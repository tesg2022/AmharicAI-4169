"""
Holds the Python trainer-side normalizer to the app's TypeScript pipeline.

`parity_vectors.json` is generated from the TypeScript itself
(`bun run tts/qa/make_parity_vectors.ts > tts/qa/parity_vectors.json`). This
test asserts the Python port reproduces every vector byte-for-byte.

If this fails, the model would be trained on text that differs from the text it
is served at inference. Fix the Python — never the vectors.

Run: python3 tts/qa/test_parity.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import normalize_am as N  # noqa: E402

VECTORS = Path(__file__).resolve().parent / "parity_vectors.json"

# vector key -> (callable taking the key string, human label)
CASES = {
    "expandNumbers": (N.expand_numbers, "expand_numbers"),
    "normalizeForSpeech": (N.normalize_for_speech, "normalize_for_speech"),
    "foldHomophones": (N.fold_homophones, "fold_homophones"),
    "modernizeWordspace": (N.modernize_wordspace, "modernize_wordspace"),
    "amharicRatio": (N.amharic_ratio, "amharic_ratio"),
    "countEjectives": (N.count_ejectives, "count_ejectives"),
    "numberToAmharic": (lambda k: N.number_to_amharic(int(k)), "number_to_amharic"),
    "timeToAmharic": (
        lambda k: N.time_to_amharic(int(k.split(":")[0]), int(k.split(":")[1])),
        "time_to_amharic",
    ),
    "ethiopicToNumber": (N.ethiopic_to_number, "ethiopic_to_number"),
}


def equal(got: object, want: object) -> bool:
    if isinstance(want, float) or isinstance(got, float):
        if got is None or want is None:
            return got == want
        return abs(float(got) - float(want)) < 1e-12
    return got == want


def main() -> int:
    if not VECTORS.exists():
        print(f"FAIL: {VECTORS} missing. Generate it from the TypeScript first.")
        return 2

    data = json.loads(VECTORS.read_text(encoding="utf-8"))
    passed = 0
    failures: list[str] = []

    for key, (fn, label) in CASES.items():
        table = data.get(key)
        if table is None:
            failures.append(f"{label}: no vectors under '{key}'")
            continue
        for arg, want in table.items():
            try:
                got = fn(arg)
            except Exception as exc:  # noqa: BLE001 - a raise is a failure like any other
                failures.append(f"{label}({arg!r}) raised {exc!r}")
                continue
            if equal(got, want):
                passed += 1
            else:
                failures.append(f"{label}({arg!r})\n    want: {want!r}\n    got:  {got!r}")

    total = passed + len(failures)
    print(f"parity: {passed}/{total} vectors match")
    if failures:
        print(f"\n{len(failures)} FAILURES\n" + "-" * 60)
        for f in failures[:40]:
            print(f)
        if len(failures) > 40:
            print(f"... and {len(failures) - 40} more")
        return 1
    print("OK — Python training-time normalization is identical to the app's inference-time pipeline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
