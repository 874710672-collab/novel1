/* ===== 抽卡写小说 · 核心逻辑 ===== */
'use strict';

const DB_KEY = 'novel.app.v1';

/* ---------- 数据层 ---------- */
let db = null;

function defaultDB() {
  return {
    chapters: [],        // {id, no, title, body, summary, updatedAt}
    stateFile: '',       // 状态文件全文
    cards: [],           // 抽卡记录 {id, text, createdAt}
    settings: {
      base: 'https://api.deepseek.com/v1',
      key: '',
      model: 'deepseek-chat',
      temperature: 1.0,
      stylePrompt: (typeof DEFAULT_STYLE_PROMPT !== 'undefined' ? DEFAULT_STYLE_PROMPT : '')
    },
    // 抽卡上下文勾选状态（持久化）
    ctx: {
      style: true,
      state: true,
      editor: true,
      summaryIds: [],
      fullIds: []
    }
  };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      db = Object.assign(defaultDB(), parsed);
      db.settings = Object.assign(defaultDB().settings, parsed.settings || {});
      db.ctx = Object.assign(defaultDB().ctx, parsed.ctx || {});
    } else {
      db = defaultDB();
    }
  } catch (e) {
    db = defaultDB();
  }
}

function saveDB() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (e) {
    toast('保存失败，本地空间可能已满');
  }
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

const MODALS = ['modalSummary', 'modalState', 'modalSettings', 'modalContext'];
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
    el.innerHTML = `
      <span class="ch-no">${String(c.no).padStart(2, '0')}</span>
      <span class="ch-title">${escapeHtml(c.title || '未命名')}</span>
      <span class="ch-meta">${countWords(c.body)}字${sumMark}</span>
      <span class="ch-del" data-del="${c.id}">×</span>`;
    el.addEventListener('click', e => {
      if (e.target.dataset.del) {
        e.stopPropagation();
        removeChapter(e.target.dataset.del);
        return;
      }
      selectChapter(c.id);
      closeDrawer();
    });
    list.appendChild(el);
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function selectChapter(id) {
  flushEditor();
  currentChapterId = id;
  const c = currentChapter();
  $('chapterTitle').textContent = c ? `第${c.no}章 · ${c.title || '未命名'}` : '未选择章节';
  $('editor').value = c ? c.body : '';
  updateWordCount();
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
  toast(`已新建第${ch.no}章`);
}

function removeChapter(id) {
  const c = db.chapters.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`删除第${c.no}章「${c.title || '未命名'}」？正文和摘要都会一起删掉。`)) return;
  db.chapters = db.chapters.filter(x => x.id !== id);
  db.ctx.summaryIds = db.ctx.summaryIds.filter(x => x !== id);
  db.ctx.fullIds = db.ctx.fullIds.filter(x => x !== id);
  if (currentChapterId === id) {
    currentChapterId = null;
    $('editor').value = '';
    $('chapterTitle').textContent = '未选择章节';
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
}

/* ===== 上下文弹窗 ===== */
function renderCtxLists() {
  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);

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
  });
  const span = document.createElement('span');
  span.textContent = `第${c.no}章 · ${c.title || '未命名'}（${countWords(c.body)}字）`;
  label.appendChild(cb);
  label.appendChild(span);
  return label;
}

/* ===== 组装抽卡提示词 ===== */
function buildContext() {
  const parts = [];

  if (db.ctx.style && db.settings.stylePrompt.trim()) {
    parts.push(db.settings.stylePrompt.trim());
  }

  if (db.ctx.state && db.stateFile.trim()) {
    parts.push('【故事状态文件】\n' + db.stateFile.trim());
  }

  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);

  if (db.ctx.summaryIds.length) {
    const sums = sorted
      .filter(c => db.ctx.summaryIds.includes(c.id) && c.summary && c.summary.trim())
      .map(c => `—— 第${c.no}章摘要 ——\n${c.summary.trim()}`)
      .join('\n\n');
    if (sums) parts.push('【前情摘要】\n' + sums);
  }

  if (db.ctx.fullIds.length) {
    const refs = sorted
      .filter(c => db.ctx.fullIds.includes(c.id) && c.body && c.body.trim())
      .map(c => `—— 第${c.no}章正文 ——\n${c.body.trim()}`)
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
  const s = db.settings;
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
        db.cards.push({ id: uid(), text: full, createdAt: Date.now() });
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
      SUMMARY_PROMPT,
      `请为下面这一章生成结构化摘要。\n\n【章节编号】第${c.no}章\n【章节正文】\n${c.body}`,
      txt => { $('summaryOut').value = txt; },
      summaryAbort.signal
    );
    $('summaryOut').value = out;
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

