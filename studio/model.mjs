import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, readdir, lstat } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';

export const REPO = 'roldself/rolin-ai-lab';
export const PAGE_LIMIT = 25 * 1024 ** 2;
export const RELEASE_LIMIT = 2 * 1024 ** 3;
export const IMAGE_LIMIT = 8 * 1024 ** 2;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const gitBlobHash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const validId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
export const safeLink = href => {
  if (typeof href !== 'string' || href.length > 2048) return false;
  if (href === '#build-log') return true;
  try { const url = new URL(href); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
};
const mediaPath = value => typeof value === 'string' && /^\/media\/[a-f0-9-]{36}\.(webp|png|jpg|jpeg)$/.test(value);

export function validateContent(content) {
  if (!content || content.schemaVersion !== 1 || !Array.isArray(content.works) || content.works.length > 500) throw fail('作品数据格式不正确。');
  const ids = new Set();
  for (const work of content.works) {
    if (!validId(work.id) || ids.has(work.id)) throw fail('作品编号无效或重复。');
    ids.add(work.id);
    if (!text(work.name, 120, true) || !text(work.description, 600, true)) throw fail('请填写作品名称和一句话介绍。');
    if (!['Skill', 'Agent', 'Product'].includes(work.category) || !['待整理', 'Idea', 'Building', 'Testing', 'Published', 'Archived'].includes(work.status)) throw fail('作品类型或状态无效。');
    for (const [key, max] of [['body', 20000], ['version', 60], ['date', 40], ['format', 60], ['icon', 20]]) if (work[key] !== undefined && !text(work[key], max)) throw fail(`${key} 内容过长。`);
    for (const key of ['capabilities', 'technology']) if (work[key] !== undefined && (!Array.isArray(work[key]) || work[key].length > 30 || !work[key].every(value => text(value, 200, true)))) throw fail('能力和技术每行一项，最多 30 项。');
    if (work.cover && !mediaPath(work.cover)) throw fail('封面必须从工作台上传。');
    if (work.screenshots !== undefined && (!Array.isArray(work.screenshots) || work.screenshots.length > 8 || !work.screenshots.every(shot => mediaPath(shot.src) && text(shot.caption, 300)))) throw fail('截图最多 8 张，并且必须从工作台上传。');
    if (work.links !== undefined && (!Array.isArray(work.links) || work.links.length > 30 || !work.links.every(link => text(link.label, 100, true) && safeLink(link.href)))) throw fail('链接需要名称和完整的 http/https 地址。');
  }
  if (!Array.isArray(content.featured) || content.featured.length > 4 || new Set(content.featured).size !== content.featured.length || !content.featured.every(id => ids.has(id))) throw fail('首页最多选择四个不同的作品。');
  return content;
}

export async function atomicJSON(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}

export async function readJSON(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}

export async function deploymentFiles(root) {
  const files = [];
  async function visit(relative) {
    const info = await lstat(join(root, relative));
    if (info.isSymbolicLink()) throw fail('发布目录中不允许符号链接。');
    if (info.isDirectory()) {
      for (const child of await readdir(join(root, relative), { withFileTypes: true })) {
        if (child.isSymbolicLink()) throw fail('发布目录中不允许符号链接。');
        if (!child.name.startsWith('.')) await visit(`${relative}/${child.name}`);
      }
    } else {
      if (info.size > PAGE_LIMIT) throw fail(`${relative} 超过 25 MiB，请改放 Releases。`);
      const bytes = await readFile(join(root, relative));
      files.push({ path: relative, bytes, size: bytes.length, sha: gitBlobHash(bytes), mode: info.mode & 0o111 ? '100755' : '100644' });
    }
  }
  for (const path of ['src', 'public', 'studio', 'Start Studio.command', 'astro.config.mjs', 'package.json', 'package-lock.json', 'tsconfig.json', '.gitignore', 'README.md', 'STUDIO-GUIDE.md', 'STUDIO-REVIEW.md', 'DESIGN-SYSTEM.md', 'ASSETS.md', 'PREVIEW.md', 'UI-REVIEW.md']) await visit(path);
  if (files.filter(file => file.path.startsWith('public/')).length + 1 > 20000) throw fail('网站文件数量超过 Pages 免费版限制。');
  return files;
}

export function detectImage(bytes, filename) {
  const ext = extname(filename).toLowerCase();
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && ['.jpg', '.jpeg'].includes(ext)) return ext;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && ext === '.png') return ext;
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && ext === '.webp') return ext;
  throw fail('仅接受真实 PNG、JPEG 或 WebP 图片，不能上传 SVG 或 HTML。');
}
