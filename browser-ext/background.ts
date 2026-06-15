/**
 * Background service worker: owns all daemon network I/O.
 *
 * Content scripts can't reliably fetch http://localhost from an https page
 * (CORS), so they message us instead. We POST to the daemon, and if it's
 * offline we persist the event to chrome.storage.local and retry hourly via
 * chrome.alarms. (chrome.storage.local is used rather than localStorage because
 * MV3 service workers have no DOM/localStorage.)
 */

const DAEMON_URL = "http://localhost:5699/events"
const QUEUE_KEY = "phd_tracker_queue"
const RETRY_ALARM = "phd-tracker-retry"
const RETRY_PERIOD_MIN = 60

// Create the retry alarm on every SW startup (create is idempotent per name).
chrome.alarms.create(RETRY_ALARM, { periodInMinutes: RETRY_PERIOD_MIN })

chrome.runtime.onStartup.addListener(flushQueue)
chrome.runtime.onInstalled.addListener(flushQueue)

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) flushQueue()
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "paper-event") {
    sendOrQueue(message.payload).then((delivered) => sendResponse({ delivered }))
    return true // keep the channel open for the async response
  }
  return false
})

async function postEvent(payload: unknown): Promise<boolean> {
  try {
    const res = await fetch(DAEMON_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
    return res.ok
  } catch {
    return false
  }
}

async function sendOrQueue(payload: unknown): Promise<boolean> {
  const delivered = await postEvent(payload)
  if (!delivered) {
    await enqueue(payload)
  } else {
    // A live daemon is a good moment to drain anything queued earlier.
    void flushQueue()
  }
  return delivered
}

async function enqueue(payload: unknown): Promise<void> {
  const queue = await readQueue()
  queue.push(payload)
  await chrome.storage.local.set({ [QUEUE_KEY]: queue })
}

async function readQueue(): Promise<unknown[]> {
  const data = await chrome.storage.local.get(QUEUE_KEY)
  const queue = data[QUEUE_KEY]
  return Array.isArray(queue) ? queue : []
}

async function flushQueue(): Promise<void> {
  const queue = await readQueue()
  if (queue.length === 0) return

  const remaining: unknown[] = []
  for (const payload of queue) {
    const delivered = await postEvent(payload)
    if (!delivered) remaining.push(payload)
  }
  await chrome.storage.local.set({ [QUEUE_KEY]: remaining })
}
