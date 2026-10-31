/* ===== 人设库：人物 + 世界观 ===== */

let castTab = 'char';
let editingCharId = null;
let editingWorldId = null;
let extractAbort = null;
let extractPick = [];      // 提取时临时勾选的章节 id
let reviewItems = [];      // 提取结果待确认列表

/* ---------- 打开人设库 ---------- */
function openCast() {
  renderCastList();
  openModal('modalCast');
}

function switchCastTab(tab) {
  castTab = tab;
  document.querySelectorAll('#segCastTab button').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === tab);
  });
  $('castCharPane').hidden = tab !== 'char';
  $('castWorldPane').hidden = tab !== 'world';
}

/* ---------- 别名工具 ---------- */
function splitAliases(str) {
  if (!str) return [];
  return String(str)
    .split(/[、,，;；\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** 返回该人物的所有称呼（姓名 + 别名） */
function allNamesOf(c) {
  const set = new Set();
  if (c.name) set.add(c.name);
  for (const a of splitAliases(c.alias)) set.add(a);
  return [...set];
}

/** 查找名字命中的人物；返回 {exact: [...], fuzzy: [...]} */
function findByName(name) {
  if (!name) return { exact: [], fuzzy: [] };
  const exact = [];   // 姓名完全相同
  const fuzzy = [];   // 命中别名，或包含关系
  for (const c of db.characters) {
    if (c.name === name) { exact.push(c); continue; }
    const names = allNamesOf(c);
    if (names.includes(name)) { fuzzy.push(c); continue; }
    // 包含关系：如 "许昭昭" 与 "昭昭"
    const related = names.some(n =>
      n.length >= 2 && name.length >= 2 && (n.includes(name) || name.includes(n)));
    if (related) fuzzy.push(c);
  }
  return { exact, fuzzy };
}

/* ---------- 列表渲染 ---------- */
function renderCastList() {
  const cl = $('castCharList');
  cl.innerHTML = '';
  if (!db.characters.length) {
    cl.innerHTML = '<div class="ctx-empty">还没有人物<br>可以手动新建，或从章节里提取</div>';
  } else {
    for (const c of db.characters) {
      const el = document.createElement('div');
      el.className = 'cast-item';

      const main = document.createElement('div');
      main.className = 'cast-main';
      const nm = document.createElement('div');
      nm.className = 'cast-name';
      nm.textContent = c.name + (c.role ? `（${c.role}）` : '');
      const pv = document.createElement('div');
      pv.className = 'cast-preview';
      const aliasArr = splitAliases(c.alias);
      const aliasTxt = aliasArr.length ? `又名：${aliasArr.join('、')} · ` : '';
      pv.textContent = aliasTxt + ((c.body || '').replace(/\s+/g, ' ').slice(0, 40) || '（空）');
      main.appendChild(nm);
      main.appendChild(pv);
      main.addEventListener('click', () => openCharEdit(c.id));

      const del = document.createElement('span');
      del.className = 'cast-del';
      del.textContent = '×';
      del.addEventListener('click', e => {
        e.stopPropagation();
        deleteCharacter(c.id);
      });

      el.appendChild(main);
      el.appendChild(del);
      cl.appendChild(el);
    }
  }

  const wl = $('castWorldList');
  wl.innerHTML = '';
  if (!db.worldEntries.length) {
    wl.innerHTML = '<div class="ctx-empty">还没有世界观条目</div>';
  } else {
    for (const w of db.worldEntries) {
      const el = document.createElement('div');
      el.className = 'cast-item';
      const main = document.createElement('div');
      main.className = 'cast-main';
      const nm = document.createElement('div');
      nm.className = 'cast-name';
      nm.textContent = w.title;
      const pv = document.createElement('div');
      pv.className = 'cast-preview';
      pv.textContent = (w.body || '').replace(/\s+/g, ' ').slice(0, 48) || '（空）';
      main.appendChild(nm);
      main.appendChild(pv);
      main.addEventListener('click', () => openWorldEdit(w.id));

      const del = document.createElement('span');
      del.className = 'cast-del';
      del.textContent = '×';
      del.addEventListener('click', e => {
        e.stopPropagation();
        deleteWorld(w.id);
      });

      el.appendChild(main);
      el.appendChild(del);
      wl.appendChild(el);
    }
  }
}

/* ---------- 人物编辑 ---------- */
function openCharEdit(id) {
  const c = id ? db.characters.find(x => x.id === id) : null;
  editingCharId = c ? c.id : null;
  $('charEditTitle').textContent = c ? '编辑人物' : '新建人物';
  $('charName').value = c ? c.name : '';
  $('charRole').value = c ? (c.role || '') : '';
  $('charAlias').value = c ? (c.alias || '') : '';
  $('charBody').value = c ? (c.body || '') : '';
  $('btnDeleteChar').hidden = !c;
  $('btnDeleteChar').style.display = c ? 'block' : 'none';
  openModal('modalCharEdit');
}

function saveCharacter() {
  const name = $('charName').value.trim();
  if (!name) { toast('姓名不能为空'); return; }

  const role = $('charRole').value.trim();
  const alias = $('charAlias').value.trim();
  const body = $('charBody').value.trim();

  if (editingCharId) {
    const c = db.characters.find(x => x.id === editingCharId);
    if (c) { c.name = name; c.role = role; c.alias = alias; c.body = body; }
  } else {
    db.characters.push({ id: uid(), name, role, alias, body });
  }
  saveDB();
  renderCtxLists();
  renderCtxChips();
  closeModal();
  setTimeout(returnToCast, 260);
  toast('已保存');
}

function returnToCast() {
  renderCastList();
  openModal('modalCast');
}

async function deleteCharacter(id) {
  const c = db.characters.find(x => x.id === id);
  if (!c) return;
  const ok = await askConfirm('删除这个人物？', `「${c.name}」的人设会被删除，无法恢复。`, '删除');
  if (!ok) return;
  db.characters = db.characters.filter(x => x.id !== id);
  db.ctx.charIds = db.ctx.charIds.filter(x => x !== id);
  // 同步清理剧情表单里的勾选，否则会留下指向已删除人物的脏数据
  if (db.plot && db.plot.form && Array.isArray(db.plot.form.charIds)) {
    db.plot.form.charIds = db.plot.form.charIds.filter(x => x !== id);
  }
  saveDB();
  renderCtxLists();
  renderCtxChips();
  if (typeof plotMode !== 'undefined' && plotMode) {
    try { ensurePlotForm(); renderPlotChips(); updatePlotCtxSize(); } catch (e) {}
  }
  closeModal();
  setTimeout(returnToCast, 260);
  toast('已删除');
}

/* ---------- 世界观编辑 ---------- */
function openWorldEdit(id) {
  const w = id ? db.worldEntries.find(x => x.id === id) : null;
  editingWorldId = w ? w.id : null;
  $('worldTitle').value = w ? w.title : '';
  $('worldBody').value = w ? (w.body || '') : '';
  $('btnDeleteWorld').hidden = !w;
  $('btnDeleteWorld').style.display = w ? 'block' : 'none';
  openModal('modalWorldEdit');
}

function saveWorld() {
  const title = $('worldTitle').value.trim();
  if (!title) { toast('标题不能为空'); return; }
  const body = $('worldBody').value.trim();

  if (editingWorldId) {
    const w = db.worldEntries.find(x => x.id === editingWorldId);
    if (w) { w.title = title; w.body = body; }
  } else {
    db.worldEntries.push({ id: uid(), title, body });
  }
  saveDB();
  renderCtxLists();
  renderCtxChips();
  closeModal();
  setTimeout(returnToCast, 260);
  toast('已保存');
}

async function deleteWorld(id) {
  const w = db.worldEntries.find(x => x.id === id);
  if (!w) return;
  const ok = await askConfirm('删除这个条目？', `「${w.title}」会被删除，无法恢复。`, '删除');
  if (!ok) return;
  db.worldEntries = db.worldEntries.filter(x => x.id !== id);
  db.ctx.worldIds = db.ctx.worldIds.filter(x => x !== id);
  saveDB();
  renderCtxLists();
  renderCtxChips();
  closeModal();
  setTimeout(returnToCast, 260);
  toast('已删除');
}

/* ============================================================
   提取人物
   ============================================================ */

const EXTRACT_PROMPT = `你是一个网文创作辅助系统，负责从小说正文中提取人物人设。

【要求】
1. 只提取在正文中有实质出场或被明确提到的人物，路人一笔带过的不提。
2. 输出格式如下，每个人物之间用单独一行 "---" 分隔：

姓名：XXX
称呼：XXX、XXX
身份：XXX
人设：XXX

3. 「姓名」填最正式、最完整的那个称呼。如果原文只给了小名或绰号，就填那个。
4. 「称呼」列出正文中出现的该人物的其他所有称呼（小名、昵称、绰号、姓+职位等），用顿号分隔。没有其他称呼就写"无"。
   注意：如果某个称呼可能属于别人，不要硬塞进来。
5. 「人设」用 3-6 条短句，覆盖：外貌（如有）、性格特点、说话方式、当前处境、与其他角色的关系。
6. 只写正文中明确出现的信息，不要编造。看不出来的就不写。
7. 不要复制原文完整句子，用自己的话概括。
8. 只输出人物条目本身，不要开场白或总结。`;

function openExtractPick() {
  // 默认勾选上下文里已选的全文章节；没有就全不选
  extractPick = [...(db.ctx.fullIds || [])];

  const list = $('extractChapterList');
  list.innerHTML = '';
  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);

  if (!sorted.length) {
    list.innerHTML = '<div class="ctx-empty">还没有章节</div>';
  } else {
    for (const c of sorted) {
      const label = document.createElement('label');
      label.className = 'ctx-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = extractPick.includes(c.id);
      cb.addEventListener('change', () => {
        const i = extractPick.indexOf(c.id);
        if (cb.checked && i < 0) extractPick.push(c.id);
        if (!cb.checked && i >= 0) extractPick.splice(i, 1);
      });
      const span = document.createElement('span');
      span.textContent = `第${c.no}章 · ${c.title || '未命名'}（${countWords(c.body)}字）`;
      label.appendChild(cb);
      label.appendChild(span);
      list.appendChild(label);
    }
  }
  openModal('modalExtractPick');
}

async function runExtract() {
  if (!extractPick.length) { toast('先勾选章节'); return; }

  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);
  const picked = sorted.filter(c => extractPick.includes(c.id) && c.body.trim());
  if (!picked.length) { toast('勾选的章节没有正文'); return; }

  const content = picked.map(c =>
    `—— 第${c.no}章${c.title && c.title !== '未命名' ? '·' + c.title : ''} ——\n${c.body.trim()}`
  ).join('\n\n');

  const btn = $('btnDoExtract');
  btn.textContent = '提取中…';
  btn.disabled = true;
  extractAbort = new AbortController();

  try {
    const out = await callModel(
      EXTRACT_PROMPT,
      `请从以下正文中提取人物人设。\n\n${content}`,
      null,
      extractAbort.signal
    );
    const parsed = parseCharacters(out);
    if (!parsed.length) { toast('没有解析出人物'); return; }
    buildReview(parsed);
  } catch (e) {
    toast(e.name === 'AbortError' ? '已取消' : '提取失败：' + e.message);
  } finally {
    extractAbort = null;
    btn.textContent = '提取';
    btn.disabled = false;
  }
}

function parseCharacters(text) {
  const blocks = text.split(/\n\s*-{3,}\s*\n/);
  const out = [];
  for (const b of blocks) {
    const nameM = b.match(/姓名[：:]\s*(.+)/);
    if (!nameM) continue;
    const name = nameM[1].trim().replace(/^[「『]|[」』]$/g, '');
    if (!name || name.length > 20) continue;

    const callM = b.match(/称呼[：:]\s*(.+)/);
    const roleM = b.match(/身份[：:]\s*(.+)/);
    const bodyM = b.match(/人设[：:]\s*([\s\S]*)/);

    let calls = [];
    if (callM) {
      const raw = callM[1].trim();
      if (raw && raw !== '无') calls = splitAliases(raw);
    }

    out.push({
      name,
      role: roleM ? roleM[1].trim() : '',
      calls,
      body: bodyM ? bodyM[1].trim() : ''
    });
  }
  return out;
}

/* ---------- 构建确认列表 ---------- */
function buildReview(parsed) {
  reviewItems = parsed.map(p => {
    const hit = findByName(p.name);
    // 也试试别称能不能命中
    let matched = hit.exact[0] || hit.fuzzy[0] || null;
    let reason = '';
    if (hit.exact.length) reason = '同名';
    else if (hit.fuzzy.length) reason = '称呼相近';

    // 如果名字没命中，试试各个称呼
    if (!matched) {
      for (const c of p.calls) {
        const h2 = findByName(c);
        if (h2.exact[0] || h2.fuzzy[0]) {
          matched = h2.exact[0] || h2.fuzzy[0];
          reason = '称呼命中';
          break;
        }
      }
    }

    return {
      name: p.name,
      role: p.role,
      calls: p.calls,
      body: p.body,
      action: matched ? 'merge' : 'new',   // 默认：命中则合并，否则新建
      targetId: matched ? matched.id : null,
      reason,
      skip: false
    };
  });

  renderReview();
  const mergeCount = reviewItems.filter(r => r.action === 'merge').length;
  const newCount = reviewItems.filter(r => r.action === 'new').length;
  $('extractSummaryText').textContent =
    `解析出 ${reviewItems.length} 个人物：${newCount} 个新建，${mergeCount} 个可合并到已有卡片。请逐一确认。`;
  openModal('modalExtractReview');
}

function renderReview() {
  const box = $('extractReviewList');
  box.innerHTML = '';

  reviewItems.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'review-card';

    const head = document.createElement('div');
    head.className = 'review-head';
    const nm = document.createElement('div');
    nm.className = 'review-name';
    nm.textContent = item.name + (item.role ? `（${item.role}）` : '');
    const badge = document.createElement('span');
    badge.className = 'review-badge ' + (item.action === 'merge' ? 'merge' : 'new');
    badge.textContent = item.action === 'merge' ? '合并' : '新建';
    head.appendChild(nm);
    head.appendChild(badge);
    card.appendChild(head);

    if (item.calls.length) {
      const calls = document.createElement('div');
      calls.className = 'review-line';
      calls.textContent = '称呼：' + item.calls.join('、');
      card.appendChild(calls);
    }

    if (item.role) {
      const r = document.createElement('div');
      r.className = 'review-line';
      r.textContent = '身份：' + item.role;
      card.appendChild(r);
    }

    if (item.body) {
      const b = document.createElement('div');
      b.className = 'review-body';
      b.textContent = item.body;
      card.appendChild(b);
    }

    // 匹配到谁
    if (item.action === 'merge' && item.targetId) {
      const t = db.characters.find(c => c.id === item.targetId);
      if (t) {
        const m = document.createElement('div');
        m.className = 'review-match';
        m.textContent = `→ 合并到已有卡片「${t.name}」（${item.reason || '手动指定'}）`;
        card.appendChild(m);
      }
    }

    // 操作
    const ops = document.createElement('div');
    ops.className = 'review-ops';

    const btnMerge = document.createElement('button');
    btnMerge.className = 'card-btn' + (item.action === 'merge' ? ' primary' : '');
    btnMerge.textContent = '合并到…';
    btnMerge.addEventListener('click', () => {
      openPickTarget(idx);
    });

    const btnNew = document.createElement('button');
    btnNew.className = 'card-btn' + (item.action === 'new' ? ' primary' : '');
    btnNew.textContent = '作为新人物';
    btnNew.addEventListener('click', () => {
      item.action = 'new';
      item.targetId = null;
      item.reason = '';
      renderReview();
    });

    const btnSkip = document.createElement('button');
    btnSkip.className = 'card-btn';
    btnSkip.textContent = item.skip ? '已跳过' : '跳过';
    btnSkip.addEventListener('click', () => {
      item.skip = !item.skip;
      renderReview();
    });

    ops.appendChild(btnMerge);
    ops.appendChild(btnNew);
    ops.appendChild(btnSkip);
    card.appendChild(ops);

    if (item.skip) card.classList.add('skipped');
    box.appendChild(card);
  });
}

