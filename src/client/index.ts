import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { installConversationAdapter } from '../lib/client.ts'
import { TurnTailNodeView, type TurnTailNodeViewProps } from '../lib/vendor/chat/TurnTailNodeView.tsx'
import { DeleteTurnAction } from './DeleteTurnAction.tsx'
import { en, zh } from './locales.ts'
import type { DeleteTurnResult } from './slots.ts'
import stylesheet from './style.css?inline'
import { stylesheet as tailStyles } from '../lib/vendor/chat/TurnTailNodeView.module.css?module'
import { stylesheet as actionStyles } from '../lib/vendor/chat/MessageIconActions.module.css?module'
import { stylesheet as usageStyles } from '../lib/vendor/chat/TurnUsagePanel.module.css?module'
import { stylesheet as dialogStyles } from '../lib/vendor/chat/stat-dialog.module.css?module'

export const inject = ['slots', 'sessions', 'locale', 'uiConversation']
try { installConversationAdapter() }
catch (error) { console.error('delete-last-turn: Conversation adapter failed', error); throw error }

/** Submit once. A lost response cannot prove whether the deletion was committed. */
export async function submitDeletion(ctx: Context, sessionId: SessionId, turn: number): Promise<DeleteTurnResult> {
  const binding = ctx.sessions.binding(sessionId)
  if (binding === undefined) return 'unavailable'
  try {
    const result = await binding.session.command(`/delete-last-turn ${turn}`)
    if (!result.ok) return 'unknown'
    return result.value.matched ? 'accepted' : 'unavailable'
  } catch (error) {
    ctx.logger.error('delete-last-turn: command outcome unknown', error)
    return 'unknown'
  }
}

/** Retain the shipped footer's slot ownership, hooks, preferences and effect lifetime. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('deleteLastTurn', { zh, en }), 'delete-last-turn: dictionaries')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@deshark42/dsh-session-tree'
    style.textContent = [stylesheet, tailStyles, actionStyles, usageStyles, dialogStyles].join('\n')
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'delete-last-turn: styles')
  ctx.slots.inject('conversation.chat.turnTail', () => {
    const entry = ctx.slots.entries('conversation.chat.node').find(candidate => candidate.options.key === 'turn-tail' && candidate.locale === 'chat')
    if (entry === undefined || entry.children?.['conversation.chat.assistant-actions'] === undefined) {
      throw new Error('delete-last-turn: incompatible shipped Turn footer')
    }
    const original = entry.component
    const t = ctx.locale.bind('deleteLastTurn')
    const enhanced = (props: TurnTailNodeViewProps) => createElement(TurnTailNodeView, {
      ...props,
      trailingActions: createElement(DeleteTurnAction, {
        turn: props.node.data.turn, useChat: props.useChat, useSession: props.useSession, t,
        deleteTurn: turn => submitDeletion(ctx, props.sessionId, turn),
      }),
    })
    entry.component = enhanced
    // A lower-ranked occupant changes the registry snapshot and triggers a redraw.
    // The original entry continues to own its child declarations and hooks.
    const invalidate = ctx.slots.register({ name: 'conversation.chat.node', key: 'turn-tail', priority: 10000 }, () => null)
    return () => {
      if (entry.component === enhanced) entry.component = original
      invalidate()
    }
  })
}
