/* ===== AI 大纲辅助 =====
   两件事：
   - 提炼已写内容（看章节正文，整理成大纲）
   - 补充后续建议（看现有大纲 + 作者想法，给往后走向）

   结果先给作者编辑，确认后才写入总纲。 */

let aiPicked = [];        // 勾选的章节 id
let aiAbort = null;
let aiMode = 'extract';   // extract | suggest

/* ---------- 提示词 ---------- */
const AI_EXTRACT_PROMPT = `你是中文网文的编辑，负责把已经写好的正文整理成故事大纲。

【任务】
读正文，提炼出这本书"已经发生"的主线脉络，写成大纲。

【输出要求】
- 用 Markdown 二级标题分段，例如：
## 一、故事起点
## 二、目前进展
- 只写事实：谁做了什么、局面怎么变了
- 不写评价、不写文笔分析、不抒情
- 不预测后续，只整理已写内容
- 保留关键转折和人物关系变化
- 总长度控制在 800 字以内
- 直接输出大纲，不要开场白`;

const AI_SUGGEST_PROMPT = `你是中文网文的策划编辑，熟悉各类题材的长篇结构。

【任务】
根据作者已有的故事和大纲，提出后续走向建议，帮助作者把长篇写下去。

【输出要求】
- 用 Markdown 二级标题分段，例如：
## 目前的故事状态
## 接下来可以往哪走
## 建议的结构节奏
- 「接下来可以往哪走」给出 2-3 个不同方向的选项，每个说清利弊
- 「建议的结构节奏」说明接下来几章大致怎么推进
- 如果你判断这个题材有常见的爽点或节奏模式，可以点出来，但要说明这只是参考
- 不要写具体正文，不要写对白
- 不要空话套话，每条都要具体到这本书
- 总长度控制在 1000 字以内
- 直接输出建议，不要开场白`;

/* ---------- 打开面板 ---------- */
function openAiOutline() {
  // 默认全选章节
  aiPicked = db.chapters.map(c => c.id);

  $('aiSrcChapters').checked = true;
  $('aiSrcMaster').checked = true;
  $('aiSrcVolume').checked = false;
  $('aiSrcChapOutline').checked = false;
  $('aiIdea').value = '';
  $('aiResult').value = '';
  aiMode = 'extract';
  updateAiButtons();

  renderAiChapterList();
  openModal('modalAiOutline');
}

function renderAiChapterList() {
  const list = $('aiChapterList');
  list.innerHTML = '';
  const sorted = [...db.chapters].sort((a, b) => a.no - b.no);

  if (!sorted.length) {
    list.innerHTML = '<div class="ctx-empty">还没有章节</div>';
    return;
  }

  for (const c of sorted) {
    const label = document.createElement('label');
    label.className = 'ctx-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = aiPicked.includes(c.id);
    cb.addEventListener('change', () => {
      const i = aiPicked.indexOf(c.id);
      if (cb.checked && i < 0) aiPicked.push(c.id);
      if (!cb.checked && i >= 0) aiPicked.splice(i, 1);
    });
    const sp = document.createElement('span');
    sp.textContent = `第${c.no}章 · ${c.title || '未命名'}（${countWords(c.body)}字）`;
    label.appendChild(cb);
    label.appendChild(sp);
    list.appendChild(label);
  }
}

function updateAiButtons() {
  $('btnAiGenerate').textContent = aiMode === 'extract' ? '提炼' : '建议';
}

/* ---------- 组装材料 ---------- */
function buildAiMaterial(mode) {
  const parts = [];

  // 章节正文
  if ($('aiSrcChapters').checked && aiPicked.length) {
    const sorted = [...db.chapters].sort((a, b) => a.no - b.no);
    const picked = sorted.filter(c => aiPicked.includes(c.id) && c.body.trim());
    if (picked.length) {
      const txt = picked.map(c =>
        `—— 第${c.no}章${c.title && c.title !== '未命名' ? '·' + c.title : ''} ——\n${c.body.trim()}`
      ).join('\n\n');
      parts.push('【已写正文】\n' + txt);
    }
  }

  const o = outlineData();

  if ($('aiSrcMaster').checked && o && o.master && o.master.trim()) {
    parts.push('【现有总纲】\n' + o.master.trim());
  }

  if ($('aiSrcVolume').checked && o && o.volumes && o.volumes.length) {
    const txt = [...o.volumes]
      .sort((a, b) => (a.from || 0) - (b.from || 0))
      .map(v => `—— ${v.name}（第${v.from}–${v.to}章）——\n${(v.body || '').trim()}`)
      .join('\n\n');
    parts.push('【现有卷纲】\n' + txt);
  }

  if ($('aiSrcChapOutline').checked && o && o.chapterOutlines) {
    const sorted = [...db.chapters].sort((a, b) => a.no - b.no);
    const items = sorted
      .filter(c => o.chapterOutlines[c.id])
      .map(c => `第${c.no}章：${o.chapterOutlines[c.id].trim()}`);
    if (items.length) parts.push('【现有章纲】\n' + items.join('\n'));
  }

  const idea = $('aiIdea').value.trim();
  if (idea) parts.push('【我的想法】\n' + idea);

  return parts.join('\n\n');
}

