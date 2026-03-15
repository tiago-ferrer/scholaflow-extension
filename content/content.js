/**
 * content.js — Page content script
 *
 * Responsibilities:
 *   - Collect a serialised page snapshot when requested by the popup/background
 *   - Never runs expensive extraction proactively; waits for a message
 *
 * The snapshot is a plain JSON-serialisable object that contains all data
 * the background / popup needs to run metadata extraction without further
 * DOM access.
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PAPERHUB_GET_SNAPSHOT") {
    try {
      const snapshot = buildSnapshot();
      sendResponse({ ok: true, snapshot });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
    return true;
  }

  if (message.type === "PAPERHUB_SHOW_SAVED_BADGE") {
    showSavedBadge(message.title);
    sendResponse({ ok: true });
    return true;
  }
});

// ─── Saved badge ──────────────────────────────────────────────────────────────

function showSavedBadge(title) {
  // Remove any existing badge
  document.getElementById("scholaflow-saved-badge")?.remove();

  const badge = document.createElement("div");
  badge.id = "scholaflow-saved-badge";
  badge.innerHTML = `
    <span class="ph-badge-icon">✓</span>
    <span class="ph-badge-text">Saved to Scholaflow</span>
    <button class="ph-badge-close" aria-label="Dismiss">✕</button>
  `;

  const style = document.createElement("style");
  style.textContent = `
    #scholaflow-saved-badge {
      all: initial;
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      background: #1a1a2e;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      padding: 10px 14px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.35);
      animation: ph-slidein 0.25s ease;
      max-width: 320px;
    }
    #scholaflow-saved-badge .ph-badge-icon {
      all: initial;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      background: #22c55e;
      border-radius: 50%;
      font-size: 11px;
      font-weight: 700;
      color: #fff;
      flex-shrink: 0;
    }
    #scholaflow-saved-badge .ph-badge-text {
      all: initial;
      font-family: inherit;
      font-size: 13px;
      color: #fff;
      flex: 1;
    }
    #scholaflow-saved-badge .ph-badge-close {
      all: initial;
      cursor: pointer;
      color: rgba(255,255,255,0.5);
      font-size: 12px;
      padding: 2px 4px;
      border-radius: 4px;
      line-height: 1;
    }
    #scholaflow-saved-badge .ph-badge-close:hover {
      color: #fff;
      background: rgba(255,255,255,0.1);
    }
    @keyframes ph-slidein {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(badge);

  badge.querySelector(".ph-badge-close").addEventListener("click", () => badge.remove());

  // Auto-dismiss after 6 seconds
  setTimeout(() => badge.remove(), 6000);
}

// ─── Snapshot builder ─────────────────────────────────────────────────────────

function buildSnapshot() {
  return {
    pageUrl: location.href,
    pageTitle: document.title,
    canonicalUrl: getCanonical(),
    ogUrl: getMeta("og:url", "property"),
    metaTags: collectMetaTags(),
    metaTagsMulti: collectMetaTagsMulti(),
    jsonLd: collectJsonLd(),
    pdfLinks: collectPdfLinks(),
    arxivAbstract: getArxivAbstract(),
    pageAbstract: extractPageAbstract(),
    pageText: getRelevantText(),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCanonical() {
  const el = document.querySelector('link[rel="canonical"]');
  return el?.href ?? null;
}

function getMeta(name, attr = "name") {
  const el = document.querySelector(`meta[${attr}="${name}"]`);
  return el?.content?.trim() ?? null;
}

/**
 * Collect the last value of each unique meta tag name.
 * Covers name, property, and itemprop attributes.
 */
function collectMetaTags() {
  const result = {};
  for (const el of document.querySelectorAll("meta[name], meta[property], meta[itemprop]")) {
    const key =
      el.getAttribute("name") ??
      el.getAttribute("property") ??
      el.getAttribute("itemprop");
    if (key && el.content) {
      result[key.toLowerCase()] = el.content.trim();
    }
  }
  return result;
}

/**
 * Collect all values for meta tags that may appear multiple times
 * (e.g. citation_author, citation_keywords).
 */
