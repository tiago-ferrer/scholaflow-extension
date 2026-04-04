# Scholaflow

A browser extension for saving academic papers and PDFs directly to [Scholaflow](https://api.scholaflow.com) from any web page. Works on Chrome, Brave, Edge, and Firefox.

---

## Table of Contents

- [Requirements](#requirements)
- [Running Locally](#running-locally)
  - [Chrome / Brave / Edge](#chrome--brave--edge)
  - [Firefox](#firefox)
- [Project Structure](#project-structure)
- [Debugging](#debugging)
  - [Background Service Worker](#background-service-worker)
  - [Popup](#popup)
  - [Content Script](#content-script)
  - [Common Issues](#common-issues)
- [Making Changes](#making-changes)
- [Deploying to the Chrome Web Store](#deploying-to-the-chrome-web-store)
  - [1. Prepare the package](#1-prepare-the-package)
  - [2. Create a developer account](#2-create-a-developer-account)
  - [3. Submit the extension](#3-submit-the-extension)
  - [4. Privacy policy requirements](#4-privacy-policy-requirements)
  - [5. After publishing](#5-after-publishing)
- [Firefox Add-ons (AMO)](#firefox-add-ons-amo)
- [Environment Variables / Configuration](#environment-variables--configuration)

---

## Requirements

- **Node.js** 18+ (only needed for development tooling — the extension itself has no build step)
- A modern browser: Chrome 109+, Edge 109+, Brave (any recent), or Firefox 128+
- A Scholaflow account at `https://api.scholaflow.com`

No bundler, no transpiler, no `npm install` required. The extension is pure ES modules loaded directly by the browser.

---

## Running Locally

### Chrome / Brave / Edge

1. **Clone the repo** (if you haven't already):

   ```bash
   git clone <repo-url>
   cd scholaflow-extension
   ```

2. **Open the extensions page** in your browser:

   | Browser | URL |
   |---------|-----|
   | Chrome  | `chrome://extensions` |
   | Brave   | `brave://extensions` |
   | Edge    | `edge://extensions` |

3. **Enable Developer Mode** using the toggle in the top-right corner.

4. Click **Load unpacked** and select the `scholaflow-extension/` directory (the folder that contains `manifest.json`).

5. The **Scholaflow** icon appears in your toolbar. Pin it for easy access.

6. Click the icon, log in with your Scholaflow credentials, and navigate to any academic paper.

> **Reload after changes:** After editing any source file, go back to `chrome://extensions` and click the reload icon (↺) on the Scholaflow card, or press the reload shortcut. You do **not** need to re-add the extension.

---

### Firefox

Firefox MV3 support is available from Firefox 128+. Before loading, add the Firefox-specific browser ID to `manifest.json`:

```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "scholaflow-connector@scholaflow.dev",
      "strict_min_version": "128.0"
    }
  }
}
```

Then:

1. Open `about:debugging`
2. Click **This Firefox** in the left sidebar
3. Click **Load Temporary Add-on…**
4. Navigate to the `scholaflow-extension/` folder and select `manifest.json`

> Temporary add-ons are removed when Firefox closes. For a persistent install you must sign the extension via [AMO](#firefox-add-ons-amo).

---

## Project Structure

```
scholaflow-extension/
├── manifest.json           Extension manifest (MV3)
│
├── background/
│   └── background.js       Service worker — all privileged operations
│                           (API calls, metadata extraction, PDF upload)
│
├── content/
│   └── content.js          Injected into every page; builds a DOM snapshot
│                           on demand (only when popup is opened)
│
├── core/
│   ├── auth.js             JWT login, storage, expiry, session helpers
│   ├── api.js              Scholaflow REST client (register paper, upload PDF)
│   ├── doi.js              DOI detection + Crossref/OpenAlex/Semantic Scholar
│   ├── metadata.js         Extraction pipeline orchestrator
│   └── pdf.js              PDF URL detection + fetch→upload pipeline
│
├── translators/
│   ├── arxiv.js            arXiv-specific extractor
│   ├── springer.js         SpringerLink extractor
│   ├── nature.js           Nature Publishing extractor
│   ├── ieee.js             IEEE Xplore extractor
│   └── acm.js              ACM Digital Library extractor
│
├── ui/
│   ├── popup.html          Popup markup
│   ├── popup.js            Popup controller (login + paper form)
│   └── styles.css          All popup styles
│
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

---

## Debugging

### Background Service Worker

The background script (`background/background.js`) runs as a service worker and has its own DevTools console.

1. Go to `chrome://extensions`
2. Find **Scholaflow**
3. Click **Service Worker** (shown as a link next to "Inspect views")
4. A DevTools window opens — use the **Console** and **Sources** tabs

This is where you debug:
- Authentication errors
- API request/response details
- Metadata extraction logic
- PDF download failures

Add temporary `console.log` calls to any file in `core/` or `background/` and they appear here.

---

### Popup

1. Right-click the **Scholaflow** toolbar icon
2. Select **Inspect popup** (Chrome) or **Inspect** (Firefox)

This opens DevTools scoped to `popup.html`. You can:
- Inspect the DOM of the popup
- See `console.log` output from `popup.js`
- Step through popup logic in the **Sources** tab

> The popup closes when it loses focus, which also closes its DevTools. To keep it open while inspecting, open DevTools first, *then* click the extension icon.

---

### Content Script

Content scripts run in the context of the web page.

1. Open DevTools on the **target page** (`F12` or right-click → Inspect)
2. In the **Console** tab, use the context switcher (top-left dropdown, usually says "top")
3. Select **Scholaflow** from the list

You can also add `debugger;` statements to `content/content.js` and they will pause in the page's Sources panel under the **Content scripts** folder.

To inspect the snapshot that `content.js` produces, paste this in the page console after the extension is injected:

```js
chrome.runtime.sendMessage({ type: 'SCHOLAFLOW_GET_SNAPSHOT' }, console.log)
```

---

### Common Issues

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Popup shows blank / won't open | JS error in `popup.js` | Inspect popup → Console |
| "No academic paper detected" on a paper page | Translator not matching, or meta tags absent | Check snapshot in content script console; add a translator or extend `metadata.js` |
| "Not authenticated" error | Token expired or storage cleared | Log out and log in again |
| PDF upload fails with `Response does not appear to be a PDF` | Publisher paywall redirect | Expected; metadata is still saved. No fix without institutional access |
| `Cannot use import statement` error in service worker | Old browser without MV3 ES module support | Update browser to Chrome 112+ / Firefox 128+ |
| Extension not reloading changes | Browser cached old version | Go to `chrome://extensions` → click ↺ reload button |
| `chrome.scripting` permission error | `activeTab` permission not granted | Make sure you click the icon on an actual `http/https` page, not `chrome://` pages |

---

## Making Changes

Since there is no build step, the workflow is:

```
edit file  →  reload extension  →  test in browser
```

**Reload shortcut (Chrome):** After making a change, you can reload the extension without leaving your test page by pressing `Ctrl+R` (or `Cmd+R`) in the **Service Worker** DevTools window. This restarts the service worker with the new code.

**Live-reload helper (optional):** If you want automatic reloading on file change, install the [Extensions Reloader](https://chrome.google.com/webstore/detail/extensions-reloader/fimgfedafeadlieiabdeeaodndnlbhid) Chrome extension and run a file-watcher:

```bash
# macOS / Linux — watch for file changes and trigger reload
while true; do
  fswatch -1 -r . --exclude='.git'
  # POST to Extensions Reloader's localhost endpoint
  curl -s http://reload.extensions/ > /dev/null
  echo "Reloaded at $(date +%T)"
done
```

---

## Deploying to the Chrome Web Store

### 1. Prepare the package

Create a production ZIP of the extension (exclude dev files and hidden directories):

```bash
cd scholaflow-extension

zip -r scholaflow.zip . \
  --exclude "*.git*" \
  --exclude "*.DS_Store" \
  --exclude "*.idea*" \
  --exclude "*.vscode*" \
  --exclude "node_modules/*" \
  --exclude "*.zip"
```

Verify the ZIP contains exactly the right files:

```bash
unzip -l scholaflow.zip
```

Expected output should list `manifest.json`, all JS files, `ui/`, `icons/` — and nothing else.

---

### 2. Create a developer account

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Sign in with a Google account
3. Pay the **one-time $5 registration fee**
4. Accept the developer agreement

---

### 3. Submit the extension

1. Click **New Item** in the Developer Dashboard
2. Upload `scholaflow.zip`
3. Fill in the store listing:

   | Field | Recommendation |
   |-------|---------------|
   | **Name** | Scholaflow |
   | **Short description** (132 chars) | Save academic papers and PDFs to Scholaflow directly from your browser |
   | **Detailed description** | Explain supported publishers, metadata extraction, PDF attach feature |
   | **Category** | Productivity |
   | **Language** | English |
   | **Screenshots** | At least 1 screenshot of the popup (1280×800 or 640×400 px) |
   | **Small promo tile** | 440×280 px PNG |
   | **Icon** | 128×128 px (already in `icons/icon128.png`) |

4. Under **Privacy**, declare the following:

   - **Permissions justification:**
     - `storage` — stores JWT authentication token
     - `activeTab` — reads page content to extract paper metadata
     - `scripting` — injects content script to collect DOM snapshot
     - `tabs` — gets the current tab URL
     - `host_permissions: <all_urls>` — required to detect papers on any academic publisher site

5. Set **Visibility** to Public (or Unlisted for testing)

6. Click **Submit for Review**

Review typically takes **1–3 business days** for new extensions.

---

### 4. Privacy policy requirements

The Chrome Web Store **requires a privacy policy URL** because the extension:
- Handles authentication credentials
- Reads page content
- Sends data to an external server (`api.scholaflow.com`)

Host a privacy policy at a stable URL (e.g. `https://scholaflow.com/privacy`) that covers:

- What data is collected (credentials, paper metadata, PDF content)
- Where it is sent (scholaflow backend)
- How the JWT token is stored (locally in browser storage, never transmitted to third parties)
- How users can delete their data

---

### 5. After publishing

**Updating the extension:**

1. Increment `version` in `manifest.json` (e.g. `"1.0.0"` → `"1.1.0"`)
2. Re-create the ZIP
3. In the Developer Dashboard, click your extension → **Package** → **Upload new package**
4. Submit for review (updates review faster than new submissions, usually same day)

**Installing from the store:**

Once published, users install directly from your store listing URL. The extension auto-updates in the background when a new version is approved.

---

## Firefox Add-ons (AMO)

To distribute on [addons.mozilla.org](https://addons.mozilla.org):

1. Add the gecko ID to `manifest.json` (see [Firefox section](#firefox) above)
2. Create an account at [addons.mozilla.org](https://addons.mozilla.org/developers/)
3. Submit via **Developer Hub** → **Submit a New Add-on**
4. Choose **On this site** for distribution through AMO
5. Upload the ZIP — AMO will auto-sign it
6. Fill in listing details (same content as Chrome store)

AMO review is stricter and may take **1–2 weeks** for the first submission.

---

## Environment Variables / Configuration

The API base URL is defined in two places. To point the extension at a different backend (e.g. local development server), update both:

- `core/auth.js` — `const API_BASE = "https://api.scholaflow.com"`
- `core/api.js` — `const API_BASE = "https://api.scholaflow.com"`

> There is intentionally no build-time config system to keep the extension dependency-free. If you find yourself needing multiple environments frequently, consider adding a simple `core/config.js` that exports `API_BASE` and importing it from both files.
