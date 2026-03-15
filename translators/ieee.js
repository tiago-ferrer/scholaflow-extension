/**
 * translators/ieee.js — IEEE Xplore translator
 *
 * Handles:
 *   - ieeexplore.ieee.org/document/*
 *   - ieeexplore.ieee.org/abstract/document/*
 */

export function detect(snapshot) {
  const url = snapshot.pageUrl ?? "";
  return /ieeexplore\.ieee\.org\/(document|abstract\/document)\//i.test(url);
}

export async function extract(snapshot) {
  const m = snapshot.metaTags ?? {};
  const multi = snapshot.metaTagsMulti ?? {};

  // IEEE uses both og: and citation_ tags
  const title =
    m["citation_title"] ?? m["og:title"] ?? null;

  const authors = (multi["citation_author"] ?? []).filter(Boolean);

  const doi = m["citation_doi"] ?? null;

  const journal =
    m["citation_journal_title"] ??
    m["citation_conference_title"] ??
    m["og:site_name"] ??
    "IEEE Xplore";

  const year = parseYear(m["citation_publication_date"] ?? m["citation_year"]);

  const volume = m["citation_volume"] ?? null;
  const issue = m["citation_issue"] ?? null;
  const pages =
    m["citation_firstpage"] && m["citation_lastpage"]
      ? `${m["citation_firstpage"]}-${m["citation_lastpage"]}`
      : null;

  const abstract =
    m["citation_abstract"] ?? m["og:description"] ?? m["description"] ?? null;

  // IEEE PDF: stamp.jsp?arnumber=NNNN
  const pdfUrl =
    m["citation_pdf_url"] ??
    deriveIeeePdf(snapshot.pageUrl);

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

function deriveIeeePdf(pageUrl) {
  if (!pageUrl) return null;
  const m = pageUrl.match(/ieeexplore\.ieee\.org\/(?:document|abstract\/document)\/(\d+)/);
  if (m) return `https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=${m[1]}`;
  return null;
}

function parseYear(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}
