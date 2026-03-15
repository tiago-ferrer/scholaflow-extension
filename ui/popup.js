/**
 * popup.js — Scholaflow popup controller
 *
 * Panel flow (inside view-paper):
 *   panel-idle       → user clicks "Detect Paper"
 *   panel-detecting  → spinner while background scans the page
 *   panel-none       → nothing found; "Try again" resets to idle
 *   paper-form       → metadata form; "← Back" resets to idle
 *
 * After a successful save the background notifies the content script to
 * inject a "Saved to Scholaflow" badge directly on the page.
 */

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const viewLoading    = document.getElementById("view-loading");
const viewLogin      = document.getElementById("view-login");
const viewPaper      = document.getElementById("view-paper");

// Login
const loginForm      = document.getElementById("login-form");
const inputUsername  = document.getElementById("input-username");
const inputPassword  = document.getElementById("input-password");
const btnLogin       = document.getElementById("btn-login");
const loginError     = document.getElementById("login-error");

// Paper view — panels
const headerUsername = document.getElementById("header-username");
const btnLogout      = document.getElementById("btn-logout");
const panelIdle      = document.getElementById("panel-idle");
const panelDetecting = document.getElementById("panel-detecting");
const panelNone      = document.getElementById("panel-none");
const panelNoneMsg   = document.getElementById("panel-none-msg");
const btnDetect      = document.getElementById("btn-detect");
const btnRetry       = document.getElementById("btn-retry");

// Paper form
const paperForm      = document.getElementById("paper-form");
const sourceBadge    = document.getElementById("source-badge");
const sourceLabel    = document.getElementById("source-label");
const btnReset       = document.getElementById("btn-reset");
const fieldTitle     = document.getElementById("field-title");
const fieldAuthors   = document.getElementById("field-authors");
const fieldJournal   = document.getElementById("field-journal");
const fieldYear      = document.getElementById("field-year");
const fieldVolume    = document.getElementById("field-volume");
const fieldIssue     = document.getElementById("field-issue");
const fieldPages     = document.getElementById("field-pages");
const fieldDoi       = document.getElementById("field-doi");
const fieldAbstract  = document.getElementById("field-abstract");
const chkPdf         = document.getElementById("chk-pdf");
const pdfUrlBadge    = document.getElementById("pdf-url-badge");
const btnSave        = document.getElementById("btn-save");
const saveError      = document.getElementById("save-error");
const saveSuccess    = document.getElementById("save-success");
const progressLog    = document.getElementById("progress-log");

// ─── State ────────────────────────────────────────────────────────────────────

let currentMetadata = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  showView("loading");
  try {
    const res = await chrome.runtime.sendMessage({ type: "BG_GET_SESSION" });
    if (res?.data) {
      showPaperView(res.data.username);
    } else {
      showView("login");
      inputUsername.focus();
    }
  } catch (err) {
    console.error("Scholaflow:", err.message);
    showView("login");
    inputUsername.focus();
  }
})();

// ─── Login ────────────────────────────────────────────────────────────────────

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = inputUsername.value.trim();
  const password = inputPassword.value;

  if (!username || !password) {
    showError(loginError, "Please enter username and password.");
    return;
  }

  setButtonLoading(btnLogin, true);
  hideEl(loginError);

  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: "BG_LOGIN", username, password });
  } catch (err) {
    showError(loginError, "Extension error: " + err.message);
    setButtonLoading(btnLogin, false);
    return;
  }

  if (res?.ok) {
    showPaperView(res.data.username);
  } else {
    showError(loginError, res?.error ?? "Login failed. Please try again.");
    setButtonLoading(btnLogin, false);
  }
});

// ─── Logout ───────────────────────────────────────────────────────────────────

btnLogout.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "BG_LOGOUT" });
  currentMetadata = null;
  showView("login");
  inputUsername.value = "";
  inputPassword.value = "";
  inputUsername.focus();
});

// ─── Paper view ───────────────────────────────────────────────────────────────

function showPaperView(username) {
  headerUsername.textContent = username ?? "";
  showView("paper");
  showPanel("idle");
}

// ─── Detect button ────────────────────────────────────────────────────────────

btnDetect.addEventListener("click", runDetection);
btnRetry.addEventListener("click", () => showPanel("idle"));
btnReset.addEventListener("click", () => {
  currentMetadata = null;
  paperForm.reset();
  clearMessages();
  resetProgressLog();
  btnSave.disabled = false;
  showPanel("idle");
});

async function runDetection() {
  showPanel("detecting");

  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: "BG_GET_SNAPSHOT_AND_METADATA" });
  } catch (err) {
    showPanel("none");
    panelNoneMsg.textContent = "Extension error: " + err.message;
    return;
  }

  if (!res?.ok) {
    showPanel("none");
    panelNoneMsg.textContent = res?.error ?? "Could not extract metadata.";
    return;
  }

  const { metadata } = res.data;
  currentMetadata = metadata;

  if (!metadata?.title || metadata.title === "Untitled") {
    showPanel("none");
    panelNoneMsg.textContent = "No academic paper detected on this page.";
    return;
  }

  populateForm(metadata);
  showPanel("form");
}

