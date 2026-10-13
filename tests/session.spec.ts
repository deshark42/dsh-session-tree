import { describe, expect, it } from 'vitest'
import { Session, SessionId, SessionSeq, KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { deleteLastTurn } from '../src/lib/host.ts'
import { visibleSessionEvents } from '../src/lib/vendor/session/turn-deletion.ts'
import { createMessage, createSystemMessage, createUserMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { restoreReleasedV4Artifact } from '../src/lib/vendor/format/validation.ts'
import type { SessionFormatArtifact } from '@deepseek-ai/dsh-session-format'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import '@deepseek-ai/dsh-compaction/types'

function turn(session: Session, number: number, tools = false) {
  session.append('turn/start', { turn: number })
  session.append('step/start', { turn: number, step: 1 })
  if (number === 1) session.append('system/message', {
    turn: number, step: 1, message: createSystemMessage('system'),
  }, { surfaceOp: 'append' })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: `prompt ${number}` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('request/header', { header: {
    config: { provider: 'mock', model: 'mock' },
    ...tools ? { tools: [{ name: 'test', description: 'test tool', parameters: { type: 'object' as const, properties: {} } }] } : {},
  }, reason: number === 1 ? 'initial' : 'series' })
  const callId = ToolCallId(`call-${number}`)
  session.append('assistant/message', {
    turn: number, step: 1, stream: [],
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock' }, content: [
      { type: 'text', text: `reply ${number}` },
      ...tools ? [{ type: 'tool-call' as const, id: callId, name: 'test', arguments: '{}' }] : [],
    ] }),
  }, { surfaceOp: 'append' })
  if (tools) {
    session.append('tool/call', { turn: number, step: 1, callId, name: 'test', arguments: '{}' })
    session.append('tool/result', { turn: number, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'tool result' }], isError: false }) }, { surfaceOp: 'append' })
  }
  session.append('step/end', { turn: number, step: 1 })
  session.append('turn/end', { turn: number, reason: { kind: 'completed' } })
}

function artifact(session: Session): SessionFormatArtifact {
  const json: SessionFormatArtifact = JSON.parse(JSON.stringify({ header: { ...session.header, delegationDepth: 0 }, inheritedEventCount: 0, events: session.snapshotEvents() }))
  return json
}

