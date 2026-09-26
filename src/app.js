/* ============ 词镜 WordLens — 渲染层逻辑 ============ */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const api = window.wordlens;

// ---------- 全局状态 ----------
const state = {
  view: 'reader',
  currentFile: null,      // { name, path }
  currentText: '',
  wordbook: [],           // 单词本条目
  theme: 'light',
  llm: { enabled: true, provider: 'codex', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' },
  codexAvailable: false,  // 本机是否检测到 Codex CLI
  codexDir: '',
  codexNew: [],           // Codex 自动同步的新文章列表
  filter: 'all',
  search: ''
};

const WB_KEY = 'wordlens.wordbook.v1';
const CFG_KEY = 'wordlens.config.v1';

// ---------- 初始化 ----------
function init() {
  loadConfig();
  loadWordbook();
  bindTitlebar();
  bindNav();
  bindReader();
  bindWordbook();
  bindSettings();
  bindDragDrop();
  bindCodexSync();
  applyTheme(state.theme);
  renderWordbook();
  updateWordbookBadge();
}

// ============ 持久化 ============
function loadConfig() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) Object.assign(state, JSON.parse(raw));
  } catch {}
  // 应用 LLM 配置到输入框
  $('#llm-enabled').checked = !!state.llm.enabled;
  $('#llm-base').value = state.llm.baseUrl || '';
  $('#llm-model').value = state.llm.model || '';
  $('#llm-key').value = state.llm.apiKey || '';
  $('#codex-dir').value = state.codexDir || '';
  const provider = state.llm.provider === 'openai' ? 'openai' : 'codex';
  state.llm.provider = provider;
  $$('#ai-provider-seg .seg-item').forEach(b => b.classList.toggle('active', b.dataset.p === provider));
  updateProviderUI(provider);
  // 主题 seg
  const t = state.theme === 'dark' ? 'dark' : state.theme === 'auto' ? 'auto' : 'light';
  $$('#theme-seg .seg-item').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
}

function saveConfig() {
  state.llm = {
    enabled: $('#llm-enabled').checked,
    provider: state.llm.provider || 'codex',
    baseUrl: $('#llm-base').value.trim(),
    model: $('#llm-model').value.trim(),
    apiKey: $('#llm-key').value.trim()
  };
  state.codexDir = $('#codex-dir').value.trim();
  localStorage.setItem(CFG_KEY, JSON.stringify({ theme: state.theme, llm: state.llm, codexDir: state.codexDir }));
}

function loadWordbook() {
  try {
    const raw = localStorage.getItem(WB_KEY);
    if (raw) state.wordbook = JSON.parse(raw);
  } catch { state.wordbook = []; }
}

function saveWordbook() {
  localStorage.setItem(WB_KEY, JSON.stringify(state.wordbook));
  updateWordbookBadge();
}

function updateWordbookBadge() {
  const n = state.wordbook.length;
  $('#wb-count').textContent = n || '';
  $('#wb-count').style.display = n ? '' : 'none';
}

// ============ 主题 ============
function applyTheme(theme) {
  let effective = theme;
  if (theme === 'auto') {
    effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', effective);
  // 同步右上角原生窗口按钮颜色
  if (api.window && api.window.setTitleBarOverlay) {
    api.window.setTitleBarOverlay(effective);
  }
}

// ============ 标题栏 ============
function bindTitlebar() {
  const titlebar = $('.titlebar');

  // 右上角窗口控制按钮（自绘，走系统 IPC）
  $('#win-min').addEventListener('click', () => api.window.minimize());
  $('#win-max').addEventListener('click', () => api.window.maximize());
  $('#win-close').addEventListener('click', () => api.window.close());

  // 双击标题栏切换最大化（避开按钮区域）
  titlebar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.win-controls')) return;
    api.window.maximize();
  });

  // 最大化状态 → 切换图标（□ ↔ ❐）
  if (api.window && api.window.onMaximizeChange) {
    api.window.onMaximizeChange((max) => setMaxIcon(max));
  }
  if (api.window && api.window.isMaximized) setMaxIcon(api.window.isMaximized());

  // 跟随系统主题时，监听系统深浅色切换
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme === 'auto') applyTheme('auto');
  });
}

function setMaxIcon(max) {
  const btn = $('#win-max');
  if (!btn) return;
  btn.innerHTML = max
    ? '<svg viewBox="0 0 10 10" width="10" height="10"><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" stroke-width="1"/></svg>'
    : '<svg viewBox="0 0 10 10" width="10" height="10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
  btn.title = max ? '还原' : '最大化';
}

// ============ 导航 ============
function bindNav() {
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

function switchView(view) {
  state.view = view;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + view).classList.remove('hidden');
  $('#titlebar-title').textContent =
    view === 'reader' ? '词镜 WordLens' : view === 'wordbook' ? '我的单词本' : '设置';
  if (view === 'wordbook') renderWordbook();
}

