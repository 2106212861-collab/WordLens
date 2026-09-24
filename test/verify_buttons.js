// 验证自绘窗口按钮：DOM 存在 + 最大化 toggle + 最小化
const PORT = 9222;
async function getTargets() { const r = await fetch(`http://127.0.0.1:${PORT}/json`); return r.json(); }
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { ready, send(method, params) { return new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); }); } };
}
const EXPR = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = {};
  out.hasMin = !!document.querySelector('#win-min');
  out.hasMax = !!document.querySelector('#win-max');
  out.hasClose = !!document.querySelector('#win-close');
  out.controlsRight = (() => {
    const c = document.querySelector('.win-controls');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { right: Math.round(r.right), top: Math.round(r.top), width: Math.round(r.width) };
  })();
  out.initMax = window.wordlens.window.isMaximized();
  // 点击最大化
  document.querySelector('#win-max').click();
  await sleep(800);
  out.afterMax = window.wordlens.window.isMaximized();
  // 再点还原
  document.querySelector('#win-max').click();
  await sleep(800);
  out.afterRestore = window.wordlens.window.isMaximized();
  return JSON.stringify(out);
})()`;
(async () => {
  try {
    const targets = await getTargets();
    const page = targets.find(t => t.type === 'page');
    if (!page) { console.log('ERROR: 无页面'); process.exit(1); }
    const c = connect(page.webSocketDebuggerUrl);
    await c.ready;
    const r = await c.send('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) { console.log('EXCEPTION:', JSON.stringify(r.result.exceptionDetails.exception?.description || '')); process.exit(1); }
    console.log(r.result?.result?.value);
    process.exit(0);
  } catch (e) { console.log('TEST_ERROR:', e.message); process.exit(1); }
})();
