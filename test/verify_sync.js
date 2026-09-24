// 轮询检查 Codex 自动同步推送
const PORT = 9222;
async function getTargets() { const r = await fetch(`http://127.0.0.1:${PORT}/json`); return r.json(); }
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { ready, send(method, params) { return new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); }); } };
}
const CHECK = `(() => {
  const bar = document.querySelector('#codex-sync');
  return JSON.stringify({
    hidden: bar ? bar.classList.contains('hidden') : null,
    text: bar ? bar.innerText.slice(0, 120) : null,
    toast: document.querySelector('#toast') ? document.querySelector('#toast').textContent : null
  });
})()`;
(async () => {
  const targets = await getTargets();
  const page = targets.find(t => t.type === 'page');
  const c = connect(page.webSocketDebuggerUrl);
  await c.ready;
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    const r = await c.send('Runtime.evaluate', { expression: CHECK, returnByValue: true });
    const st = JSON.parse(r.result?.result?.value || '{}');
    if (st.hidden === false && st.text && st.text.includes('auto-sync-test')) {
      // 推送成功 → 点击"阅读"验证链路闭环
      await c.send('Runtime.evaluate', { expression: `document.querySelector('.codex-sync-item').click()`, returnByValue: true });
      await new Promise(res => setTimeout(res, 1200));
      const r2 = await c.send('Runtime.evaluate', { expression: `JSON.stringify({ articleShown: !document.querySelector('#reader-article').classList.contains('hidden'), meta: document.querySelector('#reader-meta').textContent, barCleared: document.querySelector('#codex-sync').classList.contains('hidden') })`, returnByValue: true });
      console.log('PUSHED:', r2.result?.result?.value);
      process.exit(0);
    }
    await new Promise(res => setTimeout(res, 3000));
  }
  console.log('TIMEOUT: 150s 内未收到推送');
  process.exit(1);
})();
