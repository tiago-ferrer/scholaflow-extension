/**
 * metadata.js — Metadata extraction orchestrator
 *
 * Extraction pipeline (in priority order):
 *   1. Publisher translator (arxiv, springer, nature, ieee, acm)
 *   2. citation_* meta tags (Highwire Press / Google Scholar)
 *   3. Dublin Core meta tags
 *   4. Open Graph / Twitter Card
 *   5. Schema.org JSON-LD
 *   6. DOI enrichment via Crossref / OpenAlex / Semantic Scholar
 *
 * All extractors receive a normalised `snapshot` object produced by content.js.
 */

import { extractDOIFromSnapshot, enrichFromDOI } from "./doi.js";
import { detectPdfUrl } from "./pdf.js";

// Translator registry — loaded lazily
const TRANSLATOR_MODULES = {
  arxiv: () => import("../translators/arxiv.js"),
  springer: () => import("../translators/springer.js"),
  nature: () => import("../translators/nature.js"),
  ieee: () => import("../translators/ieee.js"),
  acm: () => import("../translators/acm.js"),
};

/**
 * @typedef {Object} PaperMetadata
 * @property {string}   title
 * @property {string[]} authors
 * @property {string}   [journal]
 * @property {string}   [volume]
 * @property {string}   [issue]
 * @property {string}   [pages]
 * @property {number}   [year]
 * @property {string}   [doi]
 * @property {string}   [abstract]
 * @property {string}   [url]
 * @property {string}   [pdf_url]
 * @property {string[]} [categories]
 * @property {number}   [citation_count]
 * @property {string}   [_source]   — which extractor produced the result
 */

/**
 * Main entry point. Given a page snapshot, return the best available metadata.
 *
 * @param {Object} snapshot  — from content.js
 * @returns {Promise<PaperMetadata>}
 */
export async function extractMetadata(snapshot) {
  let meta = {};

  // 1. Publisher translators
  for (const [name, load] of Object.entries(TRANSLATOR_MODULES)) {
    try {
      const mod = await load();
      if (mod.detect(snapshot)) {
        const extracted = await mod.extract(snapshot);
        if (extracted?.title) {
          meta = merge(meta, extracted);
          meta._source = name;
          break;
        }
      }
    } catch {
      // translator failed, continue
    }
  }

  // 2. citation_* meta tags
  if (!meta.title) {
    meta = merge(meta, extractCitationMeta(snapshot));
    if (meta.title) meta._source = "citation_meta";
  }

  // 3. Dublin Core
  if (!meta.title) {
    meta = merge(meta, extractDublinCore(snapshot));
    if (meta.title) meta._source = "dublin_core";
  }

  // 4. Open Graph / Twitter
  if (!meta.title) {
    meta = merge(meta, extractOpenGraph(snapshot));
    if (meta.title) meta._source = "opengraph";
  }

  // 5. Schema.org JSON-LD
  if (!meta.title) {
    meta = merge(meta, extractJsonLd(snapshot));
    if (meta.title) meta._source = "json_ld";
  }

  // 6. DOI extraction then API enrichment
  const doi = meta.doi ?? extractDOIFromSnapshot(snapshot);
  if (doi) {
    meta.doi = doi;
    if (!meta.title || !meta.authors?.length) {
      try {
        const enriched = await enrichFromDOI(doi);
        meta = merge(meta, enriched);
        if (!meta._source) meta._source = "doi_api";
      } catch {
        // enrichment failed — use what we have
      }
    }
  }

  // Always include page URL
  if (!meta.url) meta.url = snapshot.pageUrl;

  // PDF URL
  meta.pdf_url = detectPdfUrl(snapshot);

  // pageAbstract from content script DOM extraction overrides short/missing abstracts.
  // Applied last so it wins over truncated og:description values.
  if (snapshot.pageAbstract && snapshot.pageAbstract.length > (meta.abstract?.length ?? 0)) {
    meta.abstract = snapshot.pageAbstract;
  }

  return sanitise(meta);
}

// ─── Extractor: citation_* meta tags ─────────────────────────────────────────

