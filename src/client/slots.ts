import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from './locales.ts'

export type DeleteTurnResult = 'accepted' | 'unavailable' | 'unknown'

export interface DeleteTurnInjected {
  /** Submit a guarded command for the displayed Turn; outcomes remain in the Session log. */
  deleteTurn: (turn: number) => Promise<DeleteTurnResult>
}

export type DeleteTurnProps = Pick<PropsRuntime<'conversation.chat.node'>, 'useChat' | 'useSession'> & { turn: number }
  & PropsLocale<'deleteLastTurn'>
  & InjectFace<DeleteTurnInjected>
