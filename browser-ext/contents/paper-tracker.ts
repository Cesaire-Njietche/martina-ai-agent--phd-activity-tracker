import type { PlasmoCSConfig } from "plasmo"

import { detectPaper } from "~lib/detect"
import { startEngagementTracking } from "~lib/engagement"

/**
 * Engagement tracker for HTML paper pages. Detection/extraction lives in
 * ~lib/detect and the timing logic in ~lib/engagement (shared with the PDF
 * viewer). Native PDF pages (arxiv /pdf/) can't run content scripts, so those
 * are redirected by the background worker to tabs/pdf-viewer instead.
 */

export const config: PlasmoCSConfig = {
  matches: [
    "*://arxiv.org/abs/*",
    "*://www.semanticscholar.org/paper/*",
    "*://semanticscholar.org/paper/*",
    "*://pubmed.ncbi.nlm.nih.gov/*",
    "*://dl.acm.org/doi/*",
    "*://ieeexplore.ieee.org/document/*",
    "*://openreview.net/forum*"
  ],
  run_at: "document_idle"
}

const paper = detectPaper(location.href)

if (paper) {
  startEngagementTracking({
    paper,
    getUrl: () => location.href,
    getTitle: () => document.title
  })
}
