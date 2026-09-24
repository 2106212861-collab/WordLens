// 端到端 GUI 冒烟测试：通过 CDP 连接运行中的词镜，验证 点词→气泡→收录 链路
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
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
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

const TEST_EXPR = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = {};

  out.hasApi = !!window.wordlens;

  // 1. 载入示例文章
  document.querySelector('#btn-demo').click();
  await sleep(400);
  out.articleShown = !document.querySelector('#reader-article').classList.contains('hidden');
  out.wordCount = document.querySelectorAll('#reader-article .word').length;

  // 2. 点击一个四级难词 negligible
  const target = document.querySelector('#reader-article .word[data-word="negligible"]');
  out.targetFound = !!target;
  if (target) target.click();
  await sleep(1500);

  // 3. 气泡状态与内容
  out.popShown = !document.querySelector('#popover').classList.contains('hidden');
  out.popText = (document.querySelector('#pop-content')?.innerText || '').slice(0, 260);
  out.hasTagBadge = !!document.querySelector('.pop-tag');

  // 4. 收录进单词本
  const add = document.querySelector('#pop-add');
  if (add) { add.click(); await sleep(400); }
  const wb = JSON.parse(localStorage.getItem('wordlens.wordbook.v1') || '[]');
  out.wbCount = wb.length;
  out.wbFirst = wb[0] ? { word: wb[0].word, phonetic: wb[0].phonetic, meaning: (wb[0].meaning || '').slice(0, 80) } : null;

  // 5. 清理测试数据
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
    const r = await c.send('Runtime.evaluate', {
      expression: TEST_EXPR,
      awaitPromise: true,
      returnByValue: true
    });
    const val = r.result?.result?.value;
    if (r.result?.exceptionDetails) {
      console.log('EXCEPTION:', JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails, null, 2));
      process.exit(1);
    }
    console.log(val);
    process.exit(0);
  } catch (e) {
    console.log('TEST_ERROR:', e.message);
    process.exit(1);
  }
})();
