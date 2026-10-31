/* ===== 查找 =====
   在 textarea 里做搜索：只做「跳转 + 选中」，不做高亮
   （textarea 不支持给局部文字上色）。 */

let searchTarget = null;     // 目标 textarea
let searchMatches = [];      // 匹配位置数组
let searchIndex = 0;         // 当前第几个（0 基）
let searchQuery = '';

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
    if (out.length > 5000) break;   // 防御：极端情况
  }
  return out;
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
    // 内容可能变了，重新算一次
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
  if (searchMatches.length) jumpTo(searchIndex);
  updateSearchNav();
}

function updateSearchCount() {
  const n = searchMatches.length;
  $('searchCount').textContent = n ? `${searchIndex + 1}/${n}` : (searchQuery ? '0/0' : '0/0');
}

function updateSearchNav() {
  const has = searchMatches.length > 0;
  $('btnSearchPrev').disabled = !has;
  $('btnSearchNext').disabled = !has;
}

function jumpTo(i) {
  if (!searchTarget || !searchMatches.length) return;
  const start = searchMatches[i];
  const len = searchQuery.length;
  const ta = searchTarget;

  ta.focus();
  try {
    ta.setSelectionRange(start, start + len);
  } catch (e) { return; }

  // 粗略滚动到可见：按选中位置估算行号
  try {
    const text = ta.value.slice(0, start);
    const lines = text.split('\n').length;
    const cs = window.getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 24;
    const target = (lines - 1) * lh;
    const viewH = ta.clientHeight;
    if (target < ta.scrollTop || target > ta.scrollTop + viewH - lh * 2) {
      ta.scrollTop = Math.max(0, target - viewH / 2);
    }
  } catch (e) {}
}

function searchNext() {
  if (!searchMatches.length) { runSearch(); return; }
  searchIndex = (searchIndex + 1) % searchMatches.length;
  updateSearchCount();
  jumpTo(searchIndex);
}

function searchPrev() {
  if (!searchMatches.length) { runSearch(); return; }
  searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length;
  updateSearchCount();
  jumpTo(searchIndex);
}

/* ---------- 绑定 ---------- */
function initSearch() {
  const inp = $('searchInput');
  if (!inp) return;

  inp.addEventListener('input', () => {
    searchMatches = [];
    searchIndex = 0;
    runSearch(false);
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
