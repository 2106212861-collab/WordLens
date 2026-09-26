// 验证：后台预翻译 —— 导入文章后自动批量翻译生词，点词秒出
const PORT = 9232;
async function getTargets() { const r = await fetch(`http://127.0.0.1:${PORT}/json`); return r.json(); }
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { ready, send(method, params) { return new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); }); } };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  try {
    const targets = await getTargets();
    const page = targets.find(t => t.type === 'page');
    if (!page) { console.log('ERROR: 无页面 target'); process.exit(1); }
    const c = connect(page.webSocketDebuggerUrl);
    await c.ready;

    // 1. 设置 GLM 配置到 localStorage
    const setCfg = `localStorage.setItem('wordlens.config.v1', JSON.stringify({
      theme:'light',
      llm:{enabled:true,provider:'openai',baseUrl:'https://open.bigmodel.cn/api/paas/v4/',model:'glm-5.3-flash',apiKey:'c31ac6da0e7f4962945051704b948558.pljPUYYEFEc5524d'},
      codexDir:''
    })); 'set'`;
    await c.send('Runtime.evaluate', { expression: setCfg, returnByValue: true });

    // 2. reload 让配置生效
    await c.send('Page.reload', {});
    await sleep(2500);

    // 3. 主测试流程
    const EXPR = `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      document.querySelector('#btn-demo').click();
      await sleep(1200);
      const bgEl = document.querySelector('#bg-translate');
      out.bgStarted = !!bgEl && !bgEl.classList.contains('hidden');
      out.bgText0 = bgEl ? bgEl.textContent : null;
      for (let i = 0; i < 75; i++) {
        await sleep(1000);
        const el = document.querySelector('#bg-translate');
        if (el && el.classList.contains('hidden')) { out.bgFinal = 'done'; break; }
        out.bgFinal = el ? el.textContent : null;
      }
      // 找文章里第一个"离线查不到"的生词（后台翻译应该缓存了它）
      let unknownWord = null;
      for (const el of document.querySelectorAll('#reader-article .word')) {
        const w = el.dataset.word;
        const off = await window.wordlens.offlineLookup(w);
        if (!off || !off.found) { unknownWord = w; break; }
      }
      out.unknownWord = unknownWord;
      if (unknownWord) {
        const el = document.querySelector('#reader-article .word[data-word="' + unknownWord + '"]');
        el.click();
        await sleep(500);   // 缓存命中应几乎立即出现 AI 释义
        const slot = document.querySelector('#pop-ai-slot');
        out.aiLabel = slot ? slot.querySelector('.pop-ai-label')?.textContent : null;
        out.aiContent = slot ? (slot.innerText || '').replace(/\\n/g,' ').slice(0,100) : null;
        out.aiImmediate = !!(slot && slot.querySelector('.pop-def'));
      } else { out.err = 'no unknown word'; }
      return JSON.stringify(out);
    })()`;
    const r = await c.send('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) { console.log('EXCEPTION:', JSON.stringify(r.result.exceptionDetails.exception?.description || '')); process.exit(1); }
    console.log(r.result?.result?.value);
    process.exit(0);
  } catch (e) { console.log('TEST_ERROR:', e.message); process.exit(1); }
})();
