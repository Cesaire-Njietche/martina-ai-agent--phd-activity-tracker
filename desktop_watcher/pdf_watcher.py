"""Desktop PDF-reading watcher for Foxit PDF Reader and Adobe Acrobat.

Polls the foreground window once a second; while a matching PDF app is focused it
tracks a reading session, and when focus is lost or the window title changes (a
new PDF) it ends the session and POSTs a paper_read event to the local daemon —
but only if the session lasted at least 90 seconds.

The OS window APIs differ per platform (osascript on macOS, user32 + psutil on
Windows, xdotool/xprop on Linux); the matching / title cleaning / session logic
is kept pure so it can be unit tested without a real window.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Optional, Tuple

DAEMON_URL = "http://localhost:5699/events"
POLL_INTERVAL_SECS = 1.0
THRESHOLD_SECS = 90
GREEN = "\033[32m"
RESET = "\033[0m"

# Process/app names to match (case-insensitive). The brand substrings below are a
# superset of these and tolerate version-specific naming:
#   Foxit:   "Foxit PDF Reader", "FoxitPDFReader", "FoxitReader"
#   Acrobat: "Adobe Acrobat", "Acrobat Reader", "AcroRd32", "Acrobat"
_APP_TITLE_TOKENS = ("foxit", "acrobat", "adobe")


# --------------------------------------------------------------------------- #
# Pure logic (unit tested)
# --------------------------------------------------------------------------- #


def match_app(name: Optional[str]) -> Optional[str]:
    """Map a foreground process/app name to a canonical app, or None."""
    if not name:
        return None
    n = name.strip().lower()
    if n.endswith(".exe"):
        n = n[:-4]
    if "foxit" in n:
        return "Foxit PDF Reader"
    if "acrobat" in n or "acrord32" in n:
        return "Adobe Acrobat"
    return None


def clean_title(raw_title: Optional[str]) -> str:
    """Best-effort PDF name: drop the app-name segment(s) from the window title.

    Window titles look like "thesis.pdf - Foxit PDF Reader" or
    "report.pdf - Adobe Acrobat Reader (64-bit)"; we keep the segments that don't
    name the application. Falls back to the raw title if nothing remains.
    """
    raw = (raw_title or "").strip()
    if not raw:
        return raw
    segments = [s.strip() for s in raw.split(" - ")]
    kept = [s for s in segments if s and not any(t in s.lower() for t in _APP_TITLE_TOKENS)]
    cleaned = " - ".join(kept).strip()
    return cleaned or raw


@dataclass
class _Session:
    app: str
    raw_title: str
    title: str
    start: datetime


class SessionTracker:
    """Turns a stream of (matched_app, raw_title, now) ticks into events.

    Emits at most one event per tick — when a session ends (focus lost or title
    changed) and it lasted >= threshold seconds.
    """

    def __init__(self, threshold_secs: int = THRESHOLD_SECS) -> None:
        self.threshold = threshold_secs
        self._session: Optional[_Session] = None

    def tick(
        self, matched_app: Optional[str], raw_title: str, now: datetime
    ) -> Optional[dict]:
        if matched_app is None:
            return self._end(now)

        s = self._session
        if s is None:
            self._start(matched_app, raw_title, now)
            return None
        if s.app != matched_app or s.raw_title != raw_title:
            # Focus moved to a different app/PDF: close the old session, then
            # immediately open a new one for what is now in focus.
            event = self._end(now)
            self._start(matched_app, raw_title, now)
            return event
        return None  # same app + same title: session continues

    def _start(self, app: str, raw_title: str, now: datetime) -> None:
        self._session = _Session(
            app=app, raw_title=raw_title, title=clean_title(raw_title), start=now
        )

    def _end(self, now: datetime) -> Optional[dict]:
        s = self._session
        self._session = None
        if s is None:
            return None
        dwell = (now - s.start).total_seconds()
        if dwell < self.threshold:
            return None
        return {
            "source": "desktop",
            "activity_type": "paper_read",
            "timestamp": s.start.isoformat(),
            "engaged_secs": int(dwell),
            "metadata": {"app": s.app, "title": s.title, "raw_title": s.raw_title},
        }


# --------------------------------------------------------------------------- #
# Transport
# --------------------------------------------------------------------------- #


def post_event(event: dict, url: str = DAEMON_URL) -> bool:
    """POST an event to the daemon. Returns False (and drops) if it's offline."""
    data = json.dumps(event).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False  # daemon offline — silently drop (sessions are bounded)


