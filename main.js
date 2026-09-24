const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;

let mainWindow = null;

// ---------- 窗口 ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    frame: false,            // 无边框，窗口控制按钮由渲染层自绘（右上角 ─ □ ✕）
    show: true,
    backgroundColor: '#f5f5f7',
    title: '词镜 WordLens',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // 最大化状态变化 → 通知渲染层切换按钮图标（□ ↔ ❐）
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximize-changed', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximize-changed', false));

  // 外链用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => (mainWindow = null));
}

// ---------- 文本解析（主进程侧通用工具） ----------
const SUPPORTED_EXTS = ['.txt', '.md', '.markdown', '.html', '.htm', '.json', '.csv'];

function isTextLike(name) {
  const ext = path.extname(name).toLowerCase();
  return SUPPORTED_EXTS.includes(ext);
}

async function readTextFile(filePath) {
  const stat = await fsp.stat(filePath);
  if (stat.size > 20 * 1024 * 1024) {
    throw new Error('文件超过 20MB，暂不支持');
  }
  const buf = await fsp.readFile(filePath);
  // 尝试 UTF-8，失败回退 GBK（Windows 常见）
  let text = buf.toString('utf8');
  if (text.includes('\uFFFD')) {
    text = buf.toString('gbk');
  }
  return text;
}

// 扫描 Codex 目录，找出所有英文文章类文本文件
async function scanCodexDir(dir) {
  const results = [];
  async function walk(d, depth) {
    if (depth > 5) return;
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (isTextLike(e.name) && !e.name.endsWith('.json')) {
        try {
          const st = await fsp.stat(full);
          results.push({ name: e.name, path: full, size: st.size, mtime: st.mtimeMs });
        } catch {}
      }
    }
  }
  await walk(dir, 0);
  // 按修改时间倒序，最新的排前面
  results.sort((a, b) => b.mtime - a.mtime);
  return results;
}

function defaultCodexDir() {
  return path.join(os.homedir(), 'Documents', 'Codex');
}

// ---------- 内置离线词典（ECDICT 精简版） ----------
const dictMap = new Map();
let dictReady = false;

async function loadDict() {
  try {
    const file = path.join(__dirname, 'resources', 'dict-mini.tsv');
    const text = await fsp.readFile(file, 'utf8');
    for (const line of text.split('\n')) {
      const i = line.indexOf('\t');
      if (i <= 0) continue;
      const word = line.slice(0, i);
      if (dictMap.has(word)) continue;
      const rest = line.slice(i + 1).split('\t');
      const entry = {
        phonetic: rest[0] || '',
        pos: rest[1] || '',
        translation: rest[2] || '',
        definition: rest[3] || '',
        tag: rest[4] || ''
      };
      dictMap.set(word, entry);
      const lw = word.toLowerCase();
      if (!dictMap.has(lw)) dictMap.set(lw, entry);
    }
    dictReady = true;
    console.log(`[dict] 已加载 ${dictMap.size} 个键`);
  } catch (e) {
    console.error('[dict] 加载失败:', e.message);
  }
}

// 启发式词形还原：books→book, studies→study, stopped→stop, bigger→big…
function stemsOf(lw) {
  const out = new Set();
  const push = (w) => { if (w && w.length > 1) out.add(w); };
  if (lw.endsWith('ies') && lw.length > 4) push(lw.slice(0, -3) + 'y');
  if (lw.endsWith('es') && lw.length > 3) push(lw.slice(0, -2));
  if (lw.endsWith('s') && !lw.endsWith('ss') && lw.length > 3) push(lw.slice(0, -1));
  if (lw.endsWith('ed') && lw.length > 4) {
    push(lw.slice(0, -2));
    push(lw.slice(0, -1));
    const stem = lw.slice(0, -2);
    if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) push(stem.slice(0, -1)); // stopped→stop
    push(lw.slice(0, -2) + 'e'); // hoped→hope
  }
  if (lw.endsWith('ing') && lw.length > 5) {
    push(lw.slice(0, -3));
    push(lw.slice(0, -3) + 'e'); // making→make
    const stem = lw.slice(0, -3);
    if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) push(stem.slice(0, -1)); // running→run
  }
  if (lw.endsWith('ly') && lw.length > 4) push(lw.slice(0, -2));
  if (lw.endsWith('er') && lw.length > 4) {
    push(lw.slice(0, -2));
    push(lw.slice(0, -1));
  }
  if (lw.endsWith('est') && lw.length > 5) {
    push(lw.slice(0, -3));
    push(lw.slice(0, -2));
  }
  return Array.from(out);
}

