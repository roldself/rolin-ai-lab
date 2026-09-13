import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, mkdir, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { createStudio } from './server.mjs';
import { validateContent, safeLink, detectImage, deploymentFiles, RELEASE_LIMIT, gitBlobHash } from './model.mjs';
import { githubClient } from './github.mjs';

const project = resolve(import.meta.dirname, '..');
const initial = { schemaVersion: 1, featured: ['travel-os'], works: [
  { id: 'resume-skill', name: 'Resume fixture', description: 'Resume test', category: 'Skill', status: 'Idea' },
  { id: 'travel-os', name: 'Travel fixture', description: 'Travel test', category: 'Product', status: 'Idea' },
] };

test('content contract: placement, links and uploaded media', () => {
  assert.equal(validateContent(structuredClone(initial)).works.length, initial.works.length);
  assert(safeLink('https://example.com/demo'));
  for (const link of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'https://user:secret@example.com']) assert(!safeLink(link));
  const content = structuredClone(initial); content.featured = ['missing']; assert.throws(() => validateContent(content));
  content.featured = initial.featured; content.works[0].cover = '/../../private/file'; assert.throws(() => validateContent(content));
  assert.throws(() => detectImage(Buffer.from('<svg></svg>'), 'cover.png'));
});

test('articles and profile validate safely, without migrating existing works', () => {
  const content = structuredClone(initial);
  content.articles = [{ id:'article-test', title:'Test', summary:'', date:'2026-09-12', status:'Published', blocks:[{type:'paragraph',text:'Hello'}] }];
  content.profile = { email:'hello@example.com', wechat:'rolin', xiaohongshuUrl:'https://example.com/creator' };
  assert.doesNotThrow(() => validateContent(content));
  for (const mutate of [c => c.articles[0].blocks = [], c => c.articles[0].date = '2026-02-31', c => c.articles[0].blocks = [{type:'html',text:'<script />'}], c => c.profile.wechatQr = '/etc/passwd', c => c.profile.douyinUrl = 'javascript:alert(1)', c => c.profile.email = 'bad']) {
    const invalid = structuredClone(content); mutate(invalid); assert.throws(() => validateContent(invalid));
  }
});

test('article and profile save/upload roundtrip with stale revision protection', async () => {
  const { send, root } = await fixture();
  let { json: state } = await send('/api/state');
  state.content.articles = [{ id:'article-test', title:'Test article', summary:'', date:'', status:'Draft', blocks:[] }];
  let response = await send('/api/save',{method:'POST',body:{content:state.content,revision:state.revision}});
  assert.equal(response.status,200); state = response.json;
  const image = await send('/api/upload?owner=article&work=article-test&kind=image&name=cover.png',{method:'POST',body:Buffer.from([137,80,78,71,13,10,26,10,0])});
  assert.equal(image.status,200);
  assert.equal((await send('/api/upload?owner=article&work=missing&kind=image&name=cover.png',{method:'POST',body:Buffer.from('x')})).status,400);
  assert.equal((await send('/api/upload?owner=profile&work=profile&kind=download&name=file.zip',{method:'POST',body:Buffer.from('x')})).status,400);
  state.content.articles[0].blocks = [{type:'image',src:image.json.src,caption:'Caption'}];
  state.content.profile = { name:'Rolin', wechat:'contact-test', wechatQr:image.json.src };
  const oldRevision = state.revision;
  response = await send('/api/save',{method:'POST',body:{content:state.content,revision:oldRevision}});
  assert.equal(response.status,200);
  assert.equal((await send('/api/save',{method:'POST',body:{content:state.content,revision:oldRevision}})).status,409);
  const disk = JSON.parse(await readFile(join(root,'src/data/content.json')));
  assert.equal(disk.profile.wechat,'contact-test'); assert.deepEqual(disk.works,initial.works);
  assert.equal((await send('/writing')).status,200); assert.equal((await send('/profile')).status,200);
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rolin-studio-test-'));
  await mkdir(join(root, 'src/data'), { recursive: true });
  await writeFile(join(root, 'src/data/content.json'), JSON.stringify(initial));
  await cp(join(project, 'studio'), join(root, 'studio'), { recursive: true });
  const server = createStudio(root, 4380);
  let secret;
  const send = async (url, { method = 'GET', body, headers = {} } = {}) => {
    const data = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const req = Readable.from(data.length ? [data] : []);
    Object.assign(req, { method, url, headers: { host: '127.0.0.1:4380', 'content-length': String(data.length), ...(secret ? { 'x-studio-token': secret } : {}), ...headers } });
    return new Promise(resolve => {
      const response = { status: 200, headersSent: false, destroyed: false, headers: {}, setHeader(key, value) { this.headers[key] = value; }, writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); this.headersSent = true; }, end(bytes) { const text = Buffer.isBuffer(bytes) ? bytes.toString() : bytes || ''; let json; try { json = JSON.parse(text); } catch {} resolve({ status: this.status, text, json, headers: this.headers }); } };
      server.emit('request', req, response);
    });
  };
  const page = await send('/'); secret = /name="studio-token" content="([a-f0-9]+)"/.exec(page.text)[1];
  return { root, send };
}

