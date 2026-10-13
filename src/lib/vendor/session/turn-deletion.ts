/** Durable deletion of complete conversation turns without rewriting the event log. */
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** One completed turn selected for deletion. */
export interface SessionTurnDeletion {
  readonly turn: number
  readonly startSeq: SessionSeq
  readonly endSeq: SessionSeq
}

/** Stable rejection of a deletion; no deletion event is committed. */
export class SessionTurnDeletionError extends Error {
  /** @param code - rejection identity. @param message - diagnostic for the receiving UI. */
  constructor(readonly code: 'TURN_OPEN' | 'COMPACTION_OPEN' | 'INVALID_DELETION' | 'LATER_SURFACE' | 'TURN_CHANGED', message: string) {
    super(message)
    this.name = 'SessionTurnDeletionError'
  }
}

/** Minimal event fields shared by durable logs and browser event windows. */
export interface TurnDeletionRecord {
  readonly type: string
  readonly seq: number
  readonly data: unknown
  readonly ignorable?: true
}

/**
 * Validate a deletion's JSON payload and earlier coordinates.
 * @param event - deletion event read from a durable log or browser stream.
 * @returns admitted deletion coordinates.
 * @throws when coordinates or omission safety are invalid.
 */
export function readTurnDeletion(event: TurnDeletionRecord): SessionTurnDeletion {
  const data = event.data
  if (typeof data !== 'object' || data === null || Array.isArray(data) || event.ignorable === true) {
    throw new SessionTurnDeletionError('INVALID_DELETION', 'turn deletion requires a non-ignorable object payload')
  }
  const fields = data as Record<string, unknown>
  const { turn, startSeq, endSeq } = fields
  if (Object.keys(fields).length !== 3 || typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 1
    || typeof startSeq !== 'number' || !Number.isSafeInteger(startSeq) || startSeq < 0 || Object.is(startSeq, -0)
    || typeof endSeq !== 'number' || !Number.isSafeInteger(endSeq) || endSeq < startSeq || endSeq >= event.seq) {
    throw new SessionTurnDeletionError('INVALID_DELETION', 'turn deletion requires a positive turn and an earlier inclusive event range')
  }
  return { turn, startSeq: SessionSeq(startSeq), endSeq: SessionSeq(endSeq) }
}

/**
 * Select undeleted events, retaining their original sequence numbers. Raw log readers remain lossless.
 * @param events - events in increasing sequence order, including cropped browser windows.
 * @returns active events with deletion decisions and their target ranges omitted.
 */
export function visibleSessionEvents<T extends TurnDeletionRecord>(events: readonly T[]): T[] {
  const ranges = events.filter(event => event.type === 'session/turn-deleted').map(readTurnDeletion)
    .sort((left, right) => left.startSeq - right.startSeq)
  let range = 0
  return events.filter((event) => {
    for (;;) {
      const candidate = ranges[range]
      if (candidate === undefined || event.seq <= candidate.endSeq) break
      range++
    }
    const target = ranges[range]
    return event.type !== 'session/turn-deleted' && (target === undefined || event.seq < target.startSeq)
  })
}

/**
 * Select the latest completed turn containing an admitted user or assistant message.
 * Empty rejected turns are skipped; an open turn or live compaction prevents deletion.
 * @param events - complete committed log, with earlier deletion decisions.
 * @returns the latest message turn, or absence when all message turns are deleted.
 * @throws when a turn or live compaction is still open.
 */
export function lastDeletableTurn(events: readonly SessionEvent[]): SessionTurnDeletion | undefined {
  let open: { turn: number; startSeq: SessionSeq; hasMessage: boolean } | undefined
  let compactionOpen = false
  let last: SessionTurnDeletion | undefined
  for (const event of visibleSessionEvents(events)) {
    // Compaction is a merged log-only lifecycle; the seed marker ends inherited work.
    const type: string = event.type
    if (type === 'compaction/start') compactionOpen = true
    else if (type === 'compaction/end' || type === 'session/end-seed') compactionOpen = false
    if (event.type === 'turn/start') open = { turn: event.data.turn, startSeq: event.seq, hasMessage: false }
    else if ((event.type === 'user/message' || event.type === 'assistant/message') && open !== undefined) open.hasMessage = true
    else if (event.type === 'turn/end' && open?.turn === event.data.turn) {
      if (open.hasMessage) last = { turn: open.turn, startSeq: open.startSeq, endSeq: event.seq }
      open = undefined
    }
  }
  if (open !== undefined) throw new SessionTurnDeletionError('TURN_OPEN', 'stop the active turn before deleting messages')
  if (compactionOpen) throw new SessionTurnDeletionError('COMPACTION_OPEN', 'wait for the active compaction before deleting messages')
  return last
}

/**
 * Admit deletion only for the latest active complete message turn.
 * A later surface edit must be resolved before the turn can be deleted.
 * @param event - proposed decision outside the target turn.
 * @param events - complete history before the decision.
 * @returns the validated deletion.
 * @throws when the decision cannot apply atomically to the current history.
 */
export function validateTurnDeletion(event: TurnDeletionRecord, events: readonly SessionEvent[]): SessionTurnDeletion {
  const deletion = readTurnDeletion(event)
  const last = lastDeletableTurn(events)
  if (last === undefined || last.turn !== deletion.turn || last.startSeq !== deletion.startSeq || last.endSeq !== deletion.endSeq) {
    throw new SessionTurnDeletionError('INVALID_DELETION', 'turn deletion must name the latest complete message turn')
  }
  if (visibleSessionEvents(events).some(candidate => candidate.seq > deletion.endSeq && candidate.surfaceOp !== undefined)) {
    throw new SessionTurnDeletionError('LATER_SURFACE', 'a later context edit depends on this turn; delete is unavailable after that edit')
  }
  return deletion
}
