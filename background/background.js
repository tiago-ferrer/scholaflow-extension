/**
 * background.js — MV3 Service Worker
 *
 * ALL fetch() calls live here. The popup never makes direct network requests
 * because extension pages send an Origin header that triggers CORS errors on
 * servers that don't explicitly allow chrome-extension:// origins.
 * Background service workers with host_permissions bypass CORS entirely.
 *
 * Message protocol (popup → background):
 *   BG_LOGIN                { username, password }  → { username }
 *   BG_LOGOUT               {}                      → {}
 *   BG_GET_SESSION          {}                      → { username } | null
 *   BG_GET_SNAPSHOT_AND_METADATA  {}               → { snapshot, metadata }
 *   BG_SAVE_PAPER           { paper, attachPdf }    → { paper, pdfResult, steps }
 *
 * All responses: { ok: boolean, data?, error? }
 *
 * IMPORTANT: only auth.js and api.js are statically imported at the top level.
 * metadata.js and pdf.js are dynamically imported inside their handlers so that
 * a failure in a translator or enrichment module does not prevent the service
 * worker from registering its message listener (which would break login too).
 */

import { login, clearSession, getSession } from "../core/auth.js";
import { registerPaper } from "../core/api.js";
import { extractMetadata } from "../core/metadata.js";
import { downloadAndAttach } from "../core/pdf.js";

// ─── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "BG_LOGIN":
      handleLogin(message, sendResponse);
      return true;

    case "BG_LOGOUT":
      handleLogout(sendResponse);
      return true;

    case "BG_GET_SESSION":
      handleGetSession(sendResponse);
      return true;

    case "BG_GET_SNAPSHOT_AND_METADATA":
      handleGetMetadata(sendResponse);
      return true;

    case "BG_SAVE_PAPER":
      handleSavePaper(message, sendResponse);
      return true;

    default:
      return false;
  }
});

// ─── Auth handlers ────────────────────────────────────────────────────────────

async function handleLogin(message, sendResponse) {
  try {
    const session = await login(message.username, message.password);
    sendResponse({ ok: true, data: { username: session.username } });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

async function handleLogout(sendResponse) {
  try {
    await clearSession();
    sendResponse({ ok: true });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

async function handleGetSession(sendResponse) {
  try {
    const session = await getSession();
    if (session) {
      sendResponse({ ok: true, data: { username: session.username } });
    } else {
      sendResponse({ ok: true, data: null });
    }
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ─── Metadata handler ─────────────────────────────────────────────────────────

async function handleGetMetadata(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found");

    // Inject content script if not yet present (e.g. right after install)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/content.js"],
      });
    } catch {
      // Already injected — ignore
    }

    const contentResponse = await chrome.tabs.sendMessage(tab.id, {
      type: "PAPERHUB_GET_SNAPSHOT",
    });

    if (!contentResponse?.ok) {
      throw new Error(contentResponse?.error ?? "Failed to get page snapshot");
    }

    const snapshot = contentResponse.snapshot;

    const metadata = await extractMetadata(snapshot);

    sendResponse({ ok: true, data: { snapshot, metadata } });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ─── Save paper handler ───────────────────────────────────────────────────────

async function handleSavePaper(message, sendResponse) {
  const { paper, attachPdf } = message;
  const steps = [];

  try {
    steps.push("Registering paper…");
    const created = await registerPaper(paper);
    steps.push(`Paper saved (id: ${created.id})`);

    let pdfResult = null;
    if (attachPdf && paper.pdf_url) {
      pdfResult = await downloadAndAttach(paper.pdf_url, created.id, (progress) => {
        steps.push(progress.message);
      });
    }

    sendResponse({ ok: true, data: { paper: created, pdfResult, steps } });
  } catch (err) {
    sendResponse({ ok: false, error: err.message, steps });
  }
}
