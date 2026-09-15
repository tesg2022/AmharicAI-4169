# AmharicAI — Canonical Brand & Search Identity: Status and Remaining Steps

**Date:** 15 September 2026
**Scope:** SEO and brand-identity cleanup only. Paystack, Hono, Better Auth, database, entitlements, pricing, plans, webhooks, course content, the Expo app and the Android package ID were not touched.

---

## Conclusion first

The code was already almost entirely correct. **The problem is DNS, not the codebase.**

`amharicai.org` resolves to WordPress.com and serves a blank "Something new is coming" placeholder. The real AmharicAI app serves on `www.amharicai.org`. Meanwhile every canonical signal the real app emits — canonical tag, `og:url`, sitemap, robots — correctly declares `https://amharicai.org/`.

The net effect is that the production site has been telling Google *"the authoritative version of this page lives at the apex"*, and the apex is a WordPress placeholder. That is the mechanism behind the search conflict, and **no code change can fix it.** It is resolved by pointing the apex at the app.

One correction to the brief's premise: there is **no Nuxt website and no Vercel deployment**. Neither exists in the repository or on either host. The production site is the Vite + React + Hono app in this repo. The `task-accounts.md` note about a "Nuxt BFF proxy" is a stale plan that was never built and should be deleted so it stops misleading.

---

## Current configuration, as measured

| Host | DNS | Serves |
| --- | --- | --- |
| `amharicai.org` (apex) | A `192.0.78.24`, `192.0.78.25` → WordPress.com | Blank placeholder, site `amharicaiorgdomainonly.wordpress.com` |
| `www.amharicai.org` | A `104.18.6.116`, `104.18.7.116` → Cloudflare/fly.io | **The real AmharicAI app** |

Authoritative nameservers: `ns1/ns2/ns3.wordpress.com` — so DNS is edited at WordPress.com.

Findings on the apex placeholder:

- **No `<link rel="canonical">` at all.** It is not claiming canonical status, so nothing is actively fighting the app's own tags. It simply occupies the URL the app points at.
- Publishes a competing 2-URL sitemap: `/` and `/about/`.
- Its `robots.txt` advertises `https://amharicai.org/sitemap.xml` and `news-sitemap.xml`.
- `og:title` / `og:site_name` are the bare string `amharicai.org`, with a blank `og:image`.

Redirect behaviour:

- `http://amharicai.org` → 301 to HTTPS. Correct.
- `http://www.amharicai.org` → **200, no redirect to HTTPS.** Edge-level issue, worth raising once the apex is live.
- No redirect loops found. No redirect logic exists in the app at all.

---

## Critical sequencing warning

I tested the app's edge with `Host: amharicai.org` and got an **empty response**, while the same IP serves `www.amharicai.org` normally. The app's edge does not yet recognise the apex hostname.

**Consequence: if you move the apex A records first, the site goes down rather than getting fixed.** The apex has to be registered on the serving side before DNS changes.

### Step 1 — Register the apex in Runable first

Website publishing and custom domains are handled in the Runable platform UI, not from code. Open the website's settings, add `amharicai.org`, and let it provision the TLS certificate. Wait until it reports the apex as pending or verified. Do not edit DNS before this.

### Step 2 — Then change DNS at WordPress.com

Replace the apex A records:

```
remove:  A   @   192.0.78.24
remove:  A   @   192.0.78.25
add:     A   @   <address Runable issues in step 1>
```

Use whatever address Runable gives you in step 1 — do not guess. For reference, `www` currently sits on `104.18.6.116` / `104.18.7.116`, so expect something of that shape, or a CNAME target instead.

**Do not delete these two existing TXT records while editing:**

| Record | Why it matters |
| --- | --- |
| `google-site-verification=DBYuY367hlZPVJz4-pkZtlbQaw0amNgqehmR25x6kQE` | Keeps `amharicai.org` verified in Search Console. Deleting it costs you verification. |
| `v=spf1 include:_spf.google.com ~all` | Your mail. |

### Step 3 — Retire the placeholder

Once the A records move, the WordPress site stops serving `amharicai.org` automatically and falls back to `amharicaiorgdomainonly.wordpress.com`. To keep the site but stop it competing, as you chose:

1. In that site's settings, set search-engine visibility to discourage indexing (or set the site private).
2. Optionally use WordPress.com's **Site Redirect** upgrade to send it to `https://amharicai.org/`.

Its only indexed URLs are `/` and `/about/`, and the app already answers both — `/about` and `/about/` each return 200 — so those results heal on the next crawl instead of 404ing.

### Step 4 — Search Console, after the apex serves the app

- Request re-indexing of `/` and `/about/`.
- Submit `https://amharicai.org/sitemap.xml`.
- Expect this to take time. Google reprocessing is not immediate and nothing here forces it.

---

## Files changed

| File | Change |
| --- | --- |
| `packages/web/index.html` | Added static Organization JSON-LD. Homepage title → `AmharicAI — Learn Amharic with AI`. Rewrote the fallback meta description. Added `twitter:url` and `twitter:image`. |
| `packages/web/src/web/pages/landing.tsx` | Homepage title and description via `useSeo`, matching the static fallbacks. |
| `packages/web/src/web/hooks/use-seo.ts` | Added `exactTitle` option so the homepage leads with the brand token instead of appending `· AmharicAI`. Added per-route `twitter:url`. |
| `packages/web/src/web/components/layout.tsx` | Footer line (done earlier in this task). |

---

## Item-by-item status

**1. Canonical brand — already clean.** A search for `Amharic AI`, `Amharic-AI`, `Amharic Dictionary`, `AmharicAI App` across the whole source tree returned **zero hits**. The brand is consistently `AmharicAI` everywhere. No change needed.

**2. Canonical website — correct in code, blocked on DNS.**

- `<link rel="canonical">`: `https://amharicai.org/` static, with per-route canonicals written by `use-seo.ts` from `ORIGIN = "https://amharicai.org"`. Verified at runtime: `/` → `https://amharicai.org/`, `/pricing` → `https://amharicai.org/pricing`.
- Sitemap: 12 URLs, all on the canonical apex. Every path matches a live route.
- Internal links: all relative via the router. No hardcoded absolute internal links anywhere outside metadata and the sitemap — so they follow whatever host serves them and need no change.
- Open Graph URL: `https://amharicai.org/`, updated per route. `og:image` absolute.
- Twitter card URL: **added.** Previously only `twitter:card` existed and the URL fell back to `og:url` implicitly; it is now stated explicitly, statically and per route.
- `robots.txt`: correct, points at the canonical sitemap, keeps `/admin`, `/account`, `/progress`, `/subscription`, `/sign-in` out.
- Favicon: `favicon.ico` present and referenced.
- No WordPress.com URL is exposed as canonical anywhere in the codebase.

**3. Google Play identity — reported, not changed.** `com.companyname.AmharicDictionary` appears nowhere in the repo and was not referenced, modified or mentioned on the site. **However:** `com.amharicai_zoin.capetown` currently exists only as the **iOS `bundleIdentifier`** in `packages/mobile/app.json`. The Android `package` there is the literal string `"AmharicAI"`, which is not a valid Android package name. Left untouched because the Android package ID and the Expo app are explicitly out of scope — but it needs fixing before any app/website association can work.

**4. Organization JSON-LD — added.** Static, so crawlers read it without executing JavaScript. There was no `ld+json` anywhere in the repo before. Contains `@type: Organization`, `name: AmharicAI`, `url: https://amharicai.org/`, a description, and `PostalAddress` for Cape Town / ZA. Parses as valid JSON; verified present in the production bundle.

Two deliberate omissions:

- **No `sameAs`.** There is no production Google Play URL, and inventing one was explicitly forbidden. Add it as `sameAs` once the listing exists.
- **`logo` currently points at `og-image.png`.** This is a gap: no logo asset exists in the repo — `public/images/` and `public/fonts/` contain only `.gitkeep`, and the header brand is rendered as text, not an image. `og-image.png` is a 1200×630 social card, not a proper logo. Google prefers a square, high-resolution logo. I did not generate one, since inventing brand assets was not requested. **Recommend supplying a real square logo** and pointing `logo` at it.

