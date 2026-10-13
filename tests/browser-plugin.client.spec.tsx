// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import * as JSX from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DeleteTurnResult } from '../src/client/slots.ts'
import { stockConversation } from './stock-client.ts'

const roots: Context[] = []
afterEach(async () => { for (const ctx of roots.splice(0)) await ctx.fiber.dispose() })
function loadBundle(): { apply: (ctx: Context) => void; inject: string[]; submitDeletion: (ctx: Context, id: SessionId, turn: number) => Promise<DeleteTurnResult> } {
  let plugin: ReturnType<typeof loadBundle> | undefined
  const shared = new Map<string, object>([
    ['react', React], ['react/jsx-runtime', JSX], ['react-dom', ReactDom],
    ['@deepseek-ai/dsh-client-ui-primitives', Primitives],
    ['@deepseek-ai/dsh-client-ui-conversation', stockConversation()],
  ])
  runInNewContext(readFileSync(join(process.cwd(), 'lib/client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load({ id, factory }: { id: string; factory: (require: (name: string) => object) => ReturnType<typeof loadBundle> }) {
      expect(id).toBe('@deshark42/dsh-session-tree')
      plugin = factory(name => {
        const value = shared.get(name)
        if (value === undefined) throw new Error(`Unexpected external: ${name}`)
        return value
      })
    } } }, document, console,
  })
  if (plugin === undefined) throw new Error('No Client plugin registered')
  return plugin
}
async function bench(command = vi.fn(async (_line: string) => ({ ok: true, value: { matched: true } }))) {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sessions', { binding: () => ({ session: { command } }) } as never)
  ctx.provide('uiConversation', {} as never)
  const plugin = loadBundle()
  const fiber = ctx.plugin(plugin)
  await fiber.await()
  const original = () => null
  const declare = () => {
    const dispose = ctx.slots.register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } } } as never, (() => null) as never)
    ctx.slots.register({ name: 'conversation.chat.node', key: 'turn-tail', locale: 'chat', children: {
      'conversation.chat.turnTail': { kind: 'list', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
    } }, original)
    return dispose
  }
  const dispose = declare()
  await fiber.await()
  const entry = ctx.slots.entries('conversation.chat.node').find(entry => entry.options.priority === undefined)!
  const face = { deleteTurn: (turn: number) => plugin.submitDeletion(ctx, 'browser-session' as SessionId, turn) }
  return { ctx, fiber, declare, dispose, entry, original, face, command }
}
describe('packed browser plugin on stock Conversation and existing footer declarations', () => {
  it('adds the action without redeclaring built-in slots and restores the footer on unload', async () => {
    const b = await bench()
    expect(b.entry.component).not.toBe(b.original)
    expect(document.querySelector('style[data-plugin="@deshark42/dsh-session-tree"]')).not.toBeNull()
    expect(await b.face.deleteTurn(2)).toBe('accepted')
    expect(b.command).toHaveBeenCalledExactlyOnceWith('/delete-last-turn 2')
    await b.fiber.dispose()
    expect(b.entry.component).toBe(b.original)
    expect(b.ctx.slots.entries('conversation.chat.node')).toHaveLength(1)
    expect(b.ctx.slots.spec('conversation.chat.turnTail')).toBeDefined()
    expect(b.ctx.slots.spec('conversation.chat.assistant-actions')).toBeDefined()
    expect(document.querySelector('style[data-plugin="@deshark42/dsh-session-tree"]')).toBeNull()
    expect(b.ctx.locale.bind('deleteLastTurn')('action.delete')).toBe('action.delete')
  })
  it('restores adaptation when the built-in footer is reloaded', async () => {
    const b = await bench()
    b.dispose()
    expect(b.entry.component).toBe(b.original)
    b.declare()
    expect(b.ctx.slots.entries('conversation.chat.node')).toHaveLength(2)
    expect(b.ctx.slots.entries('conversation.chat.node')[0]!.component).not.toBe(b.original)
  })
  it('reports missing commands and unknown transport outcomes without retrying', async () => {
    const b = await bench()
    b.command.mockResolvedValueOnce({ ok: true, value: { matched: false } })
    expect(await b.face.deleteTurn(2)).toBe('unavailable')
    b.command.mockRejectedValueOnce(new Error('connection lost'))
    expect(await b.face.deleteTurn(2)).toBe('unknown')
    expect(b.command).toHaveBeenCalledTimes(2)
  })
})