function lookupOffline(word) {
  if (!word || !word.trim()) return { ready: dictReady, found: false };
  const w = word.trim();
  const lw = w.toLowerCase();
  const candidates = [w, lw, ...stemsOf(lw)];
  for (const c of candidates) {
    const hit = dictMap.get(c);
    if (hit) return { ready: dictReady, found: true, word: c, data: hit };
  }
  return { ready: dictReady, found: false };
}

// ---------- 词典增强（Free Dictionary API，在线，失败可容忍） ----------
async function lookupDictionary(word) {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return { found: false };
  if (!res.ok) throw new Error(`词典服务返回 ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return { found: false };
  return { found: true, data };
}

// ---------- 模型释义（OpenAI 兼容接口，可选） ----------
async function lookupLLM(word, context, config) {
  const base = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = config.model || 'gpt-4o-mini';
  const key = config.apiKey;
  if (!key) throw new Error('未配置 API Key');

  const system = '你是一个英汉词典助手。用简洁的中文解释英文单词，输出 JSON：{"word","phonetic","meaning":"词性+中文释义（多个义项用分号）","example":"一句英文例句","example_cn":"例句中文","tip":"一个记忆技巧"}。只输出 JSON，不要多余文字。';
  const ctx = context && context.trim() ? `\n上下文（该词所在句子）：${context.trim().slice(0, 300)}` : '';

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `单词：${word}${ctx}` }
      ]
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`模型接口返回 ${res.status} ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  try {
    return JSON.parse(content);
  } catch {
    return { word, phonetic: '', meaning: content, example: '', example_cn: '', tip: '' };
  }
}

// ---------- IPC 注册 ----------
function registerIpc() {
  // 窗口控制
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.on('window:isMaximized', (e) => e.returnValue = mainWindow?.isMaximized() ?? false);

  // 主题切换（无 titleBarOverlay，窗口按钮颜色由系统默认；此通道保留供渲染层调用，避免报错）
  ipcMain.on('theme:set', (_e, theme) => {
    // no-op：原生窗口按钮颜色无法自定义时，保持系统默认即可
  });

  // 打开文件（单/多选）
  ipcMain.handle('dialog:openFiles', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '导入英文文章',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '文本文章', extensions: ['txt', 'md', 'markdown', 'html', 'htm'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (r.canceled) return [];
    const items = [];
    for (const f of r.filePaths) {
      try {
        items.push({ name: path.basename(f), path: f, content: await readTextFile(f) });
      } catch (err) {
        items.push({ name: path.basename(f), path: f, error: String(err.message || err) });
      }
    }
    return items;
  });

  // 扫描 Codex 目录
  ipcMain.handle('codex:scan', async (_e, customDir) => {
    const dir = customDir || defaultCodexDir();
    const exists = fs.existsSync(dir);
    return { dir, exists, files: exists ? await scanCodexDir(dir) : [] };
  });

  // 读取指定文件
  ipcMain.handle('fs:readFile', async (_e, filePath) => {
    return readTextFile(filePath);
  });

  // 离线词典查询（主力，零网络依赖）
  ipcMain.handle('dict:offline', (_e, word) => lookupOffline(word));

  // 在线词典增强
  ipcMain.handle('dictionary:lookup', async (_e, word) => {
    try {
      return await lookupDictionary(word);
    } catch (err) {
      return { found: false, error: String(err.message || err) };
    }
  });

  // 模型释义（OpenAI 兼容接口）
  ipcMain.handle('llm:lookup', async (_e, word, context, config) => {
    try {
      const data = await lookupLLM(word, context, config || {});
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  // 本机 Codex CLI 释义
  ipcMain.handle('codex:lookup', async (_e, word, context) => codexLookup(word, context));

  // Codex CLI 检测状态（供设置页显示）
  ipcMain.handle('codex:status', () => ({ available: !!codexPath, version: codexVersion }));

  // 导出单词本
  ipcMain.handle('wordbook:export', async (_e, { content, format, defaultName }) => {
    const exts = { markdown: 'md', json: 'json', csv: 'csv' };
    const ext = exts[format] || 'md';
    const r = await dialog.showSaveDialog(mainWindow, {
      title: '导出单词本',
      defaultPath: `${defaultName || '我的单词本'}.${ext}`,
      filters: [
        { name: format === 'json' ? 'JSON' : format === 'csv' ? 'CSV' : 'Markdown', extensions: [ext] }
      ]
    });
    if (r.canceled) return { ok: false, canceled: true };
    await fsp.writeFile(r.filePath, content, 'utf8');
    return { ok: true, path: r.filePath };
  });

  // 获取默认 Codex 目录（供 UI 显示）
  ipcMain.handle('app:defaultCodexDir', () => defaultCodexDir());
}

// ---------- 本机 Codex CLI 接入（无需 API Key，走用户 Codex 订阅） ----------
let codexPath = null;      // codex 可执行文件路径
let codexVersion = '';     // 版本号，如 0.156.1

function candidateCodexPaths() {
  return [
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    'codex'   // 回退：PATH 中查找
  ];
}

function runCmd(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let buf = '';
    child.stdout.on('data', d => (buf += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve(buf) : reject(new Error('exit ' + code))));
    const t = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('timeout')); }, timeoutMs);
    child.on('close', () => clearTimeout(t));
  });
}

