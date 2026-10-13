/** Independent, alpha.2-specific reader/writer adapter. Never replaces Session.append. */
import { createRequire } from 'node:module'
import type {} from './event-types.ts'
import { Session, SessionId, SessionLogOffset, KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import type { SessionFormatArtifact } from '@deepseek-ai/dsh-session-format'
import { imageOffloadProjection } from '@deepseek-ai/dsh-compaction-image-offload/projection'
import { SurfaceManager } from './vendor/session/surface.ts'
import { ToolHistoryProjection } from './vendor/session/tool-history.ts'
import { lastDeletableTurn, SessionTurnDeletionError, visibleSessionEvents } from './vendor/session/turn-deletion.ts'
import { restoreReleasedV4Artifact } from './vendor/format/validation.ts'
import { extendPrototype } from './prototype.ts'

export { SessionTurnDeletionError }
/** Recognize errors from the process-lifetime reader after a plugin reload. */
export function isTurnDeletionError(error: unknown): error is SessionTurnDeletionError {
  return error instanceof Error && error.name === 'SessionTurnDeletionError' && 'code' in error
    && ['TURN_OPEN', 'COMPACTION_OPEN', 'INVALID_DELETION', 'LATER_SURFACE', 'TURN_CHANGED'].includes(String(error.code))
}
const adapterKey = Symbol.for('@deshark42/dsh-session-tree/host/0.1.0')
const requireHere = createRequire(import.meta.url)
const deletionType = 'session/turn-deleted'

/** Append a validated decision using the original store's notification and persistence path. */
export function deleteLastTurn(session: Session, expectedTurn?: number) {
  const target = lastDeletableTurn(session.snapshotEvents())
  if (expectedTurn !== undefined && target?.turn !== expectedTurn) {
    throw new SessionTurnDeletionError('TURN_CHANGED', 'the last message turn has changed; refresh before deleting')
  }
  // The compatibility lib owns this event; the stock type graph cannot name it.
  const append = session.append as (type: string, data: object) => { data: { turn: number } }
  return target === undefined ? undefined : append.call(session, deletionType, target)
}

function restoreWithDeletion(artifact: SessionFormatArtifact): SessionFormatArtifact {
  const restored = restoreReleasedV4Artifact(artifact, KNOWN_SESSION_EVENT_TYPES)
  Reflect.apply(Session.fromRestore, Session, [SessionId(restored.header.id), restored.events,
    restored.header, SessionLogOffset(restored.inheritedEventCount), 'detached', [imageOffloadProjection]])
  return restored
}

/** Install before commands/agents may read chats. The reader stays for the process lifetime. */
export function installHostAdapter(): void {
  const prototype = Session.prototype
  if (Reflect.get(prototype, adapterKey) === true) return
  for (const name of ['dsh-session', 'dsh-session-format', 'dsh-session-format-catalog']) {
    const version = requireHere(`@deepseek-ai/${name}/package.json`).version
    if (version !== '0.2.1-alpha.2') throw new Error(`delete-last-turn: unsupported ${name} ${version}; requires 0.2.1-alpha.2`)
  }
  if (!(KNOWN_SESSION_EVENT_TYPES instanceof Set)) {
    throw new Error('delete-last-turn: incompatible event vocabulary')
  }
  const sample = Session.create(SessionId('delete-last-turn-adapter-probe'))
  const manager = Object.getPrototypeOf(sample.surface)
  for (const field of ['log', '_state', '_lastProcessedSeq', 'projections']) {
    if (!Object.hasOwn(sample.surface, field)) throw new Error(`delete-last-turn: incompatible surface field ${field}`)
  }
  const header = sessionFormatCatalog.encodeCurrentHeader({ version: 4, id: 'adapter-probe', createdAt: 0, isSeeded: false, delegationDepth: 0 }, 0)
  const restore = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
  if (!Object.hasOwn(restore, 'restoreArtifact') || !Object.hasOwn(restore, 'collector')) {
    throw new Error('delete-last-turn: incompatible V4 restore')
  }
  const restorePrototype = Object.getPrototypeOf(restore)
  const originalFinish = restorePrototype.finish
  // Keep physical decoding, density checks and fork cuts in the original reader.
  // Only logs using this extension replace the final logical validator.
  restorePrototype.finish = function () {
    const previous = this.restoreArtifact
    if (this.collector.values.some((event: { type: string }) => event.type === deletionType)) this.restoreArtifact = restoreWithDeletion
    try { return originalFinish.call(this) }
    finally { this.restoreArtifact = previous }
  }
  extendPrototype(manager, SurfaceManager.prototype)
  const histories = new WeakMap<Session, { seq: number; projection: ToolHistoryProjection }>()
  prototype.toolHistory = function () {
    const events = this.snapshotEvents()
    let state = histories.get(this)
    if (state === undefined || events.slice(state.seq).some(event => event.type === deletionType)) {
      state = { seq: events.length, projection: new ToolHistoryProjection() }
      for (const event of visibleSessionEvents(events)) state.projection.apply(event)
      histories.set(this, state)
    } else {
      for (const event of events.slice(state.seq)) state.projection.apply(event)
      state.seq = events.length
    }
    return state.projection.snapshot()
  }
  KNOWN_SESSION_EVENT_TYPES.add(deletionType)
  Object.defineProperty(prototype, adapterKey, { value: true })
}

// Import-time install also protects agents scheduled before apply's services settle.
installHostAdapter()
