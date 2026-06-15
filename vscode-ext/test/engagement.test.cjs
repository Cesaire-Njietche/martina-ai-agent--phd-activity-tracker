const test = require("node:test")
const assert = require("node:assert")
const { tick, shouldAccrue, THRESHOLD_SECS } = require("../out/engagement.js")

const T0 = 1_000_000

test("accrues only when focused and recently engaged", () => {
  assert.equal(shouldAccrue(true, T0, T0 + 10_000), true) // 10s ago
  assert.equal(shouldAccrue(true, T0, T0 + 30_000), true) // exactly 30s
  assert.equal(shouldAccrue(true, T0, T0 + 30_001), false) // >30s stale
  assert.equal(shouldAccrue(false, T0, T0 + 1_000), false) // not focused
})

test("fires exactly once after 90 cumulative engaged seconds", () => {
  let state = { engagedSecs: 0, sent: false }
  let fires = 0
  // Six focused, freshly-engaged heartbeats -> 90s.
  for (let i = 1; i <= 8; i++) {
    const now = T0 + i * 1000
    const r = tick(state, true, now, now) // engaged "now" each tick
    state = r.state
    if (r.fire) fires++
  }
  assert.equal(fires, 1, "should fire exactly once")
  assert.equal(state.sent, true)
  assert.ok(state.engagedSecs >= THRESHOLD_SECS)
})

test("does not accrue while unfocused", () => {
  let state = { engagedSecs: 0, sent: false }
  for (let i = 1; i <= 10; i++) {
    const now = T0 + i * 1000
    state = tick(state, false, now, now).state
  }
  assert.equal(state.engagedSecs, 0)
  assert.equal(state.sent, false)
})

test("does not accrue when engagement is stale", () => {
  let state = { engagedSecs: 0, sent: false }
  // Engagement happened at T0, ticks are far later (stale > 30s).
  for (let i = 1; i <= 10; i++) {
    const now = T0 + 60_000 + i * 1000
    state = tick(state, true, T0, now).state
  }
  assert.equal(state.engagedSecs, 0)
})
