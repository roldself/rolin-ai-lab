(() => {
  const $ = selector => document.querySelector(selector);
  const profileMode = location.pathname === '/profile';
  const token = $('meta[name="studio-token"]').content;
  let state, selected, draft, profile, dirty = false, busy = false;
  const form = $('#article-form');
  const profileForm = $('#profile-form');
  const names = { paragraph: '段落', heading: '标题', quote: '引用', image: '图片' };
  function notice(text, error = false) { $('#notice').hidden = false; $('#notice').textContent = text; $('#notice').classList.toggle('error', error); }
  async function api(path, body) {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-studio-token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '操作未完成');
    return data;
  }
  async function task(action) {
    if (busy) return;
    busy = true; document.body.setAttribute('aria-busy', 'true'); notice('正在处理，请稍候…');
    const controls = [...document.querySelectorAll('button,input,textarea,select')].map(node => [node, node.disabled]);
    controls.forEach(([node]) => { node.disabled = true; });
    try { await action(); } catch (error) { notice(error.message, true); }
    finally { busy = false; controls.forEach(([node, disabled]) => { if (node.isConnected) node.disabled = disabled; }); document.body.removeAttribute('aria-busy'); }
  }
  function changed() { dirty = true; $('#save-state').textContent = '未保存'; }
  function collect() {
    if (!draft) return;
    for (const key of ['title', 'summary', 'date', 'status']) draft[key] = form.elements[key].value;
  }
  function list() {
    $('#article-list').replaceChildren();
    for (const article of state.content.articles.filter(item => item.title.toLowerCase().includes($('#search').value.trim().toLowerCase()))) {
      const button = document.createElement('button'); button.textContent = article.title; button.setAttribute('aria-current', String(article.id === selected));
      const small = document.createElement('small'); small.textContent = article.status === 'Published' ? '网站展示' : '草稿'; button.append(small);
      button.onclick = () => { if (busy || (dirty && !confirm('放弃当前未保存的修改？'))) return; selected = article.id; render(); };
      $('#article-list').append(button);
    }
  }
  function renderBlocks() {
    $('#blocks').replaceChildren();
    draft.blocks.forEach((block, index) => {
      const row = document.createElement('section'); row.className = 'block';
      const bar = document.createElement('div'); bar.className = 'block-bar';
      const label = document.createElement('span'); label.textContent = `${index + 1} / ${names[block.type]}`; bar.append(label);
      for (const [symbol, title, offset] of [['↑', '上移', -1], ['↓', '下移', 1], ['×', '移除', 0]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = symbol; button.title = title; button.setAttribute('aria-label', `${title}第 ${index + 1} 块`);
        button.disabled = offset !== 0 && (index + offset < 0 || index + offset >= draft.blocks.length);
        button.onclick = () => { if (busy) return; if (!offset) { if (!confirm('移除这一块正文？')) return; draft.blocks.splice(index, 1); } else [draft.blocks[index], draft.blocks[index + offset]] = [draft.blocks[index + offset], draft.blocks[index]]; changed(); renderBlocks(); };
        bar.append(button);
      }
      row.append(bar);
      if (block.type === 'image') { const image = new Image(); image.src = block.src; image.alt = block.caption || '文章配图'; row.append(image); }
      const input = document.createElement(block.type === 'image' ? 'input' : 'textarea'); input.value = block.type === 'image' ? block.caption : block.text;
      input.maxLength = block.type === 'image' ? 300 : 20000;
      input.setAttribute('aria-label', `${names[block.type]} ${index + 1}${block.type === 'image' ? ' 图片说明' : ''}`);
      if (block.type !== 'image') input.rows = block.type === 'heading' ? 2 : 5;
      input.oninput = () => { block[block.type === 'image' ? 'caption' : 'text'] = input.value; changed(); };
      row.append(input); $('#blocks').append(row);
    });
  }
  function render() {
    const article = state.content.articles.find(item => item.id === selected);
    draft = article ? structuredClone(article) : null;
    form.hidden = !draft; $('#empty').hidden = Boolean(draft); $('#save').hidden = !draft; $('#delete').hidden = !draft;
    $('#editor-title').textContent = draft?.title || '图文';
    if (draft) { for (const key of ['title', 'summary', 'date', 'status']) form.elements[key].value = draft[key] || ''; $('#cover').hidden = !draft.cover; if (draft.cover) $('#cover').src = draft.cover; renderBlocks(); }
    dirty = false; $('#save-state').textContent = ''; list();
  }
  async function save() {
    const content = structuredClone(state.content);
    if (profileMode) {
      if (!profileForm.reportValidity()) throw Error('请检查邮箱和主页链接。');
      for (const element of profileForm.elements) if (element.name) profile[element.name] = element.value.trim();
      content.profile = structuredClone(profile);
    } else if (draft) {
      if (!form.reportValidity()) throw Error('请填写文章标题。');
      collect(); content.articles = content.articles.map(article => article.id === selected ? structuredClone(draft) : article);
    }
    state = await api('/api/save', { content, revision: state.revision });
    state.content.articles ||= [];
    dirty = false; $('#save-state').textContent = '已保存'; if (!profileMode && draft) $('#editor-title').textContent = draft.title; list();
  }
  async function upload(file) {
    if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 25 * 1024 ** 2) throw Error('请选择 25 MiB 以内的 PNG、JPG 或 WebP。');
    const bitmap = await createImageBitmap(file); const canvas = document.createElement('canvas'); const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale)); canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .9)); if (!blob) throw Error('图片转换失败。');
    const response = await fetch(`/api/upload?owner=${profileMode ? 'profile' : 'article'}&work=${encodeURIComponent(profileMode ? 'profile' : selected)}&kind=image&name=image.webp`, { method:'POST', headers:{'x-studio-token':token}, body:blob });
    const result = await response.json(); if (!response.ok) throw Error(result.error); return result.src;
  }
  $('#new').onclick = () => task(async () => {
    if (dirty && !confirm('放弃未保存的修改，新增文章？')) return;
    const content = structuredClone(state.content);
    const article = { id:`article-${Date.now().toString(36)}`, title:'未命名文章', summary:'', date:'', status:'Draft', blocks:[] };
    content.articles.push(article);
    state = await api('/api/save', { content, revision:state.revision }); selected = article.id; render(); notice('已创建本地草稿。');
  });
  $('#save').onclick = $('#save-profile').onclick = () => task(async () => { await save(); notice('已保存到本地，尚未上传。'); });
  $('#delete').onclick = () => task(async () => {
    if (!draft || !confirm(`删除「${draft.title}」？图片文件会保留，不会自动上传网站。`)) return;
    const content = structuredClone(state.content); content.articles = content.articles.filter(article => article.id !== selected);
    state = await api('/api/save', { content, revision:state.revision }); selected = state.content.articles[0]?.id; render(); notice('文章已从本地移除。');
  });
  form.oninput = event => { if (!event.target.closest('#blocks')) { collect(); changed(); } }; form.onsubmit = profileForm.onsubmit = event => event.preventDefault(); profileForm.oninput = changed;
  $('#search').oninput = list;
  document.querySelectorAll('[data-add]').forEach(button => { button.onclick = () => { if (draft.blocks.length >= 200) return notice('正文最多 200 块。',true); draft.blocks.push({type:button.dataset.add,text:''}); changed(); renderBlocks(); $('#blocks').lastElementChild.querySelector('textarea').focus(); }; });
  for (const [id, target] of [['cover-file','cover'],['body-image','body'],['qr-file','qr']]) $( `#${id}`).onchange = event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    task(async () => { if (target === 'body' && draft.blocks.length >= 200) throw Error('正文最多 200 块。'); await save(); const src = await upload(file); if (target === 'qr') { profile.wechatQr = src; $('#qr').src = src; $('#qr').hidden = false; } else if (target === 'cover') { draft.cover = src; $('#cover').src = src; $('#cover').hidden = false; } else { draft.blocks.push({type:'image',src,caption:''}); renderBlocks(); } changed(); await save(); notice('图片已保存到本地。'); });
  };
  $('#remove-cover').onclick = () => { delete draft.cover; $('#cover').hidden = true; changed(); };
  $('#remove-qr').onclick = () => { delete profile.wechatQr; $('#qr').hidden = true; changed(); };
  $('#preview').onclick = () => task(async () => { await save(); const result = await api('/api/preview',{}); notice('网站预览已生成。'); const link = document.createElement('a'); link.href = result.url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = ' 打开预览 ↗'; $('#notice').append(link); });
  $('#read-preview').onclick = () => {
    collect(); const body = $('#reading-body'); body.replaceChildren(); const title = document.createElement('h1'); title.textContent = draft.title; body.append(title);
    const summary = document.createElement('p'); summary.textContent = draft.summary; body.append(summary);
    if (draft.cover) { const image = new Image(); image.src = draft.cover; image.alt = draft.title; body.append(image); }
    for (const block of draft.blocks) { const element = document.createElement({paragraph:'p',heading:'h2',quote:'blockquote',image:'figure'}[block.type]); if (block.type === 'image') { const image = new Image(); image.src = block.src; image.alt = block.caption; const caption = document.createElement('figcaption'); caption.textContent = block.caption; element.append(image,caption); } else element.textContent = block.text; body.append(element); }
    $('#reading').showModal();
  };
  $('#close-reading').onclick = () => $('#reading').close();
  addEventListener('beforeunload',event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
  document.querySelectorAll('header a').forEach(link => link.addEventListener('click', event => { if (busy || (dirty && !confirm('放弃当前未保存的修改？'))) event.preventDefault(); else dirty = false; }));
  document.body.classList.toggle('profile',profileMode); $('#article-sidebar').hidden = profileMode; $('#article-editor').hidden = profileMode; $('#profile-editor').hidden = !profileMode;
  document.querySelector(`nav a[href="${profileMode ? '/profile' : '/writing'}"]`).setAttribute('aria-current','page');
  task(async () => { state = await api('/api/state'); state.content.articles ||= []; profile = structuredClone(state.content.profile || {}); for (const element of profileForm.elements) if (element.name) element.value = profile[element.name] || ''; $('#qr').hidden = !profile.wechatQr; if (profile.wechatQr) $('#qr').src = profile.wechatQr; selected = state.content.articles[0]?.id; render(); $('#notice').hidden = true; });
})();
