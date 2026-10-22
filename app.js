/* ===== 抽卡写小说 · 核心逻辑 ===== */
'use strict';

const DB_KEY = 'novel.app.v1';      /* 单书版本用的 key，迁移后保留 */
const SHELF_KEY = 'novel.shelf.v2';  /* 书架版 */

/* ============================================================
   数据结构
   - shelf: { settings, books: [{id, title, createdAt, updatedAt, data}] }
   - data : 单本书的全部内容
   db 始终指向「当前打开那本书」的 data，其余代码不用改
   ============================================================ */

let shelf = null;       // 书架
let db = null;          // 当前书的 data（引用 shelf.books[i].data）
let currentBookId = null;

function defaultBookData() {
  return {
    chapters: [],
    stateFile: '',
    cards: [],
    draft: '',
    lastChapterId: null,
    characters: [],
    worldEntries: [],
    ctx: {
      style: true,
      state: true,
      editor: true,
      summaryIds: [],
      fullIds: [],
      charIds: [],
      worldIds: []
    }
  };
}

function defaultSettings() {
  return {
    base: 'https://api.deepseek.com/v1',
    key: '',
    model: 'deepseek-chat',
    temperature: 1.0,
    stylePrompt: (typeof DEFAULT_STYLE_PROMPT !== 'undefined' ? DEFAULT_STYLE_PROMPT : ''),
    summaryPrompt: '',      // 空 = 用内置默认
    statePromptBody: ''     // 空 = 用内置默认
  };
}

function defaultShelf() {
  return { settings: defaultSettings(), books: [], currentBookId: null };
}

/* 旧的单书结构 → 书架结构 */
function migrateLegacy(legacy) {
  const data = defaultBookData();
  data.chapters = legacy.chapters || [];
  data.stateFile = legacy.stateFile || '';
  data.cards = legacy.cards || [];
  data.lastChapterId = legacy.lastChapterId || null;
  data.characters = legacy.characters || [];
  data.worldEntries = legacy.worldEntries || [];
  data.ctx = Object.assign(defaultBookData().ctx, legacy.ctx || {});

  const book = {
    id: uid(),
    title: '我的书',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data
  };

  return {
    settings: Object.assign(defaultSettings(), legacy.settings || {}),
    books: [book],
    currentBookId: book.id
  };
}

function loadShelf() {
  try {
    const raw = localStorage.getItem(SHELF_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      shelf = Object.assign(defaultShelf(), parsed);
      shelf.settings = Object.assign(defaultSettings(), parsed.settings || {});
      shelf.books = (parsed.books || []).map(b => ({
        id: b.id,
        title: b.title || '未命名',
        createdAt: b.createdAt || Date.now(),
        updatedAt: b.updatedAt || Date.now(),
        data: Object.assign(defaultBookData(), b.data || {})
      }));
      // 补齐每本书的 ctx
      shelf.books.forEach(b => {
        b.data.ctx = Object.assign(defaultBookData().ctx, b.data.ctx || {});
      });
    } else {
      // 尝试从旧结构迁移
      const legacyRaw = localStorage.getItem(DB_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        shelf = migrateLegacy(legacy);
        saveShelf();
        // 保留旧数据，改名留一份，防止迁移出错
        localStorage.setItem('novel.app.v1.backup', legacyRaw);
        localStorage.removeItem(DB_KEY);
      } else {
        shelf = defaultShelf();
      }
    }
  } catch (e) {
    shelf = defaultShelf();
  }

  // 没有书就建一本
  if (!shelf.books.length) {
    const book = {
      id: uid(), title: '我的书',
      createdAt: Date.now(), updatedAt: Date.now(),
      data: defaultBookData()
    };
    shelf.books.push(book);
    shelf.currentBookId = book.id;
    saveShelf();
  }

  // 确定当前书
  let cur = shelf.books.find(b => b.id === shelf.currentBookId);
  if (!cur) {
    cur = shelf.books[0];
    shelf.currentBookId = cur.id;
  }
  currentBookId = cur.id;
  db = cur.data;
}

function saveShelf() {
  try {
    localStorage.setItem(SHELF_KEY, JSON.stringify(shelf));
  } catch (e) {
    toast('保存失败，本地空间可能已满');
  }
}

/* 兼容旧代码：saveDB 保存整个书架 */
function saveDB() {
  const cur = shelf.books.find(b => b.id === currentBookId);
  if (cur) {
    cur.data = db;
    cur.updatedAt = Date.now();
  }
  saveShelf();
}

/* ---------- 设置（全局，不属于任何一本书） ---------- */
function getSettings() {
  return shelf ? shelf.settings : defaultSettings();
}

/* ---------- 工具 ---------- */
const $ = id => document.getElementById(id);

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2000);
}

function countWords(s) {
  return (s || '').replace(/\s/g, '').length;
}

function currentChapter() {
  return db.chapters.find(c => c.id === currentChapterId) || null;
}

let currentChapterId = null;

/* ===== 面板动画（JS 驱动，兼容 WebKit） ===== */
let mRaf = null, mTimer = null, mFallback = null;

function cancelModalAnim() {
  if (mRaf) { cancelAnimationFrame(mRaf); mRaf = null; }
  if (mTimer) { clearTimeout(mTimer); mTimer = null; }
  if (mFallback) { clearTimeout(mFallback); mFallback = null; }
}

function panModal(el, toOpen, done) {
  cancelModalAnim();
  const DUR = 240;
  const start = toOpen ? window.innerHeight : 0;
  const end = toOpen ? 0 : window.innerHeight;
  const t0 = performance.now();

  if (toOpen) { el.style.visibility = 'visible'; el.classList.add('on'); }

  const ease = t => 1 - Math.pow(1 - t, 3);
  let done_ = false;

  function finish() {
    if (done_) return;
    done_ = true;
    cancelModalAnim();
    if (toOpen) {
      el.style.transform = '';
    } else {
      el.classList.remove('on');
      el.style.transform = '';
      el.style.visibility = '';
      if (done) done();
    }
  }

  function step() {
    if (done_) return;
    const p = Math.min(1, (performance.now() - t0) / DUR);
    const y = start + (end - start) * ease(p);
    el.style.transform = `translateY(${y}px)`;
    if (p >= 1) { finish(); return; }
    mRaf = requestAnimationFrame(step);
    mTimer = setTimeout(step, 16);
  }
  step();
  mFallback = setTimeout(finish, DUR + 140);
}

const MODALS = ['modalSummary', 'modalState', 'modalSettings', 'modalContext', 'modalChapterInfo', 'modalConfirm', 'modalCast', 'modalCharEdit', 'modalWorldEdit', 'modalExtractPick', 'modalExtractReview', 'modalPickTarget', 'modalHistory', 'modalShelf', 'modalBookEdit', 'modalPrompts', 'modalDraft'];
let openModalId = null;

