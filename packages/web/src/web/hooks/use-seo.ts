import { useEffect } from "react";

/**
 * Per-page document head.
 *
 * The site is a single-page app, so the crawler-visible title and description
 * have to be written at runtime as routes change — without this every page
 * shares index.html's tags and search results list eight identical entries.
 *
 * Deliberately dependency-free: one useEffect writing four tags is less
 * machinery than a head-management library for a site this size.
 */

const SITE_NAME = "AmharicAI";
export const ORIGIN = "https://amharicai.org";

/** The one script tag this hook owns, so a route change replaces it rather than stacking. */
const JSON_LD_ID = "seo-json-ld";

function upsertMeta(selector: string, attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Writes the page's structured data, replacing whatever the previous route
 * left behind. The static Organization block in index.html is deliberately
 * left alone: it describes the site, this describes the page.
 */
function upsertJsonLd(data: unknown) {
  const existing = document.getElementById(JSON_LD_ID);
  if (data === undefined || data === null) {
    existing?.remove();
    return;
  }
  const el =
    (existing as HTMLScriptElement | null) ?? document.createElement("script");
  el.id = JSON_LD_ID;
  el.setAttribute("type", "application/ld+json");
  el.textContent = JSON.stringify(data);
  if (!existing) document.head.appendChild(el);
}

export interface Seo {
  title: string;
  description: string;
  /** Path only, e.g. "/pricing". Omitted, the canonical tag is left alone. */
  path?: string;
  /** Keep search engines off account-only screens. */
  noIndex?: boolean;
  /**
   * Use `title` verbatim instead of appending " · AmharicAI". For the homepage,
   * where the brand token has to lead the title so search results read
   * "AmharicAI — ..." rather than burying the brand at the end.
   */
  exactTitle?: boolean;
  /**
   * schema.org JSON-LD for this page — an object or an array of them. Only
   * ever describe what the deployed build really does: a Course entry for a
   * course that is not written, or an FAQ answer the page does not give, is a
   * structured-data penalty waiting to happen.
   *
   * Pass a stable value (module constant, or memoised) — it is serialised on
   * every change, and a fresh object literal per render would rewrite the tag
   * on every render.
   */
  jsonLd?: unknown;
}

export function useSeo({ title, description, path, noIndex, exactTitle, jsonLd }: Seo) {
  useEffect(() => {
    const full =
      exactTitle || title === SITE_NAME ? title : `${title} · ${SITE_NAME}`;
    document.title = full;

    upsertMeta('meta[name="description"]', "name", "description", description);
    upsertMeta('meta[property="og:title"]', "property", "og:title", full);
    upsertMeta('meta[property="og:description"]', "property", "og:description", description);
    upsertMeta('meta[property="og:site_name"]', "property", "og:site_name", SITE_NAME);
    upsertMeta('meta[property="og:type"]', "property", "og:type", "website");
    upsertMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
    upsertMeta('meta[name="twitter:title"]', "name", "twitter:title", full);
    upsertMeta(
      'meta[name="twitter:description"]',
      "name",
      "twitter:description",
      description,
    );
    upsertMeta(
      'meta[name="robots"]',
      "name",
      "robots",
      noIndex ? "noindex, nofollow" : "index, follow",
    );

    if (path) {
      upsertLink("canonical", `${ORIGIN}${path}`);
      upsertMeta('meta[property="og:url"]', "property", "og:url", `${ORIGIN}${path}`);
      // Stated explicitly rather than left to fall back to og:url, so the card
      // URL can never resolve against a non-canonical host.
      upsertMeta('meta[name="twitter:url"]', "name", "twitter:url", `${ORIGIN}${path}`);
    }

    upsertJsonLd(jsonLd);
  }, [title, description, path, noIndex, exactTitle, jsonLd]);
}
