/* ===== 书架：多本书管理 ===== */

let editingBookId = null;

/* ---------- 打开书架 ---------- */
function openShelf() {
  renderShelf();
  openModal('modalShelf');
}

function bookStats(book) {
  const d = book.data;
  const chapters = (d.chapters || []).length;
  const words = (d.chapters || []).reduce((s, c) => s + countWords(c.body), 0);
  return { chapters, words };
}

function renderShelf() {
  const list = $('shelfList');
  list.innerHTML = '';

  const sorted = [...shelf.books].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  for (const book of sorted) {
    const st = bookStats(book);
    const isCur = book.id === currentBookId;

    const el = document.createElement('div');
    el.className = 'book-item' + (isCur ? ' on' : '');

    const main = document.createElement('div');
    main.className = 'book-main';

    const titleRow = document.createElement('div');
    titleRow.className = 'book-title-row';
    const title = document.createElement('span');
    title.className = 'book-title';
    title.textContent = book.title;
    titleRow.appendChild(title);
    if (isCur) {
      const badge = document.createElement('span');
      badge.className = 'book-badge';
      badge.textContent = '当前';
      titleRow.appendChild(badge);
    }

    const meta = document.createElement('div');
    meta.className = 'book-meta';
    meta.textContent = `${st.chapters} 章 · ${st.words.toLocaleString()} 字`;

    main.appendChild(titleRow);
    main.appendChild(meta);

    main.addEventListener('click', () => {
      if (isCur) { closeModal(); return; }
      switchBook(book.id);
    });

    const ops = document.createElement('div');
    ops.className = 'book-ops';

    const btnEdit = document.createElement('span');
    btnEdit.className = 'book-op';
    btnEdit.textContent = '✎';
    btnEdit.addEventListener('click', e => {
      e.stopPropagation();
      openBookEdit(book.id);
    });

    const btnExp = document.createElement('span');
    btnExp.className = 'book-op';
    btnExp.textContent = '导出';
    btnExp.addEventListener('click', e => {
      e.stopPropagation();
      exportBook(book.id);
    });

    ops.appendChild(btnEdit);
    ops.appendChild(btnExp);

    if (shelf.books.length > 1) {
      const btnDel = document.createElement('span');
      btnDel.className = 'book-op danger';
      btnDel.textContent = '删除';
      btnDel.addEventListener('click', e => {
        e.stopPropagation();
        deleteBook(book.id);
      });
      ops.appendChild(btnDel);
    }

    el.appendChild(main);
    el.appendChild(ops);
    list.appendChild(el);
  }
}

/* ---------- 新建 ---------- */
function createBook() {
  editingBookId = null;
  $('bookEditTitle').textContent = '新建一本书';
  $('bookName').value = '';
  $('btnDeleteBook').hidden = true;
  $('btnDeleteBook').style.display = 'none';
  openModal('modalBookEdit');
  setTimeout(() => $('bookName').focus(), 320);
}

function openBookEdit(id) {
  const b = shelf.books.find(x => x.id === id);
  if (!b) return;
  editingBookId = id;
  $('bookEditTitle').textContent = '修改书名';
  $('bookName').value = b.title;
  $('btnDeleteBook').hidden = shelf.books.length <= 1;
  $('btnDeleteBook').style.display = shelf.books.length <= 1 ? 'none' : 'block';
  openModal('modalBookEdit');
  setTimeout(() => $('bookName').focus(), 320);
}

function saveBookEdit() {
  const name = $('bookName').value.trim();
  if (!name) { toast('书名不能为空'); return; }

  if (editingBookId) {
    const b = shelf.books.find(x => x.id === editingBookId);
    if (b) { b.title = name; b.updatedAt = Date.now(); }
    saveShelf();
    closeModal();
    setTimeout(() => { renderShelf(); openModal('modalShelf'); }, 260);
    toast('已改名');
  } else {
    // 新建
    const book = {
      id: uid(),
      title: name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: defaultBookData()
    };
    shelf.books.push(book);
    saveShelf();
    closeModal();
    setTimeout(() => { renderShelf(); openModal('modalShelf'); }, 260);
    toast(`已新建《${name}》`);
  }
}

/* ---------- 切换 ---------- */
async function switchBook(id) {
  const target = shelf.books.find(b => b.id === id);
  if (!target) return;

  // 保存当前书的编辑内容
  try { flushEditor(); } catch (e) {}

  currentBookId = id;
  shelf.currentBookId = id;
  db = target.data;
  saveShelf();

  // 重置到这本书的章节
  currentChapterId = null;
  const chs = [...(db.chapters || [])].sort((a, b) => b.no - a.no);
  const last = chs.find(c => c.id === db.lastChapterId);
  const sel = last || chs[0] || null;

  closeModal();
  setTimeout(() => {
    if (sel) {
      selectChapter(sel.id);
    } else {
      currentChapterId = null;
      $('editor').value = '';
      $('chapterTitle').textContent = '未选择章节';
      $('chapterTitle').classList.remove('editable');
      updateWordCount();
      $('staleBadge').hidden = true;
      renderChapterList();
      renderCtxChips();
    }
    renderCtxLists();
    toast(`已切换到《${target.title}》`);
  }, 280);
}

/* ---------- 删除 ---------- */
async function deleteBook(id) {
  const b = shelf.books.find(x => x.id === id);
  if (!b) return;
  if (shelf.books.length <= 1) { toast('至少要保留一本书'); return; }

  const st = bookStats(b);
  const ok = await askConfirm(
    `删除《${b.title}》？`,
    `${st.chapters} 章、${st.words} 字，以及人设、状态文件、历史卡片都会被删除，无法恢复。建议先导出备份。`,
    '删除'
  );
  if (!ok) return;

  shelf.books = shelf.books.filter(x => x.id !== id);

  if (currentBookId === id) {
    const next = shelf.books[0];
    currentBookId = next.id;
    shelf.currentBookId = next.id;
    db = next.data;
    currentChapterId = null;
  }
  saveShelf();
  renderShelf();
  // 如果删的是当前书，界面要重载
  if (currentChapterId === null) {
    closeModal();
    setTimeout(() => location.reload(), 200);
    return;
  }
  toast('已删除');
}

/* ---------- 单本导出 ---------- */
function exportBook(id) {
  const b = shelf.books.find(x => x.id === id);
  if (!b) return;
  if (b.id === currentBookId) {
    try { flushEditor(); } catch (e) {}
  }
  const payload = {
    app: 'novel-draw',
    version: 2,
    scope: 'single-book',
    exportedAt: new Date().toISOString(),
    book: {
      title: b.title,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      data: b.data
    }
  };
  const safeName = (b.title || '未命名').replace(/[\\/:*?"<>|]/g, '_');
  download(`${safeName}-${todayStr()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast(`已导出《${b.title}》`);
}
