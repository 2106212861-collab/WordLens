// v1.4.0 验证：Codex 释义链路（真实调用 CLI）+ 设置页 UI + 同步条
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

  // 1. 设置页：provider seg + Codex 状态
  document.querySelector('[data-view="settings"]').click();
  await sleep(200);
  out.providerSeg = !!document.querySelector('#ai-provider-seg');
  out.providerDefault = document.querySelector('#ai-provider-seg .seg-item.active')?.dataset.p;
  const statusEl = await new Promise(res => {
    let n = 0;
    const t = setInterval(() => {
      const el = document.querySelector('#codex-status');
      if (el && el.textContent.includes('Codex')) { clearInterval(t); res(el.textContent); }
      else if (++n > 30) { clearInterval(t); res(el ? el.textContent : null); }
    }, 200);
  });
  out.codexStatus = statusEl;
  document.querySelector('[data-view="reader"]').click();

  // 2. 打开 AI 释义开关（Codex provider 不需要 key）
  document.querySelector('[data-view="settings"]').click();
  document.querySelector('#llm-enabled').checked = true;
  document.querySelector('#llm-enabled').dispatchEvent(new Event('change'));
  document.querySelector('[data-view="reader"]').click();

  // 3. 点词触发 Codex 释义（真实 CLI 调用，最长等 50s）
  document.querySelector('#btn-demo').click();
  await sleep(300);
  const target = document.querySelector('#reader-article .word[data-word="negligible"]');
  if (target) target.click();
  let aiSlot = null;
  for (let i = 0; i < 100; i++) {
    await sleep(500);
    aiSlot = document.querySelector('#pop-ai-slot');
    if (aiSlot && aiSlot.innerHTML.trim()) break;
  }
  out.aiLabel = document.querySelector('#pop-ai-slot .pop-ai-label')?.textContent || null;
  out.aiContent = (document.querySelector('#pop-ai-slot')?.innerText || '').slice(0, 150);

  // 4. 同步条存在
  out.syncBar = !!document.querySelector('#codex-sync');

  // 清理
  localStorage.removeItem('wordlens.wordbook.v1');
  return JSON.stringify(out);
})()`;
(async () => {
  try {
    const targets = await getTargets();
    const page = targets.find(t => t.type === 'page');
    if (!page) { console.log('ERROR: 无页面 target'); process.exit(1); }
    const c = connect(page.webSocketDebuggerUrl);
    await c.ready;
    const r = await c.send('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) { console.log('EXCEPTION:', JSON.stringify(r.result.exceptionDetails.exception?.description || '')); process.exit(1); }
    console.log(r.result?.result?.value);
    process.exit(0);
  } catch (e) { console.log('TEST_ERROR:', e.message); process.exit(1); }
})();
