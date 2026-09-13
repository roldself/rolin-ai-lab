import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve, join, basename, extname, sep } from 'node:path';
import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { REPO, PAGE_LIMIT, RELEASE_LIMIT, IMAGE_LIMIT, fail, validId, validateContent, atomicJSON, readJSON, digest, detectImage, deploymentFiles } from './model.mjs';
import { githubClient } from './github.mjs';

export function createStudio(root, port = 4380) {
  const privateDir = join(root, '.studio');
  const contentPath = join(root, 'src/data/content.json');
  const queuePath = join(privateDir, 'downloads.json');
  const secret = randomBytes(32).toString('hex');
  let token = '';
  let connection = null;
  let busy = false;
  let plan = null;
  const origin = `http://127.0.0.1:${port}`;
  const readContent = () => readJSON(contentPath);
  const readQueue = () => readJSON(queuePath, []);
  async function buildPreview() {
    const astro = await readJSON(join(root, 'node_modules/astro/package.json'));
    try {
      await promisify(execFile)(process.execPath, [resolve(root, 'node_modules/astro', astro.bin.astro), 'build'], { cwd: root, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' }, timeout: 120000, maxBuffer: 1024 ** 2 });
    } catch (error) {
      await mkdir(privateDir, { recursive: true });
      await writeFile(join(privateDir, 'build.log'), `${error.stdout || ''}\n${error.stderr || ''}`);
      throw fail('网站构建失败，尚未上传。检查记录已保存在本地 .studio/build.log。');
    }
  }
  const state = async () => {
    const content = await readContent();
    return { content, revision: digest(JSON.stringify(content)), downloads: (await readQueue()).map(({ path, ...item }) => item), connection, repo: REPO, limits: { image: IMAGE_LIMIT, pages: PAGE_LIMIT, release: RELEASE_LIMIT } };
  };
  async function saveContent(content) {
    validateContent(content);
    const articleImages = (content.articles || []).flatMap(article => [article.cover, ...article.blocks.filter(block => block.type === 'image').map(block => block.src)]);
    for (const path of [...articleImages, content.profile?.wechatQr].filter(Boolean)) {
      if (!(await stat(join(root, 'public', path))).isFile()) throw fail('图文或二维码图片不存在，请重新上传。');
    }
    for (const work of content.works) for (const path of [work.cover, ...(work.screenshots || []).map(shot => shot.src)].filter(Boolean)) {
      if (!(await stat(join(root, 'public', path))).isFile()) throw fail('关联图片不存在，请重新上传。');
    }
    await atomicJSON(join(privateDir, 'content-backup.json'), await readContent());
    await atomicJSON(contentPath, content);
    plan = null;
  }
  async function bodyJSON(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 ** 2) throw fail('表单内容过大。', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fail('请求格式不正确。'); }
  }
  function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
  async function upload(req, url) {
    const workId = url.searchParams.get('work');
    const kind = url.searchParams.get('kind');
    const content = await readContent();
    const owner = url.searchParams.get('owner') || 'work';
    const exists = owner === 'profile' ? workId === 'profile' : owner === 'article' ? (content.articles || []).some(article => article.id === workId) : owner === 'work' && content.works.some(work => work.id === workId);
    if (!validId(workId) || !exists || (owner !== 'work' && kind !== 'image')) throw fail('先保存内容，再添加图片。');
    if (!['image', 'download'].includes(kind)) throw fail('素材类型不正确。');
    const filename = basename(url.searchParams.get('name') || '').replace(/[\x00-\x1f/\\]/g, '').slice(0, 160);
    if (!filename || filename.startsWith('.')) throw fail('文件名无效。');
    const size = Number(req.headers['content-length']);
    const limit = kind === 'image' ? IMAGE_LIMIT : RELEASE_LIMIT - 1;
    if (!Number.isSafeInteger(size) || size < 1 || size > limit) throw fail(kind === 'image' ? '图片超过 8 MiB，请压缩后上传。' : '下载文件必须小于 2 GiB。', 413);
    const id = randomUUID();
    const directory = join(privateDir, 'downloads');
    await mkdir(directory, { recursive: true });
    const path = join(directory, id);
    let actual = 0;
    const hash = createHash('sha256');
    const guard = new Transform({ transform(chunk, _, callback) { actual += chunk.length; hash.update(chunk); callback(actual > limit || actual > size ? fail('文件大小超出限制。', 413) : null, chunk); } });
    try {
      await pipeline(req, guard, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      if (actual !== size) throw fail('文件未完整传输，请重试。');
      if (kind === 'image') {
        const bytes = await readFile(path);
        const extension = detectImage(bytes, filename);
        await mkdir(join(root, 'public/media'), { recursive: true });
        await writeFile(join(root, 'public/media', id + extension), bytes, { flag: 'wx' });
        await unlink(path);
        return { src: `/media/${id}${extension}`, size };
      }
      const queue = await readQueue();
      if (queue.some(asset => asset.workId === workId && asset.name === filename && asset.status !== 'published')) throw fail('这个作品已有同名的未发布文件，请先处理已有文件或使用不同文件名。');
      const asset = { id, workId, originalName: filename, name: filename, size, sha256: hash.digest('hex'), path: id, status: 'local' };
      queue.push(asset);
      await atomicJSON(queuePath, queue);
      return { ...asset, path: undefined };
    } catch (error) { await unlink(path).catch(() => {}); throw error; }
  }
  async function staticFile(res, relative, prefix) {
    const path = resolve(prefix, relative);
    if (!path.startsWith(resolve(prefix) + sep)) throw fail('路径无效。', 403);
    const bytes = await readFile(path);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }); res.end(bytes);
  }

  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (req.headers.host !== `127.0.0.1:${port}`) throw fail('工作台只允许本机访问。', 403);
      if (req.headers.origin && req.headers.origin !== origin) throw fail('拒绝跨站请求。', 403);
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/') {
        const html = (await readFile(join(root, 'studio/index.html'), 'utf8')).replace('__STUDIO_TOKEN__', secret);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return;
      }
      if (req.method === 'GET' && ['/writing', '/profile'].includes(url.pathname)) {
        const html = (await readFile(join(root, 'studio/writing.html'), 'utf8')).replace('__STUDIO_TOKEN__', secret);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); return;
      }
      if (req.method === 'GET' && ['/writing.js', '/writing.css'].includes(url.pathname)) return await staticFile(res, url.pathname.slice(1), join(root, 'studio'));
      if (req.method === 'GET' && /^\/articles\/[a-z0-9-]+\/?$/.test(url.pathname)) {
        const html = await readFile(join(root, 'dist', url.pathname.slice(1).replace(/\/$/, ''), 'index.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html.replaceAll('href="/#articles"', 'href="/preview/#articles"').replaceAll('href="/"', 'href="/preview/"')); return;
      }
      if (req.method === 'GET' && ['/app.js', '/style.css'].includes(url.pathname)) return await staticFile(res, url.pathname.slice(1), join(root, 'studio'));
      if (req.method === 'GET' && /^\/(brand|media)\//.test(url.pathname)) return await staticFile(res, decodeURIComponent(url.pathname.slice(1)), join(root, 'public'));
      if (req.method === 'GET' && (url.pathname === '/preview/' || url.pathname.startsWith('/_astro/'))) return await staticFile(res, url.pathname === '/preview/' ? 'index.html' : url.pathname.slice(1), join(root, 'dist'));
      if (req.headers['x-studio-token'] !== secret) throw fail('工作台会话已失效，请刷新。', 403);
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, await state());
      if (req.method !== 'POST') throw fail('此入口不存在。', 404);
      if (busy) throw fail('上一项操作尚未完成，请稍候。', 409);
      busy = true;
      try {
        if (url.pathname === '/api/upload') return json(res, await upload(req, url));
        const body = await bodyJSON(req);
        if (url.pathname === '/api/save') {
          if (body.revision !== digest(JSON.stringify(await readContent()))) throw fail('另一窗口修改了作品，请先重新载入，避免覆盖。', 409);
          await saveContent(body.content);
          return json(res, await state());
        }
        if (url.pathname === '/api/work/delete') {
          const content = await readContent();
          if (body.confirm !== true || !validId(body.id)) throw fail('请确认要删除的作品。');
          if (body.revision !== digest(JSON.stringify(content))) throw fail('作品已被其他窗口修改，请刷新后再删除。', 409);
          if (!content.works.some(work => work.id === body.id)) throw fail('作品不存在。', 404);
          content.works = content.works.filter(work => work.id !== body.id);
          content.featured = content.featured.filter(id => id !== body.id);
          await saveContent(content);
          return json(res, await state());
        }
        if (url.pathname === '/api/connect') {
          if (typeof body.token !== 'string' || body.token.length < 10 || body.token.length > 500) throw fail('请填写有效的 GitHub 访问凭据。');
          const next = await githubClient(body.token).connection();
          token = body.token; connection = next; plan = null;
          return json(res, { connection });
        }
        if (url.pathname === '/api/disconnect') { token = ''; connection = null; plan = null; return json(res, { connection }); }
        if (url.pathname === '/api/download/remove') {
          const queue = await readQueue();
          const asset = queue.find(item => item.id === body.id);
          if (!body.confirm || !asset || asset.status !== 'local' || asset.releaseId) throw fail('仅能移除尚未上传的本地文件。');
          await atomicJSON(queuePath, queue.filter(item => item.id !== asset.id));
          await unlink(join(privateDir, 'downloads', asset.path)).catch(() => {});
          return json(res, await state());
        }
        if (url.pathname === '/api/preview') {
          await buildPreview();
          return json(res, { url: '/preview/' });
        }
        if (url.pathname === '/api/site/plan') {
          const client = githubClient(token);
          validateContent(await readContent());
          await buildPreview();
          const files = await deploymentFiles(root);
          const base = await client.base(connection.branch);
          plan = { id: randomUUID(), fingerprint: digest(files.map(file => file.path + file.sha + file.mode).join('\n')), base, branch: connection.branch };
          return json(res, { id: plan.id, repo: REPO, branch: plan.branch, files: files.map(({ path, size }) => ({ path, size })), total: files.reduce((sum, file) => sum + file.size, 0) });
        }
        if (url.pathname === '/api/site/publish') {
          if (!body.confirm || !plan || body.planId !== plan.id) throw fail('请先查看并确认上传清单。');
          const files = await deploymentFiles(root);
          if (plan.fingerprint !== digest(files.map(file => file.path + file.sha + file.mode).join('\n'))) throw fail('文件已经变化，请重新查看上传清单。', 409);
          const currentPlan = plan; plan = null;
          const result = await githubClient(token).publishSite(files, currentPlan.base, currentPlan.branch);
          return json(res, { ...result, message: '已同步 GitHub。Cloudflare Pages 需事先完成仓库绑定；此处不代表部署已成功。' });
        }
        if (url.pathname === '/api/release/draft') {
          if (!body.confirm || !Array.isArray(body.ids) || !body.ids.length) throw fail('请确认要上传的下载文件。');
          const content = await readContent();
          const work = content.works.find(work => work.id === body.workId);
          const queue = await readQueue();
          const assets = queue.filter(asset => body.ids.includes(asset.id));
          if (!work || assets.length !== new Set(body.ids).size || assets.some(asset => asset.workId !== work.id || asset.status === 'published')) throw fail('下载文件不属于当前作品，或已经发布。');
          const tag = `${work.id}-${body.version || 'v1.0.0'}`;
          if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(tag)) throw fail('版本号只能包含英文、数字、点、短横线和下划线。');
          if (typeof body.notes !== 'string' || body.notes.length > 20000) throw fail('版本说明过长。');
          const client = githubClient(token);
          const releaseIds = [...new Set(assets.map(asset => asset.releaseId).filter(Boolean))];
          if (releaseIds.length > 1) throw fail('这些文件属于不同的草稿，请分别上传。');
          let release = releaseIds.length ? await client.api(`/releases/${releaseIds[0]}`) : await client.createDraft(work, tag, body.notes);
          if (!release.draft || release.tag_name !== tag) throw fail('草稿版本不一致或已公开，请检查 GitHub。');
          for (const asset of assets) { asset.releaseId = release.id; asset.releaseUrl = release.html_url; asset.tag = tag; }
          await atomicJSON(queuePath, queue);
          for (const asset of assets) {
            if (asset.status === 'draft') continue;
            const existing = release.assets?.find(item => item.name === asset.name);
            if (existing && (existing.digest !== `sha256:${asset.sha256}` || existing.size !== asset.size || existing.state !== 'uploaded')) throw fail('草稿中存在未能校验的同名文件，本次不会覆盖它。');
            const uploaded = existing || await client.uploadAsset(release.id, asset, join(privateDir, 'downloads', asset.path));
            if (uploaded.state !== 'uploaded' || uploaded.size !== asset.size) throw fail('GitHub 未确认文件完整上传，请检查草稿。');
            asset.status = 'draft'; asset.assetId = uploaded.id; asset.downloadUrl = uploaded.browser_download_url;
            await atomicJSON(queuePath, queue);
          }
          return json(res, await state());
        }
        if (url.pathname === '/api/release/publish') {
          if (!body.confirm || !Number.isSafeInteger(body.releaseId)) throw fail('请确认公开发布这个草稿。');
          const queue = await readQueue();
          const assets = queue.filter(asset => asset.releaseId === body.releaseId);
          if (!assets.length || assets.some(asset => !['draft', 'published'].includes(asset.status))) throw fail('仍有文件未上传成功。');
          const client = githubClient(token);
          const remote = await client.api(`/releases/${body.releaseId}`);
          if (assets.some(asset => !remote.assets.some(item => item.id === asset.assetId && item.state === 'uploaded' && item.size === asset.size))) throw fail('远端文件有变化，请先检查草稿。');
          const content = await readContent();
          for (const asset of assets) {
            const work = content.works.find(work => work.id === asset.workId);
            if (!work) continue;
            work.links ||= [];
            if (!work.links.some(link => link.href === asset.downloadUrl)) work.links.push({ label: `下载 ${asset.originalName}`.slice(0, 100), href: asset.downloadUrl });
            asset.status = 'published';
          }
          validateContent(content);
          if (remote.draft) await client.publishRelease(body.releaseId);
          await saveContent(content);
          await atomicJSON(queuePath, queue);
          return json(res, await state());
        }
        throw fail('此入口不存在。', 404);
      } finally { busy = false; }
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, { error: error.status ? error.message : error.code === 'ENOENT' ? '文件未找到；预览网站前请先生成预览。' : '操作未完成，请检查网络或本地文件权限后重试。' }, error.status && error.status >= 400 && error.status < 600 ? error.status : 500);
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let port = 4380;
  function start() {
    const server = createStudio(root, port);
    server.on('error', error => {
      if (error.code === 'EADDRINUSE' && port < 4390) { port++; start(); }
      else { console.error(`无法启动本地工作台 (${error.code})。`); process.exitCode = 1; }
    });
    server.listen(port, '127.0.0.1', () => console.log(`Rolin Studio: http://127.0.0.1:${port}/\n仅本机访问。保存不会上传；关闭终端会清除 GitHub 凭据。`));
  }
  start();
}
