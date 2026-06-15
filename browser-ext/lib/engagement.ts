import type { PaperRef } from "~lib/detect"

/**
 * Shared engagement tracker used by both the HTML content script and the PDF.js
 * viewer page. Accrues "engaged seconds" via a 15s heartbeat that only counts
 * when there was scroll/mousemove/keydown activity in the last 30s AND the
 * document is focused. At 90 cumulative engaged seconds it sends one
 * paper_read event to the background worker.
 *
 * The only difference between callers is the scroll surface: the content script
 * scrolls the document, while the viewer scrolls a container element.
 */

const HEARTBEAT_MS = 15_000
const ACTIVE_WINDOW_MS = 30_000
const THRESHOLD_SECS = 90

export interface EngagementOptions {
  paper: PaperRef
  getUrl: () => string
  getTitle: () => string
  /** Scroll container to measure; defaults to the document scrolling element. */
  scrollEl?: HTMLElement | null
}

export function startEngagementTracking(opts: EngagementOptions): () => void {
  const { paper, getUrl, getTitle } = opts
  const scrollEl = opts.scrollEl ?? null

  let lastActivityAt = Date.now()
  let engagedSecs = 0
  let maxScrollPct = 0
  let sent = false

  const readScroll = () => {
    const el = scrollEl ?? document.scrollingElement ?? document.documentElement
    const scrollable = el.scrollHeight - el.clientHeight
    const pct = scrollable > 0 ? (el.scrollTop / scrollable) * 100 : 100
    maxScrollPct = Math.max(maxScrollPct, Math.min(100, Math.round(pct)))
  }

  const onActivity = () => {
    lastActivityAt = Date.now()
    readScroll()
  }

  const isFocused = () =>
    document.visibilityState === "visible" && document.hasFocus()

  const send = (secs: number) => {
    chrome.runtime.sendMessage({
      type: "paper-event",
      payload: {
        source: "browser",
        activity_type: "paper_read",
        timestamp: new Date().toISOString(),
        engaged_secs: secs,
        metadata: {
          paper_id: paper.paper_id,
          paper_source: paper.paper_source,
          url: getUrl(),
          title: getTitle(),
          scroll_pct: maxScrollPct
        }
      }
    })
  }

  const heartbeat = () => {
    const recentlyActive = Date.now() - lastActivityAt <= ACTIVE_WINDOW_MS
    if (!recentlyActive || !isFocused()) return
    engagedSecs += HEARTBEAT_MS / 1000
    if (engagedSecs >= THRESHOLD_SECS && !sent) {
      sent = true
      send(engagedSecs)
    }
  }

  const scrollTarget: EventTarget = scrollEl ?? window
  scrollTarget.addEventListener("scroll", onActivity, { passive: true })
  window.addEventListener("mousemove", onActivity, { passive: true })
  window.addEventListener("keydown", onActivity, { passive: true })

  readScroll()
  const timer = setInterval(heartbeat, HEARTBEAT_MS)

  return () => {
    clearInterval(timer)
    scrollTarget.removeEventListener("scroll", onActivity)
    window.removeEventListener("mousemove", onActivity)
    window.removeEventListener("keydown", onActivity)
  }
}