describe('same-chat turn deletion', () => {
  it('removes the entire tool round, preserves the id and raw committed prefix, and survives replay', () => {
    const session = Session.create(SessionId('same-id'))
    turn(session, 1)
    const first = session.deriveMessages()
    const firstTools = session.toolHistory()
    turn(session, 2, true)
    expect(session.toolHistory().tools).toHaveLength(1)
    const raw = session.snapshotEvents()
    const generation = session.surface.replaceGeneration
    const deleted = deleteLastTurn(session)!
    expect(session.id).toBe('same-id')
    expect(session.deriveMessages()).toEqual(first)
    expect(session.toolHistory()).toEqual(firstTools)
    expect(session.surface.replaceGeneration).toBe(generation + 1)
    expect(session.snapshotEvents().slice(0, raw.length)).toEqual(raw)
    expect(visibleSessionEvents(session.snapshotEvents()).some(event => event.seq === deleted.data.startSeq)).toBe(false)
    const replay = Session.create(session.id, JSON.parse(JSON.stringify(session.snapshotEvents())), session.header)
    expect(replay.deriveMessages()).toEqual(first)
    expect(restoreReleasedV4Artifact(artifact(session), KNOWN_SESSION_EVENT_TYPES)).toBeTruthy()
  })

  it('supports repeated deletion and new monotonically numbered turns', () => {
    const session = Session.create(SessionId('repeat'))
    turn(session, 1)
    turn(session, 2)
    deleteLastTurn(session)
    deleteLastTurn(session)
    expect(session.deriveMessages()).toEqual([])
    expect(deleteLastTurn(session)).toBeUndefined()
    turn(session, 3)
    expect(session.deriveMessages().map(message => message.role)).toEqual(['user', 'assistant'])
    expect(restoreReleasedV4Artifact(artifact(session), KNOWN_SESSION_EVENT_TYPES)).toBeTruthy()
  })

  it('rejects stale and duplicate guarded deletion without deleting another turn', () => {
    const session = Session.create(SessionId('guarded'))
    turn(session, 1)
    turn(session, 2)
    const seq = session.seq
    expect(() => deleteLastTurn(session, 1)).toThrow('last message turn has changed')
    expect(session.seq).toBe(seq)
    expect(deleteLastTurn(session, 2)?.data.turn).toBe(2)
    const after = session.seq
    expect(() => deleteLastTurn(session, 2)).toThrow('last message turn has changed')
    expect(session.seq).toBe(after)
    expect(session.deriveMessages().some(message => JSON.stringify(message).includes('prompt 1'))).toBe(true)
    deleteLastTurn(session, 1)
    expect(() => deleteLastTurn(session, 1)).toThrow('last message turn has changed')
  })

  it('restores older messages shadowed by an in-turn surface replacement', () => {
    const session = Session.create(SessionId('compacted'))
    turn(session, 1)
    const before = session.deriveMessages()
    session.append('turn/start', { turn: 2 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'second prompt' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const nodes = session.surface.nodes.slice(1)
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'summary' }], source: { kind: 'user' } }), {
      surfaceOp: { op: 'replace', startSeq: nodes[0]!, endSeq: nodes.at(-1)! }, sourceEventSeqs: [...nodes],
    })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    deleteLastTurn(session)
    expect(session.deriveMessages()).toEqual(before)
  })

  it('rejects an open turn without changing the log', () => {
    const session = Session.create(SessionId('busy'))
    turn(session, 1)
    session.append('turn/start', { turn: 2 })
    const seq = session.seq
    expect(() => deleteLastTurn(session)).toThrow('stop the active turn')
    expect(session.seq).toBe(seq)
  })

  it('skips empty rejected turns', () => {
    const session = Session.create(SessionId('empty'))
    turn(session, 1)
    session.append('turn/start', { turn: 2 })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    expect(deleteLastTurn(session)?.data.turn).toBe(1)
    expect(session.deriveMessages()).toEqual([])
  })

  it('rejects a live standalone compaction but permits deletion after it closes or is inherited', () => {
    const session = Session.create(SessionId('compacting'))
    turn(session, 1)
    const compaction = { compactionId: CompactionId('manual'), turn: null }
    session.append('compaction/start', compaction)
    const seq = session.seq
    expect(() => deleteLastTurn(session)).toThrow('wait for the active compaction')
    expect(session.seq).toBe(seq)
    session.append('compaction/end', { ...compaction, error: 'cancelled' })
    expect(deleteLastTurn(session)?.data.turn).toBe(1)
    expect(restoreReleasedV4Artifact(artifact(session), KNOWN_SESSION_EVENT_TYPES)).toBeTruthy()

    const crashed = Session.create(SessionId('orphan'))
    turn(crashed, 1)
    crashed.append('compaction/start', compaction)
    const replay = Session.create(crashed.id, crashed.snapshotEvents(), crashed.header)
    expect(deleteLastTurn(replay)?.data.turn).toBe(1)
    expect(restoreReleasedV4Artifact(artifact(replay), KNOWN_SESSION_EVENT_TYPES)).toBeTruthy()
  })

  it('rejects invalid and ignorable deletion decisions on append and native V4 read', () => {
    const session = Session.create(SessionId('bad'))
    turn(session, 1)
    const seq = session.seq
    expect(() => session.append('session/turn-deleted', { turn: 2, startSeq: SessionSeq(0), endSeq: SessionSeq(seq - 1) })).toThrow()
    expect(session.seq).toBe(seq)
    const value = artifact(session)
    const unsafe = [...session.snapshotEvents(), { type: 'session/turn-deleted' as const, seq: SessionSeq(seq), time: 1, ignorable: true as const, data: { turn: 1, startSeq: SessionSeq(0), endSeq: SessionSeq(seq - 1) } }]
    expect(() => Session.create(session.id, unsafe, session.header)).toThrow()
    expect(() => restoreReleasedV4Artifact({ ...value, events: JSON.parse(JSON.stringify(unsafe)) }, KNOWN_SESSION_EVENT_TYPES)).toThrow()
    const malformed = { ...value, events: [...value.events, { type: 'session/turn-deleted', seq, time: 1, data: { turn: 9, startSeq: 0, endSeq: seq - 1 } }] }
    expect(() => restoreReleasedV4Artifact(malformed, KNOWN_SESSION_EVENT_TYPES)).toThrow()
  })

  it('makes older readers refuse the required event', () => {
    const session = Session.create(SessionId('reader'))
    turn(session, 1)
    deleteLastTurn(session)
    const older = new Set(KNOWN_SESSION_EVENT_TYPES)
    older.delete('session/turn-deleted')
    expect(() => restoreReleasedV4Artifact(artifact(session), older)).toThrow('unknown event type')
  })

  it('refuses deletion after a separate context rewrite without partially changing history', () => {
    const session = Session.create(SessionId('later-edit'))
    turn(session, 1)
    const node = session.surface.nodes[0]!
    session.append('system/message', { turn: 1, step: 1, message: createSystemMessage('new system') }, {
      surfaceOp: { op: 'replace', startSeq: node, endSeq: node }, sourceEventSeqs: [node],
    })
    const before = session.deriveMessages()
    const seq = session.seq
    expect(() => deleteLastTurn(session)).toThrow('later context edit')
    expect(session.seq).toBe(seq)
    expect(session.deriveMessages()).toEqual(before)
  })
})
