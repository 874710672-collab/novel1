/* ===== 提示词管理：摘要 / 状态文件 ===== */

/* 当前编辑的是哪一个：'summary' | 'state' */
let promptEditing = 'summary';

/* 从设置里取当前生效的提示词（未自定义则用内置默认） */
function getSummaryPrompt() {
  const custom = getSettings().summaryPrompt;
  return (custom && custom.trim()) ? custom : SUMMARY_PROMPT;
}

function getStatePromptBody() {
  const custom = getSettings().statePromptBody;
  return (custom && custom.trim()) ? custom : STATE_PROMPT_BODY;
}

function isCustomized(which) {
  const s = getSettings();
  if (which === 'summary') {
    return !!(s.summaryPrompt && s.summaryPrompt.trim());
  }
  return !!(s.statePromptBody && s.statePromptBody.trim());
}

/* ---------- 打开 ---------- */
function openPrompts() {
  promptEditing = 'summary';
  switchPromptTab('summary');
  openModal('modalPrompts');
}

function switchPromptTab(which) {
  promptEditing = which;
  document.querySelectorAll('#segPromptTab button').forEach(b => {
    b.classList.toggle('on', b.dataset.p === which);
  });

  const area = $('promptEdit');
  area.value = which === 'summary' ? getSummaryPrompt() : getStatePromptBody();

  updatePromptStatus();
}

function updatePromptStatus() {
  const customized = isCustomized(promptEditing);
  const badge = $('promptBadge');
  badge.textContent = customized ? '已自定义' : '默认版本';
  badge.className = 'prompt-badge ' + (customized ? 'custom' : 'default');
  $('btnResetPrompt').hidden = !customized;
  $('btnResetPrompt').style.display = customized ? 'block' : 'none';
}

/* ---------- 保存 ---------- */
function savePromptEdit() {
  const v = $('promptEdit').value;
  const s = getSettings();

  if (promptEditing === 'summary') {
    // 与内置完全一致时，清空为默认
    s.summaryPrompt = (v.trim() === SUMMARY_PROMPT.trim()) ? '' : v;
  } else {
    s.statePromptBody = (v.trim() === STATE_PROMPT_BODY.trim()) ? '' : v;
  }
  saveDB();
  updatePromptStatus();
  toast('已保存');
}

/* ---------- 恢复默认 ---------- */
async function resetPromptEdit() {
  const name = promptEditing === 'summary' ? '章节摘要' : '状态文件';
  const ok = await askConfirm(
    `恢复${name}提示词的默认版本？`,
    '当前修改的内容会被清空，恢复成内置的原始版本。',
    '恢复默认'
  );
  if (!ok) return;

  const s = getSettings();
  if (promptEditing === 'summary') s.summaryPrompt = '';
  else s.statePromptBody = '';
  saveDB();

  $('promptEdit').value = promptEditing === 'summary' ? SUMMARY_PROMPT : STATE_PROMPT_BODY;
  updatePromptStatus();
  toast('已恢复默认');
}

/* ---------- 查看历史（只读对照用） ---------- */
function viewDefaultPrompt() {
  const text = promptEditing === 'summary' ? SUMMARY_PROMPT : STATE_PROMPT_BODY;
  $('promptEdit').value = text;
  updatePromptStatus();
  toast('已载入默认版本到编辑框，点保存才会生效');
}
