export {}
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'session/turn-deleted': { turn: number; startSeq: import('@deepseek-ai/dsh-session/types').SessionSeq; endSeq: import('@deepseek-ai/dsh-session/types').SessionSeq }
  }
}
