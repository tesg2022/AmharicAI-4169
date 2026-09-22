# AmharicAI — Canonical Brand & Search Identity: Status and Remaining Steps

**Date:** 15 September 2026 **Scope:** SEO and brand-identity cleanup only. Paystack, Hono, Better Auth, database, entitlements, pricing, plans, webhooks, course content, the Expo app and the Android package ID were not touched.

***

## Conclusion first

The code was already almost entirely correct. **The problem is DNS, not the codebase.**

`amharicai.org` resolves to WordPress.com and serves a blank "Something new is coming" placeholder. The real AmharicAI app serves on `www.amharicai.org`. Meanwhile every canonical signal the real app emits — canonical tag, `og:url`, sitemap, robots — correctly declares `https://amharicai.org/`.

The net effect is that the production site has been telling Google *"the authoritative version of this page lives at the apex"*, and the apex is a WordPress placeholder. That is the mechanism behind the search conflict, and **no code change can fix it.** It is resolved by pointing the apex at the app.

### Correction to an earlier claim in this report

I previously stated there was no Nuxt codebase. **That was wrong, and the correction is on the record here.** A Nuxt repo does exist, in a *separate* directory outside this project:

| | |
| --- | --- |
| Path | `/home/user/gh/AmharicAI` |
| Package name | `amharicai-nuxt-production-tts` |
| Remote | GitHub `tesg2022/AmharicAI` |
| Last commit | 2026-09-07 |
| Payment provider | **Stripe** — which this project has since moved off in favour of Paystack |
| Deployment config | **None.** No `vercel.json`, no `.vercel` directory, no deploy config of any kind |
| SEO state | No canonical tag, no sitemap, no Open Graph tags, no JSON-LD |

My earlier searches were scoped to `/home/user/amharicai` and missed it. The user's memory of a Nuxt site was accurate.

**It is still not what serves the public site, and this is now proven rather than asserted.** The live `https://www.amharicai.org/` homepage is **md5-identical** to `packages/web/dist/index.html` from this repo, and carries `id="root"`, `assets/index-*.js` and `data-hostname="amharic-zoinof5-website"` — the Vite build's fingerprints, with no `__NUXT__` payload anywhere. There is also no evidence of a Vercel deployment for the Nuxt repo.

So the conclusion is unchanged but the reasoning is corrected: production is the Vite + React + Hono app, the Nuxt repo is an earlier parallel implementation that was never deployed to this domain, and the canonical work belongs in this repo.

**Recommendation revised:** do **not** delete `task-accounts.md`. It is a 243-line engineering log holding the access-code security design, verified test counts, and live risk notes (including the iOS App Review risk). Its Nuxt references are a real, unshipped plan rather than an error. A clarifying note has been added at the top of that file identifying which codebase is production, which removes the confusion without destroying project history.

***

## Current configuration, as measured

| Host                 | DNS                                              | Serves                                                       |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| amharicai.org (apex) | A 192.0.78.24, 192.0.78.25 → WordPress.com       | Blank placeholder, site amharicaiorgdomainonly.wordpress.com |
| www.amharicai.org    | A 104.18.6.116, 104.18.7.116 → Cloudflare/fly.io | The real AmharicAI app                                       |

Authoritative nameservers: `ns1/ns2/ns3.wordpress.com` — so DNS is edited at WordPress.com.

**Which situation is this?** WordPress.com is acting as **registrar/DNS only**, not as the host of a competing AmharicAI website. The backing site is a domain-only placeholder (see step 3). The fix is therefore purely a DNS/custom-domain change — connecting the domain to the external host — and does not involve migrating anything or buying a redirect.

Findings on the apex placeholder:

* **No `<link rel="canonical">` at all.** It is not claiming canonical status, so nothing is actively fighting the app's own tags. It simply occupies the URL the app points at.

* Publishes a competing 2-URL sitemap: `/` and `/about/`.

* Its `robots.txt` advertises `https://amharicai.org/sitemap.xml` and `news-sitemap.xml`.

* `og:title` / `og:site_name` are the bare string `amharicai.org`, with a blank `og:image`.

Redirect behaviour:

* `http://amharicai.org` → 301 to HTTPS. Correct.

* `http://www.amharicai.org` → **200, no redirect to HTTPS.** Edge-level issue, worth raising once the apex is live.

* No redirect loops found. No redirect logic exists in the app at all.

***

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

| Record                                                               | Why it matters                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| google-site-verification=DBYuY367hlZPVJz4-pkZtlbQaw0amNgqehmR25x6kQE | Keeps amharicai.org verified in Search Console. Deleting it costs you verification. |
| v=spf1 include:\_spf.google.com ~all                                  | Your mail.                                                                          |

### Step 3 — Retire the placeholder

**This is a domain-only registration, not a competing website.** The backing site is slugged `amharicaiorgdomainonly.wordpress.com` — WordPress's own marker for a domain purchased without a site, where a placeholder is auto-created to occupy the address. Both indexed URLs (`/` and `/about/`) render the identical stub: "Something new is coming. Subscribe." There is no AmharicAI content and there are no duplicate pages of the real site.