function saveSummary() {
  const c = currentChapter();
  if (!c) { toast('没有选中章节'); return; }
  const text = $('summaryOut').value.trim();
  if (!text) { toast('摘要为空'); return; }
  c.summary = text;
  c.updatedAt = Date.now();
  saveDB();
  renderChapterList();
  closeModal();
  toast('摘要已保存');
}

/* ===== 状态文件 ===== */
let stateMode = 'incr';
let stateAbort = null;

function buildStateMessages() {
  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);
  const withSum = sorted.filter(c => c.summary && c.summary.trim());

  if (!withSum.length) throw new Error('还没有任何章节摘要，先去生成摘要');

  if (stateMode === 'init') {
    const body = withSum.map(c => `—— 第${c.no}章摘要 ——\n${c.summary.trim()}`).join('\n\n');
    return {
      system: '当前模式：模式A（首次生成）\n\n' + STATE_PROMPT_BODY,
      user: `请根据以下章节摘要，生成完整的初始状态文件。\n\n${body}`
    };
  }

  const latest = withSum[withSum.length - 1];
  if (!db.stateFile.trim()) {
    throw new Error('还没有状态文件，请先用「首次生成」');
  }
  return {
    system: '当前模式：模式B（增量更新）\n\n' + STATE_PROMPT_BODY,
    user: `【现有状态文件】\n${db.stateFile.trim()}\n\n【最新一章摘要】\n第${latest.no}章\n${latest.summary.trim()}\n\n请输出更新后的完整状态文件。`
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

function exportAll() {
  flushEditor();
  const payload = {
    app: 'novel-draw', version: 1,
    exportedAt: new Date().toISOString(),
    data: db
  };
  download(`小说备份-${todayStr()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast(`已导出 ${db.chapters.length} 章`);
}

function exportMarkdown() {
  flushEditor();
  if (!db.chapters.length) { toast('还没有章节'); return; }
  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);
  const text = sorted.map(c =>
    `# 第${c.no}章 ${c.title || ''}\n\n${c.body.trim()}`
  ).join('\n\n\n');
  download(`正文合集-${todayStr()}.md`, text, 'text/markdown;charset=utf-8');
  toast(`已导出 ${sorted.length} 章`);
}

function importBackup(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const p = JSON.parse(fr.result);
      const incoming = p.data || p;
      if (!incoming || !Array.isArray(incoming.chapters)) throw new Error('不是有效的备份文件');

      const merged = Object.assign(defaultDB(), incoming);
      merged.settings = Object.assign(defaultDB().settings, incoming.settings || {});
      merged.ctx = Object.assign(defaultDB().ctx, incoming.ctx || {});
      db = merged;
      saveDB();

      currentChapterId = db.chapters.length ? db.chapters[0].id : null;
      selectChapter(currentChapterId);
      renderCtxLists();
      renderCtxChips();
      updateStorageHint();
      closeModal();
      toast(`导入完成，共 ${db.chapters.length} 章`);
    } catch (e) {
      toast('导入失败：' + e.message);
    }
  };
  fr.readAsText(file);
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
  try { size = new Blob([localStorage.getItem(DB_KEY) || '']).size; } catch (e) {}
  $('storageHint').textContent =
    `当前 ${db.chapters.length} 章 · 本地占用约 ${(size / 1024).toFixed(1)} KB。` +
    `数据只存在这台设备的 Safari 里，请定期导出备份。`;
}

/* ===== 设置 ===== */
function openSettings() {
  const s = db.settings;
  $('cfgBase').value = s.base || '';
  $('cfgKey').value = s.key || '';
  $('cfgModel').value = s.model || '';
  $('cfgStyle').value = s.stylePrompt || '';
  updateStorageHint();
  openModal('modalSettings');
}

function readSettings() {
  db.settings.base = $('cfgBase').value.trim();
  db.settings.key = $('cfgKey').value.trim();
  db.settings.model = $('cfgModel').value.trim();
  db.settings.stylePrompt = $('cfgStyle').value;
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
  loadDB();

  // 章节
  if (db.chapters.length) {
    selectChapter([...db.chapters].sort((a, b) => a.no - b.no)[0].id);
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
    db.settings.temperature = v;
  });
  tr.value = String(Math.round((db.settings.temperature || 1) * 100));
  $('tempVal').textContent = Number(db.settings.temperature || 1).toFixed(1);

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

  // 上下文开关
  ['style', 'state', 'editor'].forEach(k => {
    const el = $('ctx' + k[0].toUpperCase() + k.slice(1));
    el.addEventListener('change', () => {
      db.ctx[k] = el.checked;
      saveDB();
      renderCtxChips();
    });
  });

  // 关闭
  $('modalMask').addEventListener('click', () => {
    if (openModalId === 'modalSettings') readSettings();
    closeModal();
  });
  document.querySelectorAll('[data-close]').forEach(b =>
    b.addEventListener('click', () => {
      if (openModalId === 'modalSettings') readSettings();
      closeModal();
    }));

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
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