test('local save changes real content, creates backup and refuses stale saves', async () => {
  const { root, send } = await fixture();
  const { json: state } = await send('/api/state');
  state.content.works[0].name = 'Updated locally';
  const saved = await send('/api/save', { method: 'POST', body: { content: state.content, revision: state.revision } });
  assert.equal(saved.status, 200);
  assert.equal(JSON.parse(await readFile(join(root, 'src/data/content.json'))).works[0].name, 'Updated locally');
  assert.equal(JSON.parse(await readFile(join(root, '.studio/content-backup.json'))).works[0].name, initial.works[0].name);
  assert.equal((await send('/api/save', { method: 'POST', body: { content: state.content, revision: state.revision } })).status, 409);
});

test('delete requires confirmation and current revision, preserves assets, supports empty library', async () => {
  const { root, send } = await fixture();
  const image = await send('/api/upload?work=resume-skill&kind=image&name=cover.png', { method: 'POST', body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]) });
  await send('/api/upload?work=resume-skill&kind=download&name=skill.zip', { method: 'POST', body: Buffer.from('private package') });
  const queue = await readFile(join(root, '.studio/downloads.json'), 'utf8');
  let { json: state } = await send('/api/state');
  const body = { id: 'resume-skill', revision: state.revision };
  assert.equal((await send('/api/work/delete', { method: 'POST', body })).status, 400);
  assert.equal((await send('/api/work/delete', { method: 'POST', body: { ...body, confirm: true, revision: 'stale' } })).status, 409);
  const deleted = await send('/api/work/delete', { method: 'POST', body: { ...body, confirm: true } });
  assert.equal(deleted.status, 200);
  state = deleted.json;
  assert(!state.content.works.some(work => work.id === body.id));
  assert(!state.content.featured.includes(body.id));
  assert(JSON.parse(await readFile(join(root, '.studio/content-backup.json'))).works.some(work => work.id === body.id));
  assert.equal(await readFile(join(root, '.studio/downloads.json'), 'utf8'), queue);
  assert.equal((await stat(join(root, 'public', image.json.src))).size, 9);
  for (const work of [...state.content.works]) {
    const response = await send('/api/work/delete', { method: 'POST', body: { id: work.id, revision: state.revision, confirm: true } });
    assert.equal(response.status, 200);
    state = response.json;
  }
  assert.deepEqual(state.content.works, []);
  assert.deepEqual(state.content.featured, []);
});