Once the A records move, the WordPress site stops serving `amharicai.org` automatically and falls back to its `.wordpress.com` slug.

**Recommended: do not buy the Site Redirect upgrade.** It would be money spent forwarding a page with no content. WordPress distinguishes domain forwarding from connecting a domain to an external host, and this case only needs the latter. One free step is enough:

1. In that site's settings, set search-engine visibility to discourage indexing (or set the site private).

Its only indexed URLs are `/` and `/about/`, and the app already answers both — `/about` and `/about/` each return 200 — so those results heal on the next crawl instead of 404ing.

Optional, if a blog is ever wanted: keep WordPress as a separate CMS on `blog.amharicai.org` via its own DNS record. It must not occupy the apex.

### Step 4 — Search Console, after the apex serves the app

* Use the **URL Inspection** tool on `https://amharicai.org/` to see which URL Google has actually selected as canonical. This is the authoritative read on whether the fix has landed — the canonical tag is a hint Google weighs, not a command it obeys.

* Request re-indexing of `/` and `/about/`.

* Submit `https://amharicai.org/sitemap.xml`.

* Expect this to take time. Google reprocessing is not immediate and nothing here forces it.

The Search Console property for `amharicai.org` is **already verified** — the `google-site-verification` TXT record is live on the apex. This is why step 2 must preserve it.

***

## Files changed

| File                                       | Change                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| packages/web/index.html                    | Added static Organization JSON-LD. Homepage title → AmharicAI — Learn Amharic with AI. Rewrote the fallback meta description. Added twitter:url and twitter:image. |
| packages/web/src/web/pages/landing.tsx     | Homepage title and description via useSeo, matching the static fallbacks.                                                                                          |
| packages/web/src/web/hooks/use-seo.ts      | Added exactTitle option so the homepage leads with the brand token instead of appending · AmharicAI. Added per-route twitter:url.                                  |
| packages/web/src/web/components/layout.tsx | Footer line (done earlier in this task).                                                                                                                           |

***

## Item-by-item status

**1. Canonical brand — already clean.** A search for `Amharic AI`, `Amharic-AI`, `Amharic Dictionary`, `AmharicAI App` across the whole source tree returned **zero hits**. The brand is consistently `AmharicAI` everywhere. No change needed.

**2. Canonical website — correct in code, blocked on DNS.**

* `<link rel="canonical">`: `https://amharicai.org/` static, with per-route canonicals written by `use-seo.ts` from `ORIGIN = "https://amharicai.org"`. Verified at runtime: `/` → `https://amharicai.org/`, `/pricing` → `https://amharicai.org/pricing`.

* Sitemap: 12 URLs, all on the canonical apex. Every path matches a live route.

* Internal links: all relative via the router. No hardcoded absolute internal links anywhere outside metadata and the sitemap — so they follow whatever host serves them and need no change.

* Open Graph URL: `https://amharicai.org/`, updated per route. `og:image` absolute.

* Twitter card URL: **added.** Previously only `twitter:card` existed and the URL fell back to `og:url` implicitly; it is now stated explicitly, statically and per route.

* `robots.txt`: correct, points at the canonical sitemap, keeps `/admin`, `/account`, `/progress`, `/subscription`, `/sign-in` out.

* Favicon: `favicon.ico` present and referenced.

* No WordPress.com URL is exposed as canonical anywhere in the codebase.

**3. Google Play identity — reported, not changed.** `com.companyname.AmharicDictionary` appears nowhere in the repo and was not referenced, modified or mentioned on the site. **However:** `com.amharicai_zoin.capetown` currently exists only as the **iOS `bundleIdentifier`** in `packages/mobile/app.json`. The Android `package` there is the literal string `"AmharicAI"`, which is not a valid Android package name. Left untouched because the Android package ID and the Expo app are explicitly out of scope — but it needs fixing before any app/website association can work.

**4. Organization JSON-LD — added.** Static, so crawlers read it without executing JavaScript. There was no `ld+json` anywhere in the repo before. Contains `@type: Organization`, `name: AmharicAI`, `url: https://amharicai.org/`, a description, and `PostalAddress` for Cape Town / ZA. Parses as valid JSON; verified present in the production bundle.

Two deliberate omissions:

* **No `sameAs`.** There is no production Google Play URL, and inventing one was explicitly forbidden. Add it as `sameAs` once the listing exists.

* **`logo` currently points at `og-image.png`.** This is a gap: no logo asset exists in the repo — `public/images/` and `public/fonts/` contain only `.gitkeep`, and the header brand is rendered as text, not an image. `og-image.png` is a 1200×630 social card, not a proper logo. Google prefers a square, high-resolution logo. I did not generate one, since inventing brand assets was not requested. **Recommend supplying a real square logo** and pointing `logo` at it.

**5b. Logo — supplied.** A square 512x512 logo now exists at `packages/web/public/logo-512.png`, with a 192x192 variant alongside it. It is the fidel **አ** in ivory `#fbf7ef` on a rounded highland-green `#0b6e4f` field, matching the app's own design tokens. It was rendered from the real Noto Sans Ethiopic Bold font via ImageMagick rather than an image model, because image models reliably mangle Ethiopic script. The JSON-LD `logo` is now an `ImageObject` pointing at it with explicit width and height.

