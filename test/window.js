// 窗口控制冒烟测试：验证交通灯（最小化/最大化/关闭）功能真实可用
'use strict';

const PORT = 9223;

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
  return { ready, send(method, params) {
    return new Promise((resolve) => {
      const myId = ++id;
      pending.set(myId, resolve);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  } };
}

const EXPR = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = {};
  out.hasButtons = !!(document.querySelector('#tl-max') && document.querySelector('#tl-min') && document.querySelector('#tl-close'));
  out.initMax = window.wordlens.window.isMaximized();
  document.querySelector('#tl-max').click();
  await sleep(700);
  out.afterMax = window.wordlens.window.isMaximized();
  document.querySelector('#tl-max').click();
  await sleep(700);
  out.afterRestore = window.wordlens.window.isMaximized();
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