// ─── Populate form ────────────────────────────────────────────────────────────

function populateForm(meta) {
  fieldTitle.value    = meta.title ?? "";
  fieldAuthors.value  = (meta.authors ?? []).join(", ");
  fieldJournal.value  = meta.journal ?? "";
  fieldYear.value     = meta.year ?? "";
  fieldVolume.value   = meta.volume ?? "";
  fieldIssue.value    = meta.issue ?? "";
  fieldPages.value    = meta.pages ?? "";
  fieldDoi.value      = meta.doi ?? "";
  fieldAbstract.value = meta.abstract ?? "";

  if (meta._source && meta._source !== "unknown") {
    sourceLabel.textContent = meta._source.replace(/_/g, " ");
    showEl(sourceBadge);
  } else {
    hideEl(sourceBadge);
  }

  if (meta.pdf_url) {
    showEl(pdfUrlBadge);
    chkPdf.checked = true;
  } else {
    hideEl(pdfUrlBadge);
    chkPdf.checked = false;
  }
}

// ─── Save paper ───────────────────────────────────────────────────────────────

paperForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessages();
  setButtonLoading(btnSave, true);
  resetProgressLog();

  const paper = readFormValues();

  let res;
  try {
    res = await chrome.runtime.sendMessage({
      type: "BG_SAVE_PAPER",
      paper,
      attachPdf: chkPdf.checked && !!paper.pdf_url,
    });
  } catch (err) {
    setButtonLoading(btnSave, false);
    showError(saveError, err.message ?? "Unexpected error.");
    return;
  }

  setButtonLoading(btnSave, false);

  if (res?.data?.steps?.length) {
    renderProgressLog(res.data.steps);
  }

  if (!res?.ok) {
    showError(saveError, res?.error ?? "Save failed.");
    return;
  }

  const created = res.data.paper;
  const pdfRes  = res.data.pdfResult;

  let successMsg = "Saved to Scholaflow!";
  if (pdfRes?.success) successMsg += " PDF attached.";
  else if (pdfRes && !pdfRes.success) successMsg += ` (PDF skipped: ${pdfRes.error})`;

  showSuccess(saveSuccess, successMsg);
  btnSave.disabled = true;

  // Tell the content script to show the saved badge on the page
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: "PAPERHUB_SHOW_SAVED_BADGE",
        paperId: created.id,
        title: created.title ?? paper.title,
      });
    }
  } catch {
    // Non-critical — badge on page is best-effort
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFormValues() {
  return {
    title:          fieldTitle.value.trim(),
    authors:        fieldAuthors.value.split(",").map((s) => s.trim()).filter(Boolean),
    journal:        fieldJournal.value.trim() || null,
    year:           parseInt(fieldYear.value, 10) || null,
    volume:         fieldVolume.value.trim() || null,
    issue:          fieldIssue.value.trim() || null,
    pages:          fieldPages.value.trim() || null,
    doi:            fieldDoi.value.trim() || null,
    abstract:       fieldAbstract.value.trim() || null,
    url:            currentMetadata?.url ?? null,
    pdf_url:        currentMetadata?.pdf_url ?? null,
    categories:     currentMetadata?.categories ?? [],
    citation_count: currentMetadata?.citation_count ?? 0,
  };
}

/** Switch between the four panels inside view-paper. */
function showPanel(name) {
  panelIdle.hidden      = name !== "idle";
  panelDetecting.hidden = name !== "detecting";
  panelNone.hidden      = name !== "none";
  paperForm.hidden      = name !== "form";
}

function showView(name) {
  viewLoading.hidden = name !== "loading";
  viewLogin.hidden   = name !== "login";
  viewPaper.hidden   = name !== "paper";
}

function showEl(el)  { el.hidden = false; }
function hideEl(el)  { el.hidden = true; }

function showError(el, msg)   { el.textContent = msg; el.hidden = false; }
function showSuccess(el, msg) { el.textContent = msg; el.hidden = false; }

function clearMessages() {
  hideEl(saveError);
  hideEl(saveSuccess);
  saveError.textContent = "";
  saveSuccess.textContent = "";
}

function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  btn.querySelector(".btn-label").hidden  =  loading;
  btn.querySelector(".btn-spinner").hidden = !loading;
}

function resetProgressLog() {
  progressLog.innerHTML = "";
  hideEl(progressLog);
}

function renderProgressLog(steps) {
  progressLog.innerHTML = "";
  for (const step of steps) {
    const li = document.createElement("li");
    li.textContent = step;
    progressLog.appendChild(li);
  }
  showEl(progressLog);
}