function openModal(id) {
  MODALS.forEach(m => {
    if (m !== id) {
      const el = $(m);
      el.classList.remove('on');
      el.style.transform = '';
      el.style.visibility = '';
    }
  });
  openModalId = id;
  const mask = $('modalMask');
  mask.style.display = 'block';
  mask.getBoundingClientRect();
  mask.classList.add('on');

  const el = $(id);
  el.scrollTop = 0;
  el.style.transform = 'translateY(1100px)';
  el.style.visibility = 'hidden';
  el.getBoundingClientRect();
  panModal(el, true);
}

function closeModal() {
  openModalId = null;
  const mask = $('modalMask');
  mask.classList.remove('on');
  setTimeout(() => {
    if (!openModalId) mask.style.display = 'none';
  }, 220);
  MODALS.forEach(id => {
    const el = $(id);
    if (el.classList.contains('on')) panModal(el, false);
  });
}

/* ===== 左侧：章节与编辑 ===== */
function renderChapterList() {
  const list = $('chapterList');
  list.innerHTML = '';

  if (!db.chapters.length) {
    list.innerHTML = '<div class="ctx-empty">还没有章节<br>点右上「＋ 新建」或「导入」</div>';
    return;
  }

  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);
  for (const c of sorted) {
    const el = document.createElement('div');
    el.className = 'chapter-item' + (c.id === currentChapterId ? ' on' : '');
    const sumMark = c.summary ? ' · 有摘要' : '';

    const noSpan = document.createElement('span');
    noSpan.className = 'ch-no';
    noSpan.textContent = String(c.no).padStart(2, '0');

    const titleSpan = document.createElement('span');
    titleSpan.className = 'ch-title';
    titleSpan.textContent = c.title || '未命名';
    titleSpan.addEventListener('click', e => {
      e.stopPropagation();
      openChapterInfo(c.id);
    });

    const metaSpan = document.createElement('span');
    metaSpan.className = 'ch-meta';
    metaSpan.textContent = countWords(c.body) + '字' + sumMark;

    const editSpan = document.createElement('span');
    editSpan.className = 'ch-edit';
    editSpan.textContent = '✎';
    editSpan.addEventListener('click', e => {
      e.stopPropagation();
      openChapterInfo(c.id);
    });

    const delSpan = document.createElement('span');
    delSpan.className = 'ch-del';
    delSpan.textContent = '×';
    delSpan.addEventListener('click', e => {
      e.stopPropagation();
      removeChapter(c.id);
    });

    el.appendChild(noSpan);
    el.appendChild(titleSpan);
    el.appendChild(metaSpan);
    el.appendChild(editSpan);
    el.appendChild(delSpan);

    el.addEventListener('click', () => {
      selectChapter(c.id);
      closeDrawer();
    });
    list.appendChild(el);
  }
}

/* ===== 重新编号 ===== */
async function renumberChapters() {
  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);
  if (!sorted.length) { toast('没有章节'); return; }
  const ok = await askConfirm(
    '按顺序重新编号？',
    `当前 ${sorted.length} 章会按现有顺序改成 1 到 ${sorted.length}。如果某章摘要或状态文件里提到旧章号，需要你自己核对。`,
    '重新编号'
  );
  if (!ok) return;
  sorted.forEach((c, i) => { c.no = i + 1; c.updatedAt = Date.now(); });
  db.chapters = sorted;
  saveDB();
  renderChapterList();
  renderCtxLists();
  const cur = currentChapter();
  if (cur) $('chapterTitle').textContent = `第${cur.no}章 · ${cur.title || '未命名'}`;
  toast('已重新编号');
}

/* ===== 章节信息编辑 ===== */
let editingChapterId = null;

function openChapterInfo(id) {
  const c = db.chapters.find(x => x.id === id);
  if (!c) return;
  editingChapterId = id;
  $('chapterInfoTitle').textContent = '章节信息';
  $('chNo').value = c.no;
  $('chName').value = c.title || '';
  openModal('modalChapterInfo');
  setTimeout(() => $('chName').focus(), 320);
}

