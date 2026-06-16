/**
 * Shared engagement tracker used by the HTML content script (papers, Overleaf)
 * and the PDF.js viewer page. Accrues "engaged seconds" via a 15s heartbeat that
 * only counts when there was scroll/mousemove/keydown activity in the last 30s
 * AND the document is focused. At 90 cumulative engaged seconds it sends one
 * event to the background worker.
 *
 * Callers supply the activity type and the source-specific metadata fields; the
 * common fields (url, title, scroll_pct) are added here. The scroll surface
 * differs per caller: the content script scrolls the document, the viewer
 * scrolls a container element.
 */

const HEARTBEAT_MS = 15_000
const ACTIVE_WINDOW_MS = 30_000
const THRESHOLD_SECS = 90

export interface EngagementOptions {
  /** e.g. "paper_read" (reading) or "latex_writing" (Overleaf). */
  activityType: string
  getUrl: () => string
  getTitle: () => string
  /** Source-specific metadata, e.g. {paper_id, paper_source} or {project_id, paper_source}. */
  metadata: () => Record<string, unknown>
  /** Scroll container to measure; defaults to the document scrolling element. */
  scrollEl?: HTMLElement | null
}

export function startEngagementTracking(opts: EngagementOptions): () => void {
  const { getUrl, getTitle } = opts
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
        activity_type: opts.activityType,
        timestamp: new Date().toISOString(),
        engaged_secs: secs,
        metadata: {
          ...opts.metadata(),
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
  // Capture phase for key/mouse so editors (e.g. Overleaf's CodeMirror) that
  // stop event propagation still register as engagement.
  const capture = { passive: true, capture: true }
  scrollTarget.addEventListener("scroll", onActivity, { passive: true })
  window.addEventListener("mousemove", onActivity, capture)
  window.addEventListener("keydown", onActivity, capture)

  readScroll()
  const timer = setInterval(heartbeat, HEARTBEAT_MS)

  return () => {
    clearInterval(timer)
    scrollTarget.removeEventListener("scroll", onActivity)
    window.removeEventListener("mousemove", onActivity, { capture: true })
    window.removeEventListener("keydown", onActivity, { capture: true })
  }
}
