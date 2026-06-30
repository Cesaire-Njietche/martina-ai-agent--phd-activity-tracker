"""Weekly PhD progress report generation.

`generate_report(student_id, week_data)` turns the summary dict produced by
``daemon.orchestrator.run_weekly_pipeline`` into a narrative progress report
written for a supervisor. Returns only the narrative text.
"""

from __future__ import annotations

import json
from typing import Any

import anthropic
from dotenv import load_dotenv

load_dotenv()

MODEL = "claude-sonnet-4-6"

SYSTEM = (
    "You write weekly PhD progress reports for supervisors. "
    "Style: academic prose, no bullet points, no filler, 250-300 words. "
    "Structure the narrative, in this order, as flowing paragraphs: "
    "(1) what literature was covered — name the specific papers and their key ideas; "
    "(2) coding and research activity — the languages used and the projects worked on; "
    "(3) the balance of domains across quantum error correction, AI, and cybersecurity; "
    "(4) writing activity on online LaTeX. "
    "Tone: professional, like a research update email. "
    "Return only the narrative text — no heading, no sign-off, no preamble."
)


_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    """Lazily build the async client so importing this module never needs a key."""
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic()
    return _client


async def generate_report(student_id: str, week_data: dict[str, Any]) -> str:
    """Generate the week's narrative progress report from `week_data`."""
    prompt = (
        f"Write the weekly progress report for student {student_id!r}.\n\n"
        "Base it strictly on this week's activity data (JSON below). Do not invent "
        "papers, projects, or numbers that are not present. If a section has no "
        "supporting data, state briefly that there was no recorded activity there.\n\n"
        f"{json.dumps(week_data, indent=2, default=str)}\n\n"
        "Write the report now."
    )

    response = await _get_client().messages.create(
        model=MODEL,
        system=SYSTEM,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text.strip()
