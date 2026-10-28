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
  #subscribers = new Map();
  #disposed = false;

  /** Read one Session's current, detached UI value. */
  snapshot(sessionId) {
    const entry = this.#pending.get(sessionId);
    return {
      version: 1,
      sessionId,
      pending: entry === undefined ? null : { ...entry.value },
    };
  }

  /** Subscribe to changes; the caller separately reads the initial snapshot. */
  subscribe(sessionId, listener) {
    let listeners = this.#subscribers.get(sessionId);
    if (listeners === undefined) {
      listeners = new Set();
      this.#subscribers.set(sessionId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#subscribers.delete(sessionId);
    };
  }

  #publish(sessionId) {
    for (const listener of this.#subscribers.get(sessionId) ?? []) listener();
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
        this.#publish(sessionId);
        resolve(decision);
      },
    };
    const onAbort = () => entry.finish(undefined);
    this.#pending.set(sessionId, entry);
    signal.addEventListener('abort', onAbort, { once: true });
    this.#publish(sessionId);
    return promise;
  }

  /** Release exactly the failure named by the caller; stale and double clicks fail. */
  retry(sessionId, requestId) {
    const entry = this.#pending.get(sessionId);
    if (this.#disposed || entry === undefined || entry.signal.aborted
      || entry.value.requestId !== requestId) throw new RecoveryConflict();
    entry.finish({ kind: 'retry' });
    return { accepted: true, sessionId, requestId };
  }

  /** Abort waiting callbacks and notify/close all transport subscriptions. */
  dispose() {
    this.#disposed = true;
    for (const entry of [...this.#pending.values()]) entry.finish(undefined);
    this.#subscribers.clear();
  }
}

/** Admit actions arriving through HTTP or model tool JSON. */
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

/** Share one application operation between the UI endpoint and agent tool. */
export function runAction(recovery, input) {
  const action = parseAction(input);
  return action.action === 'status'
    ? recovery.snapshot(action.sessionId)
    : recovery.retry(action.sessionId, action.requestId);
}

/**
 * Watch one Session over the authenticated Fetch carrier used by Desktop and
 * Web. Slow consumers retain only the latest snapshot, never a growing queue.
 */
export function watchResponse(recovery, sessionId, signal, lifetime) {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let controller;
  let queued = false;
  let closed = false;
  const flush = () => {
    if (!closed && queued && controller.desiredSize > 0) {
      queued = false;
      controller.enqueue(encoder.encode(`${JSON.stringify(recovery.snapshot(sessionId))}\n`));
    }
  };
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    signal.removeEventListener('abort', close);
    lifetime.removeEventListener('abort', close);
    controller.close();
  };
  const body = new ReadableStream({
    start(streamController) {
      controller = streamController;
      if (signal.aborted || lifetime.aborted) {
        close();
        return;
      }
      unsubscribe = recovery.subscribe(sessionId, () => { queued = true; flush(); });
      signal.addEventListener('abort', close, { once: true });
      lifetime.addEventListener('abort', close, { once: true });
      queued = true;
      flush();
    },
    pull: flush,
    cancel() {
      if (closed) return;
      closed = true;
      unsubscribe();
      signal.removeEventListener('abort', close);
      lifetime.removeEventListener('abort', close);
    },
  });
  return new Response(body, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
