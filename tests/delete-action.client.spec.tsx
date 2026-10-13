// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { chatSnapshotFixture } from '@dsh-test/chat-snapshot-fixture'
import type { AssistantMessageNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { TurnTailNodeView } from '../src/lib/vendor/chat/TurnTailNodeView.tsx'
import { zh as chatZh } from '@deepseek-ai/dsh-client-ui-chat/src/client/locale.ts'
import type { DeleteTurnProps, DeleteTurnResult } from '../src/client/slots.ts'
import { DeleteTurnAction } from '../src/client/DeleteTurnAction.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(zh, commonZh)
const chatTranslate = makeTranslate(chatZh, commonZh)
function transcript(): ChatSnapshot {
  const nodes: AssistantMessageNode[] = [1, 2].map(turn => ({
    kind: 'assistant', seq: turn * 10, time: 1735704000000, turn, step: 1,
    messageId: `reply-${turn}` as AssistantMessageNode['messageId'],
    blocks: [{ kind: 'text', text: `Reply ${turn}` }],
  }))
  return chatSnapshotFixture({
    nodes, turnEnds: new Map([[1, 11], [2, 21], [3, 31]]),
    turnUsages: new Map([[2, { uncachedInputTokens: 100, outputTokens: 50, totalTokens: 150 }]]),
  })
}
function mount(options: { turn?: number; running?: boolean; submit?: DeleteTurnProps['deleteTurn'] } = {}) {
  const chat = transcript()
  const useChat = bindSnapshotSelector({ getSnapshot: () => chat, subscribe: () => () => {} })
  const session = { running: options.running ?? false, removed: false, openState: 'open', pendingSubmissions: [] }
  const useSession = bindSnapshotSelector({ getSnapshot: () => session, subscribe: () => () => {} }) as DeleteTurnProps['useSession']
  const deleteTurn = vi.fn(options.submit ?? (async () => 'accepted' as const))
  const props = { turn: options.turn ?? 2, useChat, useSession, deleteTurn, t } as DeleteTurnProps
  return { ...render(<DeleteTurnAction {...props} />), props, deleteTurn, chat }
}

describe('delete action in a completed Turn footer', () => {
  it('only offers the last message Turn, skipping a later empty rejected Turn', () => {
    const ui = mount({ turn: 1 })
    expect(ui.queryByRole('button')).toBeNull()
    ui.rerender(<DeleteTurnAction {...ui.props} turn={2} />)
    expect(ui.getByRole('button', { name: zh['action.delete'] })).toBeDefined()
    ui.rerender(<DeleteTurnAction {...ui.props} turn={3} />)
    expect(ui.queryByRole('button')).toBeNull()
  })

  it('keeps the disabled control accessible while the Agent runs and submits nothing', () => {
    const ui = mount({ running: true })
    const button = ui.getByRole('button', { name: zh['action.delete'] })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(ui.getByText(zh['action.busy'])).toBeDefined()
    fireEvent.click(button)
    expect(ui.deleteTurn).not.toHaveBeenCalled()
  })

  it('submits the displayed Turn once while two rapid clicks await the command', async () => {
    const deferred = Promise.withResolvers<DeleteTurnResult>()
    const ui = mount({ submit: () => deferred.promise })
    const button = ui.getByRole('button', { name: zh['action.delete'] })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(ui.deleteTurn).toHaveBeenCalledExactlyOnceWith(2)
    expect(button.getAttribute('aria-busy')).toBe('true')
    await act(async () => { deferred.resolve('accepted') })
    expect(button.hasAttribute('aria-busy')).toBe(false)
  })

  it.each(['unavailable', 'unknown', 'throw'] as const)('reports %s without claiming deletion or rollback', async outcome => {
    const ui = mount({ submit: async () => {
      if (outcome === 'throw') throw new Error('transport')
      return outcome
    } })
    fireEvent.click(ui.getByRole('button'))
    await waitFor(() => expect(ui.getByRole('status').textContent).toBe(
      outcome === 'unavailable' ? zh['error.unavailable'] : zh['error.unknown']))
  })

  it('places the trash control after usage and the clock in the actual footer component', async () => {
    const ui = mount()
    ui.unmount()
    const node = ui.chat.nodes.values().find(node => node.kind === 'turn-tail' && node.id === '2')
    const props = {
      node, useChat: ui.props.useChat, usePerformanceUsage: (select: (mode: string) => boolean) => select('detailed'),
      t: chatTranslate, openFile: vi.fn(), forkAt: vi.fn(),
      renderSlot: () => null,
      trailingActions: <DeleteTurnAction {...ui.props} />,
    } as Parameters<typeof TurnTailNodeView>[0]
    const footer = render(<TurnTailNodeView {...props} />)
    const button = footer.getByRole('button', { name: zh['action.delete'] })
    const row = button.parentElement!
    expect(row.lastElementChild).toBe(button)
    expect(button.previousElementSibling?.textContent).toMatch(/\d{2}:\d{2}/)
    const snapshot = [...row.children].map(child => child.getAttribute('aria-label') ?? 'usage + clock')
    await expect(snapshot.join('\n') + '\n').toMatchFileSnapshot('./snapshots/delete-button.expected.txt')
    fireEvent.click(button)
    expect(ui.deleteTurn).toHaveBeenCalledExactlyOnceWith(2)
  })
})
