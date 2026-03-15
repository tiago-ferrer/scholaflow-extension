/**
 * api.js — Scholaflow REST API client
 *
 * All requests automatically include the Authorization header.
 * Throws descriptive errors on non-2xx responses.
 */

import { getAuthHeader } from "./auth.js";

const API_BASE = "https://b-paperhub.tferrer.dev";

/**
 * @typedef {Object} PaperPayload
 * @property {string}   title
 * @property {string[]} authors
 * @property {string}   [journal]
 * @property {string}   [volume]
 * @property {string}   [issue]
 * @property {string}   [pages]
 * @property {number}   [year]
 * @property {string}   [doi]
 * @property {string[]} [categories]
 * @property {string}   [category]
 * @property {string}   [url]
 * @property {string}   [abstract]
 * @property {number}   [citation_count]
 */

/**
 * @typedef {Object} CreatedPaper
 * @property {string} id
 * @property {string} title
 * @property {string} [doi]
 */

/**
 * Perform an authenticated JSON fetch.
 * @param {string} path
 * @param {RequestInit} options
 * @returns {Promise<any>}
 */
async function apiFetch(path, options = {}) {
  const authHeader = await getAuthHeader();

  const headers = {
    Authorization: authHeader,
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = `API error ${response.status}`;
    try {
      const body = await response.json();
      message = body?.detail ?? body?.message ?? message;
    } catch {
      // ignore JSON parse error
    }
    throw new Error(message);
  }

  // 204 No Content
  if (response.status === 204) return null;

  return response.json();
}

/**
 * Register a new paper in Scholaflow.
 * @param {PaperPayload} paper
 * @returns {Promise<CreatedPaper>}
 */
export async function registerPaper(paper) {
  // Ensure required fields have sensible defaults
  const payload = {
    title: paper.title ?? "Untitled",
    authors: paper.authors ?? [],
    year: paper.year ?? null,
    journal: paper.journal ?? "",
    volume: paper.volume ?? "",
    issue: paper.issue ?? "",
    pages: paper.pages ?? "",
    doi: paper.doi ?? "",
    categories: paper.categories ?? [],
    category: paper.category ?? (paper.categories?.[0] ?? ""),
    url: paper.url ?? "",
    abstract: paper.abstract ?? "",
    citation_count: paper.citation_count ?? 0,
  };

  return apiFetch("/api/v1/papers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Upload a PDF attachment to a paper.
 * @param {string} paperId   — UUID returned by registerPaper
 * @param {Blob}   pdfBlob
 * @param {string} [filename]
 * @returns {Promise<any>}
 */
export async function uploadAttachment(paperId, pdfBlob, filename = "paper.pdf") {
  const authHeader = await getAuthHeader();

  const formData = new FormData();
  formData.append("file", pdfBlob, filename);

  const response = await fetch(
    `${API_BASE}/api/v1/papers/${encodeURIComponent(paperId)}/attachments`,
    {
      method: "POST",
      headers: { Authorization: authHeader },
      body: formData,
    }
  );

  if (!response.ok) {
    let message = `Attachment upload failed (${response.status})`;
    try {
      const body = await response.json();
      message = body?.detail ?? body?.message ?? message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}
