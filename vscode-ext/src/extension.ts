import * as vscode from "vscode"

import { sendOrQueue, flushQueue, type DaemonEvent } from "./daemon"
import { HEARTBEAT_MS, tick, type EngagementState } from "./engagement"

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
// Session state
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

  // Resolve the git remote asynchronously; only apply if still the same session.
  const remote = await getGitRemote(uri)
  if (session === next) session.gitRepo = remote
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

export function activate(context: vscode.ExtensionContext): void {
  // Try to drain anything queued from a previous offline session.
  void flushQueue(context.globalState)

  void startSession(vscode.window.activeTextEditor)

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void startSession(editor)
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (session && e.textEditor === vscode.window.activeTextEditor) markEngaged()
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (session && doc.uri.toString() === session.uriKey) markEngaged()
    })
  )

  const timer = setInterval(() => {
    if (!session) return
    const { state, fire } = tick(
      session.engagement,
      vscode.window.state.focused,
      session.lastEngagementAt,
      Date.now()
    )
    session.engagement = state
    if (fire) {
      void sendOrQueue(context.globalState, buildEvent(session))
    }
  }, HEARTBEAT_MS)

  context.subscriptions.push({ dispose: () => clearInterval(timer) })
}

export function deactivate(): void {
  session = undefined
}
