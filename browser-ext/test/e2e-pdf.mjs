// End-to-end check for the PDF path: navigate to a real arxiv /pdf/ URL, let
// the background worker redirect to the in-extension PDF.js viewer, render the
// real PDF, and drive ~100s of scroll engagement. Requires `npm run build`
// first, a daemon running on :5699, and network access to arxiv.org.
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXT = resolve(__dirname, "..", "build", "chrome-mv3-prod")
const PDF_URL = "https://arxiv.org/pdf/2401.00001"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const userDataDir = mkdtempSync(resolve(tmpdir(), "martina-e2e-pdf-"))
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
})
ctx.on("close", () => console.log("[ctx closed event]"))

const attachSwLogs = (sw) => sw.on("console", (m) => console.log("[sw log]", m.text()))
ctx.on("serviceworker", attachSwLogs)
let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"))
attachSwLogs(sw)
console.log("[sw]", sw.url())

// Wait until the DNR redirect rule is actually committed (async on SW startup).
for (let i = 0; i < 40; i++) {
  const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())
  if (rules.length > 0) break
  await sleep(250)
}
console.log("[dnr rule ready]")

const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on("console", (m) => console.log("[page]", m.text()))

// Navigate to the native PDF URL; the background worker should swap the tab to
// the extension viewer. page.goto may abort due to that swap — tolerate it.
await page.goto(PDF_URL, { waitUntil: "domcontentloaded" }).catch((e) =>
  console.log("[goto note]", e.message.split("\n")[0])
)
await page.waitForURL(/pdf-viewer\.html/, { timeout: 30_000 })
console.log("[redirected to]", page.url().slice(0, 80))

// Wait for the PDF to render (canvases appear inside the viewer).
await page.waitForSelector("canvas", { timeout: 30_000 })
await page.bringToFront()
console.log("[render] canvases:", await page.locator("canvas").count(),
  "hasFocus=", await page.evaluate(() => document.hasFocus()))

const DURATION_MS = 100_000
const start = Date.now()
try {
  // Put the cursor over the scroll container so wheel events scroll it.
  await page.mouse.move(400, 300)
  while (Date.now() - start < DURATION_MS) {
    await page.mouse.move(400 + ((Date.now() / 1000) % 40), 300)
    await page.mouse.wheel(0, 400)
    await page.keyboard.press("PageDown")
    const elapsed = Math.round((Date.now() - start) / 1000)
    const focused = await page.evaluate(() => document.hasFocus())
    console.log(`[t+${elapsed}s] focused=${focused}`)
    await sleep(8000)
  }
  console.log("[done driving] waiting for send + flush...")
  await sleep(12000)
} catch (err) {
  console.log("[loop aborted]", err?.message)
}

try {
  await ctx.close()
} catch {}
console.log("[closed]")
