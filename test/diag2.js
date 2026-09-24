const PORT = 9222;
async function getTargets() { const r = await fetch(`http://127.0.0.1:${PORT}/json`); return r.json(); }
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { ready, send(method, params) { return new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); }); } };
}
(async () => {
  try {
    const targets = await getTargets();
    const page = targets.find(t => t.type === 'page');
    const c = connect(page.webSocketDebuggerUrl);
    await c.ready;
    // 拿 windowId
    const win = await c.send('Browser.getWindowForTarget', { targetId: page.id });
    console.log('windowForTarget:', JSON.stringify(win.result));
    const wid = win.result?.windowId;
    if (wid) {
      const b = await c.send('Browser.getWindowBounds', { windowId: wid });
      console.log('windowBounds:', JSON.stringify(b.result));
    }
    process.exit(0);
  } catch (e) { console.log('TEST_ERROR:', e.message); process.exit(1); }
})();
