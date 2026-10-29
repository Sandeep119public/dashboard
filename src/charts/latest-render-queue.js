// Latest-wins render queue for charts that may receive overlapping refresh requests.
// Calls for one chart are serialized; while rendering, only the newest pending request is retained.
export function createLatestRenderQueue({ render, afterRender = () => {} } = {}) {
  if (typeof render !== 'function') {
    throw new TypeError('createLatestRenderQueue requires a render function.');
  }

  const states = new Map();

  const resolveWaiters = state => {
    const waiters = state.waiters.splice(0);
    for (const resolve of waiters) resolve();
  };

  function enqueue(key, target, request) {
    const state = states.get(key) || { running: false, pending: null, waiters: [] };

    if (state.running) {
      state.pending = { target, request };
      const pendingPromise = new Promise(resolve => state.waiters.push(resolve));
      states.set(key, state);
      return pendingPromise;
    }

    state.running = true;
    states.set(key, state);

    const drain = async () => {
      let current = { target, request };
      while (current) {
        try {
          await render(key, current.target, current.request);
        } catch (error) {
          if (!state.pending) throw error;
        }

        afterRender(key, current.target, current.request);
        current = state.pending;
        state.pending = null;
      }

      state.running = false;
      resolveWaiters(state);
    };

    return drain().catch(error => {
      state.running = false;
      state.pending = null;
      resolveWaiters(state);
      throw error;
    });
  }

  return { enqueue };
}
