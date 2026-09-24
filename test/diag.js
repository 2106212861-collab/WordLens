const PORT = 9222;
async function getTargets() { const r = await fetch(`http://127.0.0.1:${PORT}/json`); return r.json(); }
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { ready, send(method, params) { return new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); }); } };
}
const EXPR = `(() => {
  const out = {};
  out.readyState = document.readyState;
  out.hasApi = !!window.wordlens;
  out.title = document.title;
  out.bodyChildren = document.body ? document.body.children.length : -1;
  out.hasTitlebar = !!document.querySelector('.titlebar');
  out.hasSidebar = !!document.querySelector('.sidebar');
  out.hasReader = !!document.querySelector('#view-reader');
  out.readerVisible = document.querySelector('#view-reader') ? !document.querySelector('#view-reader').classList.contains('hidden') : null;
  out.hasCodexSync = !!document.querySelector('#codex-sync');
  out.hasProviderSeg = !!document.querySelector('#ai-provider-seg');
  // 主题是否被 init 应用（data-theme 属性）
  out.themeAttr = document.documentElement.getAttribute('data-theme');
  // 是否有 JS 错误记录
  out.errs = window.__wl_errors || null;
  return JSON.stringify(out);
})()`;
(async () => {
  try {
    const targets = await getTargets();
    const page = targets.find(t => t.type === 'page');
    const c = connect(page.webSocketDebuggerUrl);
    await c.ready;
    // 先注入错误捕获（看后续是否报错）
    await c.send('Runtime.evaluate', { expression: `window.__wl_errors=[]; window.addEventListener('error', e=>window.__wl_errors.push(e.message)); window.addEventListener('unhandledrejection', e=>window.__wl_errors.push('rej:'+e.reason));` });
    const r = await c.send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
    console.log(r.result?.result?.value);
    // 检查 console 已发生的错误（通过 Runtime.enable + Log）
    process.exit(0);
  } catch (e) { console.log('TEST_ERROR:', e.message); process.exit(1); }
})();
