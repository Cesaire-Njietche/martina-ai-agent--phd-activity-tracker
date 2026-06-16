import type { PlasmoCSConfig } from "plasmo"

import { detectOverleaf, detectPaper } from "~lib/detect"
import { startEngagementTracking } from "~lib/engagement"

/**
 * Engagement tracker for HTML pages: paper pages (reading) and Overleaf project
 * editors (writing LaTeX). Detection/extraction lives in ~lib/detect and the
 * timing logic in ~lib/engagement (shared with the PDF viewer). Native PDF pages
 * (arxiv /pdf/) can't run content scripts, so those are redirected by the
 * background worker to tabs/pdf-viewer instead.
 */

export const config: PlasmoCSConfig = {
  matches: [
    "*://arxiv.org/abs/*",
    "*://www.semanticscholar.org/paper/*",
    "*://semanticscholar.org/paper/*",
    "*://pubmed.ncbi.nlm.nih.gov/*",
    "*://dl.acm.org/doi/*",
    "*://ieeexplore.ieee.org/document/*",
    "*://openreview.net/forum*",
    "*://www.overleaf.com/project/*",
    "*://overleaf.com/project/*"
  ],
  run_at: "document_idle"
}

const paper = detectPaper(location.href)
const overleaf = detectOverleaf(location.href)

if (paper) {
  startEngagementTracking({
    activityType: "paper_read",
    getUrl: () => location.href,
    getTitle: () => document.title,
    metadata: () => ({ paper_id: paper.paper_id, paper_source: paper.paper_source })
  })
} else if (overleaf) {
  startEngagementTracking({
    activityType: "latex_writing",
    getUrl: () => location.href,
    getTitle: () => document.title,
    metadata: () => ({ project_id: overleaf.project_id, paper_source: "overleaf" })
  })
}
