/* ===== 大纲 =====
   三种文档：
   - 总纲：单份纯文本
   - 卷纲：多份，按起止章号划分
   - 章纲：每章一条，挂在具体章节 id 上

   删除方向是单向的：
   - 删章节 → 连带删掉这章的章纲（会提示）
   - 删章纲 → 绝不碰章节正文
   */

let outlineMode = false;
let outlineTab = 'master';
let masterSaveTimer = null;
let editingVolId = null;
let editingChapId = null;

/* ---------- 数据结构 ---------- */
function outlineData() {
  if (!db) return null;
  if (!db.outline) {
    db.outline = {
      master: '',          // 总纲文本
      volumes: [],         // {id, name, from, to, body}
      chapterOutlines: {}  // { [chapterId]: text }
    };
  }
  if (!Array.isArray(db.outline.volumes)) db.outline.volumes = [];
  if (!db.outline.chapterOutlines || typeof db.outline.chapterOutlines !== 'object') {
    db.outline.chapterOutlines = {};
  }
  return db.outline;
}

/* ---------- 模式切换 ---------- */
function toggleOutlineMode() {
  outlineMode = !outlineMode;

  // 互斥：打开大纲时关掉剧情
  if (outlineMode && typeof plotMode !== 'undefined' && plotMode) {
    plotMode = false;
    $('modePlot').hidden = true;
    $('btnMode').classList.remove('on');
  }

  $('modeNovel').hidden = outlineMode;
  $('modeOutline').hidden = !outlineMode;
  $('btnOutline').classList.toggle('on', outlineMode);

  if (outlineMode) {
    applyOutlineTopbar();
    loadMaster();
    renderVolumeList();
    renderChapterOutlineList();
  } else {
    refreshNovelTopbar();
  }
}

function applyOutlineTopbar() {
  const c = currentChapter();
  const t = $('chapterTitle');
  if (c) {
    t.textContent = `第${c.no}章 · ${c.title || '未命名'} · 大纲`;
  } else {
    t.textContent = '大纲';
  }
  t.classList.remove('editable');
}

/* 从其他模式切到大纲时，要确保正文/剧情模式关掉 */
function closeOtherModes() {
  if (typeof plotMode !== 'undefined' && plotMode) {
    plotMode = false;
    $('modePlot').hidden = true;
    $('btnMode').classList.remove('on');
  }
  if (typeof outlineMode !== 'undefined' && outlineMode) {
    outlineMode = false;
    $('modeOutline').hidden = true;
    $('btnOutline').classList.remove('on');
  }
  $('modeNovel').hidden = false;
}

/* ---------- 标签切换 ---------- */
function switchOutlineTab(t) {
  outlineTab = t;
  document.querySelectorAll('#segOutlineTab button').forEach(b => {
    b.classList.toggle('on', b.dataset.t === t);
  });
  $('paneMaster').hidden = t !== 'master';
  $('paneVolume').hidden = t !== 'volume';
  $('paneChapter').hidden = t !== 'chapter';

  if (t === 'volume') renderVolumeList();
  if (t === 'chapter') renderChapterOutlineList();
}

/* ---------- 总纲 ---------- */
function loadMaster() {
  const o = outlineData();
  if (!o) return;
  $('masterArea').value = o.master || '';
  updateMasterCount();
}

function updateMasterCount() {
  const o = outlineData();
  $('masterCount').textContent = countWords(o ? o.master : '') + ' 字';
}

function saveMaster() {
  const o = outlineData();
  if (!o) return;
  o.master = $('masterArea').value;
  saveDB();
  updateMasterCount();
}

/* ---------- 卷纲 ---------- */
function renderVolumeList() {
  const o = outlineData();
  const list = $('volumeList');
  list.innerHTML = '';

  const vols = [...o.volumes].sort((a, b) => (a.from || 0) - (b.from || 0));
  if (!vols.length) {
    list.innerHTML = '<div class="ctx-empty">还没有卷<br>点右上「＋ 新建卷」</div>';
    return;
  }

  for (const v of vols) {
    const el = document.createElement('div');
    el.className = 'outline-item';

    const main = document.createElement('div');
    main.className = 'outline-item-main';

    const name = document.createElement('div');
    name.className = 'outline-item-title';
    name.textContent = v.name || '未命名卷';

    const range = document.createElement('div');
    range.className = 'outline-item-sub';
    range.textContent = `第 ${v.from || '?'} 章 — 第 ${v.to || '?'} 章`;

    main.appendChild(name);
    main.appendChild(range);
    main.addEventListener('click', () => openVolumeEdit(v.id));

    const del = document.createElement('span');
    del.className = 'outline-item-del';
    del.textContent = '×';
    del.addEventListener('click', e => {
      e.stopPropagation();
      deleteVolume(v.id);
    });

    el.appendChild(main);
    el.appendChild(del);
    list.appendChild(el);
  }
}