function saveChapterInfo() {
  const c = db.chapters.find(x => x.id === editingChapterId);
  if (!c) return;

  const no = parseInt($('chNo').value, 10);
  if (!(no > 0)) { toast('章号要大于 0'); return; }

  const dup = db.chapters.find(x => x.id !== c.id && x.no === no);
  if (dup) { toast(`第${no}章已存在`); return; }

  c.no = no;
  c.title = $('chName').value.trim() || '未命名';
  c.updatedAt = Date.now();

  // 正文有改动而摘要未更新时提示
  db.chapters.sort((a, b) => a.no - b.no);
  saveDB();
  renderChapterList();
  renderCtxLists();
  if (currentChapterId === c.id) {
    $('chapterTitle').textContent = `第${c.no}章 · ${c.title}`;
    $('chapterTitle').classList.add('editable');
  }
  closeModal();
  toast('已保存');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function selectChapter(id) {
  flushEditor();
  currentChapterId = id;
  db.lastChapterId = id;
  saveDB();
  const c = currentChapter();
  $('chapterTitle').textContent = c ? `第${c.no}章 · ${c.title || '未命名'}` : '未选择章节';
  $('chapterTitle').classList.toggle('editable', !!c);
  $('editor').value = c ? c.body : '';
  updateWordCount();
  updateStaleBadge();
  renderChapterList();
  renderCtxChips();
}

let editorSaveTimer = null;

function flushEditor() {
  if (!currentChapterId) return;
  const c = currentChapter();
  if (!c) return;
  const v = $('editor').value;
  if (c.body !== v) {
    c.body = v;
    c.updatedAt = Date.now();
    saveDB();
    renderChapterList();
    updateStaleBadge();
  }
}

/* 摘要是否可能过期：有摘要，且正文改过之后摘要没重新生成 */
function isSummaryStale(c) {
  if (!c || !c.summary || !c.summary.trim()) return false;
  if (!c.summaryAt) return false;
  return (c.updatedAt || 0) > c.summaryAt + 3000;
}

function updateStaleBadge() {
  const c = currentChapter();
  const badge = $('staleBadge');
  if (!badge) return;
  if (isSummaryStale(c)) {
    badge.hidden = false;
    badge.textContent = '正文已改动，摘要可能过期';
  } else {
    badge.hidden = true;
  }
}

function updateWordCount() {
  $('wordCount').textContent = countWords($('editor').value) + ' 字';
}

function newChapter() {
  flushEditor();
  const maxNo = db.chapters.reduce((m, c) => Math.max(m, c.no), 0);
  const ch = {
    id: uid(),
    no: maxNo + 1,
    title: '未命名',
    body: '',
    summary: '',
    updatedAt: Date.now()
  };
  db.chapters.push(ch);
  saveDB();
  selectChapter(ch.id);
  closeDrawer();
  // 直接弹出命名，方便起名
  openChapterInfo(ch.id);
}

async function removeChapter(id) {
  const c = db.chapters.find(x => x.id === id);
  if (!c) return;

  const words = countWords(c.body);
  const hasSum = c.summary && c.summary.trim();
  const desc = `第${c.no}章「${c.title || '未命名'}」的正文（${words}字）` +
    (hasSum ? '和摘要' : '') + '会被一起删除，无法恢复。';

  const ok = await askConfirm('删除这一章？', desc, '删除');
  if (!ok) return;

  db.chapters = db.chapters.filter(x => x.id !== id);
  db.ctx.summaryIds = db.ctx.summaryIds.filter(x => x !== id);
  db.ctx.fullIds = db.ctx.fullIds.filter(x => x !== id);
  if (currentChapterId === id) {
    currentChapterId = null;
    $('editor').value = '';
    $('chapterTitle').textContent = '未选择章节';
    $('chapterTitle').classList.remove('editable');
    updateWordCount();
  }
  saveDB();
  renderChapterList();
  renderCtxChips();
  toast('已删除');
}

/* ===== 抽屉 ===== */
function openDrawer() {
  $('overlay').classList.add('on');
  $('drawerShelf').classList.add('on');
  renderChapterList();
}
function closeDrawer() {
  $('overlay').classList.remove('on');
  $('drawerShelf').classList.remove('on');
}

/* ===== 上下文 chips ===== */
function renderCtxChips() {
  const box = $('ctxChips');
  box.innerHTML = '';

  const items = [
    { k: 'style', label: '文风' },
    { k: 'state', label: '状态文件' },
    { k: 'editor', label: '当前正文' }
  ];

  for (const it of items) {
    const el = document.createElement('span');
    el.className = 'chip ' + (db.ctx[it.k] ? 'on' : 'off');
    el.textContent = it.label;
    box.appendChild(el);
  }

  if (db.ctx.charIds && db.ctx.charIds.length) {
    const el = document.createElement('span');
    el.className = 'chip on';
    el.textContent = `人设 ×${db.ctx.charIds.length}`;
    box.appendChild(el);
  }
  if (db.ctx.worldIds && db.ctx.worldIds.length) {
    const el = document.createElement('span');
    el.className = 'chip on';
    el.textContent = `世界观 ×${db.ctx.worldIds.length}`;
    box.appendChild(el);
  }

  if (db.ctx.summaryIds.length) {
    const el = document.createElement('span');
    el.className = 'chip on';
    el.textContent = `摘要 ×${db.ctx.summaryIds.length}`;
    box.appendChild(el);
  }
  if (db.ctx.fullIds.length) {
    const el = document.createElement('span');
    el.className = 'chip on';
    el.textContent = `全文 ×${db.ctx.fullIds.length}`;
    box.appendChild(el);
  }

  updateCtxSize();
}

/* ===== 上下文总字数 =====
   比 buildContext() 更细，分别统计每一块，页面显示一个总量 */
function calcCtxSize() {
  const parts = [];

  if (db.ctx.style && getSettings().stylePrompt.trim()) {
    parts.push(getSettings().stylePrompt.trim());
  }
  if (db.ctx.state && db.stateFile.trim()) {
    parts.push('【故事状态文件】\n' + db.stateFile.trim());
  }
  if (db.ctx.charIds && db.ctx.charIds.length) {
    const chars = db.characters.filter(c => db.ctx.charIds.includes(c.id));
    if (chars.length) {
      parts.push(chars.map(c =>
        `—— ${c.name}${c.role ? '（' + c.role + '）' : ''} ——\n${(c.body || '').trim()}`
      ).join('\n\n'));
    }
  }
  if (db.ctx.worldIds && db.ctx.worldIds.length) {
    const we = db.worldEntries.filter(w => db.ctx.worldIds.includes(w.id));
    if (we.length) {
      parts.push(we.map(w => `—— ${w.title} ——\n${(w.body || '').trim()}`).join('\n\n'));
    }
  }
  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);
  if (db.ctx.summaryIds.length) {
    const sums = sorted
      .filter(c => db.ctx.summaryIds.includes(c.id) && c.summary && c.summary.trim())
      .map(c => c.summary.trim());
    if (sums.length) parts.push(sums.join('\n\n'));
  }
  if (db.ctx.fullIds.length) {
    const refs = sorted
      .filter(c => db.ctx.fullIds.includes(c.id) && c.body && c.body.trim())
      .map(c => c.body.trim());
    if (refs.length) parts.push(refs.join('\n\n'));
  }
  // 当前正文随输入实时变化
  if (db.ctx.editor) {
    const cur = ($('editor') ? $('editor').value : '').trim();
    if (cur) parts.push(cur);
  }

  const text = parts.join('\n\n');
  return {
    chars: countWords(text),
    bytes: new Blob([text]).size
  };
}

function updateCtxSize() {
  const el = $('ctxSize');
  if (!el) return;
  try {
    const { chars, bytes } = calcCtxSize();
    const tokens = Math.round(chars * 0.75);   // 中文粗估：1 字 ≈ 0.75 token
    el.textContent = `上下文 ${chars.toLocaleString()} 字 · 约 ${tokens.toLocaleString()} tokens`;
    el.hidden = false;
  } catch (e) {
    el.hidden = true;
  }
}

/* ===== 上下文弹窗 ===== */
function renderCtxLists() {
  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);

  // 人物人设
  const cw = $('ctxCharList');
  cw.innerHTML = '';
  if (!db.characters.length) {
    cw.innerHTML = '<div class="ctx-empty">还没有人物，点顶部「人」去建</div>';
  } else {
    for (const ch of db.characters) {
      cw.appendChild(makeSimpleCtxRow(
        ch.name + (ch.role ? `（${ch.role}）` : ''),
        'charIds', ch.id
      ));
    }
  }

  // 世界观
  const ww = $('ctxWorldList');
  ww.innerHTML = '';
  if (!db.worldEntries.length) {
    ww.innerHTML = '<div class="ctx-empty">还没有世界观条目</div>';
  } else {
    for (const w of db.worldEntries) {
      ww.appendChild(makeSimpleCtxRow(w.title, 'worldIds', w.id));
    }
  }

  const sumWrap = $('ctxSummaryList');
  sumWrap.innerHTML = '';
  const withSummary = sorted.filter(c => c.summary && c.summary.trim());
  if (!withSummary.length) {
    sumWrap.innerHTML = '<div class="ctx-empty">还没有任何章节摘要</div>';
  } else {
    for (const c of withSummary) {
      sumWrap.appendChild(makeCtxRow(c, 'summaryIds'));
    }
  }

  const fullWrap = $('ctxFullList');
  fullWrap.innerHTML = '';
  if (!sorted.length) {
    fullWrap.innerHTML = '<div class="ctx-empty">还没有章节</div>';
  } else {
    for (const c of sorted) {
      fullWrap.appendChild(makeCtxRow(c, 'fullIds'));
    }
  }
}

