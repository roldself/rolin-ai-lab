import { createReadStream } from 'node:fs';
import { REPO, fail } from './model.mjs';

export function githubClient(token, request = fetch) {
  if (!token) throw fail('请先连接 GitHub。', 401);
  async function api(path, method = 'GET', body, upload = false) {
    const response = await request(`https://${upload ? 'uploads' : 'api'}.github.com/repos/${REPO}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(upload ? 30 * 60 * 1000 : 60000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': upload ? 'application/octet-stream' : 'application/json', ...(upload ? { 'Content-Length': String(body.size) } : {}) },
      ...(body !== undefined ? { body: upload ? createReadStream(body.path) : JSON.stringify(body), ...(upload ? { duplex: 'half' } : {}) } : {}),
    });
    if (!response.ok) throw fail(`GitHub 返回 ${response.status}。请检查仓库权限、版本是否重复和网络连接；已上传的草稿不会被自动删除。`, response.status);
    return response.status === 204 ? null : response.json();
  }
  return {
    api,
    async connection() { const repo = await api(''); return { branch: repo.default_branch, repo: REPO }; },
    async base(branch) { const ref = await api(`/git/ref/heads/${encodeURIComponent(branch)}`); const commit = await api(`/git/commits/${ref.object.sha}`); return { head: ref.object.sha, tree: commit.tree.sha }; },
    async publishSite(files, base, branch) {
      const oldTree = await api(`/git/trees/${base.tree}?recursive=1`);
      if (oldTree.truncated) throw fail('远端文件树过大，暂不自动发布。');
      const existing = new Map(oldTree.tree.map(entry => [entry.path, entry]));
      const changes = files.filter(file => existing.get(file.path)?.sha !== file.sha || existing.get(file.path)?.mode !== (file.mode || '100644'));
      if (!changes.length) return { unchanged: true, url: `https://github.com/${REPO}` };
      const tree = [];
      for (const file of changes) {
        const blob = await api('/git/blobs', 'POST', { content: file.bytes.toString('base64'), encoding: 'base64' });
        tree.push({ path: file.path, mode: file.mode || '100644', type: 'blob', sha: blob.sha });
      }
      const nextTree = await api('/git/trees', 'POST', { base_tree: base.tree, tree });
      const commit = await api('/git/commits', 'POST', { message: 'Update Rolin AI Lab from Studio', tree: nextTree.sha, parents: [base.head] });
      await api(`/git/refs/heads/${encodeURIComponent(branch)}`, 'PATCH', { sha: commit.sha, force: false });
      return { sha: commit.sha, changed: changes.length, url: `https://github.com/${REPO}/commit/${commit.sha}` };
    },
    async createDraft(work, tag, notes) {
      return api('/releases', 'POST', { tag_name: tag, name: `${work.name} ${tag}`, body: notes, draft: true, make_latest: 'false' });
    },
    uploadAsset(releaseId, asset, path) { return api(`/releases/${releaseId}/assets?name=${encodeURIComponent(asset.name)}`, 'POST', { path, size: asset.size }, true); },
    publishRelease(id) { return api(`/releases/${id}`, 'PATCH', { draft: false, make_latest: 'false' }); },
  };
}
