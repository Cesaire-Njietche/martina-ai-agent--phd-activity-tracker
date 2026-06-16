// End-to-end check for the Overleaf path: load the built extension, route an
// Overleaf project URL to a local editor-like page (so the URL matches the
// content-script pattern without needing a login), type for ~100s, and let the
// background worker POST a latex_writing event. Requires `npm run build` and a
// daemon on :5699.
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXT = resolve(__dirname, "..", "build", "chrome-mv3-prod")
const PROJECT_ID = "5f3a1b2c3d4e5f60718293a4"
const URL = `https://www.overleaf.com/project/${PROJECT_ID}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const EDITOR_PAGE = `<!doctype html><html><head><title>My Thesis - Online LaTeX Editor Overleaf</title></head>
<body style="height:3000px;margin:0">
<h1>Overleaf editor (e2e)</h1>
<textarea id="ed" style="width:90%;height:1200px">\\documentclass{article}\\begin{document}</textarea>
</body></html>`

const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), "martina-e2e-ol-")), {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
})
ctx.on("close", () => console.log("[ctx closed event]"))
let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"))
console.log("[sw]", sw.url().slice(0, 60))

await ctx.route(/overleaf\.com\/project\//, (route) =>
  route.fulfill({ status: 200, contentType: "text/html", body: EDITOR_PAGE })
)

const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto(URL, { waitUntil: "domcontentloaded" })
await page.bringToFront()
await page.waitForSelector("#ed", { timeout: 15_000 })
await page.click("#ed")
console.log("[nav]", page.url(), "hasFocus=", await page.evaluate(() => document.hasFocus()))

const DURATION_MS = 100_000
const start = Date.now()
try {
  while (Date.now() - start < DURATION_MS) {
    await page.keyboard.type("\\alpha ") // typing into the editor = engagement
    await page.mouse.move(120 + ((Date.now() / 1000) % 30), 200)
    const elapsed = Math.round((Date.now() - start) / 1000)
    console.log(`[t+${elapsed}s] focused=${await page.evaluate(() => document.hasFocus())}`)
    await sleep(8000)
  }
  console.log("[done typing] waiting for send + flush...")
  await sleep(12000)
} catch (err) {
  console.log("[loop aborted]", err?.message)
}
try {
  await ctx.close()
} catch {}
console.log("[closed]")
