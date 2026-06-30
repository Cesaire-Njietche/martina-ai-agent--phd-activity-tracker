"""Weekly classification pipeline.

`run_weekly_pipeline(student_id, week_start)`:
  1. Reads this week's ``paper_read`` events that carry a ``metadata.title`` from
     Supabase (same query shape as ``show_week.py``).
  2. Classifies them with ``agents.classify.classify_papers`` — one paper per
     call — fanned out concurrently in batches of 10 via ``asyncio.gather``.
  3. Upserts the results into the ``paper_classifications`` table.
  4. Returns ``{paper_count, classified_count, coding_hours}``.

Supabase's Python client is synchronous, so each DB round-trip is pushed to a
worker thread to avoid blocking the daemon's event loop.
"""

from __future__ import annotations

import asyncio
import os
from datetime import date, datetime, timedelta, timezone
from typing import Union
from uuid import uuid4

from dotenv import load_dotenv
from supabase import Client, create_client

from agents.classify import classify_papers
from agents.enrich import enrich_all
from daemon.report import generate_report

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
EVENTS_TABLE = os.environ.get("SUPABASE_TABLE", "unified_events")
CLASSIFICATIONS_TABLE = "paper_classifications"
WEEKLY_REPORTS_TABLE = "weekly_reports"

BATCH_SIZE = 10

_supabase: Client | None = None


def _get_client() -> Client:
    global _supabase
    if _supabase is None:
        if not (SUPABASE_URL and SUPABASE_KEY):
            raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set (see .env).")
        _supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase


def _week_window(week_start: Union[str, date, datetime]) -> tuple[datetime, datetime]:
    """Normalize `week_start` to a [start, start+7d) UTC datetime window."""
    if isinstance(week_start, str):
        week_start = datetime.fromisoformat(week_start)
    if isinstance(week_start, datetime):
        start = week_start if week_start.tzinfo else week_start.replace(tzinfo=timezone.utc)
    elif isinstance(week_start, date):
        start = datetime(week_start.year, week_start.month, week_start.day, tzinfo=timezone.utc)
    else:
        raise TypeError(f"unsupported week_start: {week_start!r}")
    start = start.astimezone(timezone.utc)
    return start, start + timedelta(days=7)


def _fetch_week_papers(
    supabase: Client, student_id: str, start: datetime, end: datetime
) -> list[dict]:
    """`paper_read` events for the week that actually carry a title (cf. show_week.py)."""
    resp = (
        supabase.table(EVENTS_TABLE)
        .select("id, student_id, engaged_secs, metadata, timestamp")
        .eq("activity_type", "paper_read")
        .eq("student_id", student_id)
        .gte("timestamp", start.isoformat())
        .lt("timestamp", end.isoformat())
        .execute()
    )
    return [
        event
        for event in (resp.data or [])
        if (event.get("metadata") or {}).get("title")
    ]

def _writing_activity(supabase: Client, student_id: str, start: datetime, end: datetime
) -> list[dict]:
    """`latex_writing` events for the week that regarding writing on latex."""
    resp = (
        supabase.table(EVENTS_TABLE)
        .select("id, student_id, engaged_secs, metadata, timestamp")
        .eq("activity_type", "latex_writing")
        .eq("student_id", student_id)
        .gte("timestamp", start.isoformat())
        .lt("timestamp", end.isoformat())
        .execute()
    )


    return [
        {
            "total_sec": round(float(event.get('engaged_secs')) / 3600, 2),
            "title": event.get('metadata').get('title')
        }
        for event in (resp.data or [])
        if (event.get("metadata") or {}).get("title")
    ]

def _coding_hours(
    supabase: Client, student_id: str, start: datetime, end: datetime
) -> float:
    """Total engaged hours of `coding` activity (emitted by the VS Code extension)."""
    resp = (
        supabase.table(EVENTS_TABLE)
        .select("engaged_secs")
        .eq("activity_type", "coding")
        .eq("student_id", student_id)
        .gte("timestamp", start.isoformat())
        .lt("timestamp", end.isoformat())
        .execute()
    )
    total_secs = sum(float(r.get("engaged_secs") or 0) for r in (resp.data or []))
    return round(total_secs / 3600, 2)


async def _classify_in_batches(papers: list[dict], batch_size: int = BATCH_SIZE) -> list[dict]:
    """Classify papers concurrently, `batch_size` at a time. Never sequential.

    Each batch is fanned out with ``asyncio.gather``; a paper that fails to
    classify is dropped (logged) rather than sinking the whole batch.
    """
    classifications: list[dict] = []
    for i in range(0, len(papers), batch_size):
        batch = papers[i : i + batch_size]
        results = await asyncio.gather(
            *(classify_papers(p) for p in batch), return_exceptions=True
        )
        for paper, result in zip(batch, results):
            if isinstance(result, Exception):
                title = (paper.get("metadata") or {}).get("title")
                print(f"[classify] failed for {title!r}: {result}")
                continue
            classifications.append(result)
    return classifications


def _upsert_classifications(supabase: Client, rows: list[dict]) -> None:
    if rows:
        supabase.table(CLASSIFICATIONS_TABLE).upsert(
            rows, on_conflict="event_id,week_start"
        ).execute()


def _insert_weekly_report(supabase: Client, row: dict) -> None:
    supabase.table(WEEKLY_REPORTS_TABLE).insert(row).execute()


async def run_weekly_pipeline(
    student_id: str, week_start: Union[str, date, datetime]
) -> dict:
    supabase = _get_client()
    start, end = _week_window(week_start)
    week_start_date = start.date().isoformat()

    papers = await asyncio.to_thread(_fetch_week_papers, supabase, student_id, start, end)
    writing = await asyncio.to_thread(_writing_activity, supabase, student_id, start, end)
    papers = await enrich_all(papers=papers)
    papers = [p for p in papers if 'enrichment_error' not in p]
    classifications = await _classify_in_batches(papers)

    rows = [
        {
            "event_id": c["event_id"],
            "student_id": student_id,
            "domains": c["domains"],
            "confidence": c["confidence"],
            "note": c["note"],
            "week_start": week_start_date,
        }
        for c in classifications
        if c.get("event_id") is not None
    ]

    await asyncio.to_thread(_upsert_classifications, supabase, rows)
    coding_hours = await asyncio.to_thread(_coding_hours, supabase, student_id, start, end)

    week_data = {
        "paper_count": len(papers),
        "classified_count": len(rows),
        "coding_hours": coding_hours,
        "writing": writing,
        "paper_enriched": papers,
        "classifications": classifications,
    }

    # Narrative report -> persist to weekly_reports, hand back a shareable token.
    narrative = await generate_report(student_id, week_data)
    share_token = uuid4().hex
    report_row = {
        "student_id": student_id,
        "week_start": week_start_date,
        "narrative": narrative,
        "paper_count": len(papers),
        "coding_hours": coding_hours,
        "writing_activities": writing,
        "share_token": share_token,
    }
    await asyncio.to_thread(_insert_weekly_report, supabase, report_row)

    return {
        **week_data,
        "narrative": narrative,
        "share_token": share_token,
    }


if __name__ == "__main__":
    _today = datetime.now(timezone.utc).date()
    _monday = _today - timedelta(days=_today.weekday())
    summary = asyncio.run(run_weekly_pipeline(os.environ.get("STUDENT_ID", ""), _monday))
    print(summary)