test('security: origin, session, local host, no implicit publication', async () => {
  const { send } = await fixture();
  assert.equal((await send('/api/state', { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await send('/api/state', { headers: { host: 'evil.example:4380' } })).status, 403);
  assert.equal((await send('/api/state', { headers: { 'x-studio-token': 'invalid' } })).status, 403);
  assert.equal((await send('/api/site/publish', { method: 'POST', body: {} })).status, 400);
  assert.equal((await send('/api/release/publish', { method: 'POST', body: {} })).status, 400);
  assert.equal((await send('/.studio/downloads.json')).status, 404);
});

test('uploads: images to public media, download packages private, size and signature guardrails', async () => {
  const { root, send } = await fixture();
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const image = await send('/api/upload?work=travel-os&kind=image&name=cover.png', { method: 'POST', body: png });
  assert.equal(image.status, 200);
  assert.equal((await stat(join(root, 'public', image.json.src))).size, png.length);
  const download = await send('/api/upload?work=travel-os&kind=download&name=workflow.zip', { method: 'POST', body: Buffer.from('download fixture') });
  assert.equal(download.status, 200); assert.equal(download.json.status, 'local'); assert.equal(download.json.path, undefined);
  const queue = JSON.parse(await readFile(join(root, '.studio/downloads.json')));
  assert.equal(queue.length, 1); assert.equal((await stat(join(root, '.studio/downloads', queue[0].path))).size, 16);
  assert.equal((await send('/api/upload?work=travel-os&kind=download&name=big.zip', { method: 'POST', body: Buffer.from('x'), headers: { 'content-length': String(RELEASE_LIMIT) } })).status, 413);
  assert.equal((await send('/api/upload?work=travel-os&kind=image&name=bad.png', { method: 'POST', body: Buffer.from('<script>bad</script>') })).status, 400);
});

test('deployment includes app code but excludes private queue, credentials and dependencies', async () => {
  const files = await deploymentFiles(project);
  assert(files.some(file => file.path === 'src/data/content.json'));
  assert(files.some(file => file.path === 'studio/server.mjs'));
  assert(!files.some(file => /(^|\/)(\.studio|\.git|node_modules|dist)(\/|$)/.test(file.path)));
  assert(files.every(file => file.sha === gitBlobHash(file.bytes)));
});

test('GitHub publication preserves existing tree and never force-pushes', async () => {
  const calls = [];
  const mock = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : undefined; calls.push({ url, method: options.method, body });
    let result = { sha: 'new' };
    if (url.includes('/git/trees/base?')) result = { tree: [{ path: 'unrelated.txt', sha: 'keep' }], truncated: false };
    return { ok: true, status: 200, json: async () => result };
  };
  const client = githubClient('test-only-token', mock);
  await client.publishSite([{ path: 'src/data/content.json', bytes: Buffer.from('{}'), sha: 'new' }], { head: 'old-head', tree: 'base' }, 'main');
  assert.equal(calls.find(call => call.url.endsWith('/git/trees')).body.base_tree, 'base');
  assert.deepEqual(calls.find(call => call.url.endsWith('/git/commits')).body.parents, ['old-head']);
  assert.equal(calls.at(-1).body.force, false);
  assert(calls.every(call => call.url.startsWith('https://api.github.com/repos/roldself/rolin-ai-lab/')));
});

test('release creation explicitly requests a draft, not public or latest', async () => {
  let payload;
  const client = githubClient('test-only-token', async (_, options) => { payload = JSON.parse(options.body); return { ok: true, status: 201, json: async () => ({ id: 1, draft: true }) }; });
  await client.createDraft({ name: 'Test' }, 'test-v1', 'Notes');
  assert.equal(payload.draft, true); assert.equal(payload.make_latest, 'false');
});

test('full local roundtrip: saved work and uploaded picture appear in the built homepage', async () => {
  const { root, send } = await fixture();
  for (const path of ['src', 'public', 'package.json', 'astro.config.mjs', 'tsconfig.json']) await cp(join(project, path), join(root, path), { recursive: true });
  await writeFile(join(root, 'src/data/content.json'), JSON.stringify(initial));
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'), 'dir');
  const bytes = await readFile(join(project, 'public/brand/category-products.webp'));
  const uploaded = await send('/api/upload?work=travel-os&kind=image&name=cover.webp', { method: 'POST', body: bytes });
  assert.equal(uploaded.status, 200);
  const { json: state } = await send('/api/state');
  const work = state.content.works.find(work => work.id === 'travel-os');
  work.name = 'Studio Roundtrip Project'; work.body = 'Saved detail body from Studio.'; work.cover = uploaded.json.src;
  work.screenshots = [{ src: uploaded.json.src, caption: 'Saved screenshot caption' }];
  work.links = [{ label: 'Try the project', href: 'https://example.com/test' }];
  state.content.articles = [
    { id:'public-story',title:'Public story',summary:'Summary',date:'2026-09-12',status:'Published',cover:uploaded.json.src,blocks:[{type:'paragraph',text:'<script>alert(1)</script>'},{type:'image',src:uploaded.json.src,caption:'Article caption'}] },
    { id:'draft-story',title:'Private draft title',summary:'',date:'',status:'Draft',blocks:[] },
  ];
  state.content.profile = { name:'Creator test',email:'hello@example.com',wechat:'wechat-test',xiaohongshu:'XHS test',xiaohongshuUrl:'https://example.com/profile' };
  assert.equal((await send('/api/save', { method: 'POST', body: { content: state.content, revision: state.revision } })).status, 200);
  const built = await send('/api/preview', { method: 'POST', body: {} });
  assert.equal(built.status, 200, built.text);
  const html = await readFile(join(root, 'dist/index.html'), 'utf8');
  for (const value of [work.name, work.body, uploaded.json.src, 'Saved screenshot caption', 'https://example.com/test']) assert(html.includes(value));
  assert(html.includes('Public story')); assert(!html.includes('Private draft title')); assert(html.includes('hello@example.com'));
  const articleHtml = await readFile(join(root,'dist/articles/public-story/index.html'),'utf8');
  assert(articleHtml.includes('Article caption')); assert(!articleHtml.includes('<script>alert(1)</script>')); assert(articleHtml.includes('&lt;script'));
  assert.equal((await send('/articles/public-story/')).status,200);
  await assert.rejects(stat(join(root,'dist/articles/draft-story/index.html')));
  assert.equal((await send('/preview/')).status, 200);
});

test('full release flow: explicit draft upload, separate public confirmation, download link saved locally', async () => {
  const { root, send } = await fixture();
  const originalFetch = globalThis.fetch;
  const changes = [];
  let published = false;
  let asset;
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    let result;
    if (path.endsWith('/rolin-ai-lab')) result = { default_branch: 'main' };
    else if (path.endsWith('/releases') && options.method === 'POST') {
      const body = JSON.parse(options.body); assert.equal(body.draft, true); changes.push('draft');
      result = { id: 123, draft: true, tag_name: 'travel-os-v1.0.0', html_url: 'https://github.com/roldself/rolin-ai-lab/releases/tag/travel-os-v1.0.0' };
    } else if (new URL(url).hostname === 'uploads.github.com') {
      let size = 0; for await (const chunk of options.body) size += chunk.length;
      changes.push('upload');
      asset = { id: 456, state: 'uploaded', size, browser_download_url: 'https://github.com/roldself/rolin-ai-lab/releases/download/travel-os-v1.0.0/workflow.zip' }; result = asset;
    } else if (path.endsWith('/releases/123')) {
      if (options.method === 'PATCH') { assert.equal(JSON.parse(options.body).draft, false); changes.push('publish'); published = true; }
      result = { id: 123, draft: !published, tag_name: 'travel-os-v1.0.0', assets: [asset] };
    } else throw Error(`Unexpected GitHub request: ${path}`);
    return { ok: true, status: 200, json: async () => result };
  };
  try {
    await send('/api/connect', { method: 'POST', body: { token: 'test-only-credential' } });
    const local = await send('/api/upload?work=travel-os&kind=download&name=workflow.zip', { method: 'POST', body: Buffer.from('fixture') });
    assert.deepEqual(changes, [], 'Local save must not contact upload APIs');
    const body = { ids: [local.json.id], workId: 'travel-os', version: 'v1.0.0', notes: '', confirm: true };
    assert.equal((await send('/api/release/draft', { method: 'POST', body: { ...body, confirm: false } })).status, 400);
    assert.deepEqual(changes, []);
    const draft = await send('/api/release/draft', { method: 'POST', body }); assert.equal(draft.status, 200, draft.text);
    assert.deepEqual(changes, ['draft', 'upload']); assert.equal(draft.json.downloads[0].status, 'draft');
    assert(!draft.json.content.works.find(work => work.id === 'travel-os').links?.some(link => link.href === asset.browser_download_url));
    const result = await send('/api/release/publish', { method: 'POST', body: { releaseId: 123, confirm: true } }); assert.equal(result.status, 200, result.text);
    assert.deepEqual(changes, ['draft', 'upload', 'publish']);
    const content = JSON.parse(await readFile(join(root, 'src/data/content.json')));
    assert(content.works.find(work => work.id === 'travel-os').links.some(link => link.href === asset.browser_download_url));
    assert.equal(result.json.downloads[0].status, 'published');
  } finally { globalThis.fetch = originalFetch; }
});
