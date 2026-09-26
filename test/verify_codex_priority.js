// 验证：Codex 优先收录 —— 默认启用 Codex + 收录用 Codex 释义（而非离线词典）
const PORT = 9230;
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

  // 1. 默认状态（不手动勾选任何开关）
  out.enabledDefault = document.querySelector('#llm-enabled').checked;
  out.providerDefault = document.querySelector('#ai-provider-seg .seg-item.active')?.dataset.p;

  // 2. Codex 检测状态（时序修复后应直接 available:true）
  const st = await window.wordlens.codexStatus();
  out.codexAvailable = st.available;
  out.codexVersion = st.version;

  // 3. 点词 negligible，等 Codex 释义出现
  document.querySelector('#btn-demo').click();
  await sleep(400);
  const target = document.querySelector('#reader-article .word[data-word="negligible"]');
  if (!target) { out.err = 'no target word'; return JSON.stringify(out); }
  target.click();
  let aiMeaning = null;
  for (let i = 0; i < 120; i++) {   // 最多等 60s
    await sleep(500);
    const slot = document.querySelector('#pop-ai-slot');
    const def = slot && slot.querySelector('.pop-def');
    if (def && def.innerText.trim()) { aiMeaning = def.innerText.trim(); break; }
  }
  out.aiMeaning = aiMeaning;

  // 4. 点「加入单词本」
  document.querySelector('#pop-add').click();
  await sleep(800);

  // 5. 读单词本
  const wb = JSON.parse(localStorage.getItem('wordlens.wordbook.v1') || '[]');
  if (wb.length > 0) {
    out.wbMeaning = wb[0].meaning;
    out.wbExample = (wb[0].example || '').slice(0, 80);
  } else {
    out.wbEmpty = true;
  }

  // 判定：收录释义是否等于 Codex 释义（而非离线词典）
  out.priorityOK = !!(out.wbMeaning && out.aiMeaning && out.wbMeaning === out.aiMeaning);

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
