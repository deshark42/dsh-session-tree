import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from './event-types.ts'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { visibleSessionEvents } from './vendor/session/turn-deletion.ts'
const adapterKey = Symbol.for('@deshark42/dsh-session-tree/client/0.1.0')

/** Preserve existing Conversation instances and their live subscriptions. */
export function installConversationAdapter(assembler = ConversationNodeAssembler): void {
  const prototype = assembler.prototype
  if (Reflect.get(prototype, adapterKey) === true) return
  for (const method of ['replaceWindow', 'append', 'prepend', 'settleAssistant', 'rebuildRegistry']) {
    if (typeof Reflect.get(prototype, method) !== 'function') throw new Error(`delete-last-turn: incompatible Conversation.${method}`)
  }
  const sample = new assembler({ entries: () => [], fallbackEntry: () => undefined }, { entries: () => [] })
  if (!Object.hasOwn(sample, 'inputs') || !Object.hasOwn(sample, 'hasMore')) throw new Error('delete-last-turn: incompatible Conversation window fields')
  const originalReplace = prototype.replaceWindow
  const originalAppend = prototype.append
  const originalPrepend = prototype.prepend
  const inputsOf = (owner: ConversationNodeAssembler): Map<number, SessionEventLikeEntry> => Reflect.get(owner, 'inputs')
  prototype.replaceWindow = function (entries, hasMore) {
    const sorted = [...entries].sort((left, right) => left.event.seq - right.event.seq)
    const visible = new Set(visibleSessionEvents(sorted.map(entry => entry.event)).map(event => event.seq))
    const result = originalReplace.call(this, sorted.filter(entry => visible.has(entry.event.seq)), hasMore)
    // Registry rebuild and older pages need the raw decisions as well as visible entries.
    for (const entry of sorted) inputsOf(this).set(entry.event.seq, entry)
    return result
  }
  prototype.append = function (record) {
    if (inputsOf(this).has(record.event.seq)) return 'none'
    return record.event.type === 'session/turn-deleted'
      ? this.replaceWindow([...inputsOf(this).values(), record], Reflect.get(this, 'hasMore'))
      : originalAppend.call(this, record)
  }
  prototype.prepend = function (entries, hasMore) {
    const all = [...inputsOf(this).values(), ...entries]
    return all.some(entry => entry.event.type === 'session/turn-deleted')
      ? this.replaceWindow(all, hasMore)
      : originalPrepend.call(this, entries, hasMore)
  }
  Object.defineProperty(prototype, adapterKey, { value: true })
}
