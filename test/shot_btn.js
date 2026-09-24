// 截图当前窗口（按钮现在是 DOM，可截到）
const PORT = 9222;
const path = require('path');
async function getTargets() { const r = await fetch(`http://127.0.0.1:${PORT}/json`); return r.json(); }
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { ready, send(method, params) { return new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); }); } };
}
(async () => {
  const targets = await getTargets();
  const page = targets.find(t => t.type === 'page');
  const c = connect(page.webSocketDebuggerUrl);
  await c.ready;
  const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const out = path.join(__dirname, '..', 'wl_buttons.png');
  require('fs').writeFileSync(out, Buffer.from(r.result.data, 'base64'));
  console.log('saved: ' + out);
  process.exit(0);
})();