Treat it as a correct, on-brand functional mark, not a substitute for a designer's identity work — swap the file and the JSON-LD keeps working.

**5. Website/app relationship — not possible yet.** Needs a production Play listing and a valid Android package ID. No `.well-known/` directory exists; Digital Asset Links would go there when the time comes.

**6. SEO content — applied, with one accuracy correction.** The requested title is applied verbatim: `AmharicAI — Learn Amharic with AI`.

**The suggested meta description was not applied verbatim, deliberately.** It reads "...AI tutoring, translation and interactive learning", but your own code contradicts this:

* `plans.ts`: "Translate your own text" carries the caveat **"Needs a translation provider key. Not set in this build."**

* `/features` lists the **AI tutor as `preview`** — "Reachable and usable, but not signed off."

* Custom Amharic voice and speaking feedback are `coming_soon` — not built.

Shipping the suggested wording would claim translation is operational, which item 6 itself forbids. The description applied instead:

> Learn Amharic as an English speaker with AmharicAI: the ፊደል syllabary, pronunciation built around the sounds English lacks, a written beginner course with spaced-repetition practice, and an AI tutor in preview. Free to start.

This keeps the "AI" positioning the brand needs while only naming things that actually work. When a translation provider key is configured, the description can be widened.

**7. Existing search conflict — no action taken, as instructed.** The older app is not mentioned on the site and nothing was done to interfere with its search result. The strategy is entirely the consistent-signal work above.

**8. Footer — done and verified.** Renders exactly: `© 2026 AmharicAI · amharicai.org · Cape Town, South Africa`. Personal and legal references were left untouched in the Privacy Policy, Terms, About and Contact pages — `OPERATOR.legalName` in `src/api/content/legal.ts` still carries the legal operator name, and the FAQ publisher/jurisdiction sentence was left as-is per your decision.

**9. Architecture — unchanged.** Only the four files above were modified. None are API, billing, auth, schema, entitlement or content files.

***

## Verification results

| Check                   | Result                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| tsc --noEmit            | Clean, exit 0                                                                                                                                       |
| Billing self-test       | 59 passed, 0 failed                                                                                                                                 |
| Entitlement self-test   | 55 passed, 0 failed                                                                                                                                 |
| Production build        | Succeeded (only the pre-existing chunk-size warning)                                                                                                |
| Routes                  | All 14 return 200: /, /features, /pricing, /faq, /download, /app, /fidel, /pronunciation, /about, /contact, /privacy, /terms, /subscription, /tutor |
| Homepage rendered head  | title=AmharicAI — Learn Amharic with AI, canonical/og:url/twitter:url all https://amharicai.org/, robots=index, follow, JSON-LD present             |
| Per-route canonical     | /pricing → https://amharicai.org/pricing, title keeps · AmharicAI suffix                                                                            |
| noIndex still works     | /subscription → noindex, nofollow                                                                                                                   |
| JSON-LD in build output | Present and parses as valid JSON                                                                                                                    |
| Footer                  | Exact match to requested string                                                                                                                     |
| Redirect loops          | None                                                                                                                                                |
| Paystack / webhooks     | Untouched; both self-test suites green                                                                                                              |

One caveat on the self-tests: they need a pre-migrated SQLite file. Run them against an existing migrated DB, or a fresh file fails with `no such table: user` — that is a harness requirement, not a regression.

### What is not verified

`https://amharicai.org/` does **not** currently load the production homepage — it loads the WordPress placeholder. That line of item 10 cannot pass until steps 1–2 above are complete. Everything else in item 10 passes.

***

## Deployment note

The live `www.amharicai.org` is served from a periodic build of this repo, not instantly. As of this writing the earlier round of changes (title, canonical, `twitter:url`, JSON-LD) is **confirmed live**, while the newest logo change is built and verified locally but has not yet propagated — `https://www.amharicai.org/logo-512.png` still returns the SPA HTML fallback rather than the PNG. It will land on the next deploy; no further action is needed.

**Re-checked 2026-09-15 13:48 UTC.** Still not propagated:

- `https://www.amharicai.org/logo-512.png` → `200 text/html; charset=utf-8` (SPA fallback, not the PNG). Same for `logo-192.png`.
- Live JSON-LD `logo` still reads the old string value `"https://amharicai.org/og-image.png"` rather than the new `ImageObject` pointing at `logo-512.png`.
- Live `<title>` is `AmharicAI — Learn Amharic with AI` and live canonical is `https://amharicai.org/` — so the previous round is definitely live and the pipeline works.
- md5 of live `index.html` is `203f4722856fc51c8d6c0935e5309d23` vs local `dist/index.html` at `d8a1ff0765ba836fec1579bee03f2da0`, which is simply the expected signature of one undeployed commit.

Nothing to fix in code. Publish/redeploy the site from the Runable UI to push the logo live, or wait for the next automatic build.

## Recommended next actions
