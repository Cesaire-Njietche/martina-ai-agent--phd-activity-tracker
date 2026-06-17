# Martina

**Martina** is a passive research activity tracker built for my PhD. It quietly watches what I read and code across my browser, VSCode, and desktop apps, then turns that activity into a weekly progress report I can share with my supervisor — no manual logging, no weekly seminar slides.

Named after my mother.

## Why

PhD supervision usually relies on weekly seminars where students present what they did. That model has real limits: it's a curated narrative, not a record, it doesn't scale past a handful of students, and the work needed to "perform" the update often competes with the work itself.

Martina replaces the status-update part with an automatic, private log — so the actual conversation with my supervisor can be about the research, not about what happened last week.

## How it works

```
Browser ──┐
VSCode ───┼──► Local daemon (localhost:5699) ──► Supabase ──► Weekly report ──► Share link
Desktop ──┘
```

Four layers:

| Layer | What it does |
|---|---|
| **Capture** | Browser extension (papers + Overleaf), VSCode extension (coding), desktop watcher (Zotero, Obsidian, Foxit/Acrobat) — all feeding one local daemon |
| **Enrich** | Turns a paper ID into title, authors, abstract, and year via Semantic Scholar (OpenAlex fallback) |
| **Classify** | Tags each paper by domain (QEC / AI / cybersecurity) and flags unusual reading patterns |
| **Report** | Generates a weekly narrative and serves it at a private, shareable link |

## Stack

- **Browser extension** — Plasmo (Chrome, MV3)
- **VSCode extension** — TypeScript
- **Desktop watcher** — Python + ActivityWatch
- **Daemon** — FastAPI, runs locally on port `5699`
- **Database** — Supabase (Postgres)
- **AI** — Anthropic API (Claude Haiku for classification, Claude Sonnet for reports)
- **Dashboard** — Next.js

## Project structure

```
martina/
├── browser-ext/      # Chrome extension — papers, arXiv, Overleaf
├── vscode-ext/        # VSCode extension — coding activity
├── desktop-watcher/    # Zotero, Obsidian, Foxit/Acrobat tracking
├── daemon/            # FastAPI server — capture, enrich, classify, report
└── dashboard/         # Next.js — student view + supervisor share page
```

## Setup

```bash
git clone <repo-url> martina
cd martina

# Daemon
cd daemon && pip install -r requirements.txt --break-system-packages
cp .env.example .env   # add ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_KEY
uvicorn main:app --port 5699

# Browser extension
cd browser-ext && npm install && npm run dev
# Load unpacked from build/chrome-mv3-dev in chrome://extensions

# VSCode extension
cd vscode-ext && npm install && npm run package
# Install the generated .vsix file

# Desktop watcher
cd desktop-watcher && pip install -r requirements.txt --break-system-packages
python aw_bridge.py
```

## Privacy

Martina logs *time and context*, never content. It records what file you had open, not what's in it; what paper you read, not your annotations. The dashboard is private to you; only the weekly share link is visible to your supervisor, and only for the week it covers.

## Status

🚧 Early prototype — built incrementally, one layer at a time.

## License

Personal project — not currently licensed for reuse.
