export const TAG_REPO = 'yangyuelin-jhs/tcg-calendar-pages';
export const TAG_BRANCH = 'calendar-tags';
export const TAG_PATH = 'data/user-tags.json';
const endpoint = `https://api.github.com/repos/${TAG_REPO}/contents/${TAG_PATH}`;
export const TAG_COLORS = ['amber', 'green', 'blue', 'pink'];

export function validateTags(tags) {
  if (!Array.isArray(tags) || tags.length > 8) throw new Error('每条记录最多添加 8 个标签');
  const seen = new Set();
  return tags.map(tag => {
    const text = String(tag?.text || '').trim();
    if (!text || [...text].length > 24) throw new Error('标签需要 1–24 个字');
    if (!TAG_COLORS.includes(tag.color)) throw new Error('请选择标签颜色');
    if (seen.has(text)) throw new Error('标签名称不能重复');
    seen.add(text);
    return { text, color: tag.color };
  });
}

export function validateDocument(data) {
  if (data?.version !== 1 || !data.records || typeof data.records !== 'object' || Array.isArray(data.records)) {
    throw new Error('标签文件格式错误，已停止同步以保护已有标签');
  }
  return data;
}

function decodeContent(content) {
  return new TextDecoder().decode(Uint8Array.from(atob(content.replace(/\s/g, '')), ch => ch.charCodeAt(0)));
}

function encodeContent(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2) + '\n');
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

async function githubRequest(url, token, init = {}, fetcher = fetch) {
  const response = await fetcher(url, {
    ...init,
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers }
  });
  if (!response.ok) {
    const messages = { 401: 'GitHub 授权已失效，请重新授权', 403: 'GitHub 拒绝访问，请检查令牌的 Contents 读写权限或稍后重试', 404: '未找到标签文件，或当前授权无权访问仓库', 409: '标签正在被其他设备更新', 422: 'GitHub 未接受这次修改，请刷新后重试' };
    const error = new Error(messages[response.status] || `GitHub 连接失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function readRemoteTags(token = '', fetcher = fetch) {
  const file = await githubRequest(`${endpoint}?ref=${TAG_BRANCH}`, token, {}, fetcher);
  return { data: validateDocument(JSON.parse(decodeContent(file.content))), sha: file.sha };
}

export async function readPublicTags(fetcher = fetch) {
  const url = `https://raw.githubusercontent.com/${TAG_REPO}/${TAG_BRANCH}/${TAG_PATH}?t=${Date.now()}`;
  const response = await fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`标签读取失败（${response.status}）`);
  return validateDocument(await response.json());
}

export async function saveRemoteTags({ id, title, tags, baseRevision }, token, fetcher = fetch) {
  if (!token) throw new Error('编辑前请先连接 GitHub');
  if (typeof id !== 'string' || !id || id.length > 600 || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('记录编号无效');
  const cleanTags = validateTags(tags);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, sha } = await readRemoteTags(token, fetcher);
    const previous = Object.hasOwn(data.records, id) ? data.records[id] : undefined;
    if ((previous?.revision || '') !== (baseRevision || '')) {
      const error = new Error('这条标签已被另一台设备修改，请重新打开标签编辑，再保存');
      error.status = 409;
      throw error;
    }
    const updatedAt = new Date().toISOString();
    // Retain empty entries so stale clients cannot resurrect deleted tags.
    data.records[id] = { title: String(title || '').slice(0, 300), tags: cleanTags, updatedAt, revision: crypto.randomUUID() };
    data.updatedAt = updatedAt;
    try {
      await githubRequest(endpoint, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Update calendar labels', branch: TAG_BRANCH, sha, content: encodeContent(data) })
      }, fetcher);
      return data;
    } catch (error) {
      if (error.status !== 409 || attempt === 2) throw error;
    }
  }
}
