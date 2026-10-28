import { RequestRecovery, RecoveryConflict, runAction, watchResponse } from './recovery.js';

export const inject = ['agents', 'connection', 'tools'];

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

  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/deshark.session-retry',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      if (lifetime.signal.aborted) return Response.json({ error: 'PLUGIN_UNLOADED' }, { status: 503 });
      if (request.method === 'GET') {
        const sessionId = new URL(request.url).searchParams.get('sessionId');
        if (sessionId === null || sessionId.length === 0) {
          return Response.json({ error: 'SESSION_ID_REQUIRED' }, { status: 400 });
        }
        return watchResponse(recovery, sessionId, request.signal, lifetime.signal);
      }
      let input;
      try {
        input = await request.json();
      } catch (error) {
        if (request.signal.aborted) throw error;
        return Response.json({ error: 'INVALID_JSON' }, { status: 400 });
      }
      try {
        return Response.json(runAction(recovery, input));
      } catch (error) {
        if (error instanceof RecoveryConflict) {
          return Response.json({ error: 'REQUEST_CHANGED' }, { status: 409 });
        }
        if (error instanceof TypeError) return Response.json({ error: 'INVALID_ACTION' }, { status: 400 });
        throw error;
      }
    },
  }), 'session-retry: authenticated application endpoint');

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
  }, 'session-retry: release pending requests and transports');
}
