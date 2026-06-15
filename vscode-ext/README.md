# phd-tracker VSCode extension

Tracks engaged coding time per file and reports it to the local phd-tracker
daemon (`http://localhost:5699`).

## Behaviour

- On active-editor change, starts a session capturing the file URI, language id,
  workspace-folder name (as `project`), and the git remote URL (via the built-in
  `vscode.git` extension API).
- Engagement is marked on `onDidChangeTextEditorSelection` and
  `onDidSaveTextDocument`.
- A 15s heartbeat accrues 15 engaged seconds only when `window.state.focused` is
  true **and** there was an engagement event in the last 30s.
- After 90 cumulative engaged seconds it POSTs one event to `/events` with
  `source=vscode`, `activity_type=coding`, and `metadata` `{file, language,
  project, git_repo}`.
- If the daemon is offline the event is queued in `globalState` and retried on
  the next successful send and on next activation.

## Develop

```bash
npm install
npm run compile     # tsc -> out/
npm test            # node:test unit tests for the engagement logic
npm run package     # builds the .vsix (runs vsce package)
```

## Install the .vsix

```bash
code --install-extension phd-tracker-vscode-0.1.0.vsix
```

Or in VSCode: Extensions view → `…` menu → **Install from VSIX…**

## Notes

The network + queue logic lives in `src/daemon.ts` and the engagement math in
`src/engagement.ts`, both free of the vscode API so they can be unit tested
directly. `src/extension.ts` is the thin vscode glue.
