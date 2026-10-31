/* ===== 剧情抽卡 =====
   独立模块：不切到剧情模式时，完全不影响正文抽卡。 */

const MOODS = ['搞笑', '冲突', '反转', '温情', '悬疑', '尴尬', '压抑', '轻松', '紧张', '暧昧'];

let plotMode = false;          // 当前是否在剧情模式
let plotCount = 1;
let plotAbort = null;
let plotCards = [];            // 本次抽到的卡
let plotHistQuery = '';
let plotHistLimit = 60;
let plotSaveTimer = null;

/* ---------- 剧情提示词（可被设置覆盖） ---------- */
const PLOT_PROMPT_DEFAULT = `你是中文网文的剧情设计助手。根据作者给出的条件，设计一段剧情的梗概。

【输出要求】
- 只写剧情走向，不写成正文，不做细致的场景描写
- 可以写对白，用「某人说：……」的形式，不要展开动作和神态描写
- 按时间顺序写清楚：谁做了什么、遇到什么、结果如何
- 不要抒情、不要环境铺陈、不要总结升华
- 结尾停在一个具体的动作或状态上
- 段落之间用空行隔开，方便阅读

【其他】
- 作者没有提到的信息不要自行添加设定
- 如果作者给了篇幅要求，按那个篇幅控制
- 只输出剧情梗概本身，不要开场白或说明`;

function getPlotPrompt() {
  const custom = getSettings().plotPrompt;
  return (custom && custom.trim()) ? custom : PLOT_PROMPT_DEFAULT;
}

/* ---------- 剧情数据（按书存） ---------- */
function plotData() {
  if (!db) return null;
  if (!db.plot) {
    db.plot = {
      editor: '',
      cards: [],
      // 表单状态：全部记住
      form: {
        charIds: [],
        moods: [],
        length: 0,
        pov: '',
        scene: '',
        goal: '',
        must: '',
        ban: '',
        end: '',
        extra: '',
        count: 1,
        temperature: 1.0,
        includePlot: true
      }
    };
  }
  if (!db.plot.form) {
    db.plot.form = {
      charIds: [], moods: [], length: 0, pov: '',
      scene: '', goal: '', must: '', ban: '', end: '', extra: '',
      count: 1, temperature: 1.0, includePlot: true
    };
  }
  return db.plot;
}

/* ---------- 模式切换 ---------- */
function togglePlotMode() {
  plotMode = !plotMode;

  $('modeNovel').hidden = plotMode;
  $('modePlot').hidden = !plotMode;
  $('btnMode').classList.toggle('on', plotMode);

  if (plotMode) {
    applyPlotTopbar();
    ensurePlotForm();
    renderPlotChips();
    renderPlotCards();
    updatePlotCtxSize();
  } else {
    // 切回正文模式：恢复标题
    refreshNovelTopbar();
  }
}

/* 剧情模式下的顶栏标题 */
function applyPlotTopbar() {
  const c = currentChapter();
  const t = $('chapterTitle');
  if (c) {
    t.textContent = `第${c.no}章 · ${c.title || '未命名'} · 剧情构思中…`;
    t.classList.add('editable');
  } else {
    t.textContent = '未选择章节 · 剧情构思中…';
    t.classList.remove('editable');
  }
}

/* 恢复正文模式的顶栏标题 */
function refreshNovelTopbar() {
  const c = currentChapter();
  const t = $('chapterTitle');
  if (c) {
    t.textContent = `第${c.no}章 · ${c.title || '未命名'}`;
    t.classList.add('editable');
  } else {
    t.textContent = '未选择章节';
    t.classList.remove('editable');
  }
}

/* ---------- 剧情编辑区 ---------- */
function loadPlotEditor() {
  const p = plotData();
  $('plotEditor').value = p ? (p.editor || '') : '';
  updatePlotWordCount();
}

function updatePlotWordCount() {
  const p = plotData();
  $('plotWordCount').textContent = countWords(p ? p.editor : '') + ' 字';
}

function savePlotEditor() {
  const p = plotData();
  if (!p) return;
  p.editor = $('plotEditor').value;
  saveDB();
  updatePlotWordCount();
}