// ============ 阅读器 ============
function bindReader() {
  $('#btn-import').addEventListener('click', importFiles);
  $('#btn-import-2').addEventListener('click', importFiles);
  $('#btn-demo').addEventListener('click', loadDemo);
  $('#btn-codex').addEventListener('click', openCodexModal);
  $('#codex-modal-close').addEventListener('click', closeCodexModal);
  $('#codex-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeCodexModal(); });

  // 点词事件委托 + 划词取词
  $('#reader-article').addEventListener('click', onArticleClick);
  $('#reader-article').addEventListener('mouseup', onArticleMouseUp);
}

// 内嵌示例文章（开箱即试）
const DEMO_ARTICLE = `# The Power of Small Habits

When people think about changing their lives, they usually imagine something dramatic: a new job, a new city, or a bold resolution announced to friends. But real change rarely arrives with fireworks. It tends to begin quietly, with a small habit repeated day after day.

Consider a student who wants to read more. Instead of promising to finish twenty books this year, she commits to reading a single page every night. On most evenings, one page feels almost effortless. But something curious happens: the page often becomes a chapter, and the chapter becomes a habit. By the end of the month, she has read more than she did in the entire previous year.

Psychologists describe this as the compound effect of tiny behaviors. A habit is like a seed. On its own, a seed is unimpressive — easy to ignore, easy to lose. Yet planted in good soil and watered regularly, it grows into something that could not have been predicted from its size. Habits work the same way. Each small action seems negligible, but repeated over months, it shapes identity. You do not merely read; you become a reader. You do not merely exercise; you become an athlete.

The challenge, of course, is consistency. Motivation fluctuates. Some days you feel inspired; other days you can barely concentrate. The secret is to design habits that survive bad days. Lower the bar until it is almost impossible to fail. Two push-ups count. One English sentence counts. The goal on a difficult day is not performance — it is preservation of the chain.

So start smaller than feels necessary. Let the habit anchor itself first, and let ambition grow later. A river cuts through rock not because of its power, but because of its persistence.`;

function loadDemo() {
  loadArticle(DEMO_ARTICLE, 'The Power of Small Habits.md', '(示例文章)');
  toast('已载入示例文章，点击任意单词试试');
}

async function importFiles() {
  const items = await api.openFiles();
  if (!items || items.length === 0) return;
  let first = true;
  for (const item of items) {
    if (item.error) { toast(`「${item.name}」读取失败：${item.error}`); continue; }
    loadArticle(item.content, item.name, item.path);
    if (first) first = false;
  }
  if (items.length && !items.some(i => i.error)) {
    toast(items.length > 1 ? `已导入 ${items.length} 篇文章（显示最新一篇）` : `已导入「${items[0].name}」`);
  }
}

function loadArticle(text, name, path) {
  state.currentText = text;
  state.currentFile = { name, path };
  const ext = (name || '').split('.').pop().toLowerCase();
  const { html, wordCount } = renderArticle(text, ext);

  const article = $('#reader-article');
  article.innerHTML = html;
  article.classList.remove('hidden');
  $('#reader-empty').classList.add('hidden');
  $('#reader-meta').textContent = `${name} · ${wordCount} 词`;

  // 标记已收录单词
  const knownSet = new Set(state.wordbook.map(w => w.word.toLowerCase()));
  $$('.word', article).forEach(el => {
    if (knownSet.has(el.dataset.word.toLowerCase())) el.classList.add('known');
  });

  article.scrollTop = 0;
  $('#reader-body') && ($('#reader-body').scrollTop = 0);

  // 触发后台预翻译：文章导入后自动翻译生词，点词秒出
  startBackgroundTranslation(text);
}

// ============ 文章渲染 ============
function renderArticle(text, ext) {
  let html;
  if (ext === 'html' || ext === 'htm') {
    html = htmlToPlain(text);
  } else if (ext === 'md' || ext === 'markdown') {
    html = markdownToHtml(text);
  } else {
    html = plainToHtml(text);
  }
  let wordCount = 0;
  const wc = html.match(/\b[A-Za-z]+(?:['’][A-Za-z]+)?\b/g);
  if (wc) wordCount = wc.length;
  return { html, wordCount };
}

// HTML → 提取正文纯文本段落
function htmlToPlain(htmlText) {
  const div = document.createElement('div');
  div.innerHTML = htmlText;
  div.querySelectorAll('script,style,nav,header,footer,button').forEach(el => el.remove());
  const blocks = [];
  const walk = (node) => {
    if (node.nodeType === 3) {
      const t = node.textContent.trim();
      if (t) blocks.push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote'].includes(tag)) {
      const t = node.textContent.trim();
      if (t) blocks.push(t);
    } else {
      Array.from(node.childNodes).forEach(walk);
    }
  };
  Array.from(div.childNodes).forEach(walk);
  return blocks.map(p => `<p>${wrapWords(escapeHtml(p))}</p>`).join('\n');
}

// 纯文本 → 段落
function plainToHtml(text) {
  const lines = text.split(/\r?\n/);
  let html = '';
  let buf = [];
  const flush = () => { if (buf.length) { html += `<p>${wrapWords(escapeHtml(buf.join(' ')))}</p>\n`; buf = []; } };
  for (const line of lines) {
    if (line.trim() === '') { flush(); continue; }
    buf.push(line.trim());
  }
  flush();
  return html;
}

// Markdown → HTML（简化，够用）
function markdownToHtml(md) {
  const lines = md.split(/\r?\n/);
  let html = '';
  let inCode = false;
  let codeBuf = [];
  let inList = false;
  let para = [];

  const flushPara = () => {
    if (para.length) {
      html += `<p>${inline(para.join(' '))}</p>\n`;
      para = [];
    }
  };
  const closeList = () => { if (inList) { html += '</ul>\n'; inList = false; } };

  for (const raw of lines) {
    const line = raw;
    if (line.trim().startsWith('```')) {
      if (!inCode) {
        flushPara(); closeList();
        inCode = true; codeBuf = [];
      } else {
        html += `<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>\n`;
        inCode = false; codeBuf = [];
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    if (line.trim() === '') { flushPara(); closeList(); continue; }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      flushPara(); closeList();
      const lv = h[1].length;
      html += `<h${lv}>${inline(h[2])}</h${lv}>\n`;
      continue;
    }
    // 引用
    const q = line.match(/^>\s?(.*)/);
    if (q) {
      flushPara(); closeList();
      html += `<blockquote>${inline(q[1])}</blockquote>\n`;
      continue;
    }
    // 列表
    const li = line.match(/^\s*[-*+]\s+(.*)/);
    if (li) {
      flushPara();
      if (!inList) { html += '<ul>\n'; inList = true; }
      html += `<li>${inline(li[1])}</li>\n`;
      continue;
    }
    // 普通段落
    para.push(line.trim());
  }
  flushPara(); closeList();
  if (inCode) html += `<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>\n`;
  return html;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 行内格式：code / bold / italic / link —— 处理后对正文包裹单词
function inline(text) {
  const codeBlocks = [];
  // 1. 提取行内代码（占位保护，避免被单词包裹）
  let out = text.replace(/`([^`]+)`/g, (m, c) => {
    codeBlocks.push(c);
    return `\u0001${codeBlocks.length - 1}\u0002`;
  });
  // 2. 链接 [text](url) → 保留文字
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // 3. 去掉粗体/斜体标记，保留文字
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');
  out = out.replace(/\*([^*]+)\*/g, '$1');
  // 4. 转义
  out = escapeHtml(out);
  // 5. 包裹单词（占位符为控制字符+数字，不会被 [A-Za-z] 匹配）
  out = wrapWords(out);
  // 6. 还原行内代码
  out = out.replace(/\u0001(\d+)\u0002/g, (m, i) => `<code>${escapeHtml(codeBlocks[+i])}</code>`);
  return out;
}

// 单词包裹：把每个英文单词包成可点击的 span（自动保护 HTML 实体）
function wrapWords(text) {
  // 先保护 HTML 实体（&amp; 等），避免其中的字母被误包裹
  const entities = [];
  let s = text.replace(/&[a-zA-Z]+;|&#\d+;|&#x[0-9a-fA-F]+;/g, (m) => {
    entities.push(m);
    return `\u0003${entities.length - 1}\u0004`;
  });
  s = s.replace(/([A-Za-z]+(?:['’][A-Za-z]+)?)/g, (m) => {
    return `<span class="word" data-word="${m}">${m}</span>`;
  });
  s = s.replace(/\u0003(\d+)\u0004/g, (m, i) => entities[+i]);
  return s;
}

// ============ 点词 / 划词取词 ============
let lastLookupTs = 0;

function onArticleClick(e) {
  // 划词刚处理过则跳过（避免 click 紧接着重复触发）
  if (Date.now() - lastLookupTs < 350) return;
  const el = e.target.closest('.word');
  if (!el) return;
  e.stopPropagation();
  const word = el.dataset.word;
  const ctx = extractContext(el);
  const rect = el.getBoundingClientRect();
  showPopover(word, ctx, rect);
}

function onArticleMouseUp(e) {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  // 划词选中单个英文单词 → 直接取词
  if (/^[A-Za-z]+(?:['’][A-Za-z]+)?$/.test(text) && text.length > 1) {
    let rect = null;
    try {
      if (sel.rangeCount > 0) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r && r.width > 0) rect = r;
      }
    } catch {}
    const fallback = { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 };
    lastLookupTs = Date.now();
    showPopover(text, text, rect || fallback);
  }
}

function extractContext(el) {
  const block = el.closest('p,li,h1,h2,h3,h4,blockquote');
  if (!block) return wordOf(el);
  const full = block.textContent;
  const w = el.textContent;
  const idx = full.indexOf(w);
  if (idx < 0) return full.slice(0, 120);
  const start = Math.max(0, idx - 60);
  const end = Math.min(full.length, idx + w.length + 60);
  return full.slice(start, end);
}
function wordOf(el) { return el.textContent; }

// ============ 气泡 ============
let currentWord = null;
let popoverRect = null;
let currentAudio = null;

function showPopover(word, context, rect) {
  currentWord = word;
  popoverRect = rect;
  const pop = $('#popover');
  $('#pop-content').innerHTML = '';
  $('#pop-loading').classList.remove('hidden');
  pop.classList.remove('hidden');
  positionPopover(pop, rect);

  lookupWord(word, context);
}

function positionPopover(pop, rect) {
  const pw = 380;
  const ph = pop.offsetHeight || 360;   // 优先用真实高度，避免超出视口
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = rect.left + rect.width / 2 - pw / 2;
  left = Math.max(12, Math.min(left, vw - pw - 12));
  let top = rect.bottom + 10;
  if (top + ph > vh - 12) top = rect.top - ph - 10;
  top = Math.max(50, top);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

// ============ 后台预翻译（导入文章后自动翻译生词，点词秒出） ============
const bgTranslate = {
  running: false,
  total: 0,
  done: 0,
  cache: new Map()   // word(lowercase) -> { word, meaning, ... }
};

// 提取文章里所有英文单词（去重、小写）
function extractArticleWords(text) {
  const words = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  const set = new Set();
  for (const w of words) {
    const lw = w.toLowerCase();
    if (lw.length > 1) set.add(lw);
  }
  return Array.from(set);
}

// 后台预翻译：只翻译离线词典查不到的生词（常见词离线秒回，不浪费 AI）
async function startBackgroundTranslation(text) {
  const useAI = state.llm.enabled && state.llm.provider === 'openai' && state.llm.apiKey;
  bgTranslate.running = false;   // 终止上一轮
  bgTranslate.cache.clear();
  if (!useAI || !text) { renderBgProgress(); return; }

  const words = extractArticleWords(text);
  if (words.length === 0) { renderBgProgress(); return; }

  // 过滤生词（离线词典查不到的）
  const unknowns = [];
  for (const w of words) {
    const off = await api.offlineLookup(w);
    if (!off || !off.found) unknowns.push(w);
  }
  if (unknowns.length === 0) { renderBgProgress(); return; }

  bgTranslate.running = true;
  bgTranslate.total = unknowns.length;
  bgTranslate.done = 0;
  renderBgProgress();

  // 分批翻译（每次 10 词，串行，避免触发免费模型的并发限制）
  const BATCH = 10;
  for (let i = 0; i < unknowns.length && bgTranslate.running; i += BATCH) {
    const batch = unknowns.slice(i, i + BATCH);
    try {
      const res = await api.llmLookupBatch(batch, state.llm);
      if (res && res.ok && Array.isArray(res.data)) {
        for (const item of res.data) {
          if (item && item.word) bgTranslate.cache.set(String(item.word).toLowerCase(), item);
        }
      }
    } catch {}
    bgTranslate.done = Math.min(i + BATCH, unknowns.length);
    renderBgProgress();
  }
  bgTranslate.running = false;
  renderBgProgress();
}

function renderBgProgress() {
  const el = $('#bg-translate');
  if (!el) return;
  if (bgTranslate.running && bgTranslate.total > 0) {
    el.classList.remove('hidden');
    el.textContent = `后台翻译中 ${bgTranslate.done}/${bgTranslate.total}…`;
  } else {
    el.classList.add('hidden');
  }
}

// ---------- 三级数据源：离线词典（主力）→ 在线增强 → AI ----------
let popoverData = { word: null, offline: null, online: null, audioUrl: null, llm: null, llmPending: null };

async function lookupWord(word, context) {
  // 离线词典可能仍在异步加载，未就绪时短暂重试（最多约 2s）
  let offline = await api.offlineLookup(word);
  if (offline && offline.ready === false) {
    for (let i = 0; i < 20 && !offline.ready; i++) {
      await new Promise(r => setTimeout(r, 100));
      offline = await api.offlineLookup(word);
    }
  }
  const onlineP = api.dictionaryLookup(word);   // 内部已容错，失败返回 found:false
  const useCodex = state.llm.enabled && state.llm.provider === 'codex' && state.codexAvailable;
  const useOpenAI = state.llm.enabled && state.llm.provider === 'openai' && state.llm.apiKey;

  // 后台预翻译缓存命中 → 直接用缓存，秒出（不走实时请求）
  const cachedAI = bgTranslate.cache.get(word.toLowerCase());
  let llmP;
  if (cachedAI) {
    llmP = Promise.resolve({ ok: true, data: cachedAI });
  } else {
    llmP = useCodex ? api.codexLookup(word, context)
      : useOpenAI ? api.llmLookup(word, context, state.llm) : null;
  }

  // 离线秒回，先渲染主内容
  if (currentWord !== word) return;
  popoverData = { word, offline, online: null, audioUrl: null, llm: null, llmPending: llmP || null };
  renderPopover(word, offline);

  const stillOpen = () => currentWord === word && !$('#popover').classList.contains('hidden');

  // 在线 / AI 增量补渲染（气泡还开着且还是同一个词才更新）
  onlineP.then(online => { if (stillOpen()) updatePopoverOnline(word, online); });
  if (llmP) {
    llmP.then(llm => {
      popoverData.llmPending = null;            // 查询结束（无论成败）
      if (llm && llm.ok && llm.data) popoverData.llm = llm.data;
      if (stillOpen()) updatePopoverAI(word, llm);
    });
  }
}

const TAG_MAP = { cet4: 'CET-4', cet6: 'CET-6', ky: '考研', toefl: 'TOEFL', ielts: 'IELTS', gre: 'GRE' };

function tagBadges(tag) {
  return tag.split(/\s+/).filter(t => TAG_MAP[t])
    .map(t => `<span class="pop-tag">${TAG_MAP[t]}</span>`).join('');
}

function renderPopover(word, offline) {
  const cont = $('#pop-content');
  $('#pop-loading').classList.add('hidden');

  const inBook = state.wordbook.some(w => w.word.toLowerCase() === word.toLowerCase());

  let phonetic = '';
  let translationLines = [];
  let definitionEn = '';
  let tags = '';
  let lemmaNote = '';

  if (offline && offline.found && offline.data) {
    phonetic = offline.data.phonetic || '';
    translationLines = (offline.data.translation || '').split(' | ')
      .map(s => s.trim()).filter(Boolean)
      .filter(s => !s.startsWith('[网络]'));
    definitionEn = offline.data.definition || '';
    tags = tagBadges(offline.data.tag || '');
    if (offline.word && offline.word.toLowerCase() !== word.toLowerCase()) {
      lemmaNote = `<span class="pop-lemma">原形 ${escapeHtml(offline.word)}</span>`;
    }
  }

  let html = `
    <div class="pop-head">
      <div class="pop-word-wrap">
        <div class="pop-word">${escapeHtml(word)}${lemmaNote}</div>
        <div class="pop-phonetic-row">
          ${phonetic ? `<span class="pop-phonetic" id="pop-phonetic-text">${escapeHtml(phonetic)}</span>` : ''}
          <button class="pop-audio" id="pop-audio" title="朗读"><svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16 8a4 4 0 0 1 0 8"/></svg></button>
        </div>
      </div>
      <button class="pop-close" id="pop-close">✕</button>
    </div>
    <div class="pop-body">`;

  if (translationLines.length || definitionEn) {
    if (tags) html += `<div class="pop-tags">${tags}</div>`;
    if (translationLines.length) {
      html += `<div class="pop-meaning"><div class="pop-def">${translationLines.map(escapeHtml).join('<br/>')}</div></div>`;
    }
    if (definitionEn) {
      html += `<div class="pop-en-def">${escapeHtml(definitionEn)}</div>`;
    }
  } else {
    const msg = offline && !offline.ready ? '词典加载中，请稍后重试…' : '未在词典中找到该词。';
    html += `<div class="pop-def"><span class="en-def">${msg}</span></div>`;
  }

  html += `<div id="pop-online-slot"></div><div id="pop-ai-slot"></div></div>`;

  const label = inBook ? '已在单词本' : '加入单词本';
  html += `
    <div class="pop-foot">
      <button class="btn ${inBook ? 'btn-ghost' : 'btn-primary'}" id="pop-add">${inBook ? '✓ ' + label : '+ ' + label}</button>
      <button class="btn btn-ghost" id="pop-tts">🔊 朗读</button>
    </div>`;

  cont.innerHTML = html;
  // 内容填充后按真实高度重新定位，避免气泡超出视口
  if (popoverRect) positionPopover($('#popover'), popoverRect);

  $('#pop-close').addEventListener('click', hidePopover);
  $('#pop-audio').addEventListener('click', () => {
    if (popoverData.audioUrl) playAudio(popoverData.audioUrl);
    else speechTTS(word);
  });
  $('#pop-tts').addEventListener('click', () => speechTTS(word));
  $('#pop-add').addEventListener('click', async () => {
    if (inBook) { toast(`「${word}」已在单词本`); return; }
    const addBtn = $('#pop-add');
    // 若 Codex 仍在翻译，等它返回后再收录，确保单词本用 Codex 释义
    if (popoverData.llmPending) {
      if (addBtn) { addBtn.disabled = true; addBtn.textContent = '… Codex 翻译中'; }
      const res = await popoverData.llmPending;
      if (currentWord !== word) return;                 // 等待期间气泡已关闭/切词，放弃
      if (res && res.ok && res.data) popoverData.llm = res.data;
    }
    await addToWordbookFromPopover(word);
    toast(`已收录「${word}」`);
    markKnown(word);
    if (addBtn) { addBtn.disabled = false; addBtn.textContent = '✓ 已在单词本'; addBtn.className = 'btn btn-ghost'; }
  });
}

// 在线增强到位后增量更新：补音标/真人发音音频/例句（或兜底英英释义）
function updatePopoverOnline(word, onlineRes) {
  if (!onlineRes || !onlineRes.found || !Array.isArray(onlineRes.data) || !onlineRes.data[0]) return;
  popoverData.online = onlineRes;
  const d = onlineRes.data[0];

  // 补音频
  if (Array.isArray(d.phonetics)) {
    for (const p of d.phonetics) {
      if (p.audio) { popoverData.audioUrl = p.audio; break; }
    }
  }
  // 补音标（离线没有时）
  const phEl = $('#pop-phonetic-text');
  if (!phEl && d.phonetic) {
    const row = $('.pop-phonetic-row');
    if (row) row.insertAdjacentHTML('afterbegin', `<span class="pop-phonetic" id="pop-phonetic-text">${escapeHtml(d.phonetic)}</span>`);
  }

  // 例句（取第一个带 example 的义项）
  let example = '', examplePos = '';
  for (const m of (d.meanings || [])) {
    for (const def of (m.definitions || [])) {
      if (def.example) { example = def.example; examplePos = m.partOfSpeech || ''; break; }
    }
    if (example) break;
  }

  const slot = $('#pop-online-slot');
  if (!slot) return;
  let html = '';
  if (example) {
    html += `<div class="pop-example"><div class="en">${escapeHtml(example)}</div></div>`;
  }
  // 离线完全没查到时，用在线英英释义兜底
  if (popoverData.offline && !popoverData.offline.found && Array.isArray(d.meanings)) {
    for (const m of d.meanings.slice(0, 2)) {
      html += `<span class="pop-pos">${escapeHtml(m.partOfSpeech || '')}</span>`;
      for (const def of (m.definitions || []).slice(0, 2)) {
        html += `<div class="pop-def">${escapeHtml(def.definition || '')}</div>`;
      }
    }
  }
  if (html) slot.innerHTML = html;
}

// AI 释义增量更新
function updatePopoverAI(word, llm) {
  const slot = $('#pop-ai-slot');
  if (!slot) return;
  if (llm && llm.ok && llm.data) {
    popoverData.llm = llm.data;
    const a = llm.data;
    let html = `<div class="pop-ai"><div class="pop-ai-label">✦ ${state.llm.provider === 'codex' ? 'Codex 释义' : 'AI 释义'}</div>`;
    if (a.meaning) html += `<div class="pop-def">${escapeHtml(a.meaning)}</div>`;
    if (a.example) {
      html += `<div class="pop-example"><div class="en">${escapeHtml(a.example)}</div>`;
      html += a.example_cn ? `<div class="cn">${escapeHtml(a.example_cn)}</div></div>` : `</div>`;
    }
    if (a.tip) html += `<div class="pop-tip">💡 ${escapeHtml(a.tip)}</div>`;
    html += `</div>`;
    slot.innerHTML = html;
  } else if (llm && !llm.ok && state.llm.enabled) {
    slot.innerHTML = `<div class="pop-ai"><div class="pop-ai-label">✦ ${state.llm.provider === 'codex' ? 'Codex 释义' : 'AI 释义'}</div><div class="pop-ai-error">${escapeHtml(llm.error)}</div></div>`;
  }
}

function markKnown(word) {
  $$('#reader-article .word').forEach(el => {
    if (el.dataset.word.toLowerCase() === word.toLowerCase()) el.classList.add('known');
  });
}

function hidePopover() {
  $('#popover').classList.add('hidden');
  stopAudio();
  currentWord = null;
}

function stopAudio() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

function playAudio(url) {
  if (!url) return;
  stopAudio();
  let u = url;
  if (u.startsWith('//')) u = 'https:' + u;
  const a = new Audio(u);
  currentAudio = a;
  a.play().catch(() => toast('音频播放失败'));
}

function speechTTS(word) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }
}

// 点击外部关闭气泡
document.addEventListener('click', (e) => {
  const pop = $('#popover');
  if (pop && !pop.classList.contains('hidden') && !pop.contains(e.target) && !e.target.closest('.word')) {
    hidePopover();
  }
});
// Esc 关闭气泡
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hidePopover();
});
window.addEventListener('resize', () => {
  const pop = $('#popover');
  if (pop && !pop.classList.contains('hidden') && popoverRect) positionPopover(pop, popoverRect);
});

// ============ 单词本 ============
async function addToWordbookFromPopover(word) {
  const off = popoverData.offline;
  const on = popoverData.online;

  // 若 Codex/AI 释义仍在查询，等它返回（用户要求：单词本以 Codex 翻译为准）
  let llmData = popoverData.llm || null;
  if (!llmData && popoverData.llmPending) {
    const res = await popoverData.llmPending;
    if (res && res.ok && res.data) {
      llmData = res.data;
      popoverData.llm = res.data;
    }
  }

  // 释义优先级：Codex/AI > 离线词典（没有 Codex 或 Codex 失败时回退离线）
  let phonetic = '';
  let meaning = '';
  let example = '';

  if (llmData) {
    phonetic = llmData.phonetic || '';
    meaning = llmData.meaning || '';
    example = llmData.example || '';
  }

  // 离线兜底
  if (!meaning && off && off.found && off.data.translation) {
    meaning = off.data.translation.split(' | ')
      .map(s => s.trim()).filter(Boolean)
      .filter(s => !s.startsWith('[网络]'))
      .join('；');
  }
  if (!phonetic && off && off.found && off.data.phonetic) phonetic = off.data.phonetic;

  // 例句兜底（在线词典）
  if (!example && on && on.found && Array.isArray(on.data) && on.data[0]) {
    const d = on.data[0];
    if (!phonetic && d.phonetic) phonetic = d.phonetic;
    outer:
    for (const m of (d.meanings || [])) {
      for (const def of (m.definitions || [])) {
        if (def.example) { example = def.example; break outer; }
      }
    }
  }

  // 从释义首行提取词性（"n. 通路…" → "n."）
  let pos = '';
  const pm = meaning.match(/^\s*(n|v|vt|vi|adj|adv|prep|conj|pron|art|num|aux|int|abbr)\./i);
  if (pm) pos = pm[1].toLowerCase() + '.';

  const entry = {
    word,
    phonetic,
    pos,
    meaning,
    example,
    source: state.currentFile ? state.currentFile.name : '',
    starred: false,
    addedAt: Date.now()
  };
  state.wordbook.unshift(entry);
  saveWordbook();
}

function bindWordbook() {
  $('#wb-search').addEventListener('input', (e) => {
    state.search = e.target.value.trim().toLowerCase();
    renderWordbook();
  });
  $$('#wb-filter .seg-item').forEach(b => {
    b.addEventListener('click', () => {
      $$('#wb-filter .seg-item').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.filter = b.dataset.f;
      renderWordbook();
    });
  });
  $('#btn-export').addEventListener('click', exportWordbook);
  $('#btn-clear').addEventListener('click', clearWordbook);
}

function renderWordbook() {
  const list = $('#wb-list');
  const empty = $('#wb-empty');
  let items = state.wordbook.slice();
  if (state.filter === 'starred') items = items.filter(w => w.starred);
  if (state.search) {
    items = items.filter(w => (w.word + ' ' + w.meaning).toLowerCase().includes(state.search));
  }

  $('#wb-sub').textContent = `共 ${state.wordbook.length} 词${state.filter === 'starred' ? ' · 已收藏' : ''}`;

  if (items.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = items.map((w, i) => {
    const origIdx = state.wordbook.indexOf(w);
    return `
    <div class="wb-card" data-idx="${origIdx}">
      <button class="wb-star ${w.starred ? 'on' : ''}" data-act="star" data-word="${escapeHtml(w.word)}" title="收藏">
        <svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.8l-5.4 3 1-6.1L3.2 9.5l6.1-.9L12 3Z"/></svg>
      </button>
      <div class="wb-word-wrap">
        <div class="wb-word-head">
          <span class="wb-word">${escapeHtml(w.word)}</span>
          ${w.phonetic ? `<span class="wb-phonetic">${escapeHtml(w.phonetic)}</span>` : ''}
          ${w.pos ? `<span class="wb-pos">${escapeHtml(w.pos)}</span>` : ''}
        </div>
        <div class="wb-meaning">${escapeHtml(w.meaning || '')}</div>
        ${w.example ? `<div class="wb-example">${escapeHtml(w.example)}</div>` : ''}
        <div class="wb-meta">
          ${w.source ? `<span>来源：${escapeHtml(w.source)}</span>` : ''}
          <span>${fmtDate(w.addedAt)}</span>
        </div>
      </div>
      <div class="wb-actions-col">
        <button class="wb-icon-btn" data-act="tts" data-word="${escapeHtml(w.word)}" title="朗读">
          <svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16 8a4 4 0 0 1 0 8"/></svg>
        </button>
        <button class="wb-icon-btn del" data-act="del" data-word="${escapeHtml(w.word)}" title="删除">
          <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.8 12a2 2 0 0 1-2 1.9H8.8a2 2 0 0 1-2-1.9L6 7"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  // 事件委托
  list.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      const word = btn.dataset.word;
      if (act === 'star') toggleStar(word);
      else if (act === 'del') removeWord(word);
      else if (act === 'tts') speechTTS(word);
    });
  });
}

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toggleStar(word) {
  const w = state.wordbook.find(x => x.word.toLowerCase() === word.toLowerCase());
  if (w) { w.starred = !w.starred; saveWordbook(); renderWordbook(); }
}

function removeWord(word) {
  state.wordbook = state.wordbook.filter(x => x.word.toLowerCase() !== word.toLowerCase());
  saveWordbook();
  renderWordbook();
  // 同步文章高亮
  $$('#reader-article .word').forEach(el => {
    if (el.dataset.word.toLowerCase() === word.toLowerCase()) el.classList.remove('known');
  });
  toast(`已删除「${word}」`);
}

async function clearWordbook() {
  if (state.wordbook.length === 0) { toast('单词本已为空'); return; }
  const ok = await confirmDialog('清空单词本？', '将删除全部已收录单词，此操作不可撤销。');
  if (!ok) return;
  state.wordbook = [];
  saveWordbook();
  renderWordbook();
  $$('#reader-article .word').forEach(el => el.classList.remove('known'));
  toast('已清空单词本');
}

// ============ 导出 ============
async function exportWordbook() {
  if (state.wordbook.length === 0) { toast('单词本为空，先收录几个词吧'); return; }
  const format = await chooseFormat();
  if (!format) return;
  let content = '';
  const name = '我的单词本';
  if (format === 'markdown') content = toMarkdown();
  else if (format === 'json') content = JSON.stringify(state.wordbook, null, 2);
  else if (format === 'csv') content = toCsv();

  const res = await api.exportWordbook({ content, format, defaultName: name });
  if (res.ok) toast(`已导出到：${res.path}`);
  else if (!res.canceled) toast('导出失败');
}

function toMarkdown() {
  let out = `# 我的单词本\n\n> 由「词镜 WordLens」生成 · 共 ${state.wordbook.length} 词 · ${new Date().toLocaleDateString('zh-CN')}\n\n`;
  out += `| 单词 | 音标 | 词性 | 释义 | 例句 |\n| --- | --- | --- | --- | --- |\n`;
  for (const w of state.wordbook) {
    out += `| ${w.word} | ${w.phonetic || ''} | ${w.pos || ''} | ${(w.meaning || '').replace(/\|/g, '、')} | ${(w.example || '').replace(/\|/g, '、')} |\n`;
  }
  return out;
}

function toCsv() {
  const esc = s => '"' + String(s || '').replace(/"/g, '""') + '"';
  let out = 'word,phonetic,pos,meaning,example\n';
  for (const w of state.wordbook) {
    out += [esc(w.word), esc(w.phonetic), esc(w.pos), esc(w.meaning), esc(w.example)].join(',') + '\n';
  }
  return out;
}

function chooseFormat() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-mask';
    overlay.innerHTML = `
      <div class="modal" style="width:380px">
        <div class="modal-head"><h3>导出格式</h3></div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:8px">
          <button class="modal-item" data-f="markdown"><span class="modal-item-info"><span class="modal-item-name">Markdown</span></span></button>
          <button class="modal-item" data-f="json"><span class="modal-item-info"><span class="modal-item-name">JSON</span></span></button>
          <button class="modal-item" data-f="csv"><span class="modal-item-info"><span class="modal-item-name">CSV（Excel 可打开）</span></span></button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (f) => { overlay.remove(); resolve(f); };
    overlay.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => done(b.dataset.f)));
    overlay.addEventListener('click', e => { if (e.target === overlay) done(null); });
  });
}

function confirmDialog(title, desc) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-mask';
    overlay.innerHTML = `
      <div class="modal" style="width:360px">
        <div class="modal-head"><h3>${escapeHtml(title)}</h3></div>
        <div class="modal-body"><p style="font-size:13px;color:var(--text-2)">${escapeHtml(desc)}</p>
          <div style="display:flex;gap:8px;margin-top:18px">
            <button class="btn btn-ghost" id="c-cancel" style="flex:1;justify-content:center">取消</button>
            <button class="btn btn-primary" id="c-ok" style="flex:1;justify-content:center;background:var(--red)">确认清空</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    $('#c-cancel', overlay).addEventListener('click', () => { overlay.remove(); resolve(false); });
    $('#c-ok', overlay).addEventListener('click', () => { overlay.remove(); resolve(true); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
  });
}

// ============ 设置 ============
function bindSettings() {
  $('#theme-seg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-item');
    if (!b) return;
    state.theme = b.dataset.theme;
    $$('#theme-seg .seg-item').forEach(x => x.classList.toggle('active', x === b));
    applyTheme(state.theme);
    saveConfig();
  });
  $('#ai-provider-seg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-item');
    if (!b) return;
    state.llm.provider = b.dataset.p;
    $$('#ai-provider-seg .seg-item').forEach(x => x.classList.toggle('active', x === b));
    updateProviderUI(state.llm.provider);
    saveConfig();
  });
  // Codex CLI 检测状态
  refreshCodexStatus();
  ['llm-enabled', 'llm-base', 'llm-model', 'llm-key', 'codex-dir'].forEach(id => {
    $('#' + id).addEventListener('change', saveConfig);
  });
  $('#btn-browse-codex').addEventListener('click', async () => {
    // 通过 Codex 扫描弹层间接选择目录（用默认目录扫描）
    openCodexModal();
  });
}

