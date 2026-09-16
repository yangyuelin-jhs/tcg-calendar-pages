import { TAG_COLORS, validateTags, readPublicTags, readRemoteTags, saveRemoteTags } from './tag-sync.js?v=1789542411715';

const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const isStatic = Boolean(window.CALENDAR_STATIC_DATA_URL);
const localEditor = !isStatic && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
let documentData = { version: 1, records: {} };
let token = '';
let editing = null;
let draft = [];
let baseRevision = '';
let syncing = null;
let lastSync = 0;
let onUpdate = () => {};
let saving = false;
const $ = id => document.getElementById(id);

export function tagMarkup(item) {
  const tags = documentData.records[item.id]?.tags || [];
  return `<div class="userTagGroup" data-tag-record="${escape(item.id)}">${tags.map(tag => `<span class="userTag tag-${TAG_COLORS.includes(tag.color) ? tag.color : 'amber'}">${escape(tag.text)}</span>`).join('')}<button class="tagEdit" type="button" data-edit-tags="${escape(item.id)}" title="${tags.length ? '编辑标签' : '添加标签'}" aria-label="${escape(item.title)}：${tags.length ? '编辑标签' : '添加标签'}">${tags.length ? '&#9998;' : '+'}</button></div>`;
}

function status(text, failed = false) {
  $('tagSyncState').textContent = text;
  $('tagSyncState').classList.toggle('failed', failed);
}

