import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { MockAdapter, textResponse } from '@dsh-test/mock-adapter'
import * as Plugin from '../src/index.js'

const resources: { context: Context; root: string }[] = []
afterEach(async () => {
  for (const { context, root } of resources.splice(0)) {
    await context.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

async function boot() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-delete-last-turn-'))
  const context = new Context()
  resources.push({ context, root })
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['sessions', SessionStore], ['projections', SessionProjections], ['llm', LlmRuntime],
    ['system', SystemPrompt], ['tools', ToolRuntime], ['agents', AgentRegistry],
    ['loop', AgentLoop], ['commands', CommandRuntime], ['persistence', JsonlPersistence],
    ['session-tree', Plugin],
  ])
  const importModule = context.loader.internal.import.bind(context.loader.internal)
  vi.spyOn(context.loader.internal, 'import').mockImplementation(async (...args) =>
    modules.has(args[0]) ? modules.get(args[0]) : importModule(...args))
  const config = join(root, 'cordis.yml')
  await writeFile(config, [
    '- name: sessions', '- name: projections', '- name: llm', '- name: system', '- name: tools',
    '- name: agents', '- name: loop', '  config:', '    agents: []', '- name: commands',
    '- name: persistence', '  config:', `    root: ${JSON.stringify(join(root, 'sessions'))}`, '    compression: none',
    '- id: deletion-plugin', '  name: session-tree', '',
  ].join('\n'))
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await context.loader.await()
  const adapter = new MockAdapter([textResponse('first reply'), textResponse('second reply'), textResponse('third reply'), textResponse('fourth reply')])
  context.llm.registerAdapter(['mock'], adapter)
  const agent = await context.agentLoop.create(SessionId('unchanged-id'), { provider: 'mock', model: 'mock' })
  return { context, agent, adapter }
}

async function say(agent: Awaited<ReturnType<typeof boot>>['agent'], text: string) {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}
const signal = () => new AbortController().signal