// 数据源切换 → 显示/隐藏 OpenAI 配置项，切换提示文案
function updateProviderUI(provider) {
  const isCodex = provider === 'codex';
  ['llm-base-field', 'llm-model-field', 'llm-key-field'].forEach(id => {
    const el = $('#' + id);
    if (el) el.classList.toggle('hidden', isCodex);
  });
  const desc = $('#ai-enable-desc');
  if (desc) desc.textContent = isCodex ? '使用本机 Codex CLI，无需 API Key' : '需要 OpenAI 兼容接口的 API Key';
  // 仅 Codex 模式显示 Codex 检测状态，避免 OpenAI 模式下误导（否则一直显示"释义将由 Codex 提供"）
  const cs = $('#codex-status');
  if (cs) cs.classList.toggle('hidden', !isCodex);
  if (isCodex) refreshCodexStatus();
}

async function refreshCodexStatus() {
  const el = $('#codex-status');
  if (!el) return;
  // 非 Codex 模式不显示检测状态（OpenAI/GLM 模式下用不到，且会误导）
  if (state.llm.provider !== 'codex') { el.classList.add('hidden'); return; }
  try {
    const st = await api.codexStatus();
    state.codexAvailable = !!st.available;
    if (st.available) {
      // 有 Codex → 自动启用 Codex 释义（除非用户已手动关闭）
      if (state.llm.provider === 'codex' && !state.llm.enabled) {
        state.llm.enabled = true;
        const ck = $('#llm-enabled');
        if (ck) ck.checked = true;
        saveConfig();
      }
      el.textContent = `✓ 已检测到本机 Codex CLI（v${st.version}），单词释义将由 Codex 提供`;
      el.className = 'codex-status ok';
    } else {
      el.textContent = '✗ 未检测到本机 Codex CLI，将使用内置离线词典';
      el.className = 'codex-status bad';
    }
  } catch {
    state.codexAvailable = false;
    el.textContent = 'Codex CLI 状态检测失败';
    el.className = 'codex-status bad';
  }
  el.classList.remove('hidden');
}

