"""Single-paper domain classification.

`classify_papers` now classifies ONE paper at a time and returns a structured
dict. Callers fan out concurrently (see ``daemon/orchestrator.py``), which keeps
the per-call prompt small and lets failures be isolated per paper rather than
losing a whole batch.
"""

from __future__ import annotations

import json
from typing import Any, Optional

import anthropic
from dotenv import load_dotenv

load_dotenv()

DOMAINS = [
    "Quantum Error Correction",
    "Surface Code",
    "Neural Network",
    "MLP",
    "Adversarial Attacks",
    "Worst-case Physical Error Injection",
]

SYSTEM = (
    "You are a PhD research assistant performing paper domain classification. "
    "The only valid domains are: " + ", ".join(DOMAINS) + "."
)

TASK = """Classify this single paper into one or more of the valid domains.

Title: "{title}"
Metadata: {metadata}

Respond with ONLY a JSON object (all keys double-quoted), no prose, no code fences:
{{"domains": ["..."], "confidence": 0.0, "note": "one short sentence why"}}

Rules:
- Pick domains only from the valid list; never invent new ones.
- confidence is a float between 0 and 1.
- If no domain fits, return an empty domains list with confidence 0.
"""

MODEL = "claude-haiku-4-5"

_client: Optional[anthropic.AsyncAnthropic] = None


def _get_client() -> anthropic.AsyncAnthropic:
    """Lazily build the async client so importing this module never needs a key."""
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic()
    return _client


def _extract_json(text: str) -> dict[str, Any]:
    """Pull the first JSON object out of a model reply (tolerates fences/prose)."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError(f"no JSON object in model reply: {text!r}")
    return json.loads(text[start : end + 1])


async def classify_papers(paper: dict) -> dict:
    """Classify a single paper into research domains.

    Returns ``{event_id, domains, confidence, note}``. ``event_id`` is the
    originating ``unified_events.id`` so results can be joined back / upserted.
    """
    metadata = paper.get("metadata") or {}
    title = metadata.get("title") or ""

    response = await _get_client().messages.create(
        model=MODEL,
        system=SYSTEM,
        max_tokens=512,
        messages=[{"role": "user", "content": TASK.format(title=title, metadata=metadata)}],
    )

    parsed = _extract_json(response.content[0].text)
    domains = parsed.get("domains") or []
    if not isinstance(domains, list):
        domains = [str(domains)]

    return {
        "event_id": paper.get("id"),
        "domains": [str(d) for d in domains],
        "confidence": float(parsed.get("confidence") or 0.0),
        "note": str(parsed.get("note") or ""),
    }
