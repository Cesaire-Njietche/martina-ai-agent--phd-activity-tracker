/**
 * Pure engagement-accounting logic, free of the vscode API so it can be unit
 * tested. A 15s heartbeat accrues 15 engaged seconds only when the window is
 * focused and an engagement event happened in the last 30s; at 90 cumulative
 * seconds the event should fire exactly once.
 */

export const HEARTBEAT_MS = 15_000
export const ACTIVE_WINDOW_MS = 30_000
export const THRESHOLD_SECS = 90

export function shouldAccrue(
  focused: boolean,
  lastEngagementAt: number,
  now: number
): boolean {
  return focused && now - lastEngagementAt <= ACTIVE_WINDOW_MS
}

export interface EngagementState {
  engagedSecs: number
  sent: boolean
}

export interface TickResult {
  state: EngagementState
  /** True on the single tick that crosses the threshold. */
  fire: boolean
}

/** Advance one heartbeat. Returns the new state and whether to send now. */
export function tick(
  state: EngagementState,
  focused: boolean,
  lastEngagementAt: number,
  now: number
): TickResult {
  if (state.sent) return { state, fire: false }
  if (!shouldAccrue(focused, lastEngagementAt, now)) return { state, fire: false }

  const engagedSecs = state.engagedSecs + HEARTBEAT_MS / 1000
  const sent = engagedSecs >= THRESHOLD_SECS
  return { state: { engagedSecs, sent }, fire: sent }
}