// ============ 拖拽导入 ============
function bindDragDrop() {
  const overlay = $('#drop-overlay');
  const TEXT_EXTS = ['txt', 'md', 'markdown', 'html', 'htm', 'json', 'csv'];
  let dragDepth = 0;

  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    overlay.classList.remove('hidden');
  });

  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
  });

  window.addEventListener('dragleave', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepth--;
    if (dragDepth <= 0) { dragDepth = 0; overlay.classList.add('hidden'); }
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.add('hidden');
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;

    let loaded = 0, skipped = 0;
    for (const f of files) {
      const ext = (f.name || '').split('.').pop().toLowerCase();
      if (!TEXT_EXTS.includes(ext)) { skipped++; continue; }
      const p = api.getPathForFile(f);
      if (!p) { skipped++; continue; }
      try {
        const text = await api.readFile(p);
        loadArticle(text, f.name, p);
        loaded++;
      } catch { skipped++; }
    }
    if (loaded > 0) {
      toast(`已导入 ${loaded} 篇${skipped ? `，跳过 ${skipped} 个非文本文件` : ''}`);
    } else if (skipped > 0) {
      toast('未导入：请拖入 .txt / .md / .html 等文本文件');
    }
  });
}

// ============ Codex 文章自动同步 ============
function bindCodexSync() {
  if (api.onCodexNewFiles) {
    api.onCodexNewFiles((files) => {
      if (!Array.isArray(files) || files.length === 0) return;
      // 去重后追加
      const known = new Set(state.codexNew.map(f => f.path));
      for (const f of files) {
        if (!known.has(f.path)) { state.codexNew.push(f); known.add(f.path); }
      }
      renderCodexSync();
      toast(`Codex 新文章：${files[0].name}${files.length > 1 ? ` 等 ${files.length} 篇` : ''}`);
    });
  }
  $('#codex-sync').addEventListener('click', async (e) => {
    const item = e.target.closest('.codex-sync-item');
    if (item) {
      const p = item.dataset.path;
      try {
        const text = await api.readFile(p);
        loadArticle(text, p.split(/[\\/]/).pop(), p);
        state.codexNew = state.codexNew.filter(f => f.path !== p);
        renderCodexSync();
      } catch { toast('文章读取失败'); }
      return;
    }
    if (e.target.closest('#codex-sync-clear')) {
      state.codexNew = [];
      renderCodexSync();
    }
  });
}

