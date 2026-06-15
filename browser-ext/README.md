# phd-tracker browser extension

Plasmo (Chrome MV3) extension that measures engaged reading time on paper pages
and reports a single `paper_read` event per paper to the local daemon.

## Sites tracked

arXiv (`/abs/`, `/pdf/`), Semantic Scholar (`/paper/`), PubMed, ACM DL (`/doi/`),
IEEE Xplore (`/document/`), OpenReview (`/forum`). The `paper_id` is extracted
from the URL — see `lib/detect.ts` (and `lib/detect.test.ts` for the exact forms).

## How it works

- `lib/engagement.ts` — the shared engagement loop. A 15s heartbeat adds 15
  engaged seconds **only** when there was scroll/mousemove/keydown activity in
  the last 30s **and** the document is focused (`visibilityState === "visible"`
  and `document.hasFocus()`). At 90 cumulative engaged seconds it sends one event
  with `metadata` `{paper_id, paper_source, url, title, scroll_pct}`. Used by
  both the HTML content script and the PDF viewer (they differ only in the scroll
  surface — document vs. the viewer container).
- `contents/paper-tracker.ts` — runs the engagement loop on matched HTML pages.
- `background.ts` — POSTs the event to `http://localhost:5699/events`. If the
  daemon is offline the event is stored in `chrome.storage.local` and retried
  every 60 minutes via `chrome.alarms` (also drained on startup and whenever a
  live POST succeeds). The fetch lives here because `host_permissions` grants
  cross-origin access to localhost from the service worker, not from a content
  script on an https page. Also installs a `declarativeNetRequest` rule (see
  below) for PDFs.

### PDF tracking

Chrome's native PDF viewer can't run content scripts, so `arxiv.org/pdf/*` would
otherwise be untrackable. Instead, a `declarativeNetRequest` redirect rule sends
those URLs to `tabs/pdf-viewer.tsx`, an in-extension viewer that renders the PDF
with PDF.js into a scrollable container and runs the same engagement loop against
it — giving real `scroll_pct` and the 15s heartbeat just like HTML pages. The
viewer fetches the PDF bytes using the `https://arxiv.org/*` host permission, and
is declared in `web_accessible_resources` so the redirect to it is allowed.

## Develop / build / test

```bash
npm install
npm test          # vitest — paper_id extraction
npm run build     # outputs build/chrome-mv3-prod
npm run dev       # live-reloading dev build in build/chrome-mv3-dev
```

The `test/*.mjs` files are optional Playwright end-to-end checks (load the built
extension, simulate ~100s of reading, assert the event reaches the daemon). They
need a one-off `npm i --no-save playwright && npx playwright install chromium`,
a daemon running on :5699, and `npm run build` first, then e.g.
`node test/e2e.mjs` (HTML) or `node test/e2e-pdf.mjs` (PDF). Playwright is
intentionally not a dependency to keep installs lean.

## Load in Chrome

1. Start the daemon: from the repo root, `python -m daemon.main`.
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select `browser-ext/build/chrome-mv3-prod`.
3. Open e.g. `https://arxiv.org/abs/2401.00001` and read (scroll / move the
   mouse occasionally) with the tab focused. After ~90 engaged seconds the
   daemon logs `Queued event source=browser …` and syncs the row on its next
   flush.

> Note: engaged time only accrues while you actually interact — leaving the tab
> idle stops the counter after 30s by design. Chrome's native PDF viewer does
> not run content scripts, so `/pdf/` pages may not track; `/abs/` pages do.
