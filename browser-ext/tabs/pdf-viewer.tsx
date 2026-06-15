import * as pdfjsLib from "pdfjs-dist"
import workerUrl from "url:pdfjs-dist/build/pdf.worker.min.mjs"
import { useEffect, useRef, useState } from "react"

import { detectPaper } from "~lib/detect"
import { startEngagementTracking } from "~lib/engagement"

// PDF.js needs its worker; point it at the bundled asset.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * In-extension PDF viewer. The background worker redirects arxiv /pdf/ URLs
 * here with ?file=<original pdf url>. We render the PDF to stacked canvases in a
 * scrollable container and run the shared engagement tracker against that
 * container, giving the same scroll_pct + heartbeat behaviour as HTML pages.
 */
function PdfViewer() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState("Loading PDF…")

  const fileUrl = new URLSearchParams(location.search).get("file") ?? ""

  useEffect(() => {
    if (!fileUrl) {
      setStatus("No ?file= provided")
      return
    }

    let cancelled = false
    let stopEngagement: (() => void) | undefined

    const render = async () => {
      try {
        const pdf = await pdfjsLib.getDocument(fileUrl).promise
        if (cancelled) return

        const pages = pagesRef.current
        if (!pages) return

        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n)
          if (cancelled) return
          const viewport = page.getViewport({ scale: 1.3 })
          const canvas = document.createElement("canvas")
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.display = "block"
          canvas.style.margin = "10px auto"
          canvas.style.background = "#fff"
          canvas.style.boxShadow = "0 1px 6px rgba(0,0,0,.4)"
          pages.appendChild(canvas)
          const ctx = canvas.getContext("2d")
          if (ctx) await page.render({ canvasContext: ctx, viewport }).promise
        }

        if (cancelled) return
        const paper = detectPaper(fileUrl)
        document.title = paper ? `arXiv ${paper.paper_id}` : "PDF"
        setStatus("")

        if (paper) {
          stopEngagement = startEngagementTracking({
            paper,
            getUrl: () => fileUrl,
            getTitle: () => document.title,
            scrollEl: scrollRef.current
          })
        }
      } catch (err) {
        if (!cancelled) setStatus(`Failed to load PDF: ${(err as Error).message}`)
      }
    }

    void render()
    return () => {
      cancelled = true
      stopEngagement?.()
    }
  }, [fileUrl])

  return (
    <div
      ref={scrollRef}
      style={{ height: "100vh", overflow: "auto", background: "#525659" }}>
      {status && (
        <p style={{ color: "#fff", textAlign: "center", paddingTop: 24 }}>
          {status}
        </p>
      )}
      <div ref={pagesRef} />
    </div>
  )
}

export default PdfViewer