describe('/delete-last-turn through Loader and a real AgentLoop', () => {
  it('deletes durably in the same chat and excludes deleted messages from the next model request', async () => {
    const { context, agent, adapter } = await boot()
    await say(agent, 'first prompt')
    const first = agent.session.deriveMessages()
    await say(agent, 'second prompt')
    await context.sessions.flush(agent.session)
    const result = await context.commands.execute(agent, '/delete-last-turn', [], signal())
    expect(result?.result).toMatchObject({ kind: 'success', text: '已删除第 2 轮消息。' })
    expect(agent.session.id).toBe('unchanged-id')
    expect(agent.session.deriveMessages()).toEqual(first)
    const handle = await context.sessionPersistence.open(agent.session.id, 'read')
    try {
      const read = await handle.read(SessionLogOffset(0))
      const replay = Session.create(agent.session.id, read.events, handle.header, handle.inheritedEventCount)
      expect(replay.deriveMessages()).toEqual(first)
      expect(read.events.some(event => event.type === 'session/turn-deleted')).toBe(true)
    } finally { await handle.close() }
    await say(agent, 'third prompt')
    const request = JSON.stringify(adapter.requests.at(-1)?.messages)
    expect(request).toContain('first prompt')
    expect(request).toContain('third prompt')
    expect(request).not.toContain('second prompt')
    expect(request).not.toContain('second reply')
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start').map(event => event.data.turn)).toEqual([1, 2, 3])
    const messages = adapter.requests.at(-1)?.messages ?? []
    await expect([
      '# Same-chat deletion', '',
      `Session: ${agent.session.id}`,
      `Command: ${result?.result.text}`,
      'Persisted deletion: yes', '',
      '## Next model request', '',
      ...messages.map(message => `${message.role}: ${message.content.filter(block => block.type === 'text').map(block => block.text).join('')}`), '',
    ].join('\n')).toMatchFileSnapshot('./snapshots/delete-last-turn.expected.md')
  })

  it('deletes all rounds, handles an empty chat, and rebuilds the system head on the next request', async () => {
    const { context, agent, adapter } = await boot()
    await say(agent, 'first prompt')
    await say(agent, 'second prompt')
    for (const expected of ['已删除第 2 轮消息。', '已删除第 1 轮消息。', '没有可删除的消息轮次。']) {
      expect((await context.commands.execute(agent, '/delete-last-turn', [], signal()))?.result).toMatchObject({ kind: 'success', text: expected })
    }
    expect(agent.session.deriveMessages()).toEqual([])
    await say(agent, 'fresh prompt')
    expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('fresh prompt')
    expect(JSON.stringify(adapter.requests.at(-1)?.messages)).not.toContain('first prompt')
    expect(agent.session.surface.nodes[0]).toBeGreaterThan(0)
  })

  it('refuses running turns and invalid arguments without deleting', async () => {
    const { context, agent } = await boot()
    await say(agent, 'first prompt')
    for (const value of ['extra', '0', '-1', '1.5', '1e2', '9007199254740992', '1 2']) {
      expect((await context.commands.execute(agent, `/delete-last-turn ${value}`, [], signal()))?.result.kind).toBe('error')
    }
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'in flight' }], source: { kind: 'user' } }))
    expect((await context.commands.execute(agent, '/delete-last-turn', [], signal()))?.result.kind).toBe('error')
    await agent.whenIdle()
    expect(agent.session.snapshotEvents().some(event => event.type === 'session/turn-deleted')).toBe(false)
  })

  it('guards button requests by displayed Turn under the real maintenance lock', async () => {
    const { context, agent } = await boot()
    await say(agent, 'first prompt')
    const before = agent.session.deriveMessages()
    await say(agent, 'second prompt')
    const send = () => context.commands.execute(agent, '/delete-last-turn 2', [], signal())
    const first = await send()
    expect(first?.result.text).toBe('已删除第 2 轮消息。')
    const duplicate = await send()
    expect(duplicate?.result).toMatchObject({ kind: 'error', text: '最后一轮消息已改变，请刷新聊天后再删除。' })
    expect(agent.session.deriveMessages()).toEqual(before)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'session/turn-deleted')).toHaveLength(1)
  })

  it('reports persistence failure as an already committed deletion without claiming rollback', async () => {
    const { context, agent } = await boot()
    await say(agent, 'first prompt')
    vi.spyOn(context.sessions, 'flush').mockRejectedValueOnce(new Error('disk failure'))
    const result = await context.commands.execute(agent, '/delete-last-turn', [], signal())
    expect(result?.result).toMatchObject({ kind: 'error' })
    expect(result?.result.text).toContain('不要重复删除')
    expect(agent.session.deriveMessages()).toEqual([])
  })

  it('withdraws command registration when its Loader entry unloads', async () => {
    const { context, agent } = await boot()
    expect(context.commands.list(agent).some(command => command.name === 'delete-last-turn')).toBe(true)
    const entry = context.loader.entries().find(entry => entry.options.name === 'session-tree')
    expect(entry).toBeDefined()
    await entry!.fiber!.dispose()
    expect(context.commands.list(agent).some(command => command.name === 'delete-last-turn')).toBe(false)
  })

  it('keeps read support after unloading commands and preserves deletion in a persisted fork', async () => {
    const { context, agent } = await boot()
    await say(agent, 'first prompt')
    const before = agent.session.deriveMessages()
    await say(agent, 'second prompt')
    await context.commands.execute(agent, '/delete-last-turn', [], signal())
    await context.agentLoop.createAgent(context, {
      sessionId: SessionId('deletion-fork'), seed: agent.session.snapshotEvents(),
      inheritedEventCount: agent.session.seq,
      meta: { isSeeded: true, parentSession: agent.session.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const child = context.sessions.get(SessionId('deletion-fork'))!
    await context.sessions.flush(child)
    const entry = context.loader.entries().find(entry => entry.options.name === 'session-tree')!
    await entry.fiber!.dispose()
    expect(agent.session.deriveMessages()).toEqual(before)
    const handle = await context.sessionPersistence.open(child.id, 'read')
    try {
      const read = await handle.read(SessionLogOffset(0))
      const replay = Session.create(child.id, read.events, handle.header, handle.inheritedEventCount)
      expect(replay.deriveMessages()).toEqual(before)
      expect(read.events.some(event => event.type === 'session/turn-deleted')).toBe(true)
    } finally { await handle.close() }
  })
})
