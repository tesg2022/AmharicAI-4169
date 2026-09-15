import { Link } from "wouter";
import { Mail, ShieldCheck } from "lucide-react";
import { useLegalDocument, useLegalIndex } from "../queries/legal";
import { useSeo } from "../hooks/use-seo";
import type { LegalSlug } from "../../api/content/legal";
import { Card, ErrorState, Loading, TibebRule } from "../components/ui/kit";

/**
 * One page renders all four documents — privacy, terms, about, contact.
 *
 * They share a shape (`LegalDocument`) precisely so there is one renderer and
 * therefore one place a formatting bug can live. The text itself is never held
 * here: it is fetched from the server so the policy in the app is byte-for-byte
 * the policy at the public URL, which is what Play review checks.
 *
 * Body text is rendered as plain strings, never as HTML. Nothing in a policy
 * needs markup badly enough to justify an injection surface.
 */

function Section({
  section,
}: {
  section: {
    heading: string;
    body?: string[];
    bullets?: string[];
    table?: { columns: string[]; rows: string[][] };
  };
}) {
  return (
    <section className="scroll-mt-24">
      <h2 className="font-display text-xl font-bold text-foreground">{section.heading}</h2>

      {section.body?.map((paragraph, i) => (
        <p key={i} className="mt-3 leading-relaxed text-muted-foreground">
          {paragraph}
        </p>
      ))}

      {section.bullets && section.bullets.length > 0 && (
        <ul className="mt-3 space-y-2">
          {section.bullets.map((bullet, i) => (
            <li key={i} className="flex gap-3 leading-relaxed text-muted-foreground">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/50" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      )}

      {section.table && (
        /* Scrolls rather than wraps on a phone — a three-column policy table
           squeezed into 360px is unreadable, and this is the column people are
           most likely to be reading on. */
        <div className="mt-4 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-muted/60">
                {section.table.columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="px-4 py-3 font-semibold text-foreground"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row, i) => (
                <tr key={i} className="border-t border-border align-top">
                  {row.map((cell, j) => (
                    <td key={j} className="px-4 py-3 text-muted-foreground">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function LegalPage({ slug }: { slug: LegalSlug }) {
  const doc = useLegalDocument(slug);
  const index = useLegalIndex();
  const operator = index.data?.operator;

  // The document title is what a browser bookmark and a shared link show, and
  // reviewers do check that the Privacy Policy URL is titled as one. The
  // canonical has to move with the route too — left alone, every legal page
  // points search engines back at the landing page and none of them index.
  useSeo({
    title: doc.data?.title ?? "Legal",
    description:
      doc.data?.summary ?? "AmharicAI policies, terms and contact details.",
    path: `/${slug}`,
  });

  if (doc.isLoading) return <Loading label="Loading" />;
  if (doc.error || !doc.data) {
    return <ErrorState message="This document could not be loaded." onRetry={() => doc.refetch()} />;
  }

  const document_ = doc.data;

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
          <ShieldCheck className="size-4" />
          AmharicAI
        </div>
        <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">{document_.title}</h1>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{document_.summary}</p>
        <p className="mt-4 text-sm text-muted-foreground">
          Version {document_.version} · Effective {document_.effective}
        </p>
      </header>

      <TibebRule className="my-8" />

      <div className="space-y-10">
        {document_.sections.map((section, i) => (
          <Section key={i} section={section} />
        ))}
      </div>

      {operator && (
        <Card className="mt-12">
          <p className="font-display text-base font-bold">Who publishes AmharicAI</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {operator.legal_name}, trading as {operator.trading_as} · {operator.location}
          </p>
          <a
            href={`mailto:${operator.support_email}`}
            className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <Mail className="size-4" />
            {operator.support_email}
          </a>
        </Card>
      )}

      <nav aria-label="Other documents" className="mt-8 flex flex-wrap gap-2">
        {(index.data?.documents ?? [])
          .filter((entry) => entry.slug !== slug)
          .map((entry) => (
            <Link
              key={entry.slug}
              to={`/${entry.slug}`}
              className="rounded-full border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {entry.title}
            </Link>
          ))}
      </nav>
    </div>
  );
}

export const PrivacyPage = () => <LegalPage slug="privacy" />;
export const TermsPage = () => <LegalPage slug="terms" />;
export const AboutPage = () => <LegalPage slug="about" />;
export const ContactPage = () => <LegalPage slug="contact" />;

export default LegalPage;
