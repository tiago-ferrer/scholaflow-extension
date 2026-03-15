/**
 * translators/nature.js — Nature Publishing Group translator
 *
 * Handles:
 *   - www.nature.com/articles/*
 *   - www.nature.com/nature/journal/*
 */

export function detect(snapshot) {
  const url = snapshot.pageUrl ?? "";
  return /(?:^|\.)nature\.com\/(articles|nature\/journal)\//i.test(url);
}

export async function extract(snapshot) {
  const m = snapshot.metaTags ?? {};
  const multi = snapshot.metaTagsMulti ?? {};

  const title =
    m["citation_title"] ?? m["og:title"] ?? m["twitter:title"] ?? null;

  const authors = (multi["citation_author"] ?? []).filter(Boolean);

  const doi = m["citation_doi"] ?? null;

  const journal =
    m["citation_journal_title"] ??
    m["citation_publisher"] ??
    "Nature";

  const year = parseYear(
    m["citation_publication_date"] ?? m["citation_online_date"]
  );

  const volume = m["citation_volume"] ?? null;
  const issue = m["citation_issue"] ?? null;
  const pages =
    m["citation_firstpage"] && m["citation_lastpage"]
      ? `${m["citation_firstpage"]}-${m["citation_lastpage"]}`
      : m["citation_firstpage"] ?? null;

  const abstract =
    m["description"] ?? m["og:description"] ?? m["twitter:description"] ?? null;

  const pdfUrl = derivePdf(snapshot.pageUrl) ?? m["citation_pdf_url"];

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

function derivePdf(pageUrl) {
  if (!pageUrl) return null;
  const m = pageUrl.match(/nature\.com\/articles\/([^/?#]+)/);
  if (m) return `https://www.nature.com/articles/${m[1]}.pdf`;
  return null;
}

function parseYear(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}
