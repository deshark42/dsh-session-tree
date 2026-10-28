window.__ModuleLoader__.load({
  id: '@deshark/dsh-session-tree',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'deshark-session-retry';
    const ROUTE = 'api/deshark.session-retry';
    const dictionaries = {
      zh: {
        failed: '请求失败，等待手动重试',
        ready: '重试服务已连接',
        waiting: '没有等待重试的请求',
        ended: '这一轮已经结束，当前版本只能重试保持等待的请求。',
        connecting: '正在连接重试服务…',
        missing: '重试服务未加载，请检查插件是否启用并重启 DSH。',
        unavailable: '重试服务不可用，请检查插件状态。',
        retry: '重试失败请求',
        retrying: '正在重试…',
        hint: '保留已完成步骤，不追加消息；点击“停止”可结束等待。',
        changed: '请求状态已变化，请等待状态更新。',
        connection: '重试按钮暂时无法连接服务，正在重新连接…',
        actionError: '重试请求未被确认，请等待状态更新后再操作。',
      },
      en: {
        failed: 'Request failed. Waiting for manual retry.',
        ready: 'Retry service connected',
        waiting: 'No request is waiting for retry',
        ended: 'This turn has ended. This version can only retry requests that are still waiting.',
        connecting: 'Connecting to retry service…',
        missing: 'Retry service is not loaded. Check that the plugin is enabled and restart DSH.',
        unavailable: 'Retry service unavailable. Check the plugin status.',
        retry: 'Retry failed request',
        retrying: 'Retrying…',
        hint: 'Completed steps are kept. No message is added. Use Stop to end the wait.',
        changed: 'The request changed. Waiting for updated status.',
        connection: 'The retry control cannot reach the Host. Reconnecting…',
        actionError: 'Retry was not confirmed. Wait for updated status before trying again.',
      },
    };
    const css = `
      .dsh-session-retry { width:100%; box-sizing:border-box; padding:12px 14px;
        border:1px solid var(--dsw-alias-border-l2); border-radius:12px;
        background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary);
        font:inherit; font-size:13px; line-height:1.5; }
      .dsh-session-retry-row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
      .dsh-session-retry-title { flex:1; min-width:160px; font-weight:600; }
      .dsh-session-retry-detail { margin-top:6px; color:var(--dsw-alias-label-secondary);
        overflow-wrap:anywhere; white-space:pre-wrap; max-height:100px; overflow:auto; }
      .dsh-session-retry-hint { margin-top:5px; color:var(--dsw-alias-label-secondary); font-size:12px; }
      .dsh-session-retry button { display:inline-flex; align-items:center; gap:6px; flex-shrink:0;
        padding:6px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px;
        background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font:inherit; cursor:pointer; }
      .dsh-session-retry button:hover { background:var(--dsw-alias-interactive-bg-hover); }
      .dsh-session-retry button:disabled { opacity:.5; cursor:default; }
      .dsh-session-retry button:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
    `;

    function isSnapshot(value, sessionId) {
      if (value?.version !== 1 || value.sessionId !== sessionId) return false;
      const pending = value.pending;
      return pending === null || (pending !== null && typeof pending === 'object'
        && typeof pending.requestId === 'string' && Number.isSafeInteger(pending.turn)
        && Number.isSafeInteger(pending.step) && typeof pending.provider === 'string'
        && typeof pending.code === 'string' && typeof pending.message === 'string');
    }

    function reconnectDelay(signal) {
      return new Promise(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, 1500);
        signal.addEventListener('abort', finish, { once: true });
        if (signal.aborted) finish();
      });
    }

    async function watch(sessionId, signal, receive, disconnected) {
      while (!signal.aborted) {
        try {
          const query = new URLSearchParams({ sessionId });
          const response = await fetch(`${ROUTE}?${query}`, { signal, cache: 'no-store' });
          if (!response.ok || response.body === null) {
            const error = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            throw error;
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          try {
            while (!signal.aborted) {
              const chunk = await reader.read();
              if (chunk.done) throw new Error('Recovery state stream ended.');
              buffer += decoder.decode(chunk.value, { stream: true });
              let newline;
              while ((newline = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                if (line.length > 65536) throw new Error('Recovery state frame exceeded its limit.');
                const value = JSON.parse(line);
                if (!isSnapshot(value, sessionId)) throw new Error('Invalid recovery state.');
                if (!signal.aborted) receive(value);
              }
              if (buffer.length > 65536) throw new Error('Recovery state frame exceeded its limit.');
            }
          } finally {
            await reader.cancel().catch((error) => { void error; }); // The connection can already be closed.
            reader.releaseLock();
          }
        } catch (error) {
          if (signal.aborted) return;
          disconnected(error.status === 404 ? 'missing' : 'unavailable');
          await reconnectDelay(signal);
        }
      }
    }

    function RetryControl({ sessionId, t, useSession }) {
      const lastAgentError = useSession(snapshot => snapshot.lastAgentError);
      const running = useSession(snapshot => snapshot.running);
      const [state, setState] = React.useState({ sessionId, pending: null, connected: false, connection: 'connecting' });
      const [busy, setBusy] = React.useState(null);
      const [error, setError] = React.useState(null);
      const lifetime = React.useRef(null);
      const submitted = React.useRef(null);
      React.useEffect(() => {
        const abort = new AbortController();
        lifetime.current = abort;
        submitted.current = null;
        setState({ sessionId, pending: null, connected: false, connection: 'connecting' });
        setBusy(null);
        setError(null);
        void watch(sessionId, abort.signal, value => {
          setState({ ...value, connected: true });
          if (value.pending?.requestId !== submitted.current) {
            submitted.current = null;
            setBusy(null);
            setError(null);
          }
        }, connection => setState(previous => ({ ...previous, connected: false, connection })));
        return () => { abort.abort(); lifetime.current = null; };
      }, [sessionId]);

      const current = state.sessionId === sessionId ? state : null;
      const pending = current?.pending;
      if (current === null) return null;

      async function retry() {
        const abort = lifetime.current;
        if (pending === null || !current.connected || submitted.current !== null || abort === null) return;
        const requestId = pending.requestId;
        submitted.current = requestId;
        setBusy(requestId);
        setError(null);
        try {
          const response = await fetch(ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'retry', sessionId, requestId }),
            signal: abort.signal,
          });
          if (abort.signal.aborted || submitted.current !== requestId) return;
          if (!response.ok) {
            setError(response.status === 409 ? 'changed' : 'actionError');
            submitted.current = null;
            setBusy(null);
          }
          // Acknowledgement alone cannot establish execution. The state stream
          // removes this request or replaces it with the next failed attempt.
        } catch (cause) {
          if (!abort.signal.aborted && submitted.current === requestId) {
            setError('actionError');
            // Resubmission names the same requestId. The Host consumes it once,
            // even if the earlier POST was accepted but its response was lost.
            submitted.current = null;
            setBusy(null);
          }
        }
      }

      return h('section', { className: 'dsh-session-retry', 'aria-label': t('retry') },
        h('style', null, css),
        h('div', { className: 'dsh-session-retry-row' },
            h('div', { className: 'dsh-session-retry-title', role: 'status' },
              pending !== null ? t('failed') : current.connected ? t('ready') : t(current.connection)),
            h('button', { type: 'button', onClick: retry, disabled: pending === null || busy !== null || !current.connected,
              title: pending === null ? t('waiting') : t('retry') },
              h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
                h('path', { d: 'M20 10a8 8 0 1 0 .1 4M20 4v6h-6', strokeLinecap: 'round', strokeLinejoin: 'round' })),
              t(pending !== null && busy === pending.requestId ? 'retrying' : 'retry'))),
        pending === null ? h('div', { className: 'dsh-session-retry-hint' },
          lastAgentError !== null && !running ? t('ended') : t('waiting')) : h(React.Fragment, null,
          h('div', { className: 'dsh-session-retry-detail' }, `${pending.provider} · ${pending.code}\n${pending.message}`),
          h('div', { className: 'dsh-session-retry-hint' }, t('hint'))),
        h('div', { className: 'dsh-session-retry-hint' }, `Session Tree · Client 0.1.1${current.pluginVersion === undefined ? '' : ` · Host ${current.pluginVersion}`}`),
        error === null ? null : h('div', { role: 'alert' }, t(error)));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'session-retry: UI translations');
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'deshark-session-retry',
          order: -20,
          locale: NS,
        }, RetryControl));
      },
    };
  },
});
