/**
 * translators/acm.js — ACM Digital Library translator
 *
 * Handles:
 *   - dl.acm.org/doi/*
 *   - dl.acm.org/doi/abs/*
 *   - dl.acm.org/doi/full/*
 */

export function detect(snapshot) {
  const url = snapshot.pageUrl ?? "";
  return /dl\.acm\.org\/doi\//i.test(url);
}

export async function extract(snapshot) {
  const m = snapshot.metaTags ?? {};
  const multi = snapshot.metaTagsMulti ?? {};

  const title =
    m["citation_title"] ?? m["og:title"] ?? null;

  const authors = (multi["citation_author"] ?? []).filter(Boolean);

  const doi =
    m["citation_doi"] ??
    extractDoiFromUrl(snapshot.pageUrl);

  const journal =
    m["citation_journal_title"] ??
    m["citation_conference_title"] ??
    m["citation_technical_report_institution"] ??
    null;

  const year = parseYear(m["citation_publication_date"] ?? m["citation_year"]);

  const volume = m["citation_volume"] ?? null;
  const issue = m["citation_issue"] ?? null;
  const pages =
    m["citation_firstpage"] && m["citation_lastpage"]
      ? `${m["citation_firstpage"]}-${m["citation_lastpage"]}`
      : null;

  const abstract =
    m["citation_abstract"] ?? m["og:description"] ?? m["description"] ?? null;

  const pdfUrl =
    m["citation_pdf_url"] ??
    deriveAcmPdf(snapshot.pageUrl, doi);

  const categories = (multi["citation_keywords"] ?? []).flatMap((kw) =>
    kw.split(/[,;]/).map((k) => k.trim()).filter(Boolean)
  );

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
    categories,
    url: snapshot.pageUrl,
  };
}

function deriveAcmPdf(pageUrl, doi) {
  if (doi) return `https://dl.acm.org/doi/pdf/${doi}`;
  if (!pageUrl) return null;
  const m = pageUrl.match(/dl\.acm\.org\/doi\/(?:abs|full)?\/?(10\..+)/);
  if (m) return `https://dl.acm.org/doi/pdf/${m[1]}`;
  return null;
}

function extractDoiFromUrl(pageUrl) {
  if (!pageUrl) return null;
  const m = pageUrl.match(/(10\.\d{4,9}\/[^\s?#]+)/);
  return m ? m[1].replace(/[.,;)\]}>'"]+$/, "") : null;
}

function parseYear(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}
