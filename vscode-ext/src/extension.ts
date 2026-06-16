import * as vscode from "vscode"

import {
  sendOrQueue,
  flushQueue,
  QUEUE_KEY,
  type DaemonEvent
} from "./daemon"
import {
  ACTIVE_WINDOW_MS,
  HEARTBEAT_MS,
  tick,
  type EngagementState
} from "./engagement"

// --------------------------------------------------------------------------- //
// Minimal typings for the built-in vscode.git extension API (not in @types).
// --------------------------------------------------------------------------- //
interface GitRemote {
  name: string
  fetchUrl?: string
  pushUrl?: string
}
interface GitRepository {
  rootUri: vscode.Uri
  state: { remotes: GitRemote[] }
}
interface GitAPI {
  repositories: GitRepository[]
  getRepository(uri: vscode.Uri): GitRepository | null
}
interface GitExtension {
  enabled: boolean
  getAPI(version: 1): GitAPI
}

// --------------------------------------------------------------------------- //
// State
// --------------------------------------------------------------------------- //
interface Session {
  fileUri: vscode.Uri
  uriKey: string
  language: string
  project?: string
  gitRepo?: string
  lastEngagementAt: number
  engagement: EngagementState
}

let session: Session | undefined
let output: vscode.OutputChannel
let statusBar: vscode.StatusBarItem

function log(msg: string): void {
  output.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`)
}

function updateStatus(): void {
  if (!session) {
    statusBar.text = "$(pulse) Martina: idle"
    return
  }
  const s = session.engagement
  statusBar.text = s.sent
    ? `$(check) Martina: sent (${s.engagedSecs}s)`
    : `$(pulse) Martina: ${s.engagedSecs}s / 90`
}

async function getGitRemote(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const ext = vscode.extensions.getExtension<GitExtension>("vscode.git")
    if (!ext) return undefined
    const gitExt = ext.isActive ? ext.exports : await ext.activate()
    const api = gitExt.getAPI(1)
    const repo =
      api.getRepository?.(uri) ??
      api.repositories.find((r) => uri.fsPath.startsWith(r.rootUri.fsPath))
    if (!repo) return undefined
    const remote = repo.state.remotes.find((r) => r.fetchUrl) ?? repo.state.remotes[0]
    return remote?.fetchUrl ?? remote?.pushUrl
  } catch {
    return undefined
  }
}

async function startSession(editor: vscode.TextEditor | undefined): Promise<void> {
  if (!editor) {
    session = undefined
    log("Active editor: none — session paused")
    updateStatus()
    return
  }
  const uri = editor.document.uri
  const next: Session = {
    fileUri: uri,
    uriKey: uri.toString(),
    language: editor.document.languageId,
    project: vscode.workspace.getWorkspaceFolder(uri)?.name,
    gitRepo: undefined,
    lastEngagementAt: Date.now(),
    engagement: { engagedSecs: 0, sent: false }
  }
  session = next
  log(`Session start: ${uri.fsPath} [lang=${next.language}, project=${next.project ?? "-"}]`)
  updateStatus()

  const remote = await getGitRemote(uri)
  if (session === next) {
    session.gitRepo = remote
    log(`  git_repo=${remote ?? "-"}`)
  }
}

function markEngaged(): void {
  if (session) session.lastEngagementAt = Date.now()
}

function buildEvent(s: Session): DaemonEvent {
  return {
    source: "vscode",
    activity_type: "coding",
    timestamp: new Date().toISOString(),
    engaged_secs: s.engagement.engagedSecs,
    metadata: {
      file: s.fileUri.fsPath,
      language: s.language,
      project: s.project,
      git_repo: s.gitRepo
    }
  }
}

async function deliver(
  context: vscode.ExtensionContext,
  event: DaemonEvent,
  label: string
): Promise<boolean> {
  const ok = await sendOrQueue(context.globalState, event)
  log(
    ok
      ? `${label}: delivered to daemon ✓`
      : `${label}: daemon offline — queued to globalState (will retry on next send/activation)`
  )
  updateStatus()
  return ok
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Martina")
  context.subscriptions.push(output)
  log("Extension activated. Daemon target: http://localhost:5699/events")

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBar.tooltip = "Martina — engaged seconds (click for log)"
  statusBar.command = "martina.showLog"
  context.subscriptions.push(statusBar)
  statusBar.show()
  updateStatus()

  const queuedCount = context.globalState.get<DaemonEvent[]>(QUEUE_KEY, []).length
  if (queuedCount > 0) log(`Flushing ${queuedCount} event(s) queued from a previous session…`)
  void flushQueue(context.globalState).then(() => {
    const left = context.globalState.get<DaemonEvent[]>(QUEUE_KEY, []).length
    if (queuedCount > 0) log(`Queue flush done — ${left} still pending (daemon offline?)`)
  })

  void startSession(vscode.window.activeTextEditor)

  context.subscriptions.push(
    vscode.commands.registerCommand("martina.showLog", () => output.show()),
    vscode.commands.registerCommand("martina.sendTestEvent", async () => {
      const event: DaemonEvent = session
        ? { ...buildEvent(session), engaged_secs: session.engagement.engagedSecs || 1 }
        : {
            source: "vscode",
            activity_type: "coding",
            timestamp: new Date().toISOString(),
            engaged_secs: 1,
            metadata: { file: "(manual test)", language: "(test)", project: undefined, git_repo: undefined }
          }
      output.show()
      log("Manual test event — sending now…")
      const ok = await deliver(context, event, "Manual test event")
      void vscode.window.showInformationMessage(
        ok ? "Martina: delivered to daemon ✓" : "Martina: daemon offline — event queued"
      )
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void startSession(editor)
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (session && e.textEditor.document.uri.toString() === session.uriKey) markEngaged()
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (session && doc.uri.toString() === session.uriKey) markEngaged()
    })
  )

  const timer = setInterval(() => {
    if (!session) {
      updateStatus()
      return
    }
    if (session.engagement.sent) return

    const now = Date.now()
    const focused = vscode.window.state.focused
    const idleMs = now - session.lastEngagementAt

    if (!focused) {
      log("heartbeat: skipped (VSCode window not focused)")
      return
    }
    if (idleMs > ACTIVE_WINDOW_MS) {
      log(`heartbeat: skipped (idle ${Math.round(idleMs / 1000)}s — type/scroll to count)`)
      return
    }

    const { state, fire } = tick(session.engagement, focused, session.lastEngagementAt, now)
    session.engagement = state
    log(`heartbeat: +15s (total ${state.engagedSecs}s / 90)`)
    updateStatus()

    if (fire) {
      log("Threshold reached (90s) — sending coding event…")
      void deliver(context, buildEvent(session), "Coding event")
    }
  }, HEARTBEAT_MS)
  context.subscriptions.push({ dispose: () => clearInterval(timer) })
}

export function deactivate(): void {
  session = undefined
}
