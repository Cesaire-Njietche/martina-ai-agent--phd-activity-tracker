// Chrome refuses to load extensions containing files whose names start with "_"
// (reserved; only _locales / _metadata are allowed). Parcel (under Plasmo)
// emits chunks like "_empty.<hash>.js" — e.g. from pdfjs-dist's async imports.
// This postbuild step renames any such files and rewrites references to them.
import {
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root =
  process.argv[2] ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "build", "chrome-mv3-prod")

const ALLOWED = new Set(["_locales", "_metadata"])
const TEXT_EXT = /\.(js|mjs|html|json|css|map|txt)$/i

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const files = walk(root)

const renames = []
for (const p of files) {
  const b = basename(p)
  if (b.startsWith("_") && !ALLOWED.has(b)) {
    const newBase = b.replace(/^_+/, "")
    renames.push({ from: p, to: join(dirname(p), newBase), oldBase: b, newBase })
  }
}

if (renames.length === 0) {
  console.log("[fix-reserved-names] nothing to do")
  process.exit(0)
}

// Rewrite references (by basename — output names are hashed and unique).
for (const p of files) {
  if (!TEXT_EXT.test(p)) continue
  let content = readFileSync(p, "utf8")
  let changed = false
  for (const r of renames) {
    if (content.includes(r.oldBase)) {
      content = content.split(r.oldBase).join(r.newBase)
      changed = true
    }
  }
  if (changed) writeFileSync(p, content)
}

for (const r of renames) {
  renameSync(r.from, r.to)
  console.log(`[fix-reserved-names] ${r.oldBase} -> ${r.newBase}`)
}
