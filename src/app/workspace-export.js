// Workspace JSON export helpers.
// The streaming path emits exactly the same text as
// JSON.stringify({format, version, exported_at, days:[...days.entries()]})
// but keeps only one day's JSON string alive at a time. That avoids the
// ~114 MB two-byte string produced by stringifying the whole 31-day payload.
const WORKSPACE_FORMAT = 'BTCUSD-Market-Mechanics-Lab';
const WORKSPACE_VERSION = 1;

function workspaceMeta(exportedAt = new Date().toISOString()) {
  return { format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, exported_at: exportedAt };
}

function workspaceJsonText(days, meta = workspaceMeta()) {
  return JSON.stringify({
    format: meta.format || WORKSPACE_FORMAT,
    version: meta.version || WORKSPACE_VERSION,
    exported_at: meta.exported_at || new Date().toISOString(),
    days: [...days.entries()]
  });
}

// ReadableStream<Uint8Array> of the workspace JSON, serialized one day at a time.
function createWorkspaceJsonStream(days, meta = workspaceMeta()) {
  const head = JSON.stringify({
    format: meta.format || WORKSPACE_FORMAT,
    version: meta.version || WORKSPACE_VERSION,
    exported_at: meta.exported_at || new Date().toISOString()
  });
  const prefix = head.slice(0, -1) + ',"days":[';
  const encoder = new TextEncoder();
  const iterator = days.entries();
  let first = true;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(prefix));
    },
    pull(controller) {
      const next = iterator.next();
      if (next.done) {
        controller.enqueue(encoder.encode(']}'));
        controller.close();
        return;
      }
      const [date, day] = next.value;
      const chunk = (first ? '' : ',') + JSON.stringify([date, day]);
      first = false;
      controller.enqueue(encoder.encode(chunk));
    }
  });
}

async function workspaceStreamText(days, meta) {
  return new Response(createWorkspaceJsonStream(days, meta)).text();
}

export { WORKSPACE_FORMAT, WORKSPACE_VERSION, workspaceMeta, workspaceJsonText, createWorkspaceJsonStream, workspaceStreamText };
