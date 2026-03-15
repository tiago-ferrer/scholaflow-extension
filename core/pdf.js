/**
 * pdf.js — PDF URL detection and download pipeline
 *
 * Detection priority:
 *   1. meta[name="citation_pdf_url"]
 *   2. <a href="...pdf"> links on the page
 *   3. Publisher-specific heuristics (arXiv, Springer, Nature, ACM, IEEE)
 *
 * Download pipeline:
 *   fetch(pdfUrl) → Blob → uploadAttachment(paperId, blob)
 */

import { uploadAttachment } from "./api.js";

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Detect the best PDF URL from a serialised page snapshot.
 *
 * @param {Object} snapshot   — produced by content.js
 * @returns {string|null}
 */
export function detectPdfUrl(snapshot) {
  // 1. citation_pdf_url meta tag (highest confidence)
  const metaPdf =
    snapshot.metaTags?.["citation_pdf_url"] ??
    snapshot.metaTags?.["citation_fulltext_html_url"];
  if (metaPdf && looksLikePdf(metaPdf)) return metaPdf;

  // 2. Publisher-specific heuristics based on page URL
  const publisherPdf = publisherPdfUrl(snapshot.pageUrl, snapshot.metaTags);
  if (publisherPdf) return publisherPdf;

  // 3. Anchor links ending in .pdf from the snapshot
  if (snapshot.pdfLinks?.length) {
    return snapshot.pdfLinks[0];
  }

  return null;
}

/**
 * Check whether a URL looks like it points to a PDF.
 * @param {string} url
 */
function looksLikePdf(url) {
  try {
    const u = new URL(url);
    return (
      u.pathname.endsWith(".pdf") ||
      u.searchParams.get("format") === "pdf" ||
      /\/pdf\//i.test(u.pathname)
    );
  } catch {
    return url.toLowerCase().includes(".pdf");
  }
}

/**
 * Publisher-specific PDF URL derivation.
 * @param {string} pageUrl
 * @param {Object} metaTags
 * @returns {string|null}
 */
function publisherPdfUrl(pageUrl, metaTags = {}) {
  if (!pageUrl) return null;

  try {
    const u = new URL(pageUrl);
    const host = u.hostname.toLowerCase();
    const path = u.pathname;

    // arXiv — abs → pdf
    if (host.includes("arxiv.org")) {
      const m = path.match(/\/abs\/([^/]+)/);
      if (m) return `https://arxiv.org/pdf/${m[1]}.pdf`;
    }

    // Springer
    if (host.includes("springer.com") || host.includes("link.springer.com")) {
      const m = path.match(/\/article\/(.+)/);
      if (m) return `https://link.springer.com/content/pdf/${m[1]}.pdf`;
    }

    // Nature
    if (host.includes("nature.com")) {
      const m = path.match(/\/articles\/([^/]+)/);
      if (m) return `https://www.nature.com/articles/${m[1]}.pdf`;
    }

    // ACM DL
    if (host.includes("dl.acm.org")) {
      const m = path.match(/\/doi(?:\/abs|\/full)?\/(.+)/);
      if (m) return `https://dl.acm.org/doi/pdf/${m[1]}`;
    }

    // IEEE Xplore
    if (host.includes("ieeexplore.ieee.org")) {
      const m = path.match(/\/document\/(\d+)/);
      if (m) return `https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=${m[1]}`;
    }

    // PubMed Central
    if (host.includes("ncbi.nlm.nih.gov") && path.includes("/pmc/")) {
      const m = path.match(/\/pmc\/articles\/(PMC\d+)/);
      if (m) return `https://www.ncbi.nlm.nih.gov/pmc/articles/${m[1]}/pdf/`;
    }

    // bioRxiv / medRxiv
    if (host.includes("biorxiv.org") || host.includes("medrxiv.org")) {
      const m = path.match(/\/content\/([^/]+\/[^/]+)/);
      if (m) return `${u.origin}/content/${m[1]}.full.pdf`;
    }
  } catch {
    // ignore URL parse errors
  }

  return null;
}

// ─── Download pipeline ────────────────────────────────────────────────────────

/**
 * Download a PDF from `pdfUrl` and upload it as an attachment to `paperId`.
 *
 * @param {string} pdfUrl
 * @param {string} paperId
 * @param {function} [onProgress]  — optional callback({ phase: 'downloading'|'uploading'|'done'|'error', message })
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function downloadAndAttach(pdfUrl, paperId, onProgress) {
  const notify = onProgress ?? (() => {});

  try {
    notify({ phase: "downloading", message: "Downloading PDF…" });

    const response = await fetch(pdfUrl, {
      // Include credentials for publisher SSO cookies
      credentials: "include",
      headers: {
        Accept: "application/pdf,*/*",
      },
    });

    if (!response.ok) {
      throw new Error(`PDF fetch failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.includes("pdf") &&
      !contentType.includes("octet-stream") &&
      !contentType.includes("application/")
    ) {
      // Likely a paywall redirect to an HTML page
      throw new Error("Response does not appear to be a PDF (possible paywall)");
    }

    const blob = await response.blob();

    if (blob.size < 1024) {
      throw new Error("Downloaded file is too small to be a valid PDF");
    }

    notify({ phase: "uploading", message: "Uploading PDF to Scholaflow…" });
    await uploadAttachment(paperId, blob, "paper.pdf");

    notify({ phase: "done", message: "PDF attached successfully." });
    return { success: true };
  } catch (err) {
    const message = err.message ?? String(err);
    notify({ phase: "error", message });
    return { success: false, error: message };
  }
}