function extractCitationMeta(snapshot) {
  const m = snapshot.metaTags ?? {};

  const authors = collectMultivalue(snapshot.metaTagsMulti?.["citation_author"]);

  return {
    title: m["citation_title"] ?? null,
    authors,
    journal: m["citation_journal_title"] ?? m["citation_conference_title"] ?? null,
    volume: m["citation_volume"] ?? null,
    issue: m["citation_issue"] ?? null,
    pages:
      m["citation_firstpage"] && m["citation_lastpage"]
        ? `${m["citation_firstpage"]}-${m["citation_lastpage"]}`
        : m["citation_firstpage"] ?? null,
    year: parseYear(m["citation_publication_date"] ?? m["citation_year"]),
    doi: m["citation_doi"] ?? null,
    abstract: m["citation_abstract"] ?? null,
    categories: m["citation_keywords"]
      ? m["citation_keywords"].split(/[,;]/).map((k) => k.trim())
      : [],
  };
}

// ─── Extractor: Dublin Core ───────────────────────────────────────────────────

function extractDublinCore(snapshot) {
  const m = snapshot.metaTags ?? {};
  const multi = snapshot.metaTagsMulti ?? {};

  const title =
    m["dc.title"] ?? m["DC.title"] ?? m["dc.Title"] ?? null;

  const creators = collectMultivalue(
    multi["dc.creator"] ?? multi["DC.creator"]
  );

  return {
    title,
    authors: creators,
    journal: m["dc.source"] ?? m["DC.source"] ?? null,
    year: parseYear(m["dc.date"] ?? m["DC.date"]),
    doi: extractDoiFromValue(m["dc.identifier"] ?? m["DC.identifier"]),
    abstract: m["dc.description"] ?? m["DC.description"] ?? null,
    categories: collectMultivalue(multi["dc.subject"] ?? multi["DC.subject"]),
  };
}

// ─── Extractor: Open Graph ────────────────────────────────────────────────────

function extractOpenGraph(snapshot) {
  const m = snapshot.metaTags ?? {};
  return {
    title: m["og:title"] ?? m["twitter:title"] ?? null,
    abstract: m["og:description"] ?? m["twitter:description"] ?? null,
    url: m["og:url"] ?? null,
  };
}

// ─── Extractor: Schema.org JSON-LD ───────────────────────────────────────────

function extractJsonLd(snapshot) {
  if (!snapshot.jsonLd?.length) return {};

  for (const obj of snapshot.jsonLd) {
    const type = obj["@type"];
    if (!["ScholarlyArticle", "Article", "TechArticle", "NewsArticle"].includes(type)) {
      continue;
    }

    const authors = [];
    const rawAuthors = Array.isArray(obj.author) ? obj.author : obj.author ? [obj.author] : [];
    for (const a of rawAuthors) {
      if (typeof a === "string") authors.push(a);
      else if (a.name) authors.push(a.name);
    }

    return {
      title: obj.headline ?? obj.name ?? null,
      authors,
      journal: obj.isPartOf?.name ?? obj.publisher?.name ?? null,
      year: parseYear(obj.datePublished),
      doi: extractDoiFromValue(obj.identifier ?? obj.sameAs),
      abstract: obj.description ?? obj.abstract ?? null,
    };
  }

  return {};
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function merge(base, override) {
  if (!override) return base;
  const result = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && !v.trim()) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (!result[k] || (Array.isArray(result[k]) && result[k].length === 0)) {
      result[k] = v;
    }
  }
  return result;
}

function collectMultivalue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value].filter(Boolean);
}

function parseYear(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

function extractDoiFromValue(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const m = value.match(/10\.\d{4,9}\/\S+/);
    return m ? m[0].replace(/[.,;)\]}>'"]+$/, "") : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const result = extractDoiFromValue(v);
      if (result) return result;
    }
  }
  return null;
}

/**
 * Sanitise metadata — strip HTML, truncate, validate types.
 * @param {Object} meta
 * @returns {PaperMetadata}
 */
function sanitise(meta) {
  const strip = (s) =>
    typeof s === "string"
      ? s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      : s;

  return {
    title: strip(meta.title) || "Untitled",
    authors: (meta.authors ?? []).map(strip).filter(Boolean),
    journal: strip(meta.journal) || null,
    volume: strip(meta.volume) || null,
    issue: strip(meta.issue) || null,
    pages: strip(meta.pages) || null,
    year: typeof meta.year === "number" ? meta.year : parseYear(meta.year),
    doi: strip(meta.doi) || null,
    abstract: strip(meta.abstract) || null,
    url: meta.url || null,
    pdf_url: meta.pdf_url || null,
    categories: (meta.categories ?? []).map(strip).filter(Boolean),
    citation_count: typeof meta.citation_count === "number" ? meta.citation_count : 0,
    _source: meta._source ?? "unknown",
  };
}