function renderCodexSync() {
  const bar = $('#codex-sync');
  if (!bar) return;
  if (state.codexNew.length === 0) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  const show = state.codexNew.slice(-3);
  bar.innerHTML = `
    <div class="codex-sync-list">
      ${show.map(f => `
        <button class="codex-sync-item" data-path="${escapeHtml(f.path)}" title="点击阅读">
          <span class="sync-dot"></span>
          <span class="sync-name">${escapeHtml(f.name)}</span>
          <span class="sync-act">阅读</span>
        </button>`).join('')}
      ${state.codexNew.length > 3 ? `<span class="sync-more">还有 ${state.codexNew.length - 3} 篇</span>` : ''}
    </div>
    <button class="codex-sync-dismiss" id="codex-sync-clear">忽略</button>`;
}

// ============ Codex 导入弹层 ============
async function openCodexModal() {
  const modal = $('#codex-modal');
  const list = $('#codex-modal-list');
  const empty = $('#codex-modal-empty');
  const pathEl = $('#codex-modal-path');
  modal.classList.remove('hidden');
  list.innerHTML = '';
  empty.classList.add('hidden');
  pathEl.textContent = '扫描中…';

  const dir = state.codexDir || await api.defaultCodexDir();
  const res = await api.scanCodex(dir);
  pathEl.textContent = `${res.dir}（${res.exists ? '已找到' : '不存在'}）`;

  if (!res.exists || res.files.length === 0) {
    empty.classList.remove('hidden');
    if (!res.exists) empty.textContent = '目录不存在，请在设置中填写正确的 Codex 目录路径。';
    else empty.textContent = '该目录下没有找到可导入的文本文件。';
    return;
  }

  // 显示前 100 个
  res.files.slice(0, 100).forEach(f => {
    const div = document.createElement('div');
    div.className = 'modal-item';
    div.innerHTML = `
      <span class="modal-item-icon"><svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/></svg></span>
      <span class="modal-item-info">
        <span class="modal-item-name">${escapeHtml(f.name)}</span>
        <span class="modal-item-meta">${fmtSize(f.size)} · ${fmtDate(f.mtime)}</span>
      </span>`;
    div.addEventListener('click', async () => {
      const text = await api.readFile(f.path);
      closeCodexModal();
      loadArticle(text, f.name, f.path);
      toast(`已导入「${f.name}」`);
    });
    list.appendChild(div);
  });
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function closeCodexModal() {
  $('#codex-modal').classList.add('hidden');
}

// ============ Toast ============
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

// 启动
document.addEventListener('DOMContentLoaded', init);
