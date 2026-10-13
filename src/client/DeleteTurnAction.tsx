import { useEffect, useId, useRef, useState } from 'react'
import { IconTrashOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { DeleteTurnProps } from './slots.ts'
import type { DeleteTurnKey } from './locales.ts'

/** Latest admitted message Turn in the loaded Chat window, including hidden context. */
function latestMessageTurn(snapshot: ChatSnapshot): number | undefined {
  let latest: number | undefined
  for (const node of snapshot.nodes.values()) {
    if (!['user', 'steering', 'context', 'turn-trigger', 'assistant-step'].includes(node.kind)) continue
    if (node.kind === 'assistant-step' && (node as ChatNode<'assistant-step'>).data.finalNode?.messageId === undefined) continue
    if (node.location.kind !== 'turn' && node.location.kind !== 'step') continue
    const turn = node.location.turn.turn
    if (latest === undefined || turn > latest) latest = turn
  }
  return latest
}

/** Guarded deletion control placed after the completed Turn's metadata. */
export function DeleteTurnAction({ turn, useChat, useSession, deleteTurn, t }: DeleteTurnProps) {
  const latest = useChat(latestMessageTurn)
  const unavailable = useSession(snapshot => snapshot.running || snapshot.removed
    || snapshot.openState !== 'open' || snapshot.pendingSubmissions.length > 0)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<DeleteTurnKey | null>(null)
  const locked = useRef(false)
  const alive = useRef(true)
  const reasonId = useId()
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  if (latest !== turn) return null
  const disabled = unavailable || pending
  const label = pending ? t('action.pending') : unavailable ? t('action.busy') : t('action.delete')
  const remove = async () => {
    if (disabled || locked.current) return
    locked.current = true
    setPending(true)
    setFailure(null)
    try {
      const result = await deleteTurn(turn)
      if (alive.current && result !== 'accepted') {
        setFailure(result === 'unavailable' ? 'error.unavailable' : 'error.unknown')
      }
    } catch (error) {
      // An unexpected callback failure leaves the remote outcome unknown.
      if (alive.current) setFailure('error.unknown')
    } finally {
      locked.current = false
      if (alive.current) setPending(false)
    }
  }
  return <>
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        className="dsh-delete-last-turn-action"
        aria-label={t('action.delete')}
        aria-disabled={disabled || undefined}
        aria-busy={pending || undefined}
        aria-describedby={disabled ? reasonId : undefined}
        onClick={() => { void remove() }}
      >
        <IconTrashOutlineRegular />
      </button>
    </Tooltip>
    {disabled && <span id={reasonId} className="dsh-delete-last-turn-hidden">{label}</span>}
    {failure !== null && <span role="status" className="dsh-delete-last-turn-failure">{t(failure)}</span>}
  </>
}
