"""Local Martina daemon.

A FastAPI service that buffers activity events in memory and flushes them to the
Supabase `unified_events` table on a fixed interval. Events are deduplicated so
that the same paper seen from multiple sources (e.g. the browser and Zotero) on
the same day collapses into a single row.

Run directly (`python -m daemon.main`) or via uvicorn:
    uvicorn daemon.main:app --host 127.0.0.1 --port 5699
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import json
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel, Field
from supabase import Client, create_client
from agents.agent import run_agent
from daemon.orchestrator import run_weekly_pipeline

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

load_dotenv()

#logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("martina")

# Set up a formatter that prints the 'levelname'
formatter = logging.Formatter('%(levelname)s: %(message)s')

# The trick: Rename the level name globally
logging.addLevelName(logging.INFO, "Martina - PhD Tracker")
log.setLevel(logging.INFO)
handler = logging.StreamHandler()
handler.setFormatter(formatter)
log.addHandler(handler)



SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
STUDENT_ID = os.environ.get("STUDENT_ID", "")
PORT = int(os.environ.get("DAEMON_PORT", "5699"))
FLUSH_INTERVAL_SECS = int(os.environ.get("FLUSH_INTERVAL_SECS", "60"))
TABLE = os.environ.get("SUPABASE_TABLE", "unified_events")

# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #


class Event(BaseModel):
    source: str
    activity_type: str
    timestamp: datetime
    engaged_secs: float = 0.0
    metadata: dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------- #
# In-memory state
# --------------------------------------------------------------------------- #

# Buffer keyed by dedup_hash. Duplicates within a flush window are merged rather
# than appended, so each (student, paper/app, day) yields exactly one row.
_buffer: dict[str, dict[str, Any]] = {}
_buffer_lock = asyncio.Lock()
_total_synced = 0
_supabase: Client | None = None


def _dedup_hash(event: Event) -> str:
    """Dedup identity for an event.

    Note: deliberately excludes ``source`` so the same paper arriving from the
    browser and from Zotero on the same day collapses into one row, which is the
    stated goal. The identity is scoped per student.

    For app-based sources (e.g. the desktop PDF watcher) the open document
    ``title`` is folded into the identity so each PDF/document gets its own daily
    row rather than collapsing all activity in that app into one.
    """
    md = event.metadata or {}
    app = md.get("app")
    app_identity = f"{app}|{md.get('title')}" if app and md.get("title") else app
    identity = (
        md.get("paper_id")
        or md.get("doi")
        or app_identity
        or md.get("url")
        or event.source
    )
    day = event.timestamp.astimezone(timezone.utc).date().isoformat()
    raw = f"{STUDENT_ID}|{identity}|{day}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _to_row(event: Event, dedup_hash: str) -> dict[str, Any]:
    return {
        "student_id": STUDENT_ID,
        "source": event.source,
        "activity_type": event.activity_type,
        "timestamp": event.timestamp.astimezone(timezone.utc).isoformat(),
        "engaged_secs": event.engaged_secs,
        "metadata": event.metadata,
        "dedup_hash": dedup_hash,
    }


# --------------------------------------------------------------------------- #
# Flush loop
# --------------------------------------------------------------------------- #


def _accumulate(
    rows: list[dict[str, Any]], prior: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    """Fold prior daily totals into the rows being written (pure).

    Since the upsert replaces the row, we add the already-stored ``engaged_secs``
    for each dedup_hash so the total accumulates across flush windows / reading
    sessions, and we keep the earliest ``timestamp`` as the session start. Inputs
    are not mutated, so callers can safely re-buffer the originals on failure.
    """
    out: list[dict[str, Any]] = []
    for row in rows:
        merged = dict(row)
        prev = prior.get(merged["dedup_hash"])
        if prev:
            merged["engaged_secs"] = float(merged["engaged_secs"]) + float(
                prev.get("engaged_secs") or 0
            )
            prev_ts = prev.get("timestamp")
            if prev_ts:
                try:
                    if datetime.fromisoformat(prev_ts) < datetime.fromisoformat(
                        merged["timestamp"]
                    ):
                        merged["timestamp"] = prev_ts
                except ValueError:
                    pass
        out.append(merged)
    return out


def _persist(rows: list[dict[str, Any]]) -> None:
    """Read existing daily totals, accumulate, and upsert. Runs in a thread."""
    assert _supabase is not None
    hashes = [r["dedup_hash"] for r in rows]
    existing = (
        _supabase.table(TABLE)
        .select("dedup_hash, engaged_secs, timestamp")
        .in_("dedup_hash", hashes)
        .execute()
    )
    prior = {e["dedup_hash"]: e for e in (existing.data or [])}
    payload = _accumulate(rows, prior)
    _supabase.table(TABLE).upsert(payload, on_conflict="dedup_hash").execute()


async def _flush() -> int:
    """Drain the buffer to Supabase. Returns the number of rows synced.

    On failure the rows are returned to the buffer so they are retried on the
    next tick (merging with anything that arrived in the meantime).
    """
    global _total_synced

    async with _buffer_lock:
        if not _buffer:
            return 0
        rows = list(_buffer.values())
        _buffer.clear()

    if _supabase is None:
        # No client configured; put rows back and skip.
        async with _buffer_lock:
            for r in rows:
                _buffer.setdefault(r["dedup_hash"], r)
        log.warning("Supabase client not configured; %d rows held in buffer", len(rows))
        return 0

    try:
        await asyncio.to_thread(_persist, rows)
    except Exception as exc:  # noqa: BLE001 - re-buffer and retry next tick
        async with _buffer_lock:
            for r in rows:
                _buffer.setdefault(r["dedup_hash"], r)
        log.error("Flush failed (%d rows re-buffered): %s", len(rows), exc)
        return 0

    _total_synced += len(rows)
    log.info("Flushed %d rows (total_synced=%d)", len(rows), _total_synced)
    return len(rows)


async def _flush_loop() -> None:
    while True:
        await asyncio.sleep(FLUSH_INTERVAL_SECS)
        await _flush()


# --------------------------------------------------------------------------- #
# App
# --------------------------------------------------------------------------- #


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _supabase
    if SUPABASE_URL and SUPABASE_KEY:
        _supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        log.info("Supabase client ready (%s, table=%s)", SUPABASE_URL, TABLE)
    else:
        log.warning(
            "SUPABASE_URL and/or SUPABASE_KEY missing; events will buffer but not sync"
        )
    task = asyncio.create_task(_flush_loop())
    try:
        yield
    finally:
        task.cancel()
        await _flush()  # best-effort drain on shutdown


app = FastAPI(title="martina daemon", lifespan=lifespan)


@app.post("/events")
async def post_event(event: Event) -> dict[str, str]:
    dedup_hash = _dedup_hash(event)
    row = _to_row(event, dedup_hash)
    log.info(
        "Queued event source=%s activity_type=%s paper_id=%s engaged_secs=%s",
        event.source,
        event.activity_type,
        (event.metadata or {}).get("paper_id"),
        event.engaged_secs,
    )

    # #Enrichment
    # if event.activity_type == 'paper_read':
    #     task = asyncio.create_task(run_agent("You are my smart PhD research assistant", 
    #             f"""I will give you a dictionnary containing a paper title and raw paper title. Extract the title.
    #             I want you to return metadata. 
    #             RETURN the metadata as a dictionary with keys surrended with double quotes.
    #             The dictionnary: {event.metadata} """))
    #     r = await task
        
    #     s = r.index('{')
    #     e = r.index('}') + 1
    
    #     d = json.loads(r[s:e])
    #     print(d)
    #     for k, v in d.items():
    #         event.metadata[k] = v 
        
    async with _buffer_lock:
        existing = _buffer.get(dedup_hash)
        if existing is None:
            _buffer[dedup_hash] = row
        else:
            # Same paper/app/day: collapse into one row, accumulating engagement
            # and keeping the earliest timestamp.
            existing["engaged_secs"] += event.engaged_secs
            if row["timestamp"] < existing["timestamp"]:
                existing["timestamp"] = row["timestamp"]
            existing["metadata"] = {**existing.get("metadata", {}), **event.metadata}
    return {"status": "queued"}


def _this_monday() -> date:
    """The Monday (UTC) of the current week — the weekly pipeline's week_start."""
    # today = datetime.now(timezone.utc).date()
    # return today - timedelta(days=today.weekday())

    return (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()


@app.get("/run-weekly")
async def run_weekly() -> dict[str, Any]:
    """Classify this week's read papers and return a summary."""
    summary = await run_weekly_pipeline(STUDENT_ID, _this_monday())
    log.info("Weekly pipeline summary: %s", summary)
    return summary


@app.get("/status")
async def status() -> dict[str, int]:
    async with _buffer_lock:
        queue_size = len(_buffer)
    return {"queue_size": queue_size, "total_synced": _total_synced}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT)
