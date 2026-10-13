import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { deleteLastTurn } from '../src/lib/host.ts'
import { installConversationAdapter } from '../src/lib/client.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { stockConversation } from './stock-client.ts'
import type { ConversationViewNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
const { ConversationNodeAssembler } = stockConversation()
installConversationAdapter(ConversationNodeAssembler)

function transcript() {
  const session = Session.create(SessionId('conversation'))
  for (const turn of [1, 2]) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: `prompt ${turn}` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return session
}

function assembler() {
  const runtime = new ConversationNodeAssembler({
    entries: () => [{
      kind: 'test', target: 'test',
      match: event => event.type === 'user/message' ? { id: String(event.seq), role: 'start' } : null,
      start: context => context.start?.event.data,
      update: context => context.state,
      buildViewNode: context => ({ key: context.key, kind: context.kind, id: context.id, target: 'test', data: context.state }),
    }],
    fallbackEntry: () => undefined,
  }, { entries: () => [{
    target: 'test', create: () => ({
      empty: [] as readonly ConversationViewNode[],
      replace: ({ nodes }) => nodes,
      apply: ({ upserts }) => upserts,
    }),
  }] })
  runtime.activateTarget('test')
  return runtime
}

describe('Conversation deletion replay', () => {
  it('removes the visible round immediately and on refresh', () => {
    const session = transcript()
    const runtime = assembler()
    runtime.replaceWindow(session.snapshotEvents().map(event => ({ type: 'event', event })), false)
    runtime.flush()
    expect(runtime.snapshot('test')).toHaveLength(2)
    const event = deleteLastTurn(session)!
    expect(runtime.append({ type: 'event', event })).toBe('immediate')
    runtime.flush()
    expect(runtime.snapshot('test')).toHaveLength(1)
    runtime.replaceWindow(session.snapshotEvents().map(event => ({ type: 'event', event })), false)
    runtime.flush()
    expect(runtime.snapshot('test')).toHaveLength(1)
  })

  it('does not resurrect deleted messages while loading older pages or rebuilding definitions', () => {
    const session = transcript()
    deleteLastTurn(session)
    const all = session.snapshotEvents().map(event => ({ type: 'event' as const, event }))
    const runtime = assembler()
    runtime.replaceWindow(all.slice(4), true)
    runtime.flush()
    expect(runtime.snapshot('test')).toHaveLength(0)
    runtime.prepend(all.slice(0, 4), false)
    runtime.flush()
    expect(runtime.snapshot('test')).toHaveLength(1)
    runtime.rebuildRegistry()
    runtime.flush()
    expect(runtime.snapshot('test')).toHaveLength(1)
  })
})
