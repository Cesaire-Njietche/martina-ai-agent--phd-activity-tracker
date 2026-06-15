# phd-tracker daemon

A local FastAPI daemon that collects research-activity events (browser, Zotero,
apps, …), deduplicates them, and syncs them to a Supabase `unified_events` table.

## Setup

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # then fill in SUPABASE_URL, SUPABASE_KEY, STUDENT_ID
```

Create the table once (Supabase SQL editor): run `schema.sql`.

## Run

```bash
python -m daemon.main
# or: uvicorn daemon.main:app --host 127.0.0.1 --port 5699
```

## API

- `POST /events` — body `{source, activity_type, timestamp, engaged_secs, metadata}`.
  Buffers the event and returns `{"status": "queued"}`.
- `GET /status` — returns `{"queue_size", "total_synced"}`.

The buffer flushes to Supabase every `FLUSH_INTERVAL_SECS` (default 60s).

### Example

```bash
curl -X POST http://127.0.0.1:5699/events -H 'Content-Type: application/json' -d '{
  "source": "browser",
  "activity_type": "read",
  "timestamp": "2026-06-14T12:00:00Z",
  "engaged_secs": 42,
  "metadata": {"paper_id": "10.1000/xyz", "url": "https://arxiv.org/abs/1234"}
}'
```

## Deduplication

Events collapse to one row per `(student_id, paper_id_or_app, day)`. `source` is
**not** part of the key, so the same paper from the browser and from Zotero on
the same day counts once. `paper_id_or_app` is resolved from `metadata` in order:
`paper_id` → `doi` → `app` → `url`, falling back to `source`. Engagement seconds
from merged duplicates are summed.

## Auto-start at login (macOS)

```bash
bash launchd/install.sh
```

This renders `launchd/com.phdtracker.daemon.plist` with the absolute repo and
python paths into `~/Library/LaunchAgents/` and loads it (`RunAtLoad` +
`KeepAlive`). Logs go to `daemon.log` / `daemon.err.log` in the repo root.