function makeSimpleCtxRow(labelText, field, id) {
  const label = document.createElement('label');
  label.className = 'ctx-item';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  if (!db.ctx[field]) db.ctx[field] = [];
  cb.checked = db.ctx[field].includes(id);
  cb.addEventListener('change', () => {
    const arr = db.ctx[field];
    const i = arr.indexOf(id);
    if (cb.checked && i < 0) arr.push(id);
    if (!cb.checked && i >= 0) arr.splice(i, 1);
    saveDB();
    renderCtxChips();
    updateCtxSize();
  });
  const span = document.createElement('span');
  span.textContent = labelText;
  label.appendChild(cb);
  label.appendChild(span);
  return label;
}

function makeCtxRow(c, field) {
  const label = document.createElement('label');
  label.className = 'ctx-item';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = db.ctx[field].includes(c.id);
  cb.addEventListener('change', () => {
    const arr = db.ctx[field];
    const i = arr.indexOf(c.id);
    if (cb.checked && i < 0) arr.push(c.id);
    if (!cb.checked && i >= 0) arr.splice(i, 1);
    saveDB();
    renderCtxChips();
    updateCtxSize();
  });
  const span = document.createElement('span');
  // 摘要列表显示摘要本身字数，全文列表显示正文字数
  const words = field === 'summaryIds'
    ? countWords(c.summary || '')
    : countWords(c.body || '');
  span.textContent = `第${c.no}章 · ${c.title || '未命名'}（${words}字）`;
  label.appendChild(cb);
  label.appendChild(span);
  return label;
}

/* ===== 组装抽卡提示词 ===== */
function buildContext() {
  const parts = [];

  if (db.ctx.style && getSettings().stylePrompt.trim()) {
    parts.push(getSettings().stylePrompt.trim());
  }

  if (db.ctx.state && db.stateFile.trim()) {
    parts.push('【故事状态文件】\n' + db.stateFile.trim());
  }

  // 人物人设
  if (db.ctx.charIds && db.ctx.charIds.length) {
    const chars = db.characters.filter(c => db.ctx.charIds.includes(c.id));
    if (chars.length) {
      const txt = chars.map(c =>
        `—— ${c.name}${c.role ? '（' + c.role + '）' : ''} ——\n${(c.body || '').trim()}`
      ).join('\n\n');
      parts.push('【人物人设】\n' + txt);
    }
  }

  // 世界观
  if (db.ctx.worldIds && db.ctx.worldIds.length) {
    const we = db.worldEntries.filter(w => db.ctx.worldIds.includes(w.id));
    if (we.length) {
      const txt = we.map(w => `—— ${w.title} ——\n${(w.body || '').trim()}`).join('\n\n');
      parts.push('【世界观设定】\n' + txt);
    }
  }

  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);

  if (db.ctx.summaryIds.length) {
    const sums = sorted
      .filter(c => db.ctx.summaryIds.includes(c.id) && c.summary && c.summary.trim())
      .map(c => `—— 第${c.no}章${c.title && c.title !== '未命名' ? '·' + c.title : ''} 摘要 ——\n${c.summary.trim()}`)
      .join('\n\n');
    if (sums) parts.push('【前情摘要】\n' + sums);
  }

  if (db.ctx.fullIds.length) {
    const refs = sorted
      .filter(c => db.ctx.fullIds.includes(c.id) && c.body && c.body.trim())
      .map(c => `—— 第${c.no}章${c.title && c.title !== '未命名' ? '·' + c.title : ''} 正文 ——\n${c.body.trim()}`)
      .join('\n\n');
    if (refs) parts.push('【原文参考】\n' + refs);
  }

  if (db.ctx.editor) {
    const cur = $('editor').value.trim();
    if (cur) parts.push('【当前章节】\n' + cur);
  }

  return parts.join('\n\n');
}