/* ---------- 生成 ---------- */
async function runAiOutline(mode) {
  if (aiAbort) { toast('正在生成中…'); return; }
  aiMode = mode;

  const material = buildAiMaterial(mode);
  if (!material.trim()) {
    toast('没有可用的材料，先勾选章节或写点想法');
    return;
  }

  const prompt = mode === 'extract' ? AI_EXTRACT_PROMPT : AI_SUGGEST_PROMPT;
  const userMsg = mode === 'extract'
    ? `请根据下面的材料，整理出这本书已经发生的主线大纲。\n\n${material}`
    : `请根据下面的材料，给出后续走向建议。\n\n${material}`;

  aiAbort = new AbortController();
  const btns = [$('btnAiExtract'), $('btnAiSuggest'), $('btnAiGenerate')];
  const oldTexts = btns.map(b => b.textContent);
  btns.forEach(b => { b.disabled = true; });
  $('btnAiGenerate').textContent = '生成中…';
  $('aiResult').value = '';

  try {
    const out = await callModel(
      prompt,
      userMsg,
      txt => { $('aiResult').value = txt; },
      aiAbort.signal
    );
    $('aiResult').value = out;
    toast('已生成，检查后决定是否写入');
  } catch (e) {
    $('aiResult').value = '';
    toast(e.name === 'AbortError' ? '已取消' : '生成失败：' + e.message);
  } finally {
    aiAbort = null;
    btns.forEach((b, i) => { b.disabled = false; b.textContent = oldTexts[i]; });
    updateAiButtons();
  }
}

/* ---------- 写入总纲 ---------- */
function aiAppendToMaster() {
  const text = $('aiResult').value.trim();
  if (!text) { toast('结果是空的'); return; }

  const o = outlineData();
  const cur = (o.master || '').trim();
  o.master = cur ? (cur + '\n\n---\n\n' + text) : text;
  saveDB();
  loadMaster();
  closeModal();
  toast('已追加到总纲');
}

async function aiReplaceMaster() {
  const text = $('aiResult').value.trim();
  if (!text) { toast('结果是空的'); return; }

  const o = outlineData();
  const cur = (o.master || '').trim();

  if (cur) {
    const ok = await askConfirm(
      '替换总纲？',
      `当前总纲有 ${countWords(cur)} 字，会被这一版完全覆盖，无法恢复。`,
      '替换'
    );
    if (!ok) return;
  }

  o.master = text;
  saveDB();
  loadMaster();
  closeModal();
  toast('已替换总纲');
}

/* ---------- 绑定 ---------- */
function initOutlineAi() {
  const btn = $('btnAiOutline');
  if (btn) btn.addEventListener('click', openAiOutline);

  $('btnAiExtract').addEventListener('click', () => runAiOutline('extract'));
  $('btnAiSuggest').addEventListener('click', () => runAiOutline('suggest'));
  // 右上角主按钮：按当前模式走
  $('btnAiGenerate').addEventListener('click', () => runAiOutline(aiMode));

  $('btnAiAppend').addEventListener('click', aiAppendToMaster);
  $('btnAiReplace').addEventListener('click', aiReplaceMaster);

  $('btnAiSelAll').addEventListener('click', () => {
    aiPicked = db.chapters.map(c => c.id);
    renderAiChapterList();
  });
  $('btnAiSelNone').addEventListener('click', () => {
    aiPicked = [];
    renderAiChapterList();
  });

  // 章节勾选开关联动显示
  $('aiSrcChapters').addEventListener('change', () => {
    $('aiChapterPicker').hidden = !$('aiSrcChapters').checked;
  });
}