export async function refreshTags(force = false) {
  if (saving) return false;
  if (syncing) return syncing;
  if (!force && Date.now() - lastSync < 30000) return;
  syncing = (async () => {
    try {
      let next;
      if (isStatic) {
        next = token ? (await readRemoteTags(token)).data : await readPublicTags();
      } else {
        const response = await fetch(`/api/user-tags${force ? '?refresh=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '标签读取失败');
        next = result.data;
        if (!result.synced) {
          documentData = next;
          onUpdate();
          throw new Error(result.error || '当前为本地缓存');
        }
      }
      const changed = JSON.stringify(next) !== JSON.stringify(documentData);
      documentData = next;
      lastSync = Date.now();
      status('标签已同步');
      if (changed) onUpdate();
      return true;
    } catch (error) {
      status('标签同步失败，点击重试', true);
      $('tagSyncState').title = error.message;
      return false;
    }
  })().finally(() => { syncing = null; });
  return syncing;
}

function renderDraft() {
  $('tagDraft').innerHTML = draft.map((tag, index) => `<span class="userTag tag-${tag.color}">${escape(tag.text)}<button type="button" data-remove-tag="${index}" title="删除 ${escape(tag.text)}" aria-label="删除 ${escape(tag.text)}">&times;</button></span>`).join('');
  $('tagDraft').querySelectorAll('[data-remove-tag]').forEach(button => button.addEventListener('click', () => {
    draft.splice(Number(button.dataset.removeTag), 1);
    renderDraft();
  }));
}

function addDraft() {
  const value = $('tagText').value.trim();
  if (!value) return true;
  try {
    draft = validateTags([...draft, { text: value, color: document.querySelector('[name="tagColor"]:checked').value }]);
    $('tagText').value = '';
    $('tagEditorMessage').textContent = '';
    renderDraft();
    return true;
  } catch (error) {
    $('tagEditorMessage').textContent = error.message;
    return false;
  }
}

export async function openTagEditor(item) {
  editing = item;
  $('tagEditorTitle').textContent = item.title;
  $('tagEditorMessage').textContent = '正在读取最新标签…';
  $('tagEditorFields').disabled = true;
  $('saveTags').disabled = true;
  $('tagText').value = '';
  $('tagDraft').replaceChildren();
  $('tagEditorDialog').showModal();
  const fresh = await refreshTags(true);
  if (!$('tagEditorDialog').open || editing !== item) return;
  draft = (documentData.records[item.id]?.tags || []).map(tag => ({ ...tag }));
  baseRevision = documentData.records[item.id]?.revision || '';
  renderDraft();
  $('tagEditorFields').disabled = false;
  $('saveTags').disabled = !fresh;
  $('tagEditorMessage').textContent = fresh ? '' : '无法读取最新标签，请关闭后重试，避免覆盖其他设备的修改。';
  $('tagAuthNotice').hidden = localEditor || Boolean(token);
  $('tagText').focus();
}

async function save() {
  if (saving || !editing || !addDraft()) return;
  if (!localEditor && !token) { $('tagAuthDialog').showModal(); return; }
  saving = true;
  $('saveTags').disabled = true;
  $('tagEditorFields').disabled = true;
  $('tagEditorMessage').textContent = '正在保存并同步到 GitHub…';
  try {
    if (syncing) await syncing;
    const change = { id: editing.id, title: editing.title, tags: draft, baseRevision };
    let next;
    if (localEditor) {
      const response = await fetch('/api/user-tags', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change), signal: AbortSignal.timeout(70000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '保存失败');
      next = result.data;
    } else {
      next = await saveRemoteTags(change, token);
    }
    documentData = next;
    lastSync = Date.now();
    status('标签已同步');
    onUpdate();
    $('tagEditorDialog').close();
  } catch (error) {
    $('tagEditorMessage').textContent = `${error.message}。修改内容已保留，尚未确认同步。`;
  } finally {
    saving = false;
    $('saveTags').disabled = false;
    $('tagEditorFields').disabled = false;
  }
}

export function initTags({ findItem, update }) {
  onUpdate = update;
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="tagEditorDialog" class="tagDialog" aria-labelledby="tagEditorHeading">
      <div class="tagDialogHead"><h2 id="tagEditorHeading">编辑标签</h2><button type="button" id="closeTagEditor" class="tagIconBtn" title="关闭" aria-label="关闭标签编辑">&times;</button></div>
      <p id="tagEditorTitle" class="tagRecordTitle"></p>
      <fieldset id="tagEditorFields">
        <div id="tagDraft" class="tagDraft"></div>
        <label for="tagText">标签名称</label>
        <div class="tagInputRow"><input id="tagText" type="text" maxlength="48" autocomplete="off" placeholder="如：已录入、待确认、重点关注"><button id="addTag" type="button" class="tagIconBtn" aria-label="添加标签" title="添加标签">+</button></div>
        <div class="tagSwatches" role="group" aria-label="标签颜色">${TAG_COLORS.map((color, i) => `<label class="tagSwatch tag-${color}" title="${['金黄', '绿色', '蓝色', '粉色'][i]}"><input type="radio" name="tagColor" value="${color}" ${i === 0 ? 'checked' : ''} aria-label="${['金黄', '绿色', '蓝色', '粉色'][i]}"><span></span></label>`).join('')}</div>
      </fieldset>
      <p id="tagAuthNotice" hidden>网页版编辑需要 <button type="button" class="tagTextButton" id="tagAuthFromEditor">连接 GitHub</button>。</p>
      <p id="tagEditorMessage" class="tagMessage" role="status"></p>
      <div class="tagDialogActions"><button type="button" id="cancelTags" class="ghostBtn">取消</button><button type="button" id="saveTags" class="primaryBtn">保存并同步</button></div>
    </dialog>
    <dialog id="tagAuthDialog" class="tagDialog" aria-labelledby="tagAuthHeading">
      <div class="tagDialogHead"><h2 id="tagAuthHeading">连接 GitHub</h2><button type="button" id="closeTagAuth" class="tagIconBtn" title="关闭" aria-label="关闭授权">&times;</button></div>
      <p>允许当前页面修改你的标签。浏览和查看标签无需授权。</p>
      <p><a href="https://github.com/settings/personal-access-tokens/new?name=TCG-calendar-labels" target="_blank" rel="noreferrer">创建专用令牌</a>：Repository access 仅选 <strong>tcg-calendar-pages</strong>，Contents 设为 <strong>Read and write</strong>。</p>
      <label for="tagToken">GitHub 访问令牌</label><input id="tagToken" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…">
      <p class="tagAuthHint">仅用于本次打开的页面，关闭或刷新后需重新填写。令牌不会上传到网站或写入公开文件。</p>
      <p id="tagAuthMessage" class="tagMessage" role="status"></p>
      <div class="tagDialogActions"><button id="disconnectTags" type="button" class="ghostBtn">断开连接</button><button id="connectTags" type="button" class="primaryBtn">连接</button></div>
    </dialog>`);
  const tools = document.createElement('div');
  tools.className = 'tagSyncTools';
  tools.innerHTML = `<button id="tagSyncState" type="button" class="tagSyncState" title="刷新标签；其他设备的修改每分钟自动同步">正在读取标签…</button>${localEditor ? '' : '<button id="tagConnect" type="button" class="ghostBtn">连接 GitHub</button>'}`;
  document.querySelector('.actions').prepend(tools);
  $('tagSyncState').addEventListener('click', () => refreshTags(true));
  $('tagConnect')?.addEventListener('click', () => $('tagAuthDialog').showModal());
  $('tagAuthFromEditor').addEventListener('click', () => $('tagAuthDialog').showModal());
  $('closeTagAuth').addEventListener('click', () => $('tagAuthDialog').close());
  $('tagAuthDialog').addEventListener('close', () => { $('tagToken').value = ''; });
  const closeEditor = () => { if (!saving) $('tagEditorDialog').close(); };
  $('closeTagEditor').addEventListener('click', closeEditor);
  $('cancelTags').addEventListener('click', closeEditor);
  $('tagEditorDialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  $('addTag').addEventListener('click', addDraft);
  $('tagText').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addDraft(); } });
  $('saveTags').addEventListener('click', save);
  $('disconnectTags').addEventListener('click', () => {
    token = '';
    $('tagAuthMessage').textContent = '已断开连接';
    if ($('tagConnect')) $('tagConnect').textContent = '连接 GitHub';
    $('tagAuthNotice').hidden = localEditor;
  });
  $('connectTags').addEventListener('click', async () => {
    if (!window.isSecureContext) { $('tagAuthMessage').textContent = '请在 GitHub HTTPS 网页版连接授权。'; return; }
    const candidate = $('tagToken').value.trim();
    if (!candidate) { $('tagAuthMessage').textContent = '请填写专用令牌'; return; }
    $('connectTags').disabled = true;
    try {
      const result = await readRemoteTags(candidate);
      token = candidate;
      documentData = result.data;
      $('tagToken').value = '';
      if ($('tagConnect')) $('tagConnect').textContent = 'GitHub 已连接';
      $('tagAuthNotice').hidden = true;
      $('tagAuthDialog').close();
      $('tagAuthMessage').textContent = '';
      onUpdate();
      status('标签已同步');
    } catch (error) { $('tagAuthMessage').textContent = error.message; }
    finally { $('connectTags').disabled = false; }
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-edit-tags]');
    if (!button) return;
    const item = findItem(button.dataset.editTags);
    if (item) openTagEditor(item);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTags(); });
  window.addEventListener('focus', () => refreshTags());
  setInterval(() => { if (!document.hidden && !saving) refreshTags(); }, 60000);
  refreshTags(true);
}
