// 验证 Window Controls Overlay（右上角原生按钮）是否生效
const PORT = 9222;
async function getTargets() { const r = await fetch(`http://127.0.0.1:${PORT}/json`); return r.json(); }
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { ready, send(method, params) { return new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); }); } };
}
const EXPR = `(async () => {
  const out = {};
  const wco = navigator.windowControlsOverlay;
  out.wcoSupported = !!wco;
  if (wco) {
    out.wcoVisible = wco.visible;
    const rect = wco.getTitlebarAreaRect();
    out.titlebarRect = rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  }
  out.innerWidth = window.innerWidth;
  out.isMaximized = window.wordlens.window.isMaximized();
  return JSON.stringify(out);
})()`;
(async () => {
  const targets = await getTargets();
  const page = targets.find(t => t.type === 'page');
  const c = connect(page.webSocketDebuggerUrl);
  await c.ready;
  const r = await c.send('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) { console.log('EXCEPTION:', JSON.stringify(r.result.exceptionDetails.exception?.description || '')); process.exit(1); }
  console.log(r.result?.result?.value);
  process.exit(0);
})();
