/**
 * translators/arxiv.js — ArXiv translator
 *
 * Handles:
 *   - arxiv.org/abs/*
 *   - arxiv.org/pdf/*
 *   - ar5iv.labs.arxiv.org/*
 */

/**
 * Returns true if this translator can handle the given page.
 * @param {Object} snapshot
 * @returns {boolean}
 */
export function detect(snapshot) {
  const url = snapshot.pageUrl ?? "";
  return (
    /arxiv\.org\/(abs|pdf|html)\//.test(url) ||
    /ar5iv\.labs\.arxiv\.org/.test(url)
  );
}

/**
 * Extract metadata from an arXiv page snapshot.
 * @param {Object} snapshot
 * @returns {Promise<Object>}
 */
export async function extract(snapshot) {
  const m = snapshot.metaTags ?? {};
  const multi = snapshot.metaTagsMulti ?? {};

  // arXiv exposes rich citation_* meta tags
  const title = m["citation_title"] ?? m["og:title"] ?? null;
  const authors = (multi["citation_author"] ?? []).filter(Boolean);
  const doi = m["citation_doi"] ?? extractArxivDoi(snapshot.pageUrl);

  // arXiv abstract from <blockquote class="abstract">
  const abstract =
    snapshot.arxivAbstract ??
    m["citation_abstract"] ??
    m["og:description"] ??
    null;

  const year = parseYear(m["citation_date"] ?? m["citation_publication_date"]);

  // PDF URL
  const pdfUrl = deriveArxivPdf(snapshot.pageUrl) ?? m["citation_pdf_url"];

  // Use the meta tag journal if present (set for published papers), otherwise
  // leave null so DOI enrichment can fill in the real journal/volume/issue.
  const journal =
    m["citation_journal_title"] ??
    m["citation_conference_title"] ??
    null;

  return {
    title,
    authors,
    journal,
    volume: m["citation_volume"] ?? null,
    issue:  m["citation_issue"] ?? null,
    pages:
      m["citation_firstpage"] && m["citation_lastpage"]
        ? `${m["citation_firstpage"]}-${m["citation_lastpage"]}`
        : null,
    year,
    doi,
    abstract: abstract ? abstract.replace(/^Abstract:\s*/i, "").trim() : null,
    pdf_url: pdfUrl,
    categories: parseArxivCategories(m["citation_categories"] ?? ""),
    url: snapshot.pageUrl,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deriveArxivPdf(pageUrl) {
  if (!pageUrl) return null;
  const m = pageUrl.match(/arxiv\.org\/(?:abs|html)\/([^?#]+)/);
  if (m) return `https://arxiv.org/pdf/${m[1]}.pdf`;
  return null;
}

function extractArxivDoi(pageUrl) {
  if (!pageUrl) return null;
  const m = pageUrl.match(/arxiv\.org\/abs\/([^?#]+)/);
  if (m) return `10.48550/arXiv.${m[1]}`;
  return null;
}

function parseYear(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

function parseArxivCategories(raw) {
  return raw
    .split(/[,\s]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}
