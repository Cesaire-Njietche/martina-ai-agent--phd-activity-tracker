import { describe, expect, it } from "vitest"

import { detectPaper } from "./detect"

describe("detectPaper", () => {
  const cases: Array<[string, string, string]> = [
    // url, expected paper_source, expected paper_id
    ["https://arxiv.org/abs/2401.00001", "arxiv", "2401.00001"],
    ["https://arxiv.org/abs/2401.00001v2", "arxiv", "2401.00001v2"],
    ["https://arxiv.org/abs/cond-mat/9609089", "arxiv", "cond-mat/9609089"],
    ["https://arxiv.org/pdf/2401.00001", "arxiv", "2401.00001"],
    ["https://arxiv.org/pdf/2401.00001v2.pdf", "arxiv", "2401.00001v2"],
    [
      "https://www.semanticscholar.org/paper/Attention-Is-All-You-Need/204e3073870fab3f88aec8a8d75a4f1f17dca48f",
      "semanticscholar",
      "204e3073870fab3f88aec8a8d75a4f1f17dca48f"
    ],
    [
      "https://www.semanticscholar.org/paper/204e3073870fab3f88aec8a8d75a4f1f17dca48f",
      "semanticscholar",
      "204e3073870fab3f88aec8a8d75a4f1f17dca48f"
    ],
    ["https://pubmed.ncbi.nlm.nih.gov/35020452/", "pubmed", "35020452"],
    ["https://dl.acm.org/doi/10.1145/3292500.3330701", "acm", "10.1145/3292500.3330701"],
    ["https://dl.acm.org/doi/abs/10.1145/3292500.3330701", "acm", "10.1145/3292500.3330701"],
    ["https://ieeexplore.ieee.org/document/9054701", "ieee", "9054701"],
    ["https://openreview.net/forum?id=rJl-b3RcF7", "openreview", "rJl-b3RcF7"],
    [
      "https://openreview.net/forum?noteId=abc&id=rJl-b3RcF7",
      "openreview",
      "rJl-b3RcF7"
    ]
  ]

  it.each(cases)("extracts %s", (url, source, id) => {
    const ref = detectPaper(url)
    expect(ref).not.toBeNull()
    expect(ref?.paper_source).toBe(source)
    expect(ref?.paper_id).toBe(id)
  })

  const negatives = [
    "https://arxiv.org/",
    "https://arxiv.org/list/cs.AI/recent",
    "https://pubmed.ncbi.nlm.nih.gov/",
    "https://www.semanticscholar.org/",
    "https://dl.acm.org/",
    "https://ieeexplore.ieee.org/",
    "https://openreview.net/",
    "https://example.com/abs/2401.00001"
  ]

  it.each(negatives)("ignores non-paper page %s", (url) => {
    expect(detectPaper(url)).toBeNull()
  })
})