/* ===== API 调用（流式） ===== */
async function callModel(systemMsg, userMsg, onChunk, signal) {
  const s = getSettings();
  if (!s.base || !s.model) throw new Error('请先到设置里填写接口地址和模型');
  if (!s.key) throw new Error('请先到设置里填写 API Key');

  const url = s.base.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + s.key
    },
    signal,
    body: JSON.stringify({
      model: s.model,
      stream: true,
      temperature: s.temperature,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg }
      ]
    })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${txt.slice(0, 200)}`);
  }

  // 流式解析
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices && json.choices[0] && json.choices[0].delta;
        const piece = delta && (delta.content || '');
        if (piece) {
          full += piece;
          onChunk && onChunk(full);
        }
      } catch (e) { /* 忽略不完整分片 */ }
    }
  }
  return full;
}

/* ===== 抽卡 ===== */
let drawCount = 1;
let drawAbort = null;
let lastCards = [];

function renderCards() {
  const box = $('cards');
  box.innerHTML = '';
  for (const c of lastCards) {
    const el = document.createElement('div');
    el.className = 'card' + (c.streaming ? ' streaming' : '');
    if (c.streaming) {
      el.innerHTML = `
        <div class="card-loading">
          <span class="dot-pulse"><i></i><i></i><i></i></span>
          <span>${c.text ? countWords(c.text) + ' 字…' : '生成中…'}</span>
        </div>
        <div class="card-text">${escapeHtml(c.text || '')}</div>`;
    } else if (c.error) {
      el.innerHTML = `<div style="color:var(--danger);font-size:13px">${escapeHtml(c.error)}</div>
        <div class="card-foot"><span class="card-meta">第 ${c.seq} 张</span></div>`;
    } else {
      const t = document.createElement('div');
      t.className = 'card-text';
      t.textContent = c.text;
      const foot = document.createElement('div');
      foot.className = 'card-foot';
      foot.innerHTML =
        `<span class="card-meta">第 ${c.seq} 张 · ${countWords(c.text)} 字</span>` +
        `<button class="card-btn primary" data-act="insert" data-i="${c.seq}">插入正文</button>` +
        `<button class="card-btn" data-act="copy" data-i="${c.seq}">复制</button>` +
        `<button class="card-btn" data-act="drop" data-i="${c.seq}">丢弃</button>`;
      el.appendChild(t);
      el.appendChild(foot);
    }
    box.appendChild(el);
  }

  box.querySelectorAll('[data-act]').forEach(b => {
    b.addEventListener('click', () => {
      const idx = Number(b.dataset.i) - 1;
      const card = lastCards.find(c => c.seq === idx + 1);
      if (!card) return;
      if (b.dataset.act === 'insert') insertToEditor(card.text);
      if (b.dataset.act === 'copy') copyText(card.text);
      if (b.dataset.act === 'drop') {
        // 丢弃时不删历史记录，只从当前视野移除；历史里仍可找回
        lastCards = lastCards.filter(c => c.seq !== card.seq);
        renderCards();
      }
    });
  });

  // 滚动到底部让新卡可见
  box.scrollTop = box.scrollHeight;
}

function insertToEditor(text) {
  const ed = $('editor');
  const cur = ed.value;
  const needNL = cur && !cur.endsWith('\n') ? '\n\n' : '';
  ed.value = cur + needNL + text;
  updateWordCount();
  flushEditor();
  toast('已插入正文');
}

function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(() => toast('已复制'), () => toast('复制失败'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制'); }
    catch (e) { toast('复制失败'); }
    document.body.removeChild(ta);
  }
}

async function doDraw() {
  const prompt = $('promptInput').value.trim();
  if (!prompt) { toast('先写点提示词'); return; }
  if (drawAbort) { toast('正在抽卡中…'); return; }

  const ctx = buildContext();
  const system = ctx ? ctx : '你是一个中文小说写作助手。';

  drawAbort = new AbortController();
  const btn = $('btnDraw');
  btn.disabled = true;
  btn.querySelector('.draw-btn-text').textContent = '抽卡中…';

  const n = drawCount;
  lastCards = Array.from({ length: n }, (_, i) => ({
    seq: i + 1, text: '', streaming: true, error: null
  }));
  renderCards();

  // N 张并发、彼此独立
  const tasks = lastCards.map(async card => {
    try {
      const full = await callModel(
        system,
        prompt,
        txt => {
          card.text = txt;
          // 轻量更新，不整块重绘
          const box = $('cards');
          const el = box.children[card.seq - 1];
          if (el) {
            const t = el.querySelector('.card-text');
            if (t) t.textContent = txt;
            const l = el.querySelector('.card-loading span:last-child');
            if (l) l.textContent = countWords(txt) + ' 字…';
          }
        },
        drawAbort.signal
      );
      card.text = full;
      card.streaming = false;
      if (full.trim()) {
        // 历史卡片带完整信息，同时保留提示词与生成参数便于回看
        const rec = {
          id: uid(),
          text: full,
          prompt: prompt,
          chapterNo: (currentChapter() || {}).no || null,
          chapterTitle: (currentChapter() || {}).title || '',
          temperature: getSettings().temperature,
          createdAt: Date.now()
        };
        db.cards.push(rec);
        card.historyId = rec.id;
        saveDB();
      }
    } catch (e) {
      card.streaming = false;
      card.error = e.name === 'AbortError' ? '已取消' : e.message;
    }
  });

  await Promise.all(tasks);

  drawAbort = null;
  btn.disabled = false;
  btn.querySelector('.draw-btn-text').textContent = '抽 卡';
  renderCards();

  const ok = lastCards.filter(c => !c.error && c.text);
  if (ok.length) toast(`抽到 ${ok.length} 张`);
}

/* ===== 摘要生成 ===== */
let summaryAbort = null;
let pendingSummaryTitle = '';

async function generateSummary() {
  flushEditor();
  const c = currentChapter();
  if (!c || !c.body.trim()) { toast('当前章节还没有正文'); return; }

  const btn = $('btnGenSummary');
  btn.textContent = '生成中…';
  btn.disabled = true;
  $('summaryOut').value = '';

  summaryAbort = new AbortController();
  try {
    const out = await callModel(
      getSummaryPrompt(),
      `请为下面这一章生成结构化摘要。\n\n【章节编号】第${c.no}章\n【章节正文】\n${c.body}`,
      txt => { $('summaryOut').value = txt; },
      summaryAbort.signal
    );
    $('summaryOut').value = out;
    pendingSummaryTitle = parseTitleFromSummary(out);
    toast('摘要已生成，请检查后保存');
  } catch (e) {
    $('summaryOut').value = '';
    toast(e.name === 'AbortError' ? '已取消' : '生成失败：' + e.message);
  } finally {
    summaryAbort = null;
    btn.textContent = '重新生成';
    btn.disabled = false;
  }
}

/* 从摘要里解析出 AI 拟的章名，例如 "第12章·拍卖会残剑" → "拍卖会残剑" */
function parseTitleFromSummary(text) {
  if (!text) return '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // 找到「一、章节编号与标题」后面那行
  let idx = lines.findIndex(l => /章节编号与标题/.test(l));
  let line = idx >= 0 && lines[idx + 1] ? lines[idx + 1] : lines[0] || '';
  // 去掉序号和「第N章·」前缀
  line = line.replace(/^[一二三四五六七八九十]+[、.．]\s*/, '');
  line = line.replace(/^第\s*\d+\s*章\s*[·・\-—:：.、]?\s*/, '');
  line = line.replace(/^[·・\-—:：.、\s]+/, '').trim();
  if (!line || line.length > 20) return '';
  return line;
}

function saveSummary() {
  const c = currentChapter();
  if (!c) { toast('没有选中章节'); return; }
  const text = $('summaryOut').value.trim();
  if (!text) { toast('摘要为空'); return; }

  c.summary = text;
  c.summaryAt = Date.now();

  // 同步章名：AI 拟了名字，且作者没手动改过章名，就自动采用
  const aiTitle = pendingSummaryTitle || parseTitleFromSummary(text);
  const isUntitled = !c.title || c.title === '未命名' || c.title.trim() === '';
  const autoSynced = isUntitled && !!aiTitle;
  if (autoSynced) {
    c.title = aiTitle;
    $('chapterTitle').textContent = `第${c.no}章 · ${c.title}`;
    $('chapterTitle').classList.add('editable');
  }

  pendingSummaryTitle = '';
  saveDB();
  renderChapterList();
  closeModal();
  toast(autoSynced ? `摘要已保存，章名同步为「${c.title}」` : '摘要已保存');
}

/* ===== 状态文件 ===== */
let stateMode = 'incr';
let stateAbort = null;

function buildStateMessages() {
  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);
  const withSum = sorted.filter(c => c.summary && c.summary.trim());

  if (!withSum.length) throw new Error('还没有任何章节摘要，先去生成摘要');

  if (stateMode === 'init') {
    const body = withSum.map(c => `—— 第${c.no}章${c.title && c.title !== '未命名' ? '·' + c.title : ''} 摘要 ——\n${c.summary.trim()}`).join('\n\n');
    return {
      system: '当前模式：模式A（首次生成）\n\n' + getStatePromptBody(),
      user: `请根据以下章节摘要，生成完整的初始状态文件。\n\n${body}`
    };
  }

  const latest = withSum[withSum.length - 1];
  if (!db.stateFile.trim()) {
    throw new Error('还没有状态文件，请先用「首次生成」');
  }
  return {
    system: '当前模式：模式B（增量更新）\n\n' + getStatePromptBody(),
    user: `【现有状态文件】\n${db.stateFile.trim()}\n\n【最新一章摘要】\n第${latest.no}章${latest.title && latest.title !== '未命名' ? '·' + latest.title : ''}\n${latest.summary.trim()}\n\n请输出更新后的完整状态文件。`
  };
}

async function updateState() {
  let msg;
  try {
    msg = buildStateMessages();
  } catch (e) {
    toast(e.message);
    return;
  }

  const btn = $('btnUpdateState');
  btn.textContent = '生成中…';
  btn.disabled = true;
  $('stateOut').value = '';

  stateAbort = new AbortController();
  try {
    const out = await callModel(msg.system, msg.user,
      txt => { $('stateOut').value = txt; },
      stateAbort.signal);
    $('stateOut').value = out;
    toast('状态文件已生成，请检查后保存');
  } catch (e) {
    $('stateOut').value = '';
    toast(e.name === 'AbortError' ? '已取消' : '生成失败：' + e.message);
  } finally {
    stateAbort = null;
    btn.textContent = stateMode === 'init' ? '生成状态文件' : '按最新章更新';
    btn.disabled = false;
  }
}

function saveState() {
  const v = $('stateOut').value.trim();
  if (!v) { toast('内容为空'); return; }
  db.stateFile = v;
  saveDB();
  closeModal();
  toast('状态文件已保存');
}

/* ===== 导入导出 ===== */
function download(filename, content, type) {
  const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function exportMarkdown() {
  flushEditor();
  if (!db.chapters.length) { toast('还没有章节'); return; }
  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);
  const cur = shelf.books.find(b => b.id === currentBookId);
  const title = cur ? cur.title : '正文';
  const text = sorted.map(c =>
    `# 第${c.no}章 ${c.title || ''}\n\n${(c.body || '').trim()}`
  ).join('\n\n\n');
  const safeName = (title || '正文').replace(/[\\/:*?"<>|]/g, '_');
  download(`${safeName}-${todayStr()}.md`, text, 'text/markdown;charset=utf-8');
  toast(`已导出 ${sorted.length} 章`);
}

function exportAll() {
  flushEditor();
  const payload = {
    app: 'novel-draw',
    version: 2,
    scope: 'whole-shelf',
    exportedAt: new Date().toISOString(),
    shelf: shelf
  };
  download(`书架备份-${todayStr()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  // 导出后立刻把设置回填，避免系统清空输入框后残留空值
  setTimeout(() => refreshSettingsFields(), 60);
  const totalCh = shelf.books.reduce((n, b) => n + (b.data.chapters || []).length, 0);
  toast(`已导出 ${shelf.books.length} 本，共 ${totalCh} 章`);
}

/** 把各种版本的文件统一成「一本书」 */
function normalizeToBook(incoming) {
  // 单本导出格式 {book:{title,data}}
  if (incoming && incoming.book && incoming.book.data) {
    return {
      title: incoming.book.title || '导入的书',
      data: Object.assign(defaultBookData(), incoming.book.data)
    };
  }
  // 旧单书格式 {chapters:[...]}
  if (incoming && Array.isArray(incoming.chapters)) {
    return {
      title: '导入的书',
      data: Object.assign(defaultBookData(), {
        chapters: incoming.chapters,
        stateFile: incoming.stateFile || '',
        cards: incoming.cards || [],
        characters: incoming.characters || [],
        worldEntries: incoming.worldEntries || [],
        lastChapterId: incoming.lastChapterId || null,
        ctx: incoming.ctx || {}
      })
    };
  }
  return null;
}

function importBackup(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const p = JSON.parse(fr.result);

      // 整个书架
      if (p && p.shelf && Array.isArray(p.shelf.books)) {
        return handleShelfImport(p.shelf);
      }

      // 单本 / 旧格式
      const incoming = p.data || p;
      const one = normalizeToBook(incoming) || normalizeToBook(p);
      if (!one) throw new Error('不是有效的备份文件');
      return handleSingleBookImport(one);
    } catch (e) {
      toast('导入失败：' + e.message);
    }
  };
  fr.readAsText(file);
}

async function handleShelfImport(inShelf) {
  const n = inShelf.books.length;
  const ok = await askConfirm(
    '导入整个书架？',
    `这个文件包含 ${n} 本书。导入后会替换当前书架上的全部内容（当前 ${shelf.books.length} 本）。`,
    '导入并替换'
  );
  if (!ok) return;

  shelf = Object.assign(defaultShelf(), inShelf);
  shelf.settings = Object.assign(defaultSettings(), inShelf.settings || {});
  shelf.books = (inShelf.books || []).map(b => ({
    id: b.id || uid(),
    title: b.title || '未命名',
    createdAt: b.createdAt || Date.now(),
    updatedAt: b.updatedAt || Date.now(),
    data: Object.assign(defaultBookData(), b.data || {})
  }));
  shelf.books.forEach(b => {
    b.data.ctx = Object.assign(defaultBookData().ctx, b.data.ctx || {});
  });

  // 保留当前 API Key，避免导入后要重填
  const keepKey = getSettings().key;
  if (keepKey && !shelf.settings.key) shelf.settings.key = keepKey;

  if (!shelf.books.length) {
    shelf.books.push({
      id: uid(), title: '我的书', createdAt: Date.now(), updatedAt: Date.now(),
      data: defaultBookData()
    });
  }
  shelf.currentBookId = shelf.books[0].id;
  saveShelf();

  closeModal();
  setTimeout(() => location.reload(), 200);
  toast(`已导入 ${n} 本书`);
}

async function handleSingleBookImport(one) {
  const title = one.title || '导入的书';
  const chCount = (one.data.chapters || []).length;
  const ok = await askConfirm(
    `导入《${title}》？`,
    `将作为一本新书加入书架，包含 ${chCount} 章。不影响现有书籍。`,
    '导入'
  );
  if (!ok) return;

  const book = {
    id: uid(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data: Object.assign(defaultBookData(), one.data)
  };
  book.data.ctx = Object.assign(defaultBookData().ctx, book.data.ctx || {});

  shelf.books.push(book);
  saveShelf();

  closeModal();
  setTimeout(() => { renderShelf(); openModal('modalShelf'); }, 260);
  toast(`已导入《${title}》，可以在书架里切换`);
}

function importChapters(files) {
  const list = Array.from(files);
  if (!list.length) return;

  let done = 0;
  const results = [];
  let baseNo = db.chapters.reduce((m, c) => Math.max(m, c.no), 0);

  list.forEach(file => {
    const fr = new FileReader();
    fr.onload = () => {
      const raw = fr.result;
      const name = file.name.replace(/\.(md|txt|text)$/i, '');
      // 尝试从文件名取章节号
      const m = name.match(/(\d+)/);
      baseNo++;
      const no = m ? Number(m[1]) : baseNo;
      // 取第一行做标题
      const firstLine = raw.split('\n').find(l => l.trim()) || '';
      let title = firstLine.replace(/^#+\s*/, '').replace(/^第\s*\d+\s*章[·\s]*/, '').trim();
      if (!title || title.length > 30) title = name.slice(0, 30);

      db.chapters.push({
        id: uid(), no, title, body: raw, summary: '', updatedAt: Date.now()
      });
      results.push(no);
      done++;
      if (done === list.length) {
        db.chapters.sort((a, b) => a.no - b.no);
        saveDB();
        renderChapterList();
        renderCtxLists();
        if (!currentChapterId && db.chapters.length) {
          selectChapter(db.chapters[0].id);
        }
        closeModal();
        toast(`已导入 ${done} 个文件`);
      }
    };
    fr.readAsText(file);
  });
}

function todayStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function updateStorageHint() {
  let size = 0;
  try { size = new Blob([localStorage.getItem(SHELF_KEY) || '']).size; } catch (e) {}
  const totalCh = shelf.books.reduce((n, b) => n + (b.data.chapters || []).length, 0);
  const cur = shelf.books.find(b => b.id === currentBookId);
  $('storageHint').textContent =
    `书架 ${shelf.books.length} 本 · 当前《${cur ? cur.title : '—'}》${db.chapters.length} 章 · ` +
    `共 ${totalCh} 章 · 本地占用约 ${(size / 1024).toFixed(1)} KB。` +
    `数据只存在这台设备的 Safari 里，请定期导出备份。`;
}

/* ===== 设置 ===== */
function openSettings() {
  const s = getSettings();
  $('cfgBase').value = s.base || '';
  const kf = $('cfgKey');
  kf.type = 'password';
  kf.value = s.key || '';
  const eye = $('btnToggleKey');
  if (eye) { eye.textContent = '◎'; eye.title = '显示'; }
  $('cfgModel').value = s.model || '';
  $('cfgStyle').value = s.stylePrompt || '';
  updateStorageHint();
  openModal('modalSettings');
}

/* 把已保存的设置回填到输入框 */
function refreshSettingsFields() {
  const s = getSettings();
  const b = $('cfgBase'), k = $('cfgKey'), m = $('cfgModel'), st = $('cfgStyle');
  if (b && document.activeElement !== b) b.value = s.base || '';
  if (k && document.activeElement !== k) k.value = s.key || '';
  if (m && document.activeElement !== m) m.value = s.model || '';
  if (st && document.activeElement !== st) st.value = s.stylePrompt || '';
}

function readSettings() {
  const s = getSettings();

  const base = $('cfgBase').value.trim();
  const key = $('cfgKey').value.trim();
  const model = $('cfgModel').value.trim();
  const style = $('cfgStyle').value;

  // 输入框可能因系统安全策略未回填，空值不能覆盖已有设置
  if (base) s.base = base;
  if (key) s.key = key;
  if (model) s.model = model;
  if (style) s.stylePrompt = style;

  saveDB();
}

async function testConnection() {
  readSettings();
  const btn = $('btnTest');
  btn.textContent = '测试中…';
  btn.disabled = true;
  try {
    const out = await callModel('你是一个测试助手。', '回复两个字：正常', null, null);
    toast('连接成功：' + out.slice(0, 20));
  } catch (e) {
    toast('失败：' + e.message);
  } finally {
    btn.textContent = '测试连接';
    btn.disabled = false;
  }
}

/* ===== 分隔条拖拽 ===== */
function initSplitter() {
  const sp = $('splitter');
  const ws = $('workspace');
  const left = $('paneEdit');
  let dragging = false;

  const isVertical = () => window.matchMedia('(max-width:760px)').matches;

  function onStart(e) {
    dragging = true;
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    const t = e.touches ? e.touches[0] : e;
    const rect = ws.getBoundingClientRect();
    if (isVertical()) {
      const pct = (t.clientY - rect.top) / rect.height * 100;
      left.style.flex = `0 0 ${Math.min(80, Math.max(20, pct))}%`;
    } else {
      const pct = (t.clientX - rect.left) / rect.width * 100;
      left.style.flex = `0 0 ${Math.min(82, Math.max(18, pct))}%`;
    }
  }
  function onEnd() { dragging = false; }

  sp.addEventListener('mousedown', onStart);
  sp.addEventListener('touchstart', onStart, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', onEnd);
  window.addEventListener('touchend', onEnd);
}

/* ===== 初始化 ===== */
function init() {
  loadShelf();

  // 章节
  if (db.chapters.length) {
    // 优先恢复上次打开的章节；不存在则取最新一章
    const last = db.chapters.find(c => c.id === db.lastChapterId);
    const target = last || [...db.chapters].sort((a, b) => b.no - a.no)[0];
    selectChapter(target.id);
    // 章节列表滚动到当前章
    setTimeout(() => {
      const on = document.querySelector('.chapter-item.on');
      if (on) on.scrollIntoView({ block: 'center' });
    }, 60);
  } else {
    $('chapterTitle').textContent = '未选择章节';
  }

  renderChapterList();
  renderCtxChips();
  renderCtxLists();

  // 编辑器自动保存
  const ed = $('editor');
  ed.addEventListener('input', () => {
    updateWordCount();
    updateCtxSize();
    clearTimeout(editorSaveTimer);
    editorSaveTimer = setTimeout(flushEditor, 600);
  });
  ed.addEventListener('blur', flushEditor);

  // 顶栏
  $('btnShelf').addEventListener('click', openDrawer);
  $('overlay').addEventListener('click', closeDrawer);

  $('btnSummary').addEventListener('click', () => {
    flushEditor();
    const c = currentChapter();
    $('summaryOut').value = c && c.summary ? c.summary : '';
    $('btnGenSummary').textContent = '生成';
    pendingSummaryTitle = '';
    openModal('modalSummary');
  });

  $('btnState').addEventListener('click', () => {
    $('stateOut').value = db.stateFile || '';
    openModal('modalState');
  });

  $('btnSettings').addEventListener('click', openSettings);
  $('btnContext').addEventListener('click', () => {
    renderCtxLists();
    $('ctxStyle').checked = db.ctx.style;
    $('ctxState').checked = db.ctx.state;
    $('ctxEditor').checked = db.ctx.editor;
    openModal('modalContext');
  });

  // 抽屉按钮
  $('btnNewChapter').addEventListener('click', newChapter);
  $('btnImportChapters').addEventListener('click', () => $('fileChapters').click());

  // 抽卡
  $('btnDraw').addEventListener('click', doDraw);
  document.querySelectorAll('#segCount button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#segCount button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      drawCount = Number(b.dataset.n);
    });
  });

  const tr = $('tempRange');
  tr.addEventListener('input', () => {
    const v = Number(tr.value) / 100;
    $('tempVal').textContent = v.toFixed(1);
    getSettings().temperature = v;
  });
  tr.value = String(Math.round((getSettings().temperature || 1) * 100));
  $('tempVal').textContent = Number(getSettings().temperature || 1).toFixed(1);

  // 摘要
  $('btnGenSummary').addEventListener('click', generateSummary);
  $('btnSaveSummary').addEventListener('click', saveSummary);

  // 状态
  document.querySelectorAll('#segStateMode button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#segStateMode button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      stateMode = b.dataset.mode;
      $('btnUpdateState').textContent = stateMode === 'init' ? '生成状态文件' : '按最新章更新';
    });
  });
  $('btnUpdateState').addEventListener('click', updateState);
  $('btnSaveState').addEventListener('click', saveState);

  // 设置：输入即保存，避免关闭时读空值把配置清掉
  ['cfgBase', 'cfgKey', 'cfgModel', 'cfgStyle'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const s = getSettings();
      if (id === 'cfgBase') s.base = el.value.trim();
      if (id === 'cfgKey') s.key = el.value.trim();
      if (id === 'cfgModel') s.model = el.value.trim();
      if (id === 'cfgStyle') s.stylePrompt = el.value;
      saveDB();
      if (id === 'cfgStyle' || id === 'cfgBase' || id === 'cfgModel') updateCtxSize();
    });
    el.addEventListener('change', () => {
      const s = getSettings();
      if (id === 'cfgBase') s.base = el.value.trim();
      if (id === 'cfgKey') s.key = el.value.trim();
      if (id === 'cfgModel') s.model = el.value.trim();
      if (id === 'cfgStyle') s.stylePrompt = el.value;
      saveDB();
    });
  });

  // 草稿
  $('btnDraft').addEventListener('click', openDraft);
  $('draftArea').addEventListener('input', () => {
    updateDraftCount();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 500);
  });
  $('draftArea').addEventListener('blur', saveDraftNow);
  $('btnDraftClear').addEventListener('click', clearDraft);
  $('btnDraftToEditor').addEventListener('click', draftToEditor);

  // 提示词管理
  $('btnOpenPrompts').addEventListener('click', () => {
    closeModal();
    setTimeout(openPrompts, 280);
  });
  document.querySelectorAll('#segPromptTab button').forEach(b => {
    b.addEventListener('click', () => switchPromptTab(b.dataset.p));
  });
  $('btnSavePrompt').addEventListener('click', savePromptEdit);
  $('btnResetPrompt').addEventListener('click', resetPromptEdit);
  $('btnLoadDefault').addEventListener('click', viewDefaultPrompt);

  // Key 显示/隐藏
  const eye = $('btnToggleKey');
  if (eye) {
    eye.addEventListener('click', () => {
      const k = $('cfgKey');
      const hidden = k.type === 'password';
      k.type = hidden ? 'text' : 'password';
      eye.textContent = hidden ? '◉' : '◎';
      eye.title = hidden ? '隐藏' : '显示';
    });
  }

  // 设置
  $('btnTest').addEventListener('click', testConnection);
  $('btnExportAll').addEventListener('click', exportAll);
  $('btnExportMd').addEventListener('click', exportMarkdown);
  $('btnImportAll').addEventListener('click', () => $('fileBackup').click());
  $('fileBackup').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) importBackup(f);
    e.target.value = '';
  });
  $('fileChapters').addEventListener('change', e => {
    const fs = e.target.files;
    if (fs) importChapters(fs);
    e.target.value = '';
  });

  // 书架
  $('btnBooks').addEventListener('click', openShelf);
  $('btnNewBook').addEventListener('click', createBook);
  $('btnSaveBook').addEventListener('click', saveBookEdit);
  $('btnDeleteBook').addEventListener('click', () => {
    if (editingBookId) deleteBook(editingBookId);
  });
  $('bookName').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveBookEdit(); }
  });

  // 历史卡片
  $('btnHistory').addEventListener('click', openHistory);
  $('btnClearHistory').addEventListener('click', clearHistory);
  $('histSearch').addEventListener('input', e => {
    histQuery = e.target.value;
    histLimit = 60;
    renderHistory();
  });

  // 人设库
  $('btnCast').addEventListener('click', openCast);
  document.querySelectorAll('#segCastTab button').forEach(b => {
    b.addEventListener('click', () => switchCastTab(b.dataset.tab));
  });
  $('btnAddChar').addEventListener('click', () => {
    switchCastTab('char');
    openCharEdit(null);
  });
  $('btnNewWorld').addEventListener('click', () => {
    switchCastTab('world');
    openWorldEdit(null);
  });
  $('btnSaveChar').addEventListener('click', saveCharacter);
  $('btnDeleteChar').addEventListener('click', () => editingCharId && deleteCharacter(editingCharId));
  $('btnSaveWorld').addEventListener('click', saveWorld);
  $('btnDeleteWorld').addEventListener('click', () => editingWorldId && deleteWorld(editingWorldId));
  $('btnExtractChar').addEventListener('click', openExtractPick);
  $('btnDoExtract').addEventListener('click', runExtract);
  $('btnApplyExtract').addEventListener('click', applyExtract);
  $('pickSearch').addEventListener('input', e => {
    pickQuery = e.target.value;
    renderPickTarget();
  });

  // 确认框
  $('btnConfirmYes').addEventListener('click', () => settleConfirm(true));
  $('btnConfirmNo').addEventListener('click', () => settleConfirm(false));

  // 重新编号
  $('btnRenumber').addEventListener('click', renumberChapters);

  // 顶栏标题点击改名
  $('chapterTitle').addEventListener('click', () => {
    if (!currentChapterId) { toast('先选一章'); return; }
    openChapterInfo(currentChapterId);
  });

  // 章节信息
  $('btnSaveChapterInfo').addEventListener('click', saveChapterInfo);
  $('chName').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveChapterInfo(); }
  });

  // 上下文开关
  ['style', 'state', 'editor'].forEach(k => {
    const el = $('ctx' + k[0].toUpperCase() + k.slice(1));
    el.addEventListener('change', () => {
      db.ctx[k] = el.checked;
      saveDB();
      renderCtxChips();
      updateCtxSize();
    });
  });

  // 关闭
  $('modalMask').addEventListener('click', () => {
    closeModal();
  });
  document.querySelectorAll('[data-close]').forEach(b =>
    b.addEventListener('click', () => closeModal()));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (openModalId) closeModal();
      else closeDrawer();
    }
    // Cmd/Ctrl + Enter 抽卡
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      doDraw();
    }
  });

  initSplitter();

  // 页面隐藏时保存
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushEditor();
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    let reloading = false;
    navigator.serviceWorker.register('sw.js').then(reg => {
      // 每次打开都检查更新
      reg.update().catch(() => {});

      // 发现新版本：等它装好就刷新一次
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller && !reloading) {
            reloading = true;
            navigator.serviceWorker.controller.postMessage('SKIP_WAITING');
            setTimeout(() => location.reload(), 300);
          }
        });
      });
    }).catch(() => {});

    // 新 SW 接管时刷新（只刷一次，避免循环）
    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshed) return;
      refreshed = true;
      location.reload();
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