**5. Website/app relationship — not possible yet.** Needs a production Play listing and a valid Android package ID. No `.well-known/` directory exists; Digital Asset Links would go there when the time comes.

**6. SEO content — applied, with one accuracy correction.** The requested title is applied verbatim: `AmharicAI — Learn Amharic with AI`.

**The suggested meta description was not applied verbatim, deliberately.** It reads "...AI tutoring, translation and interactive learning", but your own code contradicts this:

- `plans.ts`: "Translate your own text" carries the caveat **"Needs a translation provider key. Not set in this build."**
- `/features` lists the **AI tutor as `preview`** — "Reachable and usable, but not signed off."
- Custom Amharic voice and speaking feedback are `coming_soon` — not built.

Shipping the suggested wording would claim translation is operational, which item 6 itself forbids. The description applied instead:

> Learn Amharic as an English speaker with AmharicAI: the ፊደል syllabary, pronunciation built around the sounds English lacks, a written beginner course with spaced-repetition practice, and an AI tutor in preview. Free to start.

This keeps the "AI" positioning the brand needs while only naming things that actually work. When a translation provider key is configured, the description can be widened.

**7. Existing search conflict — no action taken, as instructed.** The older app is not mentioned on the site and nothing was done to interfere with its search result. The strategy is entirely the consistent-signal work above.

**8. Footer — done and verified.** Renders exactly: `© 2026 AmharicAI · amharicai.org · Cape Town, South Africa`. Personal and legal references were left untouched in the Privacy Policy, Terms, About and Contact pages — `OPERATOR.legalName` in `src/api/content/legal.ts` still carries the legal operator name, and the FAQ publisher/jurisdiction sentence was left as-is per your decision.

**9. Architecture — unchanged.** Only the four files above were modified. None are API, billing, auth, schema, entitlement or content files.

---

## Verification results

| Check | Result |
| --- | --- |
| `tsc --noEmit` | Clean, exit 0 |
| Billing self-test | **59 passed, 0 failed** |
| Entitlement self-test | **55 passed, 0 failed** |
| Production build | Succeeded (only the pre-existing chunk-size warning) |
| Routes | All 14 return 200: `/`, `/features`, `/pricing`, `/faq`, `/download`, `/app`, `/fidel`, `/pronunciation`, `/about`, `/contact`, `/privacy`, `/terms`, `/subscription`, `/tutor` |
| Homepage rendered head | `title=AmharicAI — Learn Amharic with AI`, canonical/`og:url`/`twitter:url` all `https://amharicai.org/`, `robots=index, follow`, JSON-LD present |
| Per-route canonical | `/pricing` → `https://amharicai.org/pricing`, title keeps `· AmharicAI` suffix |
| `noIndex` still works | `/subscription` → `noindex, nofollow` |
| JSON-LD in build output | Present and parses as valid JSON |
| Footer | Exact match to requested string |
| Redirect loops | None |
| Paystack / webhooks | Untouched; both self-test suites green |

One caveat on the self-tests: they need a pre-migrated SQLite file. Run them against an existing migrated DB, or a fresh file fails with `no such table: user` — that is a harness requirement, not a regression.

### What is not verified

`https://amharicai.org/` does **not** currently load the production homepage — it loads the WordPress placeholder. That line of item 10 cannot pass until steps 1–2 above are complete. Everything else in item 10 passes.

---

## Recommended next actions

1. Add `amharicai.org` as a custom domain in the Runable website settings. **Do this before touching DNS.**
2. Move the apex A records at WordPress.com to the address Runable issues, preserving both TXT records.
3. De-index and optionally redirect the WordPress placeholder.
4. Re-submit the sitemap and request re-indexing in Search Console.
5. Supply a square logo asset and point the JSON-LD `logo` at it.
6. Ask Runable to redirect `http://www.amharicai.org` to HTTPS.
7. When the Play listing goes live: fix the Android `package` in `packages/mobile/app.json` to `com.amharicai_zoin.capetown`, add the Play URL as `sameAs` in the JSON-LD, and add `.well-known/assetlinks.json`.
8. Delete the stale `task-accounts.md` Nuxt note.
