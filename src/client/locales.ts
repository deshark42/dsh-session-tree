export const zh = {
  'action.delete': '删除最后一轮消息',
  'action.busy': '请先停止回复，再删除最后一轮消息',
  'action.pending': '正在删除最后一轮消息',
  'error.unavailable': '删除命令不可用，请检查插件是否已启用。',
  'error.unknown': '删除请求未确认。请刷新聊天并查看命令结果，再决定下一步。',
} satisfies Record<string, string>

export type DeleteTurnKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    deleteLastTurn: DeleteTurnKey
  }
}

export const en = {
  'action.delete': 'Delete the last message turn',
  'action.busy': 'Stop the response before deleting the last message turn',
  'action.pending': 'Deleting the last message turn',
  'error.unavailable': 'The deletion command is unavailable. Check that the plugin is enabled.',
  'error.unknown': 'The deletion request was not confirmed. Refresh the chat and check the command result before proceeding.',
} satisfies Record<DeleteTurnKey, string>