function applyExtract() {
  let added = 0, merged = 0, skipped = 0;

  for (const item of reviewItems) {
    if (item.skip) { skipped++; continue; }

    if (item.action === 'merge' && item.targetId) {
      const t = db.characters.find(c => c.id === item.targetId);
      if (t) {
        // 合并别名
        const exist = new Set(splitAliases(t.alias));
        if (item.name && item.name !== t.name) exist.add(item.name);
        for (const c of item.calls) if (c !== t.name) exist.add(c);
        t.alias = [...exist].filter(Boolean).join('、');
        // 补空字段
        if (!t.role && item.role) t.role = item.role;
        if (item.body) {
          t.body = t.body
            ? (t.body.includes(item.body.slice(0, 20)) ? t.body : t.body + '\n' + item.body)
            : item.body;
        }
        merged++;
        continue;
      }
    }

    // 新建
    db.characters.push({
      id: uid(),
      name: item.name,
      role: item.role,
      alias: item.calls.filter(c => c !== item.name).join('、'),
      body: item.body
    });
    added++;
  }

  saveDB();
  renderCtxLists();
  renderCtxChips();
  closeModal();
  setTimeout(returnToCast, 260);

  const parts = [];
  if (added) parts.push(`新建 ${added}`);
  if (merged) parts.push(`合并 ${merged}`);
  if (skipped) parts.push(`跳过 ${skipped}`);
  toast(parts.length ? '完成：' + parts.join('，') : '没有变化');
}

