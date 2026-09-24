// v1.3.0 冒烟测试：验证 右上角原生按钮（titleBarOverlay 配置已生效）+ 拖拽导入 UI + 点词链路
'use strict';

const PORT = 9222;

async function getTargets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`);
  return r.json();
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return {
    ready,
    send(method, params) {
      return new Promise((resolve) => {
        const myId = ++id;
        pending.set(myId, resolve);
        ws.send(JSON.stringify({ id: myId, method, params }));
      });
    }
  };
}

const EXPR = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = {};

  // 1. 拖拽导入能力已注入
  out.hasApi = !!window.wordlens;
  out.hasGetPathForFile = !!(window.wordlens && typeof window.wordlens.getPathForFile === 'function');

  // 2. 拖拽遮罩 UI 存在
  out.hasDropOverlay = !!document.querySelector('#drop-overlay');
  out.dropOverlayHidden = document.querySelector('#drop-overlay')?.classList.contains('hidden');

  // 3. 无交通灯残留（已改为系统原生按钮）
  out.hasTrafficLights = !!(document.querySelector('.traffic-lights') || document.querySelector('#tl-max') || document.querySelector('#tl-min') || document.querySelector('#tl-close'));

  // 4. 标题栏存在
  out.titlebarTitle = document.querySelector('#titlebar-title')?.textContent || null;

  // 5. 载入示例文章 + 点词链路
  document.querySelector('#btn-demo').click();
  await sleep(400);
  out.articleShown = !document.querySelector('#reader-article').classList.contains('hidden');
  const target = document.querySelector('#reader-article .word[data-word="negligible"]');
  out.targetFound = !!target;
  if (target) target.click();
  await sleep(1500);
  out.popShown = !document.querySelector('#popover').classList.contains('hidden');
  out.popText = (document.querySelector('#pop-content')?.innerText || '').slice(0, 120);

  // 清理
  localStorage.removeItem('wordlens.wordbook.v1');

  return JSON.stringify(out);
})()`;

(async () => {
  try {
    const targets = await getTargets();
    const page = targets.find(t => t.type === 'page');
    if (!page) { console.log('ERROR: 未找到页面 target'); process.exit(1); }
    const c = connect(page.webSocketDebuggerUrl);
    await c.ready;
    const r = await c.send('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) {
      console.log('EXCEPTION:', JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails));
      process.exit(1);
    }
    console.log(r.result?.result?.value);
    process.exit(0);
  } catch (e) {
    console.log('TEST_ERROR:', e.message);
    process.exit(1);
  }
})();
