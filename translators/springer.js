/**
 * translators/springer.js — Springer / SpringerLink translator
 *
 * Handles:
 *   - link.springer.com/article/*
 *   - link.springer.com/chapter/*
 *   - link.springer.com/book/*
 */

export function detect(snapshot) {
  const url = snapshot.pageUrl ?? "";
  return /link\.springer\.com\/(article|chapter|book|referenceworkentry)\//i.test(url);
}

export async function extract(snapshot) {
  const m = snapshot.metaTags ?? {};
  const multi = snapshot.metaTagsMulti ?? {};

  const title = m["citation_title"] ?? m["og:title"] ?? null;
  const authors = (multi["citation_author"] ?? []).filter(Boolean);
  const doi = m["citation_doi"] ?? null;

  const journal =
    m["citation_journal_title"] ??
    m["citation_book_title"] ??
    m["citation_series_title"] ??
    null;

  const year = parseYear(
    m["citation_publication_date"] ?? m["citation_cover_date"]
  );

  const volume = m["citation_volume"] ?? null;
  const issue = m["citation_issue"] ?? null;
  const pages =
    m["citation_firstpage"] && m["citation_lastpage"]
      ? `${m["citation_firstpage"]}-${m["citation_lastpage"]}`
      : m["citation_firstpage"] ?? null;

  // Springer exposes abstract in og:description
  const abstract = m["citation_abstract"] ?? m["og:description"] ?? null;

  const pdfUrl = derivePdf(snapshot.pageUrl, doi) ?? m["citation_pdf_url"];

  return {
    title,
    authors,
    journal,
    volume,
    issue,
    pages,
    year,
    doi,
    abstract,
    pdf_url: pdfUrl,
    url: snapshot.pageUrl,
  };
}

function derivePdf(pageUrl, doi) {
  if (doi) return `https://link.springer.com/content/pdf/${doi}.pdf`;
  if (!pageUrl) return null;
  const m = pageUrl.match(/link\.springer\.com\/(article|chapter)\/(.+)/);
  if (m) return `https://link.springer.com/content/pdf/${m[2]}.pdf`;
  return null;
}

function parseYear(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}
