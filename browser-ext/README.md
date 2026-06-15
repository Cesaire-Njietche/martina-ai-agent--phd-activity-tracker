# phd-tracker browser extension

Plasmo (Chrome MV3) extension that measures engaged reading time on paper pages
and reports a single `paper_read` event per paper to the local daemon.

## Sites tracked

arXiv (`/abs/`, `/pdf/`), Semantic Scholar (`/paper/`), PubMed, ACM DL (`/doi/`),
IEEE Xplore (`/document/`), OpenReview (`/forum`). The `paper_id` is extracted
from the URL — see `lib/detect.ts` (and `lib/detect.test.ts` for the exact forms).

## How it works

- `contents/paper-tracker.ts` — runs on matched pages. A 15s heartbeat adds 15
  engaged seconds **only** when there was scroll/mousemove/keydown activity in
  the last 30s **and** the tab is focused (`visibilityState === "visible"` and
  `document.hasFocus()`). At 90 cumulative engaged seconds it sends one event to
  the background worker with `metadata` `{paper_id, paper_source, url, title,
  scroll_pct}`.
- `background.ts` — POSTs the event to `http://localhost:5699/events`. If the
  daemon is offline the event is stored in `chrome.storage.local` and retried
  every 60 minutes via `chrome.alarms` (also drained on startup and whenever a
  live POST succeeds). The fetch lives here because `host_permissions` grants
  cross-origin access to localhost from the service worker, not from a content
  script on an https page.

## Develop / build / test

```bash
npm install
npm test          # vitest — paper_id extraction
npm run build     # outputs build/chrome-mv3-prod
npm run dev       # live-reloading dev build in build/chrome-mv3-dev
```

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