/* ---------- 表单 ---------- */
function ensurePlotForm() {
  const p = plotData();
  if (!p) return;
  const f = p.form;

  // 清掉指向已删除人物的残留 id
  if (Array.isArray(f.charIds)) {
    const before = f.charIds.length;
    f.charIds = f.charIds.filter(id => db.characters.some(c => c.id === id));
    if (f.charIds.length !== before) saveDB();
  }

  // 焦点人物
  const chars = $('pfChars');
  chars.innerHTML = '';
  if (!db.characters.length) {
    chars.innerHTML = '<span class="pf-empty">还没有人物，去「人」里建</span>';
  } else {
    for (const c of db.characters) {
      const b = document.createElement('button');
      b.className = 'pf-chip' + (f.charIds.includes(c.id) ? ' on' : '');
      b.textContent = c.name;
      b.addEventListener('click', () => {
        const i = f.charIds.indexOf(c.id);
        if (i >= 0) f.charIds.splice(i, 1);
        else f.charIds.push(c.id);
        b.classList.toggle('on');
        saveDB();
        renderPlotChips();
        updatePlotCtxSize();
      });
      chars.appendChild(b);
    }
  }

  // 氛围
  const moods = $('pfMoods');
  moods.innerHTML = '';
  for (const m of MOODS) {
    const b = document.createElement('button');
    b.className = 'pf-chip' + (f.moods.includes(m) ? ' on' : '');
    b.textContent = m;
    b.addEventListener('click', () => {
      const i = f.moods.indexOf(m);
      if (i >= 0) f.moods.splice(i, 1);
      else f.moods.push(m);
      b.classList.toggle('on');
      saveDB();
    });
    moods.appendChild(b);
  }

  // 篇幅
  // 篇幅：预设档位 + 自定义
  const customInput = $('pfLengthCustom');
  const isCustom = f.lengthCustom && Number(f.lengthCustom) > 0;

  document.querySelectorAll('#pfLength button').forEach(b => {
    const v = b.dataset.v;
    const isOn = v === 'custom'
      ? isCustom
      : (!isCustom && Number(v) === Number(f.length || 0));
    b.classList.toggle('on', isOn);

    b.onclick = () => {
      if (v === 'custom') {
        // 切到自定义：保留上次填的数字
        f.length = 0;
        if (!f.lengthCustom) f.lengthCustom = 300;
        customInput.hidden = false;
        customInput.value = String(f.lengthCustom);
        setTimeout(() => { try { customInput.focus(); customInput.select(); } catch (e) {} }, 60);
      } else {
        f.length = Number(v);
        f.lengthCustom = 0;
        customInput.hidden = true;
        customInput.value = '';
      }
      document.querySelectorAll('#pfLength button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      saveDB();
      updatePlotCtxSize();
    };
  });

  // 自定义字数输入
  if (isCustom) {
    customInput.hidden = false;
    customInput.value = String(f.lengthCustom);
  } else {
    customInput.hidden = true;
    customInput.value = '';
  }
  customInput.oninput = () => {
    const v = parseInt(customInput.value, 10);
    f.lengthCustom = (v > 0) ? v : 0;
    f.length = 0;
    saveDB();
    updatePlotCtxSize();
  };
  customInput.onblur = () => {
    // 夹到合理范围
    let v = parseInt(customInput.value, 10);
    if (!(v > 0)) { f.lengthCustom = 0; customInput.value = ''; saveDB(); return; }
    v = Math.max(50, Math.min(5000, v));
    f.lengthCustom = v;
    customInput.value = String(v);
    saveDB();
    updatePlotCtxSize();
  };

  // 视角
  document.querySelectorAll('#pfPov button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === f.pov);
    b.onclick = () => {
      f.pov = b.dataset.v;
      document.querySelectorAll('#pfPov button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      saveDB();
    };
  });

  // 文本框
  const map = {
    pfScene: 'scene', pfGoal: 'goal', pfMust: 'must',
    pfBan: 'ban', pfEnd: 'end', pfExtra: 'extra'
  };
  for (const [id, key] of Object.entries(map)) {
    const el = $(id);
    el.value = f[key] || '';
    el.oninput = () => {
      f[key] = el.value;
      saveDB();
      updateClearVisibility();
      updatePlotCtxSize();
    };
    el.onblur = () => saveDB();
  }

  // 张数
  plotCount = f.count || 1;
  document.querySelectorAll('#plotSegCount button').forEach(b => {
    b.classList.toggle('on', Number(b.dataset.n) === plotCount);
    b.onclick = () => {
      plotCount = Number(b.dataset.n);
      f.count = plotCount;
      document.querySelectorAll('#plotSegCount button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      saveDB();
    };
  });

  // 温度
  const tr = $('plotTempRange');
  const temp = f.temperature || 1.0;
  tr.value = String(Math.round(temp * 100));
  $('plotTempVal').textContent = temp.toFixed(1);
  tr.oninput = () => {
    const v = Number(tr.value) / 100;
    $('plotTempVal').textContent = v.toFixed(1);
    f.temperature = v;
    saveDB();
  };

  updateClearVisibility();
}

/* 清空按钮：只有内容非空时才显示 */
function updateClearVisibility() {
  document.querySelectorAll('.pf-clear').forEach(btn => {
    const el = $(btn.dataset.clear);
    if (!el) return;
    btn.style.visibility = el.value.trim() ? 'visible' : 'hidden';
  });
}

/* ---------- 剧情上下文 ---------- */
function buildPlotContext() {
  const p = plotData();
  const f = p ? p.form : null;
  if (!f) return { system: '', size: 0 };

  const parts = [];

  // 文风不用于剧情输出，但状态/人设/摘要/全文照常带上
  if (db.ctx.state && db.stateFile.trim()) {
    parts.push('【故事状态文件】\n' + db.stateFile.trim());
  }

  // 人物：优先用表单勾选的焦点人物，其次用上下文的 charIds
  const validCharIds = (f.charIds || []).filter(id => db.characters.some(c => c.id === id));
  const ids = validCharIds.length ? validCharIds : (db.ctx.charIds || []).filter(id => db.characters.some(c => c.id === id));
  if (ids.length) {
    const chars = db.characters.filter(c => ids.includes(c.id));
    if (chars.length) {
      const txt = chars.map(c =>
        `—— ${c.name}${c.role ? '（' + c.role + '）' : ''} ——\n${(c.body || '').trim()}`
      ).join('\n\n');
      parts.push('【相关人物人设】\n' + txt);
    }
  }

  if (db.ctx.worldIds && db.ctx.worldIds.length) {
    const we = db.worldEntries.filter(w => db.ctx.worldIds.includes(w.id));
    if (we.length) {
      parts.push('【世界观设定】\n' + we.map(w => `—— ${w.title} ——\n${(w.body || '').trim()}`).join('\n\n'));
    }
  }

  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);
  if (db.ctx.summaryIds.length) {
    const sums = sorted
      .filter(c => db.ctx.summaryIds.includes(c.id) && c.summary && c.summary.trim())
      .map(c => `—— 第${c.no}章${c.title && c.title !== '未命名' ? '·' + c.title : ''} 摘要 ——\n${c.summary.trim()}`);
    if (sums.length) parts.push('【前情摘要】\n' + sums.join('\n\n'));
  }
  if (db.ctx.fullIds.length) {
    const refs = sorted
      .filter(c => db.ctx.fullIds.includes(c.id) && c.body && c.body.trim())
      .map(c => `—— 第${c.no}章${c.title && c.title !== '未命名' ? '·' + c.title : ''} 正文 ——\n${c.body.trim()}`);
    if (refs.length) parts.push('【原文参考】\n' + refs.join('\n\n'));
  }

  // 当前剧情编辑区（受开关控制）
  if (p.editor && p.editor.trim() && f.includePlot !== false) {
    parts.push('【当前已有剧情】\n' + p.editor.trim());
  }

  // 本次要素
  const brief = [];
  if (f.scene && f.scene.trim()) brief.push(`- 场景：${f.scene.trim()}`);
  if (f.goal && f.goal.trim()) brief.push(`- 这一场要推进：${f.goal.trim()}`);
  if (f.moods && f.moods.length) brief.push(`- 氛围：${f.moods.join('、')}`);
  if (f.pov) brief.push(`- 视角：${f.pov}`);
  if (f.must && f.must.trim()) brief.push(`- 必须发生：${f.must.trim()}`);
  if (f.ban && f.ban.trim()) brief.push(`- 禁止出现：${f.ban.trim()}`);
  if (f.end && f.end.trim()) brief.push(`- 结尾落点：${f.end.trim()}`);
  const effLen = (f.lengthCustom && Number(f.lengthCustom) > 0)
    ? Number(f.lengthCustom)
    : (f.length && Number(f.length) > 0 ? Number(f.length) : 0);
  if (effLen > 0) brief.push(`- 篇幅：约 ${effLen} 字`);
  if (f.extra && f.extra.trim()) brief.push(`- 补充：${f.extra.trim()}`);

  let system = parts.join('\n\n');
  if (brief.length) {
    system += (system ? '\n\n' : '') + '【本次剧情要求】\n' + brief.join('\n');
  }

  return { system, size: countWords(system) };
}

function renderPlotChips() {
  const box = $('plotCtxChips');
  box.innerHTML = '';

  // 状态文件（全局开关）
  const elState = document.createElement('span');
  elState.className = 'chip ' + (db.ctx.state ? 'on' : 'off');
  elState.textContent = '状态文件';
  elState.addEventListener('click', () => {
    db.ctx.state = !db.ctx.state;
    saveDB();
    renderPlotChips();
    updatePlotCtxSize();
  });
  box.appendChild(elState);

  // 当前剧情编辑区（剧情模式专属开关）
  const p0 = plotData();
  const incPlot = p0 && p0.form ? (p0.form.includePlot !== false) : true;
  const elPlot = document.createElement('span');
  elPlot.className = 'chip ' + (incPlot ? 'on' : 'off');
  elPlot.textContent = '当前剧情';
  elPlot.title = '是否把左侧剧情编辑区的内容发给 AI';
  elPlot.addEventListener('click', () => {
    const p = plotData();
    p.form.includePlot = !(p.form.includePlot !== false);
    saveDB();
    renderPlotChips();
    updatePlotCtxSize();
  });
  box.appendChild(elPlot);
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
  const p = plotData();
  // 只统计仍然存在的人物，避免显示已删除的脏 id
  const fc = p && p.form && Array.isArray(p.form.charIds)
    ? p.form.charIds.filter(id => db.characters.some(c => c.id === id)).length
    : 0;
  if (fc) {
    const el = document.createElement('span');
    el.className = 'chip on';
    el.textContent = `人物 ×${fc}`;
    box.appendChild(el);
  }
}

function updatePlotCtxSize() {
  const el = $('plotCtxSize');
  if (!el) return;
  const { size } = buildPlotContext();
  const total = size + countWords(getPlotPrompt());
  const tokens = Math.round(total * 0.75);
  el.textContent = `上下文 ${total.toLocaleString()} 字 · 约 ${tokens.toLocaleString()} tokens`;
  el.hidden = false;
}

/* ---------- 剧情卡渲染 ---------- */
function renderPlotCards() {
  const box = $('plotCards');
  box.innerHTML = '';

  for (const c of plotCards) {
    const el = document.createElement('div');
    el.className = 'card' + (c.streaming ? ' streaming' : '');

    if (c.streaming) {
      el.innerHTML = `<div class="card-loading"><span class="dot-pulse"><i></i><i></i><i></i></span><span>${c.text ? countWords(c.text) + ' 字…' : '生成中…'}</span></div>`;
      const t = document.createElement('div');
      t.className = 'card-text';
      t.textContent = c.text || '';
      el.appendChild(t);
    } else if (c.error) {
      el.innerHTML = `<div style="color:var(--danger);font-size:13px">${escapeHtml(c.error)}</div>`;
    } else {
      const t = document.createElement('div');
      t.className = 'card-text';
      t.textContent = c.text;
      el.appendChild(t);

      const foot = document.createElement('div');
      foot.className = 'card-foot';
      const meta = document.createElement('span');
      meta.className = 'card-meta';
      meta.textContent = c.brief || `第 ${c.seq} 张`;
      foot.appendChild(meta);

      const bIns = document.createElement('button');
      bIns.className = 'card-btn primary';
      bIns.textContent = '插入剧情';
      bIns.addEventListener('click', () => insertToPlot(c.text));

      const bCopy = document.createElement('button');
      bCopy.className = 'card-btn';
      bCopy.textContent = '复制';
      bCopy.addEventListener('click', () => copyText(c.text));

      const bDrop = document.createElement('button');
      bDrop.className = 'card-btn';
      bDrop.textContent = '丢弃';
      bDrop.addEventListener('click', () => {
        plotCards = plotCards.filter(x => x.seq !== c.seq);
        renderPlotCards();
      });

      foot.appendChild(bIns);
      foot.appendChild(bCopy);
      foot.appendChild(bDrop);

      // 要素小字
      if (c.brief) {
        const tag = document.createElement('div');
        tag.className = 'plot-card-tags';
        tag.textContent = c.brief;
        el.appendChild(tag);
      }
      el.appendChild(foot);
    }

    box.appendChild(el);
  }
  box.scrollTop = box.scrollHeight;
}

/* ---------- 抽剧情 ---------- */
async function doPlotDraw() {
  const p = plotData();
  if (!p) return;
  if (plotAbort) { toast('正在抽卡中…'); return; }

  const ctx = buildPlotContext();
  // 至少要有一点方向
  const f = p.form;
  const hasDirection = (f.goal && f.goal.trim()) || (f.scene && f.scene.trim()) ||
    (f.extra && f.extra.trim()) || (f.must && f.must.trim());
  if (!hasDirection) {
    toast('至少写一句「要推进什么」或场景');
    return;
  }

  // 提示词本体 + 背景资料，两者都要
  const promptBody = getPlotPrompt();
  const system = ctx.system
    ? promptBody + '\n\n' + ctx.system
    : promptBody;

  plotAbort = new AbortController();
  const btn = $('btnPlotDraw');
  btn.disabled = true;
  btn.querySelector('.draw-btn-text').textContent = '生成中…';

  const n = plotCount;
  plotCards = Array.from({ length: n }, (_, i) => ({ seq: i + 1, text: '', streaming: true, error: null, brief: '' }));

  // 要素小字
  const briefParts = [];
  if (f.moods && f.moods.length) briefParts.push(f.moods.join('/'));
  if (f.charIds && f.charIds.length) {
    const names = db.characters.filter(c => f.charIds.includes(c.id)).map(c => c.name);
    if (names.length) briefParts.push(names.join('+'));
  }
  const lenForTag = (f.lengthCustom && Number(f.lengthCustom) > 0)
    ? Number(f.lengthCustom)
    : (f.length && Number(f.length) > 0 ? Number(f.length) : 0);
  if (lenForTag > 0) briefParts.push(`约${lenForTag}字`);
  const brief = briefParts.join(' · ');
  plotCards.forEach(c => { c.brief = brief; });

  renderPlotCards();

  const userMsg = '请根据上面的条件，设计这一段剧情的梗概。';

  const tasks = plotCards.map(async card => {
    try {
      const full = await callModelWithTemp(
        system,
        userMsg,
        txt => {
          card.text = txt;
          const box = $('plotCards');
          const el = box.children[card.seq - 1];
          if (el) {
            const t = el.querySelector('.card-text');
            if (t) t.textContent = txt;
            const l = el.querySelector('.card-loading span:last-child');
            if (l) l.textContent = countWords(txt) + ' 字…';
          }
        },
        plotAbort.signal,
        f.temperature
      );
      card.text = full;
      card.streaming = false;
      if (full.trim()) {
        p.cards.push({
          id: uid(),
          text: full,
          brief,
          mood: (f.moods || []).slice(),
          charIds: (f.charIds || []).slice(),
          length: lenForTag || 0,
          createdAt: Date.now()
        });
        saveDB();
      }
    } catch (e) {
      card.streaming = false;
      card.error = e.name === 'AbortError' ? '已取消' : e.message;
    }
  });

  await Promise.all(tasks);
  plotAbort = null;
  btn.disabled = false;
  btn.querySelector('.draw-btn-text').textContent = '抽 剧 情';
  renderPlotCards();
}

/* 用指定温度调用（剧情卡有自己的温度滑杆） */
async function callModelWithTemp(systemMsg, userMsg, onChunk, signal, temp) {
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
      temperature: typeof temp === 'number' ? temp : s.temperature,
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
        if (piece) { full += piece; onChunk && onChunk(full); }
      } catch (e) {}
    }
  }
  return full;
}

