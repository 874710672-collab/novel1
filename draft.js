/* ===== 草稿 =====
   独立于正文的临时书写区。存于每本书的 data.draft 里，
   不参与抽卡上下文，也不会被当作正文。 */

let draftTimer = null;

function getDraft() {
  if (!db) return '';
  if (typeof db.draft !== 'string') db.draft = '';
  return db.draft;
}

function setDraft(v) {
  if (!db) return;
  db.draft = v || '';
}

function openDraft() {
  const area = $('draftArea');
  area.value = getDraft();
  updateDraftCount();
  openModal('modalDraft');
  // 打开后自动聚焦，方便直接打字
  setTimeout(() => {
    area.focus();
    // 光标放到末尾
    const len = area.value.length;
    try { area.setSelectionRange(len, len); } catch (e) {}
  }, 320);
}

function updateDraftCount() {
  const n = countWords($('draftArea').value);
  $('draftCount').textContent = n + ' 字';
}

function saveDraftNow() {
  setDraft($('draftArea').value);
  saveDB();
}

async function clearDraft() {
  const cur = $('draftArea').value;
  if (!cur.trim()) { toast('草稿是空的'); return; }
  const ok = await askConfirm(
    '清空草稿？',
    `当前草稿有 ${countWords(cur)} 字，清空后无法恢复。`,
    '清空'
  );
  if (!ok) return;
  $('draftArea').value = '';
  setDraft('');
  saveDB();
  updateDraftCount();
  toast('草稿已清空');
}

function draftToEditor() {
  const text = $('draftArea').value;
  if (!text.trim()) { toast('草稿是空的'); return; }
  if (!currentChapterId) { toast('先选一章再插入'); return; }

  const ed = $('editor');
  const cur = ed.value;
  const needNL = cur && !cur.endsWith('\n') ? '\n\n' : '';
  ed.value = cur + needNL + text;
  updateWordCount();
  flushEditor();
  updateCtxSize();
  closeModal();
  toast('已插入正文');
}