/* ---------- 选择合并目标 ---------- */
let pickingIdx = -1;
let pickQuery = '';

/** 按相关度给候选排序：同名 > 称呼命中 > 包含关系 > 其他 */
function buildTargetCandidates(item) {
  const scored = [];
  for (const c of db.characters) {
    const names = allNamesOf(c);
    let score = 0;
    let why = '';

    if (c.name === item.name) { score = 100; why = '同名'; }
    else if (names.includes(item.name)) { score = 90; why = '是你的别名'; }
    else if (item.calls.some(x => names.includes(x))) { score = 80; why = '称呼命中'; }
    else {
      const related = names.some(n =>
        n.length >= 2 && item.name.length >= 2 && (n.includes(item.name) || item.name.includes(n)));
      if (related) { score = 60; why = '名字相近'; }
    }

    // 已经指向的那个也保留
    if (item.targetId === c.id && score === 0) { score = 50; why = '当前选择'; }

    scored.push({ char: c, score, why });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function openPickTarget(idx) {
  pickingIdx = idx;
  pickQuery = '';
  renderPickTarget();
  openModal('modalPickTarget');
}

function renderPickTarget() {
  const item = reviewItems[pickingIdx];
  if (!item) return;

  $('pickTargetTitle').textContent = `合并「${item.name}」到…`;

  const input = $('pickSearch');
  input.value = pickQuery;

  const list = $('pickTargetList');
  list.innerHTML = '';

  const q = pickQuery.trim();
  let scored = buildTargetCandidates(item);
  if (q) {
    scored = scored.filter(s => {
      const names = allNamesOf(s.char);
      return names.some(n => n.includes(q)) || (s.char.role || '').includes(q);
    });
  }

  if (!scored.length) {
    list.innerHTML = '<div class="ctx-empty">没有匹配的卡片<br>可以先「作为新人物」</div>';
    return;
  }

  for (const s of scored) {
    const el = document.createElement('div');
    el.className = 'pick-item' + (item.targetId === s.char.id ? ' on' : '');

    const main = document.createElement('div');
    main.className = 'pick-main';
    const nm = document.createElement('div');
    nm.className = 'pick-name';
    nm.textContent = s.char.name + (s.char.role ? `（${s.char.role}）` : '');
    const sub = document.createElement('div');
    sub.className = 'pick-sub';
    const al = splitAliases(s.char.alias);
    const parts = [];
    if (al.length) parts.push('又名 ' + al.join('、'));
    if (s.why) parts.push(s.why);
    if (!parts.length) parts.push((s.char.body || '').replace(/\s+/g, ' ').slice(0, 30));
    sub.textContent = parts.join(' · ');
    main.appendChild(nm);
    main.appendChild(sub);

    const check = document.createElement('span');
    check.className = 'pick-check';
    check.textContent = item.targetId === s.char.id ? '✓' : '';

    el.appendChild(main);
    el.appendChild(check);

    el.addEventListener('click', () => {
      item.action = 'merge';
      item.targetId = s.char.id;
      item.reason = '手动指定';
      renderReview();
      closeModal();
    });

    list.appendChild(el);
  }
}
