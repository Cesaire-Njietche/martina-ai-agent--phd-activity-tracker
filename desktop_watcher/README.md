# desktop PDF watcher

Tracks **Foxit PDF Reader** and **Adobe Acrobat** as the foreground app and POSTs
reading sessions to the local daemon (`http://localhost:5699/events`). Polls the
active window once a second; a session ends (and is reported, if it lasted ≥ 90s)
when the app loses focus or the window title changes (a new PDF).

## Run

```bash
pip install -r requirements.txt   # psutil (used for Windows process-name lookup)
python pdf_watcher.py
```

Prints `[pdf watcher] tracking Foxit + Acrobat on <OS>` and then blocks.

- **macOS**: uses `osascript` for the frontmost app + window title.
- **Windows**: uses `user32.GetForegroundWindow`/`GetWindowTextW` + `psutil`.
- **Linux**: uses `xdotool getactivewindow getwindowname` + `xprop WM_CLASS`.

## Test

```bash
python -m unittest
```

## Getting accurate PDF names in the title

On Foxit, go to Preferences → Documents → check "Always use filename as document
title" for accurate PDF names. On Acrobat, go to Edit → Preferences → General →
uncheck "Show document title in title bar" (or accept that document titles will
appear instead of filenames).
