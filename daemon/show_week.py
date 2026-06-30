"""Show the papers read in the last 7 days.

Queries the Supabase `unified_events` table for `paper_read` events from the past
week whose metadata carries a `title`, then prints a table sorted by engaged
reading time (longest first) with a summary of total papers and hours.

Run directly:
    python daemon/show_week.py
"""

from __future__ import annotations

import os
import asyncio
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from supabase import create_client
from agents.enrich import enrich_all
from agents.classify import classify_papers

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
TABLE = os.environ.get("SUPABASE_TABLE", "unified_events")

LOOKBACK_DAYS = 7
TITLE_WIDTH = 30


def _truncate(text: str, width: int) -> str:
    """Trim `text` to `width` chars, marking truncation with an ellipsis."""
    text = text or ""
    if len(text) <= width:
        return text
    return text[: width - 3] + "..."


def _first_author(authors) -> str:
    """Return the first author name from a metadata `authors` value."""
    if isinstance(authors, list):
        return str(authors[0]) if authors else ""
    if isinstance(authors, str):
        return authors
    return ""


async def main() -> None:
    if not (SUPABASE_URL and SUPABASE_KEY):
        raise SystemExit("SUPABASE_URL and SUPABASE_KEY must be set (see .env).")

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    since = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    resp = (
        supabase.table(TABLE)
        .select("id, student_id, engaged_secs, metadata, timestamp")
        .eq("activity_type", "paper_read")
        .gte("timestamp", since)
        .execute()
    )

    # Keep only events whose metadata actually carries a title.
    rows = []
    papers = []
    for event in resp.data or []:
        metadata = event.get("metadata") or {}
        title = metadata.get("title")
        if not title:
            continue

        papers.append(event)
        engaged_secs = float(event.get("engaged_secs") or 0)
        ts = event.get("timestamp")
        rows.append(
            {
                "timestamp": ts,
                "title": title,
                "author": _first_author(metadata.get("authors")),
                "year": metadata.get("year") or "",
                "engaged_secs": engaged_secs,
            }
        )

    papers = await enrich_all(papers)
    print (papers)
    r = await asyncio.gather(*(classify_papers(p) for p in papers))

    #print(r)
    rows.sort(key=lambda r: r["engaged_secs"], reverse=True)

    header = f"{'Title':<{TITLE_WIDTH}}  {'Author':<25}  {'Year':<6}  {'Min':<5} {'TS':>10}"
    # print(header)
    # print("-" * len(header))
    # for row in rows:
    #     minutes = round(row["engaged_secs"] / 60)
    #     print(
    #         f"{_truncate(row['title'], TITLE_WIDTH):<{TITLE_WIDTH}}  "
    #         f"{_truncate(row['author'], 25):<25}  "
    #         f"{str(row['year']):<6}  "
    #         f"{minutes:<5}"
    #         f"{row['timestamp']:>10}"
    #     )

    total_hours = sum(r["engaged_secs"] for r in rows) / 3600
    print("-" * len(header))
    print(f"{len(rows)} papers, {total_hours:.1f} hours total reading time.")


if __name__ == "__main__":
    asyncio.run(main())
