// Runs built artifacts against unmodified official npm packages, without source aliases.
import { copyFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = resolve('.artifacts/stock-runtime')
await copyFile('lib/host.js', join(root, 'plugin-check.mjs'))
await writeFile(join(root, 'check.mjs'), `
import assert from 'node:assert/strict'
import { Session, SessionId, KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { createUserMessage, createMessage, createSystemMessage } from '@deepseek-ai/dsh-llm'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
assert.equal(Session.prototype.deleteLastTurn, undefined, 'test runtime must be STOCK')
assert.equal(KNOWN_SESSION_EVENT_TYPES.has('session/turn-deleted'), false)
const session = Session.create(SessionId('stock-adapter-test'))
const originalAppend = Session.prototype.append
function turn(number) {
  session.append('turn/start', { turn: number })
  session.append('step/start', { turn: number, step: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'prompt ' + number }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('assistant/message', { turn: number, step: 1, stream: [], message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock' }, content: [{ type: 'text', text: 'reply ' + number }] }) }, { surfaceOp: 'append' })
  session.append('step/end', { turn: number, step: 1 })
  session.append('turn/end', { turn: number, reason: { kind: 'completed' } })
}
turn(1); turn(2)
session.deriveMessages()
const plugin = await import('./plugin-check.mjs')
assert.equal(Session.prototype.append, originalAppend)
let command
plugin.apply({ effect: install => install(), commands: { register: value => { command = value; return () => {} } }, sessions: { flush: async value => { assert.equal(value, session); return true } } })
const agent = { session, status: 'idle', runMaintenance: fn => fn(new AbortController().signal) }
const call = rawInput => command.handler({ agent, rawInput, signal: new AbortController().signal })
assert.equal((await call('2')).kind, 'success')
assert.equal(session.id, 'stock-adapter-test')
assert.equal(session.deriveMessages().length, 2)
assert.ok(!JSON.stringify(session.deriveMessages()).includes('prompt 2'))
const original = session.snapshotEvents()
const header = { ...session.header, delegationDepth: 0 }
const restore = sessionFormatCatalog.createRestore(sessionFormatCatalog.encodeCurrentHeader(header, 0), { recovery: 'strict', validation: 'current' })
for (const event of original) restore.decodeRow(sessionFormatCatalog.encodeCurrentEvent(event))
const artifact = restore.finish()
assert.equal(artifact.events.length, original.length)
const cold = Session.fromRestore(SessionId(header.id), artifact.events, artifact.header, 0, 'detached')
assert.equal(cold.deriveMessages().length, 2)
turn(3)
assert.equal(session.deriveMessages().length, 4)
assert.ok(!JSON.stringify(session.deriveMessages()).includes('reply 2'))
assert.equal((await call('2')).kind, 'error')
assert.equal((await call('3')).kind, 'success')
assert.equal((await call('1')).kind, 'success')
assert.equal(session.deriveMessages().length, 0)
// A re-import keeps the first reader's closures. Its errors must still be recognized.
const reloaded = await import('./plugin-check.mjs?reload')
reloaded.apply({ effect: install => install(), commands: { register: value => { command = value; return () => {} } }, sessions: { flush: async () => true } })
turn(4)
session.append('system/message', { turn: 4, step: 1, message: createSystemMessage('independent context edit') }, { surfaceOp: 'append' })
const seq = session.seq
assert.match((await call('4')).text, /独立的上下文编辑/)
assert.equal(session.seq, seq)
console.log('STOCK npm alpha.2: pre-existing Session, original append identity, same ID, model context, V4 cold restore, new turn and repeated deletion passed.')
`)
await import(pathToFileURL(join(root, 'check.mjs')).href)
