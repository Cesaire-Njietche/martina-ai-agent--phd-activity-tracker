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
const QUEUE_KEY = "martina_queue"
const RETRY_ALARM = "martina-retry"
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

// Chrome's native PDF viewer can't run content scripts, so redirect arxiv PDF
// navigations (at the network layer, before the PDF loads) to our PDF.js-based
// viewer page, passing the original PDF URL as ?file=. \\0 is the whole matched
// URL. The viewer must be web-accessible to arxiv.org for this redirect (see
// web_accessible_resources in package.json).
const PDF_REDIRECT_RULE_ID = 1

function installPdfRedirectRule(): void {
  const viewer = chrome.runtime.getURL("tabs/pdf-viewer.html")
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [PDF_REDIRECT_RULE_ID],
    addRules: [
      {
        id: PDF_REDIRECT_RULE_ID,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { regexSubstitution: `${viewer}?file=\\0` }
        },
        condition: {
          regexFilter: "^https://arxiv\\.org/pdf/.*",
          resourceTypes: ["main_frame"]
        }
      }
    ]
  })
}

installPdfRedirectRule()
chrome.runtime.onInstalled.addListener(installPdfRedirectRule)

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
