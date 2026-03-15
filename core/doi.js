/**
 * doi.js — DOI detection and metadata enrichment via external APIs
 *
 * Strategies (in priority order):
 *   1. meta[name="citation_doi"]
 *   2. meta[name="dc.identifier"]
 *   3. Regex scan of visible URL and page text
 *
 * Fallback enrichment APIs (tried in order until one succeeds):
 *   1. Crossref  — richest bibliographic data
 *   2. OpenAlex  — open scholarly graph
 *   3. Semantic Scholar — citation counts + abstracts
 */

const DOI_REGEX = /\b(10\.\d{4,9}\/[^\s"'<>]+)/g;

/**
 * Extract a DOI from the current page context (document object).
 * Safe to call from both content script and background (via serialised DOM snapshot).
 *
 * @param {Object} snapshot  — serialised page data from content script
 * @returns {string|null}
 */
export function extractDOIFromSnapshot(snapshot) {
  // 1. citation_doi meta tag
  if (snapshot.metaTags?.["citation_doi"]) {
    return cleanDOI(snapshot.metaTags["citation_doi"]);
  }

  // 2. DC identifier
  const dcId = snapshot.metaTags?.["dc.identifier"] ?? snapshot.metaTags?.["DC.identifier"];
  if (dcId && dcId.startsWith("10.")) {
    return cleanDOI(dcId);
  }

  // 3. og:url or canonical
  for (const url of [snapshot.canonicalUrl, snapshot.ogUrl, snapshot.pageUrl]) {
    if (!url) continue;
    const match = url.match(DOI_REGEX);
    if (match) return cleanDOI(match[0]);
  }

  // 4. Full text scan of collected text
  if (snapshot.pageText) {
    const matches = [...snapshot.pageText.matchAll(DOI_REGEX)];
    if (matches.length > 0) return cleanDOI(matches[0][1]);
  }

  return null;
}

/**
 * Remove trailing punctuation and URL fragments from a raw DOI string.
 * @param {string} raw
 * @returns {string}
 */
function cleanDOI(raw) {
  return raw.replace(/[.,;)\]}>'"]+$/, "").trim();
}

// ─── External API enrichment ──────────────────────────────────────────────────

/**
 * Fetch enriched metadata for a DOI.
 * Tries Crossref → OpenAlex → Semantic Scholar.
 *
 * @param {string} doi
 * @returns {Promise<Object>}  normalised metadata object (may be partial)
 */
export async function enrichFromDOI(doi) {
  const sources = [fetchCrossref, fetchOpenAlex, fetchSemanticScholar];
  let merged = {};

  for (const source of sources) {
    try {
      const data = await source(doi);
      if (data) {
        merged = mergeMetadata(merged, data);
        // If we have title + authors we're good enough
        if (merged.title && merged.authors?.length) break;
      }
    } catch {
      // try next source
    }
  }

  return merged;
}

// ─── Crossref ────────────────────────────────────────────────────────────────

async function fetchCrossref(doi) {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Scholaflow/1.0 (mailto:support@scholaflow.dev)" },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const w = json?.message;
  if (!w) return null;

  return {
    title: w.title?.[0] ?? null,
    authors: (w.author ?? []).map((a) =>
      [a.given, a.family].filter(Boolean).join(" ")
    ),
    journal:
      w["container-title"]?.[0] ??
      w["short-container-title"]?.[0] ??
      null,
    volume: w.volume ?? null,
    issue: w.issue ?? null,
    pages: w.page ?? null,
    year:
      w.published?.["date-parts"]?.[0]?.[0] ??
      w["published-print"]?.["date-parts"]?.[0]?.[0] ??
      null,
    doi: w.DOI ?? doi,
    abstract: stripJatsXml(w.abstract ?? ""),
    citation_count: w["is-referenced-by-count"] ?? 0,
    categories: w.subject ?? [],
  };
}

// ─── OpenAlex ────────────────────────────────────────────────────────────────

async function fetchOpenAlex(doi) {
  const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Scholaflow/1.0" },
  });
  if (!res.ok) return null;
  const w = await res.json();

  return {
    title: w.title ?? null,
    authors: (w.authorships ?? []).map(
      (a) => a.author?.display_name ?? ""
    ).filter(Boolean),
    journal: w.primary_location?.source?.display_name ?? null,
    volume: w.biblio?.volume ?? null,
    issue: w.biblio?.issue ?? null,
    pages: w.biblio?.first_page
      ? `${w.biblio.first_page}${w.biblio.last_page ? `-${w.biblio.last_page}` : ""}`
      : null,
    year: w.publication_year ?? null,
    doi: w.doi?.replace("https://doi.org/", "") ?? doi,
    abstract: reconstructAbstract(w.abstract_inverted_index),
    citation_count: w.cited_by_count ?? 0,
    categories: (w.topics ?? []).map((t) => t.display_name),
  };
}

// ─── Semantic Scholar ─────────────────────────────────────────────────────────

async function fetchSemanticScholar(doi) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(doi)}?fields=title,authors,year,abstract,citationCount,venue,externalIds`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const p = await res.json();

  return {
    title: p.title ?? null,
    authors: (p.authors ?? []).map((a) => a.name).filter(Boolean),
    journal: p.venue ?? null,
    year: p.year ?? null,
    doi: p.externalIds?.DOI ?? doi,
    abstract: p.abstract ?? null,
    citation_count: p.citationCount ?? 0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Merge two metadata objects, preferring non-empty values from `override`.
 */
function mergeMetadata(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (!result[key] || (Array.isArray(result[key]) && result[key].length === 0)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Strip JATS XML tags from Crossref abstracts.
 */
function stripJatsXml(text) {
  return text.replace(/<[^>]+>/g, "").trim();
}

/**
 * Reconstruct an abstract from OpenAlex inverted index format.
 * @param {Object|null} invertedIndex  — { word: [positions...] }
 */
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return null;
  const entries = Object.entries(invertedIndex);
  if (entries.length === 0) return null;

  const words = [];
  for (const [word, positions] of entries) {
    for (const pos of positions) {
      words[pos] = word;
    }
  }
  return words.filter(Boolean).join(" ");
}