function openVolumeEdit(id) {
  const o = outlineData();
  const v = id ? o.volumes.find(x => x.id === id) : null;
  editingVolId = v ? v.id : null;

  $('volumeEditTitle').textContent = v ? '编辑卷' : '新建卷';
  $('volName').value = v ? (v.name || '') : '';
  $('volBody').value = v ? (v.body || '') : '';

  // 起止章：新建时给个合理默认
  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);
  const maxNo = sorted.length ? sorted[sorted.length - 1].no : 1;
  if (v) {
    $('volFrom').value = v.from || '';
    $('volTo').value = v.to || '';
  } else {
    const lastVol = [...o.volumes].sort((a, b) => (b.to || 0) - (a.to || 0))[0];
    $('volFrom').value = lastVol ? (Number(lastVol.to) + 1) : 1;
    $('volTo').value = maxNo;
  }

  $('btnDeleteVolume').hidden = !v;
  $('btnDeleteVolume').style.display = v ? 'block' : 'none';

  openModal('modalVolumeEdit');
  setTimeout(() => { try { $('volName').focus(); } catch (e) {} }, 320);
}

function saveVolume() {
  const o = outlineData();
  const name = $('volName').value.trim();
  if (!name) { toast('卷名不能为空'); return; }

  const from = parseInt($('volFrom').value, 10);
  const to = parseInt($('volTo').value, 10);
  if (!(from > 0) || !(to > 0)) { toast('请填写起止章号'); return; }
  if (to < from) { toast('结束章不能小于起始章'); return; }

  const body = $('volBody').value;

  if (editingVolId) {
    const v = o.volumes.find(x => x.id === editingVolId);
    if (v) { v.name = name; v.from = from; v.to = to; v.body = body; }
  } else {
    o.volumes.push({ id: uid(), name, from, to, body });
  }
  saveDB();
  renderVolumeList();
  renderCtxLists();
  closeModal();
  setTimeout(returnToOutline, 260);
  toast('已保存');
}

/* 删除卷：只删卷纲本身，绝不碰章节 */
async function deleteVolume(id) {
  const o = outlineData();
  const v = o.volumes.find(x => x.id === id);
  if (!v) return;

  const ok = await askConfirm(
    `删除「${v.name || '未命名卷'}」？`,
    '只删除这一卷的大纲内容。章节正文、章纲都不会受影响。',
    '删除卷纲'
  );
  if (!ok) return;

  o.volumes = o.volumes.filter(x => x.id !== id);
  db.ctx.volumeIds = (db.ctx.volumeIds || []).filter(x => x !== id);
  saveDB();
  renderVolumeList();
  renderCtxLists();
  closeModal();
  setTimeout(returnToOutline, 260);
  toast('已删除');
}

function returnToOutline() {
  // 关闭编辑弹窗后回到大纲页
  $('modeOutline').hidden = !outlineMode;
}

/* ---------- 章纲 ---------- */
function renderChapterOutlineList() {
  const o = outlineData();
  const list = $('chapterOutlineList');
  list.innerHTML = '';

  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);
  if (!sorted.length) {
    list.innerHTML = '<div class="ctx-empty">还没有章节</div>';
    return;
  }

  for (const c of sorted) {
    const text = o.chapterOutlines[c.id];
    const el = document.createElement('div');
    el.className = 'outline-item';

    const main = document.createElement('div');
    main.className = 'outline-item-main';

    const name = document.createElement('div');
    name.className = 'outline-item-title';
    name.textContent = `第${c.no}章 · ${c.title || '未命名'}`;

    const sub = document.createElement('div');
    sub.className = 'outline-item-sub outline-preview';
    sub.textContent = text && text.trim()
      ? text.replace(/\s+/g, ' ').slice(0, 60)
      : '（还没有章纲）';
    if (!text || !text.trim()) sub.classList.add('empty');

    main.appendChild(name);
    main.appendChild(sub);
    main.addEventListener('click', () => openChapOutlineEdit(c.id));

    el.appendChild(main);
    list.appendChild(el);
  }
}

function openChapOutlineEdit(chapterId) {
  const o = outlineData();
  const c = db.chapters.find(x => x.id === chapterId);
  if (!c) return;

  editingChapId = chapterId;
  $('chapEditTitle').textContent = '章纲';
  $('chapEditSub').textContent = `第${c.no}章 · ${c.title || '未命名'}`;
  $('chapBody').value = o.chapterOutlines[chapterId] || '';
  openModal('modalChapOutlineEdit');
  setTimeout(() => { try { $('chapBody').focus(); } catch (e) {} }, 320);
}

function saveChapOutline() {
  const o = outlineData();
  if (!editingChapId) return;
  const v = $('chapBody').value.trim();
  if (v) o.chapterOutlines[editingChapId] = v;
  else delete o.chapterOutlines[editingChapId];
  saveDB();
  renderChapterOutlineList();
  renderCtxLists();
  closeModal();
  toast('已保存');
}

/* 章节被删除时调用：连带清理这章的章纲 */
function cleanupChapterOutline(chapterId) {
  const o = outlineData();
  if (!o) return false;
  if (o.chapterOutlines[chapterId]) {
    delete o.chapterOutlines[chapterId];
    return true;
  }
  return false;
}

/* ---------- 查找某章所属的卷 ---------- */
function volumeOfChapter(no) {
  const o = outlineData();
  if (!o) return null;
  return [...o.volumes]
    .filter(v => no >= (v.from || 0) && no <= (v.to || 0))
    .sort((a, b) => (a.from || 0) - (b.from || 0))[0] || null;
}
