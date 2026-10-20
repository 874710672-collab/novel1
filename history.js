/* ===== 历史卡片 ===== */

let histQuery = '';
let histLimit = 60;          // 单次渲染上限，避免一次渲染几百张卡

function openHistory() {
  histQuery = '';
  histLimit = 60;
  $('histSearch').value = '';
  renderHistory();
  openModal('modalHistory');
}

function bytesOf(text) {
  try { return new Blob([text]).size; } catch (e) { return text.length * 3; }
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (sameDay) return '今天 ' + hm;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function renderHistory() {
  const list = $('histList');
  list.innerHTML = '';

  const all = (db.cards || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const q = histQuery.trim().toLowerCase();
  const filtered = q
    ? all.filter(c =>
        (c.text || '').toLowerCase().includes(q) ||
        (c.prompt || '').toLowerCase().includes(q) ||
        (c.chapterTitle || '').toLowerCase().includes(q))
    : all;

  // 统计
  const totalBytes = all.reduce((s, c) => s + bytesOf(c.text || ''), 0);
  const shown = filtered.slice(0, histLimit);
  $('histMeta').textContent =
    `共 ${all.length} 张` + (q ? `，匹配 ${filtered.length} 张` : '') +
    ` · 占用约 ${(totalBytes / 1024).toFixed(0)} KB`;

  if (!filtered.length) {
    list.innerHTML = `<div class="ctx-empty">${all.length ? '没有匹配的卡片' : '还没有抽卡记录'}</div>`;
    return;
  }

  for (const c of shown) {
    const el = document.createElement('div');
    el.className = 'hist-card';

    const head = document.createElement('div');
    head.className = 'hist-head';
    const meta = document.createElement('span');
    meta.className = 'hist-time';
    const bits = [fmtDate(c.createdAt)];
    if (c.chapterNo) bits.push(`第${c.chapterNo}章`);
    if (typeof c.temperature === 'number') bits.push(`温度${c.temperature.toFixed(1)}`);
    meta.textContent = bits.join(' · ');
    const wc = document.createElement('span');
    wc.className = 'hist-wc';
    wc.textContent = countWords(c.text) + ' 字';
    head.appendChild(meta);
    head.appendChild(wc);

    const body = document.createElement('div');
    body.className = 'hist-text';
    body.textContent = c.text;
    // 长卡片默认折叠
    if ((c.text || '').length > 180) body.classList.add('collapsed');

    const foot = document.createElement('div');
    foot.className = 'hist-foot';

    if ((c.text || '').length > 180) {
      const btnExpand = document.createElement('button');
      btnExpand.className = 'card-btn';
      btnExpand.textContent = '展开';
      btnExpand.addEventListener('click', () => {
        const collapsed = body.classList.toggle('collapsed');
        btnExpand.textContent = collapsed ? '展开' : '收起';
      });
      foot.appendChild(btnExpand);
    }

    const btnInsert = document.createElement('button');
    btnInsert.className = 'card-btn primary';
    btnInsert.textContent = '插入正文';
    btnInsert.addEventListener('click', () => {
      insertToEditor(c.text);
      closeModal();
    });

    const btnCopy = document.createElement('button');
    btnCopy.className = 'card-btn';
    btnCopy.textContent = '复制';
    btnCopy.addEventListener('click', () => copyText(c.text));

    const btnDel = document.createElement('button');
    btnDel.className = 'card-btn danger-soft';
    btnDel.textContent = '删除';
    btnDel.addEventListener('click', () => deleteHistoryCard(c.id));

    foot.appendChild(btnInsert);
    foot.appendChild(btnCopy);
    foot.appendChild(btnDel);

    el.appendChild(head);
    el.appendChild(body);
    if (c.prompt) {
      const pr = document.createElement('div');
      pr.className = 'hist-prompt';
      pr.textContent = '提示词：' + c.prompt;
      el.appendChild(pr);
    }
    el.appendChild(foot);
    list.appendChild(el);
  }

  if (filtered.length > shown.length) {
    const more = document.createElement('button');
    more.className = 'ghost-btn full';
    more.textContent = `加载更多（还有 ${filtered.length - shown.length} 张）`;
    more.addEventListener('click', () => {
      histLimit += 60;
      renderHistory();
    });
    list.appendChild(more);
  }
}

async function deleteHistoryCard(id) {
  const idx = db.cards.findIndex(c => c.id === id);
  if (idx < 0) return;
  db.cards.splice(idx, 1);
  saveDB();
  renderHistory();
  toast('已删除');
}

async function clearHistory() {
  const n = (db.cards || []).length;
  if (!n) { toast('没有可清空的卡片'); return; }
  const bytes = db.cards.reduce((s, c) => s + bytesOf(c.text || ''), 0);
  const ok = await askConfirm(
    '清空全部历史卡片？',
    `将删除 ${n} 张卡片，约释放 ${(bytes / 1024).toFixed(0)} KB。正文和章节不受影响，但删掉的卡片无法找回。`,
    '全部清空'
  );
  if (!ok) return;
  db.cards = [];
  saveDB();
  renderHistory();
  toast('已清空');
}