/* ---------- 插入剧情编辑区 ---------- */
function insertToPlot(text) {
  const ed = $('plotEditor');
  const cur = ed.value;
  const needNL = cur && !cur.endsWith('\n') ? '\n\n' : '';
  ed.value = cur + needNL + text;
  const p = plotData();
  p.editor = ed.value;
  saveDB();
  updatePlotWordCount();
  updatePlotCtxSize();
  toast('已插入剧情编辑区');
}

/* ---------- 插入提示词框 ---------- */
function plotToPrompt() {
  const ed = $('plotEditor');
  const full = ed.value;

  if (!full.trim()) { toast('剧情编辑区是空的'); return; }

  // 有选中内容就只插选中的
  let content = full;
  let usedSelection = false;
  try {
    const s = ed.selectionStart, e = ed.selectionEnd;
    if (s !== e && s != null && e != null) {
      const sel = full.slice(s, e).trim();
      if (sel) { content = sel; usedSelection = true; }
    }
  } catch (err) {}

  const text = `根据剧情续写（）字：${content.trim()}`;

  // 写进正文模式的提示词框
  const pi = $('promptInput');
  if (!pi) { toast('找不到提示词框'); return; }
  pi.value = text;
  try { pi.focus(); } catch (e) {}

  // 切回正文模式，让用户看到结果
  if (plotMode) togglePlotMode();

  toast(usedSelection ? '已插入（选中部分）到提示词框' : '已插入（全部）到提示词框');
}

