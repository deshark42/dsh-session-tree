import { randomUUID } from 'node:crypto';

/** An action cannot be applied because its waiting request is no longer current. */
export class RecoveryConflict extends Error {
  constructor() {
    super('The failed request is no longer waiting for retry.');
    this.name = 'RecoveryConflict';
  }
}

/**
 * Process-local recovery rendezvous. The Agent loop owns execution and durable
 * attempt records; this controller only releases its request-error waterfall.
 */
export class RequestRecovery {
  #pending = new Map();
  #disposed = false;

  /** Read one Session's current, detached recovery status. */
  snapshot(sessionId) {
    const entry = this.#pending.get(sessionId);
    return {
      version: 1,
      pluginVersion: '0.1.2',
      sessionId,
      pending: entry === undefined ? null : { ...entry.value },
    };
  }

  /** Wait for one explicit retry, Agent cancellation, or plugin disposal. */
  wait({ agent, turn, step, provider, failure, signal }) {
    if (this.#disposed || signal.aborted) return Promise.resolve(undefined);
    const sessionId = agent.session.id;
    if (this.#pending.has(sessionId)) {
      throw new Error(`A failed request is already waiting in Session ${sessionId}.`);
    }
    const { promise, resolve } = Promise.withResolvers();
    const entry = {
      signal,
      value: {
        requestId: randomUUID(),
        turn,
        step,
        provider,
        code: failure.code,
        message: failure.message.slice(0, 2000),
      },
      finish: (decision) => {
        if (this.#pending.get(sessionId) !== entry) return;
        signal.removeEventListener('abort', onAbort);
        this.#pending.delete(sessionId);
        resolve(decision);
      },
    };
    const onAbort = () => entry.finish(undefined);
    this.#pending.set(sessionId, entry);
    signal.addEventListener('abort', onAbort, { once: true });
    return promise;
  }

  /** Release exactly the failure named by the caller; stale and duplicate actions fail. */
  retry(sessionId, requestId) {
    const entry = this.#pending.get(sessionId);
    if (this.#disposed || entry === undefined || entry.signal.aborted
      || entry.value.requestId !== requestId) throw new RecoveryConflict();
    entry.finish({ kind: 'retry' });
    return { accepted: true, sessionId, requestId };
  }

  /** Release all waiting callbacks when the plugin is unloaded. */
  dispose() {
    this.#disposed = true;
    for (const entry of [...this.#pending.values()]) entry.finish(undefined);
  }
}

/** Admit actions from the command and model tool. */
export function parseAction(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !['status', 'retry'].includes(value.action)
    || typeof value.sessionId !== 'string' || value.sessionId.length === 0
    || Object.keys(value).some(key => !['action', 'sessionId', 'requestId'].includes(key))
    || (value.action === 'retry' && (typeof value.requestId !== 'string' || value.requestId.length === 0))
    || (value.action === 'status' && value.requestId !== undefined)) {
    throw new TypeError('Expected action, sessionId, and a requestId only for retry.');
  }
  return value;
}

/** Share one application operation between the slash command and agent tool. */
export function runAction(recovery, input) {
  const action = parseAction(input);
  return action.action === 'status'
    ? recovery.snapshot(action.sessionId)
    : recovery.retry(action.sessionId, action.requestId);
}
