// End-to-end check: load the built extension in Chromium, simulate ~100s of
// real engagement on an arxiv /abs/ URL, and let the background worker POST to
// the local daemon. Assertions on the daemon log / Supabase are done by the
// caller. Requires: `npm run build` first, daemon running on :5699.
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXT = resolve(__dirname, "..", "build", "chrome-mv3-prod")
const URL = "https://arxiv.org/abs/2401.00001"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const TALL_PAGE = `<!doctype html><html><head><title>Test Paper: E2E 2401.00001</title></head>
<body style="height:6000px;margin:0">
<h1 style="position:fixed;top:0">arXiv abs e2e</h1>
<div style="height:6000px;background:linear-gradient(#fff,#eef)"></div>
</body></html>`

const userDataDir = mkdtempSync(resolve(tmpdir(), "phd-e2e-"))

const HEADLESS_NEW = process.env.HEADLESS_NEW === "1"
const args = [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
if (HEADLESS_NEW) args.push("--headless=new")

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args
})
ctx.on("close", () => console.log("[ctx closed event]"))

// Surface background service-worker logs for debugging.
ctx.on("serviceworker", (sw) => console.log("[sw spawned]", sw.url()))
let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"))
console.log("[sw]", sw.url())

// Serve a tall page for the arxiv URL without touching the network.
await ctx.route("**/arxiv.org/abs/**", (route) =>
  route.fulfill({ status: 200, contentType: "text/html", body: TALL_PAGE })
)

const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on("console", (m) => console.log("[page]", m.text()))
await page.goto(URL, { waitUntil: "domcontentloaded" })
await page.bringToFront()
console.log("[nav]", page.url(), "hasFocus=", await page.evaluate(() => document.hasFocus()))

// Drive real input for ~100s so the 15s heartbeat (active-in-last-30s + focused)
// accrues past the 90s threshold.
const DURATION_MS = 100_000
const start = Date.now()
let y = 100
try {
  while (Date.now() - start < DURATION_MS) {
    y += 200
    await page.mouse.move(150 + (y % 50), 150 + (y % 80))
    await page.mouse.wheel(0, 250)
    await page.keyboard.press("ArrowDown")
    const elapsed = Math.round((Date.now() - start) / 1000)
    const focused = await page.evaluate(() => document.hasFocus())
    console.log(`[t+${elapsed}s] focused=${focused}`)
    await sleep(8000)
  }
  console.log("[done driving] waiting for heartbeat send + daemon flush...")
  await sleep(12000)
} catch (err) {
  console.log("[loop aborted]", err?.message)
}

try {
  await ctx.close()
} catch {}
console.log("[closed]")
