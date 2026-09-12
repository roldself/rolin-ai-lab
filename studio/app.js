(() => {
  const $ = selector => document.querySelector(selector);
  const token = $('meta[name="studio-token"]').content;
  const demo = location.protocol === 'file:';
  const form = $('#work-form');
  let state;
  let draft;
  let unsavedNewId = null;
  let currentId = 'travel-os';
  let dirty = false;
  let busy = false;
  let noticeTimer;
  let confirmation;
  const icons = { Skill: 'skills', Agent: 'agents', Product: 'products' };
  const statusNames = { '待整理': '待确认', Idea: '想法', Building: '制作中', Testing: '测试中', Published: '已发布', Archived: '归档' };
  const current = () => state.content.works.find(work => work.id === currentId);
  const sizeText = bytes => bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  const assetURL = path => window.STUDIO_ASSETS?.[path] || path;
  function notice(message, error = false, persistent = false) {
    clearTimeout(noticeTimer);
    $('#status-message').textContent = message;
    $('#status-message').classList.toggle('error', error);
    $('#status-message').hidden = false;
    if (!persistent) noticeTimer = setTimeout(() => { $('#status-message').hidden = true; }, error ? 10000 : 6000);
  }
  async function api(path, body) {
    if (demo) throw Error('这是界面预览。请启动本地工作台后保存、上传或发布。');
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-studio-token': token, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '操作未完成。');
    return result;
  }
  async function task(label, callback) {
    if (busy) return;
    busy = true;
    document.body.setAttribute('aria-busy', 'true');
    const controls = [...document.querySelectorAll('button,input,select,textarea')].map(element => [element, element.disabled]);
    controls.forEach(([element]) => { element.disabled = true; });
    notice(label, false, true);
    try { await callback(); } catch (error) { notice(error.message, true); }
    finally {
      controls.forEach(([element, disabled]) => { if (element.isConnected) element.disabled = disabled; });
      busy = false; document.body.removeAttribute('aria-busy');
    }
  }
  function markDirty() { dirty = true; $('#save-state').textContent = '有未保存内容'; updatePreview(); }
  function splitLines(value) { return value.split('\n').map(line => line.trim()).filter(Boolean); }
  function collect() {
    const next = structuredClone(draft);
    for (const key of ['name', 'description', 'body', 'version']) next[key] = form.elements[key].value.trim();
    next.format = form.elements.format.value;
    next.category = next.format === 'Workflow' ? 'Skill' : next.format;
    next.status = form.elements.status.value;
    for (const key of ['capabilities', 'technology']) next[key] = splitLines(form.elements[key].value);
    next.links = [...document.querySelectorAll('.link-row')].map(row => ({ label: row.querySelector('[data-label]').value.trim(), href: row.querySelector('[data-href]').value.trim() })).filter(link => link.label || link.href);
    next.screenshots = [...document.querySelectorAll('.shot-row')].map(row => ({ src: row.dataset.src, caption: row.querySelector('input').value.trim() }));
    return next;
  }
  function nextContent() {
    const content = structuredClone(state.content);
    const work = collect();
    content.works[content.works.findIndex(item => item.id === work.id)] = work;
    content.featured = content.featured.filter(id => id !== work.id);
    if ($('#featured-check').checked) {
      if (content.featured.length >= 4) throw Error('首页已有四个重点作品，请先取消其中一个。其他作品不会被删除。');
      content.featured.splice(Math.min(Number($('#featured-order').value), content.featured.length), 0, work.id);
    }
    return content;
  }
  function listWorks() {
    const list = $('#work-list'); list.replaceChildren();
    const query = $('#work-search').value.toLowerCase().trim();
    const works = state.content.works.filter(work => `${work.name} ${work.description}`.toLowerCase().includes(query));
    $('#work-count').textContent = `${works.length} 个作品`;
    for (const work of works) {
      const button = document.createElement('button'); button.className = 'work-choice'; button.setAttribute('aria-current', String(work.id === currentId));
      const image = new Image(30, 30); image.src = assetURL(`/brand/category-${icons[work.category]}.webp`); image.alt = '';
      const copy = document.createElement('span'); const name = document.createElement('strong'); name.textContent = work.name; const meta = document.createElement('small'); meta.textContent = `${work.format || work.category} · ${statusNames[work.status]}`;
      copy.append(name, meta); button.append(image, copy);
      button.addEventListener('click', () => {
        if (work.id === currentId) return;
        if (dirty && !confirm('当前作品还有未保存内容。放弃这些编辑并切换作品？')) return;
        if (unsavedNewId === currentId) { state.content.works = state.content.works.filter(item => item.id !== unsavedNewId); unsavedNewId = null; }
        currentId = work.id; render();
      });
      list.append(button);
    }
  }
  function addLink(link = { label: '', href: '' }) {
    const row = document.createElement('div'); row.className = 'link-row';
    row.innerHTML = '<label>入口名称<input data-label maxlength="100" placeholder="在线体验 / 演示 / 源码"></label><label>完整链接<input data-href maxlength="2048" placeholder="https://..."></label><button type="button" class="icon-button" title="移除链接" aria-label="移除链接">×</button>';
    row.querySelector('[data-label]').value = link.label; row.querySelector('[data-href]').value = link.href;
    row.querySelector('button').onclick = () => { row.remove(); markDirty(); };
    $('#link-fields').append(row);
  }
  function renderShots(shots = []) {
    $('#screenshot-list').replaceChildren();
    for (const shot of shots) {
      const row = document.createElement('div'); row.className = 'shot-row'; row.dataset.src = shot.src;
      const image = new Image(); image.src = assetURL(shot.src); image.alt = '作品截图';
      const label = document.createElement('label'); label.textContent = '这张图展示什么？'; const input = document.createElement('input'); input.maxLength = 300; input.placeholder = '例如：自动生成的三日旅行路线'; input.value = shot.caption || ''; label.append(input);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button'; remove.textContent = '×'; remove.title = '从作品中移除截图'; remove.setAttribute('aria-label', remove.title); remove.onclick = () => { row.remove(); markDirty(); };
      row.append(image, label, remove); $('#screenshot-list').append(row);
    }
  }
  function renderDownloads() {
    $('#download-list').replaceChildren();
    const assets = state.downloads.filter(asset => asset.workId === currentId);
    if (!assets.length) { const text = document.createElement('p'); text.className = 'field-note'; text.textContent = '这个作品还没有下载文件。'; $('#download-list').append(text); }
    for (const asset of assets) {
      const row = document.createElement('div'); row.className = 'download-row';
      const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.asset = asset.id; check.checked = asset.status === 'local'; check.disabled = asset.status === 'published'; check.setAttribute('aria-label', `选择 ${asset.originalName}`);
      const copy = document.createElement('div'); const name = document.createElement('strong'); name.textContent = asset.originalName; const meta = document.createElement('small'); meta.textContent = `${sizeText(asset.size)} · ${{ local: '仅在本地', draft: '已上传，尚未公开', published: '已公开，下载链接已回填' }[asset.status]}`; copy.append(name, meta);
      row.append(check, copy);
      if (asset.status === 'draft') {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = '确认公开'; button.onclick = () => confirmRelease(asset.releaseId); row.append(button);
      } else if (asset.status === 'local' && !asset.releaseId) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = '移除';
        button.onclick = () => {
          if (!confirm('移除工作台中的本地副本？不会删除你选择的原文件，也不会操作 GitHub。')) return;
          task('移除本地副本…', async () => { const result = await api('/api/download/remove', { id: asset.id, confirm: true }); state.downloads = result.downloads; renderDownloads(); notice('已移除本地副本。'); });
        };
        row.append(button);
      }
      $('#download-list').append(row);
    }
  }
  function updatePreview() {
    const work = collect();
    $('#mini-name').textContent = work.name || '作品名称'; $('#mini-description').textContent = work.description || '一句话说明作品能解决什么问题。';
    $('#mini-category').textContent = work.format; $('#mini-status').textContent = statusNames[work.status];
    const cover = assetURL(work.cover || `/brand/category-${icons[work.category]}.webp`);
    $('#mini-image').src = cover; $('#cover-preview').src = cover;
    $('#mini-links').replaceChildren(...work.links.map(link => { const span = document.createElement('span'); span.textContent = link.label || '入口'; return span; }));
    $('#category-destination').textContent = work.format === 'Workflow' ? '工作流自动归入 Skills，图文和文件都挂在这个作品下。' : `自动归入 ${work.category}s；不需要自己选择页面区块。`;
    const checks = [[Boolean(work.name && work.description), '作品卡：名称与一句话介绍'], [Boolean(work.cover), '首页重点：真实封面图片'], [Boolean(work.body || work.screenshots.length), '作品详情：文字或截图'], [Boolean(work.links.length), '作品入口：体验、演示、源码或下载']];
    $('#placement-checklist').replaceChildren(...checks.map(([complete, label]) => { const div = document.createElement('div'); div.className = complete ? 'complete' : 'missing'; div.textContent = `${complete ? '✓' : '○'} ${label}`; return div; }));
  }
  function render() {
    if (!current()) currentId = state.content.works[0]?.id;
    const work = current();
    form.hidden = !work;
    $('.editor-tabs').hidden = !work;
    $('.preview-rail').hidden = !work;
    $('#save-button').hidden = !work;
    $('#delete-work').hidden = !work;
    if (!work) {
      dirty = false; draft = null;
      $('#editor-title').textContent = '暂无作品';
      $('#work-meta').textContent = 'PROJECT FILE';
      $('#save-state').textContent = '';
      listWorks(); return;
    }
    draft = structuredClone(work);
    for (const key of ['name', 'description', 'body', 'version']) form.elements[key].value = work[key] || '';
    form.elements.format.value = work.format || work.category; form.elements.status.value = work.status;
    for (const key of ['capabilities', 'technology']) form.elements[key].value = (work[key] || []).join('\n');
    $('#editor-title').textContent = work.name; $('#work-meta').textContent = `${work.id} / PROJECT FILE`;
    $('#link-fields').replaceChildren(); (work.links || []).forEach(addLink);
    renderShots(work.screenshots); renderDownloads();
    const index = state.content.featured.indexOf(work.id); $('#featured-check').checked = index !== -1; $('#featured-order').value = String(Math.max(0, index));
    const pendingRelease = state.downloads.find(asset => asset.workId === work.id && asset.tag && asset.status !== 'published');
    $('#release-version').value = pendingRelease ? pendingRelease.tag.slice(work.id.length + 1) : work.version || 'v1.0.0';
    dirty = false; $('#save-state').textContent = '已载入本地内容';
    $('#connection-state').textContent = state.connection ? `GitHub 已连接 · ${state.connection.branch}` : 'GitHub 未连接';
    $('#connect-button').textContent = state.connection ? 'GitHub 已连接' : '连接 GitHub';
    listWorks(); updatePreview();
  }
  async function save() {
    if (!current()) return;
    if (!form.reportValidity()) throw Error('请先补全作品名称和一句话介绍。');
    const content = nextContent();
    state = await api('/api/save', { content, revision: state.revision });
    unsavedNewId = null;
    render(); $('#save-state').textContent = '已保存到本地';
  }
  function confirmAction(title, description, files, action) {
    $('#confirm-title').textContent = title; $('#confirm-description').textContent = description;
    $('#confirm-files').replaceChildren(...files.map(file => { const row = document.createElement('div'); const name = document.createElement('span'); name.textContent = file.name || file.path; const size = document.createElement('small'); size.textContent = sizeText(file.size); row.append(name, size); return row; }));
    $('#confirm-check').checked = false; $('#confirm-action').disabled = true;
    confirmation = action; $('#confirm-dialog').showModal();
  }
  async function upload(file, kind) {
    if (demo) throw Error('请启动本地工作台后添加素材。');
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', `/api/upload?work=${encodeURIComponent(currentId)}&kind=${kind}&name=${encodeURIComponent(file.name)}`);
      request.setRequestHeader('x-studio-token', token);
      request.upload.onprogress = event => { if (event.lengthComputable) notice(`保存到本地：${file.name} · ${Math.round(event.loaded / event.total * 100)}%`, false, true); };
      request.onerror = () => reject(Error('本地上传中断，请重试。'));
      request.onload = () => { try { const result = JSON.parse(request.responseText); request.status < 300 ? resolve(result) : reject(Error(result.error)); } catch { reject(Error('本地服务返回异常，请重试。')); } };
      request.send(file);
    });
  }
  async function compressImage(file) {
    if (file.size > 25 * 1024 ** 2) throw Error('原图超过 25 MiB，请先导出较小的图片。');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw Error('请选择 PNG、JPG 或 WebP 图片。');
    const image = await createImageBitmap(file);
    const canvas = document.createElement('canvas'); const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.88));
    if (!blob) throw Error('图片转换失败，请换一张图片。');
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' });
  }
  function confirmRelease(releaseId) {
    if (dirty) return notice('请先保存作品，避免覆盖未保存的内容。', true);
    const files = state.downloads.filter(asset => asset.releaseId === releaseId);
    confirmAction('公开发布下载包', `目标：${state.repo}。这些文件将公开供他人下载。成功后链接自动保存到本地作品；上传网站仍需另行确认。`, files, async () => { state = await api('/api/release/publish', { releaseId, confirm: true }); render(); notice('下载包已公开，链接已回填本地作品。网站尚未上传。'); });
  }

  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', event => { if (!event.target.closest('.release-form') && !event.target.matches('[data-asset],input[type=file]')) markDirty(); });
  $('#work-search').addEventListener('input', listWorks);
  $('#add-link').onclick = () => { addLink(); markDirty(); };
  $('#save-button').onclick = () => task('保存本地内容…', async () => { await save(); notice('已保存到本地，没有上传。'); });
  $('#delete-work').onclick = () => {
    if (!current() || busy) return;
    if (!confirm(`从本地网站移除「${current().name}」？\n它会从目录和首页重点中移除；未保存编辑会丢弃。\n不会删除截图、下载文件或 GitHub Releases，也不会自动上传网站。`)) return;
    if (currentId === unsavedNewId) {
      state.content.works = state.content.works.filter(work => work.id !== currentId);
      unsavedNewId = null; currentId = null; render(); notice('已移除尚未保存的作品。'); return;
    }
    task('移除本地作品…', async () => {
      state = await api('/api/work/delete', { id: currentId, revision: state.revision, confirm: true });
      currentId = null; unsavedNewId = null; render(); notice('作品已从本地网站移除，素材和 GitHub 内容均保留。');
    });
  };
  $('#add-work').onclick = () => {
    if (dirty && !confirm('先放弃当前未保存的编辑，创建新作品？')) return;
    if (unsavedNewId) state.content.works = state.content.works.filter(work => work.id !== unsavedNewId);
    currentId = `work-${Date.now().toString(36)}`;
    unsavedNewId = currentId;
    state.content.works.push({ id: currentId, name: '未命名作品', category: 'Product', status: '待整理', icon: '', description: '' });
    render(); markDirty(); form.elements.name.focus();
  };
  document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => {
    document.querySelectorAll('[data-tab]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== button.dataset.tab; });
  });
  $('#remove-cover').onclick = () => { delete draft.cover; markDirty(); };
  $('#cover-file').onchange = event => { const file = event.target.files[0]; if (!file) return; task('准备封面…', async () => { await save(); const image = await upload(await compressImage(file), 'image'); draft.cover = image.src; markDirty(); await save(); notice('封面已保存到本地，并关联到作品卡。'); }); event.target.value = ''; };
  $('#screenshot-files').onchange = event => {
    const files = [...event.target.files]; event.target.value = '';
    task('准备截图…', async () => {
      await save(); const shots = [...(current().screenshots || [])];
      if (shots.length + files.length > 8) throw Error('每个作品最多 8 张截图。');
      for (const file of files) {
        const image = await upload(await compressImage(file), 'image'); shots.push({ src: image.src, caption: '' });
        renderShots(shots); markDirty(); await save();
      }
      notice('截图已保存到本地，可为每张图补充说明。');
    });
  };
  $('#download-files').onchange = event => {
    const files = [...event.target.files]; event.target.value = '';
    task('准备下载文件…', async () => {
      if (files.some(file => file.size >= 2 * 1024 ** 3)) throw Error('每个下载文件必须小于 2 GiB，超出时请拆成多个压缩包。');
      await save();
      for (const file of files) await upload(file, 'download');
      state = await api('/api/state'); renderDownloads(); notice('文件仅保存在本机，没有上传 GitHub。');
    });
  };
  $('#upload-release').onclick = () => {
    if (dirty) return notice('请先保存作品内容。', true);
    if (!state.connection) { $('#connect-dialog').showModal(); return; }
    const ids = [...document.querySelectorAll('[data-asset]:checked')].map(input => input.dataset.asset);
    const files = state.downloads.filter(asset => ids.includes(asset.id));
    if (!files.length) return notice('请先选择需要上传的本地文件。', true);
    const body = { ids, workId: currentId, version: $('#release-version').value.trim(), notes: $('#release-notes').value.trim(), confirm: true };
    confirmAction('上传到 GitHub 草稿', `目标：${state.repo}。上传这些文件会创建 Release 草稿，不会自动公开。`, files, async () => { state = await api('/api/release/draft', body); renderDownloads(); notice('已上传草稿，尚未公开。确认公开后才会回填下载链接。'); });
  };
  $('#connect-button').onclick = () => $('#connect-dialog').showModal();
  $('#connect-confirm').onclick = () => {
    const credential = $('#github-token').value.trim(); $('#github-token').value = '';
    task('验证 GitHub 连接…', async () => { const result = await api('/api/connect', { token: credential }); state.connection = result.connection; $('#connect-dialog').close(); $('#connection-state').textContent = `GitHub 已连接 · ${state.connection.branch}`; $('#connect-button').textContent = 'GitHub 已连接'; notice('已连接，尚未上传任何文件。'); });
  };
  $('#disconnect').onclick = () => task('断开连接…', async () => { await api('/api/disconnect', {}); state.connection = null; $('#connect-dialog').close(); $('#connection-state').textContent = 'GitHub 未连接'; $('#connect-button').textContent = '连接 GitHub'; notice('凭据已从本地服务内存清除。'); });
  $('#preview-button').onclick = () => task('生成本地网站预览…', async () => { await save(); const result = await api('/api/preview', {}); notice('预览已生成，没有上传。'); const link = document.createElement('a'); link.href = result.url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = ' 打开网站预览 ↗'; $('#status-message').append(link); clearTimeout(noticeTimer); });
  $('#publish-button').onclick = () => {
    if (dirty) return notice('请先保存本地内容，然后再检查上传清单。', true);
    if (!state.connection) { $('#connect-dialog').showModal(); return; }
    task('核对网站上传清单…', async () => {
      const plan = await api('/api/site/plan', {});
      confirmAction('确认上传网站到 GitHub', `${plan.repo} · ${plan.branch} · ${plan.files.length} 个文件 · ${sizeText(plan.total)}。不包含本地下载包或凭据。已绑定的 Cloudflare Pages 会开始部署。`, plan.files, async () => { const result = await api('/api/site/publish', { planId: plan.id, confirm: true }); notice(result.unchanged ? '网站没有变化，无需提交。' : result.message, false, true); });
    });
  };
  $('#guide-button').onclick = () => $('#guide-dialog').showModal();
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
  $('#confirm-check').onchange = () => { $('#confirm-action').disabled = !$('#confirm-check').checked; };
  $('#confirm-action').onclick = () => { if (!$('#confirm-check').checked || !confirmation) return; const action = confirmation; confirmation = null; $('#confirm-dialog').close(); task('正在执行已确认的上传操作，请保持工作台打开…', action); };
  addEventListener('beforeunload', event => { if (dirty || busy) event.preventDefault(); });
  (async () => {
    try { state = demo ? window.STUDIO_SEED : await api('/api/state'); render(); if (demo) notice('界面预览模式：可以浏览表单；保存与上传需启动本地工作台。', false, true); }
    catch (error) { notice(error.message, true, true); }
  })();
})();
