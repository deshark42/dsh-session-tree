/** Human command for deleting a complete message turn under the Agent maintenance lock. */
import { deleteLastTurn, isTurnDeletionError } from './lib/host.ts'
/** @typedef {import('@deepseek-ai/dsh-commands').CommandDefinition} CommandDefinition */

/** Cordis plugin identity. */
export const name = 'session-tree'
/** Services required before command registration. */
export const inject = ['commands', 'sessions']

/**
 * Register /delete-last-turn for this plugin's lifetime.
 * The package's compatibility lib installs the required reader and writer adapters.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host command and Session services.
 */
export function apply(ctx) {
  /** @type {CommandDefinition} */
  const command = {
    name: 'delete-last-turn',
    description: '删除当前聊天中最后一轮消息',
    handler: async ({ agent, rawInput, signal }) => {
      const input = rawInput.trim()
      const expectedTurn = input === '' ? undefined : Number(input)
      if (input !== '' && (!/^[1-9]\d*$/.test(input) || !Number.isSafeInteger(expectedTurn))) {
        return { kind: 'error', text: '用法：/delete-last-turn [轮次号]' }
      }
      if (agent.status !== 'idle') return { kind: 'error', text: '请先停止当前回复，再删除最后一轮消息。' }
      signal.throwIfAborted()
      try {
        return await agent.runMaintenance(async maintenanceSignal => {
          maintenanceSignal.throwIfAborted()
          signal.throwIfAborted()
          const event = deleteLastTurn(agent.session, expectedTurn)
          if (event === undefined) return { kind: 'success', text: '没有可删除的消息轮次。' }
          try {
            const persisted = await ctx.sessions.flush(agent.session)
            if (!persisted) return {
              kind: 'error',
              text: '消息已从当前聊天移除，但此会话没有持久化句柄。请检查会话存储配置；不要重复删除。',
            }
          } catch (error) {
            ctx.logger.error('delete-last-turn: deletion committed in memory but persistence failed', error)
            return { kind: 'error', text: '消息已从当前聊天移除，但保存失败。请检查会话存储错误；不要重复删除。' }
          }
          return { kind: 'success', text: `已删除第 ${event.data.turn} 轮消息。` }
        })
      } catch (error) {
        if (!isTurnDeletionError(error)) throw error
        return {
          kind: 'error',
          text: error.code === 'TURN_CHANGED'
            ? '最后一轮消息已改变，请刷新聊天后再删除。'
            : error.code === 'LATER_SURFACE'
              ? '最后一轮之后有独立的上下文编辑，暂时无法删除这一轮。'
              : error.code === 'COMPACTION_OPEN'
                ? '请先等待上下文压缩完成，再删除最后一轮消息。'
                : '当前会话无法删除最后一轮，请先停止回复并刷新聊天。',
        }
      }
    },
  }
  ctx.effect(() => ctx.commands.register(command), 'delete-last-turn: command')
}
