
const root = document.documentElement;
export {};
const tokens = getComputedStyle(root);
const motion = {
  fast: parseFloat(tokens.getPropertyValue('--motion-fast')),
  normal: parseFloat(tokens.getPropertyValue('--motion-normal')),
  ease: tokens.getPropertyValue('--ease').trim(),
};
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const motionButton = document.querySelector<HTMLButtonElement>('#motion-toggle')!;
let paused = false;
const motionEnabled = () => !reduced.matches && !paused;

const hero = document.querySelector<HTMLElement>('.hero')!;
let heroVisible = true;

const heroObserver = new IntersectionObserver(entries => {
  heroVisible = entries[0].isIntersecting;
  hero.inert = !heroVisible;
  hero.classList.toggle('offscreen', !heroVisible);
});
heroObserver.observe(document.querySelector('.hero-shell')!);

const revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {
  if (entry.isIntersecting) { entry.target.classList.add('revealed'); revealObserver.unobserve(entry.target); }
}), { threshold: 0.08 });
document.querySelectorAll('[data-reveal]').forEach(element => revealObserver.observe(element));
root.classList.add('motion-ready');

const ticker = document.querySelector<HTMLElement>('.ticker')!;
new IntersectionObserver(entries => ticker.classList.toggle('in-view', entries[0].isIntersecting)).observe(ticker);
const stackCards = [...document.querySelectorAll<HTMLElement>('.stack-card')];
const copies = [...document.querySelectorAll<HTMLElement>('.scroll-copy')];
let scrollFrame = 0;
let previousScroll = scrollY;
let tilt = 0;
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function renderScroll() {
  scrollFrame = 0;
  const enabled = motionEnabled();
  tilt *= 0.8;
  root.style.setProperty('--scroll-tilt', enabled && innerWidth > 700 ? `${tilt.toFixed(3)}deg` : '0deg');
  stackCards.forEach((card, index) => {
    const next = stackCards[index + 1];
    const progress = enabled && innerWidth > 700 && next ? clamp((innerHeight * 0.78 - next.getBoundingClientRect().top) / (innerHeight * 0.65)) : 0;
    card.style.setProperty('--stack-scale', String(1 - progress * 0.055));
    card.style.setProperty('--stack-shade', String(progress * 0.12));
  });
  copies.forEach(copy => {
    const rect = copy.getBoundingClientRect();
    const lines = [...copy.querySelectorAll<HTMLElement>(':scope > span')];
    const progress = clamp((innerHeight * 0.87 - rect.top) / Math.max(1, rect.height * 0.8));
    lines.forEach((line, index) => line.style.setProperty('--line-opacity', String(enabled ? 0.5 + clamp(progress * lines.length - index) * 0.5 : 1)));
  });
  if (Math.abs(tilt) > 0.01 && enabled && !document.hidden) scrollFrame = requestAnimationFrame(renderScroll);
}

function requestScrollFrame() { if (!scrollFrame) scrollFrame = requestAnimationFrame(renderScroll); }
addEventListener('scroll', () => {
  tilt = clamp((previousScroll - scrollY) * 0.016, -1.4, 1.4);
  previousScroll = scrollY;
  requestScrollFrame();
}, { passive: true });
addEventListener('resize', requestScrollFrame);

function applyMotionPreference() {
  root.classList.toggle('motion-paused', !motionEnabled());
  motionButton.setAttribute('aria-pressed', String(!motionEnabled()));
  motionButton.disabled = reduced.matches;
  const label = reduced.matches ? '已跟随系统减少动效' : paused ? '开启动效' : '暂停动效';
  motionButton.setAttribute('aria-label', label);
  motionButton.title = label;
  requestScrollFrame();
}
motionButton.addEventListener('click', () => { paused = !paused; applyMotionPreference(); });
reduced.addEventListener('change', applyMotionPreference);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(scrollFrame); scrollFrame = 0; }
  else requestScrollFrame();
});
applyMotionPreference();

const menuButton = document.querySelector<HTMLButtonElement>('.mobile-menu-button')!;
const menu = document.querySelector<HTMLElement>('#mobile-menu')!;
function closeMenu() { menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); }
menuButton.addEventListener('click', () => {
  menu.hidden = !menu.hidden;
  menuButton.setAttribute('aria-expanded', String(!menu.hidden));
  if (!menu.hidden) menu.querySelector<HTMLAnchorElement>('a')?.focus();
});
menu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { closeMenu(); menuButton.focus(); } });
addEventListener('resize', () => { if (innerWidth > 1000) closeMenu(); });