async function detectCodex() {
  for (const cand of candidateCodexPaths()) {
    try {
      const out = await runCmd(cand, ['--version'], 10000);
      if (/codex-cli/i.test(out)) {
        codexPath = cand;
        codexVersion = out.replace(/codex-cli\s*/i, '').trim();
        console.log(`[codex] detected: ${codexPath} (${codexVersion})`);
        return;
      }
    } catch {}
  }
  console.log('[codex] not detected');
}

const CODEX_DICT_SYSTEM = 'You are an English-Chinese dictionary assistant. Explain the given English word in simple Chinese, considering the context sentence if provided. Output ONLY a JSON object with keys "word","phonetic","meaning","example","example_cn","tip", where meaning is part of speech + Chinese meanings separated by semicolons, example is one English example sentence, example_cn is its Chinese translation, tip is one memory tip in Chinese. No other text.';

function codexLookup(word, context) {
  return new Promise((resolve) => {
    if (!codexPath) { resolve({ ok: false, error: '未检测到本机 Codex CLI' }); return; }
    const ctx = context && context.trim() ? `\nContext sentence: ${context.trim().slice(0, 300)}` : '';
    const prompt = `${CODEX_DICT_SYSTEM}\nWord: ${word}${ctx}`;
    const child = spawn(codexPath, ['exec', '--skip-git-repo-check', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: os.tmpdir()
    });
    let buf = '';
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ ok: false, error: 'Codex 响应超时（45 秒）' }); }, 45000);
    child.stdout.on('data', d => (buf += d.toString('utf8')));
    child.stderr.on('data', d => (buf += d.toString('utf8')));
    child.on('error', (e) => finish({ ok: false, error: e.message }));
    child.on('close', () => {
      // 最终答案在输出末尾：倒序找第一个可解析且 word 非空的 JSON 行
      const lines = buf.split(/\r?\n/);
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line.startsWith('{')) continue;
        try {
          const data = JSON.parse(line);
          if (data && typeof data.meaning === 'string' && data.meaning && data.word) {
            finish({ ok: true, data });
            return;
          }
        } catch {}
      }
      // 兜底：贪婪匹配最后一段 JSON（跨行情形）
      const m = buf.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          const data = JSON.parse(m[0]);
          if (data && typeof data.meaning === 'string' && data.meaning && data.word) {
            finish({ ok: true, data });
            return;
          }
        } catch {}
      }
      finish({ ok: false, error: '未能从 Codex 输出解析出释义' });
    });
  });
}

// ---------- Codex 目录自动同步（定时扫描，发现新文章推送渲染层） ----------
let codexBaseline = new Set();   // "path|mtime" 集合
let codexWatchStarted = false;

async function startCodexWatch() {
  if (codexWatchStarted) return;
  codexWatchStarted = true;
  // 首次扫描：现有文件全部进基线，不通知（避免历史文章轰炸）
  try {
    const files = await scanCodexDir(defaultCodexDir());
    for (const f of files) codexBaseline.add(f.path + '|' + f.mtime);
    console.log(`[codex-watch] baseline: ${files.length} files`);
  } catch {}
  setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const files = await scanCodexDir(defaultCodexDir());
      const newFiles = [];
      for (const f of files) {
        const key = f.path + '|' + f.mtime;
        if (codexBaseline.has(key)) continue;
        // 刚写入（<45s）的文件可能是 Codex 正在生成的中间态，等下一轮再推
        if (Date.now() - f.mtime < 45000) continue;
        codexBaseline.add(key);
        newFiles.push({ name: f.name, path: f.path, size: f.size, mtime: f.mtime });
      }
      if (newFiles.length) {
        mainWindow.webContents.send('codex:new-files', newFiles.slice(0, 5));
      }
    } catch {}
  }, 60000);
}

app.whenReady().then(() => {
  registerIpc();
  loadDict();          // 异步加载离线词典，不阻塞窗口
  detectCodex();       // 异步探测本机 Codex CLI
  createWindow();
  startCodexWatch();   // 定时扫描 Codex 目录，新文章自动推送
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
