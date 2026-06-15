/**
 * Daemon transport + offline queue, free of the vscode API.
 *
 * The queue is parameterised over a minimal key/value store so the extension
 * can pass `context.globalState` directly, while tests can pass an in-memory
 * stub. POSTing uses node:http so it works in the extension host without any
 * runtime dependency.
 */
import * as http from "node:http"

export interface DaemonEvent {
  source: string
  activity_type: string
  timestamp: string
  engaged_secs: number
  metadata: Record<string, unknown>
}

/** Matches the shape of vscode's Memento (context.globalState). */
export interface KeyValueStore {
  get<T>(key: string, defaultValue: T): T
  update(key: string, value: unknown): Thenable<void> | Promise<void>
}

export const QUEUE_KEY = "phdTracker.queue"
const DEFAULT_PORT = 5699

export function postEvent(
  event: DaemonEvent,
  port: number = DEFAULT_PORT
): Promise<boolean> {
  return new Promise((resolve) => {
    const body = JSON.stringify(event)
    const req = http.request(
      {
        host: "localhost",
        port,
        path: "/events",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 4000
      },
      (res) => {
        res.resume() // drain
        const ok = !!res.statusCode && res.statusCode >= 200 && res.statusCode < 300
        resolve(ok)
      }
    )
    req.on("error", () => resolve(false))
    req.on("timeout", () => {
      req.destroy()
      resolve(false)
    })
    req.write(body)
    req.end()
  })
}

export async function enqueue(
  store: KeyValueStore,
  event: DaemonEvent
): Promise<void> {
  const queue = store.get<DaemonEvent[]>(QUEUE_KEY, [])
  queue.push(event)
  await store.update(QUEUE_KEY, queue)
}

export async function flushQueue(
  store: KeyValueStore,
  port: number = DEFAULT_PORT
): Promise<void> {
  const queue = store.get<DaemonEvent[]>(QUEUE_KEY, [])
  if (queue.length === 0) return

  const remaining: DaemonEvent[] = []
  for (const event of queue) {
    const ok = await postEvent(event, port)
    if (!ok) remaining.push(event)
  }
  await store.update(QUEUE_KEY, remaining)
}

/** POST an event; on failure persist it to the store for later retry. */
export async function sendOrQueue(
  store: KeyValueStore,
  event: DaemonEvent,
  port: number = DEFAULT_PORT
): Promise<boolean> {
  const delivered = await postEvent(event, port)
  if (delivered) {
    await flushQueue(store, port)
  } else {
    await enqueue(store, event)
  }
  return delivered
}
