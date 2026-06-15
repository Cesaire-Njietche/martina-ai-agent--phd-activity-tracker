/**
 * Paper-page detection and paper_id extraction.
 *
 * Pure functions only (no chrome / DOM APIs) so they can be unit-tested in
 * isolation and reused by both the content script and the tests.
 */

export interface PaperRef {
  /** Short label for the originating site, stored as metadata.paper_source. */
  paper_source: string
  /** Stable identifier extracted from the URL, stored as metadata.paper_id. */
  paper_id: string
}

interface Matcher {
  source: string
  pattern: RegExp
}

// Order matters: more specific patterns first (e.g. arxiv /abs before /pdf).
const MATCHERS: Matcher[] = [
  { source: "arxiv", pattern: /arxiv\.org\/abs\/([^?#]+?)\/?(?:[?#]|$)/i },
  { source: "arxiv", pattern: /arxiv\.org\/pdf\/([^?#]+?)(?:\.pdf)?(?:[?#]|$)/i },
  {
    source: "semanticscholar",
    pattern: /semanticscholar\.org\/paper\/(?:[^/?#]+\/)?([0-9a-f]{40}|[^/?#]+)/i
  },
  { source: "pubmed", pattern: /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i },
  { source: "acm", pattern: /dl\.acm\.org\/doi\/(?:abs\/|pdf\/|full\/)?(10\.\d{4,9}\/[^?#]+)/i },
  { source: "ieee", pattern: /ieeexplore\.ieee\.org\/document\/(\d+)/i },
  { source: "openreview", pattern: /openreview\.net\/forum[^#]*[?&]id=([^&#]+)/i }
]

/** Returns the paper reference for a URL, or null if it is not a paper page. */
export function detectPaper(url: string): PaperRef | null {
  for (const m of MATCHERS) {
    const match = m.pattern.exec(url)
    if (match && match[1]) {
      return { paper_source: m.source, paper_id: safeDecode(match[1]) }
    }
  }
  return null
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
