import { RequestRecovery, runAction } from './recovery.js';

export const inject = ['agents', 'commands', 'tools'];

/** Install manual recovery after the existing provider recovery policies. */
export function apply(ctx) {
  const recovery = new RequestRecovery();
  const lifetime = new AbortController();
  const active = new Set();
  ctx.provide('sessionRetryFailedRequest', recovery);

  // Wrap existing recovery so its terminal decision returns here even when
  // another listener short-circuits the rest of the waterfall.
  const stopRecovery = ctx.on('agent/request-error', (payload, next) => {
    if (lifetime.signal.aborted) return Promise.resolve(undefined);
    const operation = (async () => {
      const decision = await next();
      if (decision?.kind === 'retry' || payload.signal.aborted || lifetime.signal.aborted) return decision;
      // Always-mode remains automatic; normal-mode eligibility stays provider-owned.
      const policy = payload.retryPolicy;
      if (policy?.mode !== 'normal' || !policy.retryableCodes.includes(payload.failure.code)) return decision;
      return recovery.wait(payload);
    })();
    active.add(operation);
    void operation.then(() => active.delete(operation), () => active.delete(operation));
    return operation;
  }, { prepend: true });

  ctx.effect(() => ctx.commands.register({
    definitionId: '@deshark/dsh-session-tree/retry',
    name: 'retry',
    description: '重试当前会话中等待恢复的失败请求',
    handler({ agent, rawInput, signal }) {
      signal.throwIfAborted();
      if (rawInput.trim() !== '') {
        return { kind: 'error', text: '用法：/retry（无需参数）' };
      }
      const sessionId = agent.session.id;
      const { pending } = runAction(recovery, { action: 'status', sessionId });
      if (pending === null) {
        return { kind: 'error', text: '当前会话没有等待重试的失败请求。已结束的失败轮次无法通过 /retry 恢复。' };
      }
      // Read and consume the current identity synchronously, before another
      // invocation can release it or a subsequent failure can replace it.
      runAction(recovery, { action: 'retry', sessionId, requestId: pending.requestId });
      return { kind: 'success', text: '已重试失败请求，将在原轮次中继续执行。' };
    },
  }), 'session-retry: /retry command');

  ctx.effect(() => ctx.tools.register({
    name: 'session_retry_failed_request',
    description: 'Read a Session’s waiting failed model request, or retry it without sending a new chat message. Status returns its requestId; retry accepts that requestId.',
    deferLoading: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['status', 'retry'] },
        sessionId: { type: 'string', minLength: 1 },
        requestId: { type: 'string', minLength: 1, description: 'Required for retry; copy the current status requestId. Omit for status.' },
      },
      required: ['action', 'sessionId'],
    },
    output: {
      schema: { type: 'object' },
      render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted();
      return runAction(recovery, args);
    },
  }), 'session-retry: shared operation tool');

  ctx.effect(() => async () => {
    stopRecovery();
    lifetime.abort();
    recovery.dispose();
    await Promise.allSettled([...active]);
  }, 'session-retry: release pending requests');
}