const search = document.querySelector<HTMLInputElement>('#search')!;
const filters = [...document.querySelectorAll<HTMLButtonElement>('[data-filter]')];
const rows = [...document.querySelectorAll<HTMLElement>('.archive-row')];
let category = 'All';
function filterWorks() {
  const query = search.value.trim().toLocaleLowerCase();
  let count = 0;
  rows.forEach(row => {
    row.hidden = (category !== 'All' && category !== row.dataset.category) || !row.dataset.search?.toLocaleLowerCase().includes(query);
    if (!row.hidden) count++;
  });
  filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === category)));
  document.querySelector('#result-count')!.textContent = `${count} 个作品`;
  document.querySelector<HTMLElement>('#empty-state')!.hidden = count !== 0;
}
search.addEventListener('input', filterWorks);
filters.forEach(button => button.addEventListener('click', () => {
  category = button.dataset.filter!;
  filterWorks();
  if (motionEnabled()) document.querySelector('.archive-list')?.animate([{ opacity: 0.45, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: motion.normal, easing: motion.ease });
}));
document.querySelectorAll<HTMLAnchorElement>('[data-category-link]').forEach(link => link.addEventListener('click', () => { category = link.dataset.categoryLink!; search.value = ''; filterWorks(); }));
document.querySelector('#clear-search')!.addEventListener('click', () => { search.value = ''; category = 'All'; filterWorks(); search.focus(); });

let activeDialog: HTMLDialogElement | null = null;
let opener: HTMLElement | null = null;
let closing = false;
let returnHash = '#selected';
function openWork(id: string, trigger: HTMLElement | null, updateHistory = true) {
  const dialog = document.getElementById(`work-${id}`) as HTMLDialogElement | null;
  if (!dialog || activeDialog) return;
  opener = trigger;
  activeDialog = dialog;
  if (updateHistory) {
    returnHash = location.hash || '#selected';
    history.pushState({ labProject: id }, '', `#work-${id}`);
  }
  dialog.showModal();
  document.body.classList.add('dialog-open');
  if (motionEnabled()) {
    const to = dialog.getBoundingClientRect();
    const from = trigger?.getBoundingClientRect();
    const transform = from ? `translate(${from.x + from.width / 2 - to.x - to.width / 2}px, ${from.y + from.height / 2 - to.y - to.height / 2}px) scale(${clamp(from.width / to.width, 0.7, 0.97)})` : 'translateY(16px) scale(0.97)';
    dialog.animate([{ opacity: 0, transform }, { opacity: 1, transform: 'translate(0, 0) scale(1)' }], { duration: motion.normal, easing: motion.ease });
  }
}
async function closeWork(targetHash?: string, fromHistory = false) {
  if (!activeDialog || closing) return;
  closing = true;
  const dialog = activeDialog;
  if (motionEnabled()) await dialog.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(10px)' }], { duration: motion.fast, easing: motion.ease }).finished.catch(() => {});
  dialog.close();
  activeDialog = null;
  closing = false;
  document.body.classList.remove('dialog-open');
  opener?.focus({ preventScroll: true });
  if (targetHash) {
    history.replaceState(null, '', targetHash);
    document.getElementById(targetHash.slice(1))?.scrollIntoView({ behavior: motionEnabled() ? 'smooth' : 'instant' });
  } else if (!fromHistory) {
    if (history.state?.labProject) history.back();
    else history.replaceState(null, '', returnHash);
  }
}
document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(button => button.addEventListener('click', () => openWork(button.dataset.open!, button)));
document.querySelectorAll<HTMLDialogElement>('.work-dialog').forEach(dialog => {
  dialog.querySelector('[data-close]')!.addEventListener('click', () => closeWork());
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeWork(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeWork();
  });
  dialog.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); closeWork(link.hash); }));
});
function syncHash() {
  const id = location.hash.startsWith('#work-') ? location.hash.slice(6) : null;
  if (id && !activeDialog) openWork(id, null, false);
  else if (!id && activeDialog) closeWork(undefined, true);
}
addEventListener('popstate', syncHash);
addEventListener('hashchange', syncHash);
syncHash();