function collectMetaTagsMulti() {
  const result = {};
  for (const el of document.querySelectorAll("meta[name], meta[property]")) {
    const key =
      el.getAttribute("name")?.toLowerCase() ??
      el.getAttribute("property")?.toLowerCase();
    if (!key || !el.content) continue;
    if (!result[key]) result[key] = [];
    result[key].push(el.content.trim());
  }
  return result;
}

/**
 * Parse all <script type="application/ld+json"> blocks.
 */
function collectJsonLd() {
  const results = [];
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(el.textContent);
      // Handle both single objects and @graph arrays
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      } else if (parsed["@graph"]) {
        results.push(...parsed["@graph"]);
      } else {
        results.push(parsed);
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return results;
}

/**
 * Collect <a href="*.pdf"> links, capped at 5.
 */
function collectPdfLinks() {
  const links = [];
  for (const el of document.querySelectorAll("a[href]")) {
    const href = el.href;
    if (href && /\.pdf(\?[^"]*)?$/i.test(href)) {
      links.push(href);
      if (links.length >= 5) break;
    }
  }
  return links;
}

/**
 * Extract the abstract text from the page body.
 * Tries publisher-specific selectors first, then generic patterns.
 * Returns null if nothing useful is found.
 */
function extractPageAbstract() {
  // Ordered from most specific to most generic.
  // Paragraph-level selectors return joined text of all matching <p> children.
  const SELECTORS = [
    // ── arXiv ──────────────────────────────────────────────────────────────
    "blockquote.abstract",

    // ── Springer / Nature (shared Springernature platform) ─────────────────
    "#Abs1-content",
    "#abs1",
    "section[data-title='Abstract'] p",
    ".c-article-section__content p",

    // ── IEEE Xplore ────────────────────────────────────────────────────────
    ".abstract-text",
    "div.u-mb-1 p",

    // ── ACM Digital Library ────────────────────────────────────────────────
    ".abstractSection p",
    "#abstract p",
    "div[class*='abstractSection'] p",

    // ── PubMed / PubMed Central ────────────────────────────────────────────
    "#abstract-1",
    ".abstract-content p",
    "#eng-abstract p",
    "div.abstract p",

    // ── bioRxiv / medRxiv ──────────────────────────────────────────────────
    "#abstract-1 p",
    "div.section.abstract p",

    // ── Elsevier / ScienceDirect ───────────────────────────────────────────
    ".abstract.author p",
    "div.abstract p",
    "section.abstract p",

    // ── Wiley Online Library ───────────────────────────────────────────────
    ".article-section__content p",

    // ── Semantic Scholar ───────────────────────────────────────────────────
    ".tldr-abstract-replacement span",

    // ── Generic patterns (catch-all) ───────────────────────────────────────
    "[class*='abstract'] p",
    "[id*='abstract'] p",
    "section[aria-label*='abstract' i] p",
    "[class*='abstract']",
    "[id='abstract']",

    // ── Schema.org fallback ────────────────────────────────────────────────
    "[itemprop='description']",
  ];

  for (const selector of SELECTORS) {
    try {
      const elements = document.querySelectorAll(selector);
      if (!elements.length) continue;

      // Join multiple <p> results (common for multi-paragraph abstracts)
      const text = Array.from(elements)
        .map((el) => (el.innerText ?? el.textContent ?? "").trim())
        .filter((t) => t.length > 0)
        .join(" ");

      if (text.length < 50) continue; // too short to be a real abstract

      // Strip leading "Abstract" heading that some sites include in the element
      return text.replace(/^Abstract[:\s]*/i, "").trim();
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * arXiv-specific: grab abstract from the blockquote element.
 */
function getArxivAbstract() {
  if (!location.hostname.includes("arxiv.org")) return null;
  const el =
    document.querySelector("blockquote.abstract") ??
    document.querySelector("#abs");
  if (!el) return null;
  return el.textContent.replace(/^Abstract:\s*/i, "").trim();
}

/**
 * Grab a small slice of visible text near the top of the page.
 * Used as a last-resort DOI scan source. Capped at 3000 chars.
 */
function getRelevantText() {
  const body = document.body;
  if (!body) return "";
  // Prefer article/main content, fall back to body
  const root =
    body.querySelector("article") ??
    body.querySelector("main") ??
    body;
  return (root.innerText ?? root.textContent ?? "").slice(0, 3000);
}