# --------------------------------------------------------------------------- #
# Foreground-window detection (per OS)
# --------------------------------------------------------------------------- #


def _active_window_macos() -> Tuple[Optional[str], Optional[str]]:
    script = (
        'tell application "System Events"\n'
        "  set frontApp to first application process whose frontmost is true\n"
        "  set appName to name of frontApp\n"
        "  try\n"
        "    set winTitle to name of front window of frontApp\n"
        "  on error\n"
        '    set winTitle to ""\n'
        "  end try\n"
        "end tell\n"
        'return appName & "|||" & winTitle'
    )
    try:
        out = subprocess.run(
            ["osascript", "-e", script], capture_output=True, text=True, timeout=4
        ).stdout.strip()
    except Exception:
        return None, None
    name, _, title = out.partition("|||")
    return name or None, title


def _active_window_windows() -> Tuple[Optional[str], Optional[str]]:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return None, None

    length = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buf, length + 1)
    title = buf.value

    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    name = None
    try:
        import psutil

        name = psutil.Process(pid.value).name()
    except Exception:
        name = None
    return name, title


def _active_window_linux() -> Tuple[Optional[str], Optional[str]]:
    try:
        win_id = subprocess.check_output(
            ["xdotool", "getactivewindow"], text=True, timeout=4
        ).strip()
    except Exception:
        return None, None
    try:
        title = subprocess.check_output(
            ["xdotool", "getwindowname", win_id], text=True, timeout=4
        ).strip()
    except Exception:
        title = ""
    name = None
    try:
        out = subprocess.check_output(
            ["xprop", "-id", win_id, "WM_CLASS"], text=True, timeout=4
        )
        # WM_CLASS(STRING) = "instance", "ClassName"
        _, _, rhs = out.partition("=")
        classes = [p.strip().strip('"') for p in rhs.split(",") if p.strip()]
        if classes:
            name = classes[-1]
    except Exception:
        name = None
    return name, title


def get_active_window() -> Tuple[Optional[str], Optional[str]]:
    if sys.platform == "darwin":
        return _active_window_macos()
    if sys.platform == "win32":
        return _active_window_windows()
    return _active_window_linux()


def os_label() -> str:
    return {"darwin": "macOS", "win32": "Windows", "linux": "Linux"}.get(
        sys.platform, sys.platform
    )


# --------------------------------------------------------------------------- #
# Loop
# --------------------------------------------------------------------------- #


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def run(
    get_window: Callable[[], Tuple[Optional[str], Optional[str]]] = get_active_window,
    post: Callable[[dict], bool] = post_event,
    poll_interval: float = POLL_INTERVAL_SECS,
    threshold_secs: int = THRESHOLD_SECS,
    clock: Callable[[], datetime] = _utcnow,
    sleep: Callable[[float], None] = time.sleep,
    iterations: Optional[int] = None,
) -> None:
    """Blocking poll loop. `iterations` bounds it for testing (None = forever)."""
    tracker = SessionTracker(threshold_secs)
    i = 0
    while iterations is None or i < iterations:
        try:
            name, title = get_window()
        except Exception:
            name, title = None, None
        event = tracker.tick(match_app(name), title or "", clock())
        if event:
            post(event)
        i += 1
        if iterations is None or i < iterations:
            sleep(poll_interval)


def main() -> None:
    print(f"{GREEN}[Martina - PhD Tracker]{RESET} tracking Foxit + Acrobat on {os_label()}", flush=True)
    try:
        run()
    except KeyboardInterrupt:
        print(f"{GREEN}[Martina - PhD Tracker]{RESET} stopped", flush=True)


if __name__ == "__main__":
    main()
