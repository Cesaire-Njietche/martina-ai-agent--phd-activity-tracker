import type { PlasmoCSConfig } from "plasmo"

import { detectPaper } from "~lib/detect"

/**
 * Engagement tracker for paper pages.
 *
 * Accrues "engaged seconds" via a 15s heartbeat that only counts when the user
 * interacted in the last 30s AND the tab is focused. Once 90 engaged seconds
 * accumulate, it asks the background worker to POST a single paper_read event
 * to the local daemon. Detection/extraction lives in ~lib/detect.
 */

export const config: PlasmoCSConfig = {
  matches: [
    "*://arxiv.org/abs/*",
    "*://arxiv.org/pdf/*",
    "*://www.semanticscholar.org/paper/*",
    "*://semanticscholar.org/paper/*",
    "*://pubmed.ncbi.nlm.nih.gov/*",
    "*://dl.acm.org/doi/*",
    "*://ieeexplore.ieee.org/document/*",
    "*://openreview.net/forum*"
  ],
  run_at: "document_idle"
}

const HEARTBEAT_MS = 15_000
const ACTIVE_WINDOW_MS = 30_000
const THRESHOLD_SECS = 90

const paper = detectPaper(location.href)

if (paper) {
  let lastActivityAt = Date.now()
  let engagedSecs = 0
  let maxScrollPct = 0
  let sent = false

  const markActive = () => {
    lastActivityAt = Date.now()
  }

  const updateScrollPct = () => {
    const el = document.scrollingElement ?? document.documentElement
    const scrollable = el.scrollHeight - el.clientHeight
    const pct = scrollable > 0 ? (el.scrollTop / scrollable) * 100 : 100
    maxScrollPct = Math.max(maxScrollPct, Math.min(100, Math.round(pct)))
  }

  const isFocused = () =>
    document.visibilityState === "visible" && document.hasFocus()

  const onActivity = () => {
    markActive()
    updateScrollPct()
  }

  for (const evt of ["scroll", "mousemove", "keydown"] as const) {
    window.addEventListener(evt, onActivity, { passive: true })
  }

  const heartbeat = () => {
    const recentlyActive = Date.now() - lastActivityAt <= ACTIVE_WINDOW_MS
    if (!recentlyActive || !isFocused()) return

    engagedSecs += HEARTBEAT_MS / 1000
    if (engagedSecs >= THRESHOLD_SECS && !sent) {
      sent = true
      sendEvent(engagedSecs)
    }
  }

  const sendEvent = (secs: number) => {
    const payload = {
      source: "browser",
      activity_type: "paper_read",
      timestamp: new Date().toISOString(),
      engaged_secs: secs,
      metadata: {
        paper_id: paper.paper_id,
        paper_source: paper.paper_source,
        url: location.href,
        title: document.title,
        scroll_pct: maxScrollPct
      }
    }
    // Background worker owns the network + offline queue (host_permissions).
    chrome.runtime.sendMessage({ type: "paper-event", payload })
  }

  updateScrollPct()
  setInterval(heartbeat, HEARTBEAT_MS)
}