/* ---------- 剧情卡历史 ---------- */
function openPlotHistory() {
  plotHistQuery = '';
  plotHistLimit = 60;
  $('plotHistSearch').value = '';
  renderPlotHistory();
  openModal('modalPlotHistory');
}

function renderPlotHistory() {
  const list = $('plotHistList');
  list.innerHTML = '';
  const p = plotData();
  const all = (p.cards || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const q = plotHistQuery.trim().toLowerCase();
  const filtered = q ? all.filter(c => (c.text || '').toLowerCase().includes(q) || (c.brief || '').toLowerCase().includes(q)) : all;

  $('plotHistMeta').textContent = `共 ${all.length} 张` + (q ? `，匹配 ${filtered.length} 张` : '');

  if (!filtered.length) {
    list.innerHTML = `<div class="ctx-empty">${all.length ? '没有匹配的剧情卡' : '还没有剧情卡'}</div>`;
    return;
  }

  const shown = filtered.slice(0, plotHistLimit);
  for (const c of shown) {
    const el = document.createElement('div');
    el.className = 'hist-card';

    const head = document.createElement('div');
    head.className = 'hist-head';
    const time = document.createElement('span');
    time.className = 'hist-time';
    time.textContent = fmtDate(c.createdAt) + (c.brief ? ' · ' + c.brief : '');
    const wc = document.createElement('span');
    wc.className = 'hist-wc';
    wc.textContent = countWords(c.text) + ' 字';
    head.appendChild(time);
    head.appendChild(wc);

    const body = document.createElement('div');
    body.className = 'hist-text';
    body.textContent = c.text;
    if ((c.text || '').length > 180) body.classList.add('collapsed');

    const foot = document.createElement('div');
    foot.className = 'hist-foot';

    if ((c.text || '').length > 180) {
      const be = document.createElement('button');
      be.className = 'card-btn';
      be.textContent = '展开';
      be.addEventListener('click', () => {
        const cc = body.classList.toggle('collapsed');
        be.textContent = cc ? '展开' : '收起';
      });
      foot.appendChild(be);
    }

    const bi = document.createElement('button');
    bi.className = 'card-btn primary';
    bi.textContent = '插入剧情';
    bi.addEventListener('click', () => { insertToPlot(c.text); closeModal(); });

    const bc = document.createElement('button');
    bc.className = 'card-btn';
    bc.textContent = '复制';
    bc.addEventListener('click', () => copyText(c.text));

    const bd = document.createElement('button');
    bd.className = 'card-btn danger-soft';
    bd.textContent = '删除';
    bd.addEventListener('click', () => {
      const pp = plotData();
      pp.cards = pp.cards.filter(x => x.id !== c.id);
      saveDB();
      renderPlotHistory();
      toast('已删除');
    });

    foot.appendChild(bi);
    foot.appendChild(bc);
    foot.appendChild(bd);

    el.appendChild(head);
    el.appendChild(body);
    el.appendChild(foot);
    list.appendChild(el);
  }

  if (filtered.length > shown.length) {
    const more = document.createElement('button');
    more.className = 'ghost-btn full';
    more.textContent = `加载更多（还有 ${filtered.length - shown.length} 张）`;
    more.addEventListener('click', () => { plotHistLimit += 60; renderPlotHistory(); });
    list.appendChild(more);
  }
}

async function clearPlotHistory() {
  const p = plotData();
  const n = (p.cards || []).length;
  if (!n) { toast('没有可清空的剧情卡'); return; }
  const ok = await askConfirm('清空全部剧情卡？', `将删除 ${n} 张剧情卡，删除后无法找回。剧情编辑区的内容不受影响。`, '全部清空');
  if (!ok) return;
  p.cards = [];
  saveDB();
  renderPlotHistory();
  toast('已清空');
}
