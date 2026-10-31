/* ===== 查找 =====
   在 textarea 里做搜索：只做「跳转 + 选中」，不做高亮
   （textarea 不支持给局部文字上色）。 */

let searchTarget = null;     // 目标 textarea
let searchMatches = [];      // 匹配位置数组
let searchIndex = 0;         // 当前第几个（0 基）
let searchQuery = '';
let searchDebounce = null;

/* ---------- 打开 ---------- */
function openSearch(target) {
  searchTarget = target || document.getElementById('editor');
  searchQuery = '';
  searchMatches = [];
  searchIndex = 0;

  $('searchInput').value = '';
  $('searchCount').textContent = '0/0';
  updateSearchNav();

  const box = $('searchBar');
  box.hidden = false;

  setTimeout(() => {
    const inp = $('searchInput');
    inp.focus();
    try { inp.select(); } catch (e) {}
  }, 50);
}

function closeSearch() {
  $('searchBar').hidden = true;
  searchMatches = [];
  searchQuery = '';
  clearTimeout(searchDebounce);
  if (searchTarget) {
    try { searchTarget.focus(); } catch (e) {}
  }
}

/* ---------- 核心：查找 ---------- */
function findAll(text, q) {
  const out = [];
  if (!q) return out;
  const hay = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = 0;
  while (true) {
    const idx = hay.indexOf(needle, i);
    if (idx < 0) break;
    out.push(idx);
    i = idx + Math.max(1, needle.length);
    if (out.length > 5000) break;
  }
  return out;
}

/**
 * @param {boolean} focusTarget 是否把焦点移到编辑区
 *        false = 输入过程中，只更新选区不抢焦点
 */
function jumpTo(i, focusTarget) {
  if (!searchTarget || !searchMatches.length) return;
  const start = searchMatches[i];
  const len = searchQuery.length;
  const ta = searchTarget;

  // 关键：输入过程中不抢焦点，否则删除键会落到正文上
  if (focusTarget) {
    try { ta.focus(); } catch (e) {}
  }

  try {
    ta.setSelectionRange(start, start + len);
  } catch (e) { return; }

  scrollToMatch(ta, start, len);
}

/* ---------- 精确定位 ----------
   用镜像元素按 textarea 的真实字体/宽度排版，
   量出匹配位置的实际高度，而不是用「行数 × 行高」估算。
   这样可以正确处理长段落折行。 */
function scrollToMatch(ta, start, len) {
  try {
    const cs = getComputedStyle(ta);
    if (cs.display === 'none') return;

    const mirror = document.createElement('div');
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';
    mirror.style.zIndex = '-1';
    mirror.style.left = '-9999px';
    mirror.style.top = '0';

    // 复制影响排版的样式
    mirror.style.width = ta.clientWidth + 'px';
    mirror.style.fontFamily = cs.fontFamily;
    mirror.style.fontSize = cs.fontSize;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.padding = cs.padding;
    mirror.style.border = '0';
    mirror.style.boxSizing = 'border-box';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordBreak = 'break-word';

    // 前置文本 + 一个标记，量标记的位置
    mirror.textContent = ta.value.slice(0, start);
    const marker = document.createElement('span');
    marker.textContent = '|';
    mirror.appendChild(marker);

    document.body.appendChild(mirror);
    const markerTop = marker.offsetTop;
    const lineH = parseFloat(cs.lineHeight) || 24;
    document.body.removeChild(mirror);

    const viewH = ta.clientHeight;
    // 让匹配行落在可视区中间偏上
    const desired = Math.max(0, markerTop - viewH * 0.35);
    // 只在确实看不见时才滚动，避免每次跳转都抖动
    if (markerTop < ta.scrollTop || markerTop > ta.scrollTop + viewH - lineH * 1.5) {
      ta.scrollTop = desired;
    }
  } catch (e) {}
}

function runSearch(keepIndex) {
  if (!searchTarget) return;

  const q = $('searchInput').value;
  const text = searchTarget.value || '';

  if (q !== searchQuery) {
    searchQuery = q;
    searchMatches = findAll(text, q);
    searchIndex = 0;
  } else {
    const prev = searchMatches[searchIndex];
    searchMatches = findAll(text, q);
    if (keepIndex !== false && prev != null) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < searchMatches.length; i++) {
        const d = Math.abs(searchMatches[i] - prev);
        if (d < bestD) { bestD = d; best = i; }
      }
      searchIndex = best;
    }
  }

  updateSearchCount();
  updateSearchNav();

  // 输入过程中不抢焦点，只更新选区
  if (searchMatches.length) jumpTo(searchIndex, false);
}

function updateSearchCount() {
  const n = searchMatches.length;
  $('searchCount').textContent = n ? `${searchIndex + 1}/${n}` : '0/0';
}

function updateSearchNav() {
  const has = searchMatches.length > 0;
  $('btnSearchPrev').disabled = !has;
  $('btnSearchNext').disabled = !has;
}

/* 用户主动跳转时才移焦点 */
function goTo(i) {
  if (!searchMatches.length) return;
  jumpTo(i, true);
}

function searchNext() {
  if (!searchMatches.length) { runSearch(false); return; }
  searchIndex = (searchIndex + 1) % searchMatches.length;
  updateSearchCount();
  goTo(searchIndex);
}

function searchPrev() {
  if (!searchMatches.length) { runSearch(false); return; }
  searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length;
  updateSearchCount();
  goTo(searchIndex);
}

/* ---------- 绑定 ---------- */
function initSearch() {
  const inp = $('searchInput');
  if (!inp) return;

  inp.addEventListener('input', () => {
    searchMatches = [];
    searchIndex = 0;
    clearTimeout(searchDebounce);
    // 防抖 120ms：连续删除时不至于每次都重算
    searchDebounce = setTimeout(() => runSearch(false), 120);
  });

  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) searchPrev(); else searchNext();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
    }
  });

  $('btnSearchPrev').addEventListener('click', searchPrev);
  $('btnSearchNext').addEventListener('click', searchNext);
  $('btnSearchClose').addEventListener('click', closeSearch);
}
