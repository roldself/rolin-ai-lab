const smoke = document.querySelector<HTMLCanvasElement>('#smoke-canvas')!;
const ctx = smoke.getContext('2d');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const pointer = matchMedia('(hover: hover) and (pointer: fine)');
const root = document.documentElement;
type Puff = { x:number; y:number; vx:number; vy:number; born:number; life:number; size:number; rotation:number; spin:number; texture:number; nx:number; ny:number; phase:number; side:number };
let puffs: Puff[] = [];
let frame = 0;
let lastDraw = 0;
let lastEmission = 0;
let cursor = { x:0, y:0, vx:0, vy:0, moved:-10000 };
let previousSource = { x:0, y:0 };
let pathPhase = 0;
let normal = { x:1, y:0 };
const textures: HTMLCanvasElement[] = [];
const heroShell = document.querySelector<HTMLElement>('.hero-shell');
type Ripple = { x:number; y:number; born:number; dark:boolean };
let ripples: Ripple[] = [];
let mode: 'smoke' | 'water' = heroShell ? 'smoke' : 'water';
let lastRipple = -1000;
let pointerPosition = { x:0, y:0 };
const enabled = () => pointer.matches && !reduce.matches && !root.classList.contains('motion-paused') && !document.hidden;

// Cache irregular, multi-scale density textures once. No blurred strokes or circular stamps.
function prepareTextures() {
  if (textures.length) return;
  for (let variant=0; variant<6; variant++) {
    const tile = document.createElement('canvas'); tile.width = tile.height = 160;
    const tileContext = tile.getContext('2d')!;
    const pixels = tileContext.createImageData(160,160);
    const grids = [5,10,20,40].map(size => ({size,values:Float32Array.from({length:(size+1)**2},()=>Math.random())}));
    const noise = (x:number,y:number) => grids.reduce((sum,grid,index) => {
      const gx = Math.max(0,Math.min(.9999,x))*grid.size, gy = Math.max(0,Math.min(.9999,y))*grid.size;
      const ix = Math.floor(gx), iy = Math.floor(gy);
      const sx = gx-ix, sy = gy-iy, u = sx*sx*(3-2*sx), v = sy*sy*(3-2*sy);
      const at = (dx:number,dy:number) => grid.values[(iy+dy)*(grid.size+1)+ix+dx];
      return sum+((at(0,0)*(1-u)+at(1,0)*u)*(1-v)+(at(0,1)*(1-u)+at(1,1)*u)*v)*[.53,.27,.14,.06][index];
    },0);
    const lobes = Array.from({length:7},(_,index) => { const angle=index*2.4+variant; return {x:.5+Math.cos(angle)*(.08+Math.random()*.15),y:.5+Math.sin(angle)*(.08+Math.random()*.15),radius:.15+Math.random()*.1}; });
    const color = variant%2 ? [203,43,48] : [22,153,89];
    for (let y=0;y<160;y++) for (let x=0;x<160;x++) {
      const nx=x/160, ny=y/160, grain=noise(nx,ny);
      const warpX=nx+(grain-.5)*.15, warpY=ny+(noise(ny,nx)-.5)*.15;
      const density=lobes.reduce((sum,lobe)=>sum+Math.exp(-((warpX-lobe.x)**2+(warpY-lobe.y)**2)/(lobe.radius**2)*3),0);
      const edge=Math.max(0,Math.min(1,Math.min(nx,ny,1-nx,1-ny)*10));
      const alpha=Math.min(.9,Math.max(0,density*(grain*.95+.1)-.1))*edge;
      const offset=(y*160+x)*4, light=.72+grain*.55;
      for(let channel=0;channel<3;channel++) pixels.data[offset+channel]=Math.min(255,color[channel]*light+grain*12);
      pixels.data[offset+3]=alpha*255;
    }
    tileContext.putImageData(pixels,0,0); textures.push(tile);
  }
}
function clear() { cancelAnimationFrame(frame); frame = 0; puffs = []; ripples = []; cursor.moved=-10000; lastEmission=0; lastRipple=-1000; ctx?.clearRect(0,0,innerWidth,innerHeight); }
function syncMode() {
  const bottom = heroShell?.getBoundingClientRect().bottom ?? 0;
  const next = bottom > pointerPosition.y && bottom > 0 ? 'smoke' : 'water';
  if (next !== mode) { clear(); mode = next; }
  smoke.dataset.effect = mode;
}
function resize() { const ratio = Math.min(devicePixelRatio,1.25); smoke.width = Math.round(innerWidth * ratio); smoke.height = Math.round(innerHeight * ratio); ctx?.setTransform(ratio,0,0,ratio,0,0); clear(); }
function emit(now:number) {
  const distance = Math.hypot(cursor.x-previousSource.x,cursor.y-previousSource.y);
  if (distance>2) normal = {x:-(cursor.y-previousSource.y)/distance,y:(cursor.x-previousSource.x)/distance};
  const count = Math.min(18,Math.max(2,Math.ceil(distance/14)));
  for(let i=0;i<count;i++) {
    const mix=(i+1)/count;
    const phase=pathPhase+distance*mix*.023;
    // Matched red/green emitters orbit opposite sides of the same mouse trail.
    for(let stream=0;stream<2;stream++) {
      puffs.push({x:previousSource.x+(cursor.x-previousSource.x)*mix,y:previousSource.y+(cursor.y-previousSource.y)*mix,vx:(Math.random()-.5)*22+cursor.vx*.04,vy:(Math.random()-.5)*22+cursor.vy*.04,born:now,life:1500+Math.random()*500,size:165+Math.random()*65,rotation:Math.random()*Math.PI*2,spin:(Math.random()-.5)*1.3,texture:Math.floor(Math.random()*3)*2+stream,nx:normal.x,ny:normal.y,phase,side:stream ? 1 : -1});
    }
  }
  pathPhase+=distance*.023+.07;
  puffs=puffs.slice(-240); previousSource={x:cursor.x,y:cursor.y}; lastEmission=now;
}
function draw(now:number) {
  frame = 0;
  if (!ctx || !enabled()) return clear();
  if(now-lastDraw<32) { frame=requestAnimationFrame(draw); return; }
  lastDraw=now;
  if (mode === 'water') {
    ctx.clearRect(0,0,innerWidth,innerHeight);
    ripples = ripples.filter(ripple => now-ripple.born<1200);
    for (const ripple of ripples) {
      const age=(now-ripple.born)/1200;
      const radius=7+age*66;
      const alpha=Math.sin(Math.min(1,age*5)*Math.PI/2)*(1-age)**2;
      for(let ring=0;ring<3;ring++) {
        const r=radius-ring*7;
        if(r<=0) continue;
        ctx.lineWidth=1.2;
        ctx.strokeStyle=ripple.dark ? `rgba(178,224,224,${alpha*.4/(ring+1)})` : `rgba(52,118,126,${alpha*.3/(ring+1)})`;
        ctx.beginPath(); ctx.arc(ripple.x,ripple.y,r,0,Math.PI*2); ctx.stroke();
        ctx.strokeStyle=`rgba(255,255,255,${alpha*.45/(ring+1)})`;
        ctx.beginPath(); ctx.arc(ripple.x,ripple.y-1,r+1,Math.PI,Math.PI*2); ctx.stroke();
      }
    }
    if(ripples.length) frame=requestAnimationFrame(draw);
    return;
  }
  if(now-cursor.moved<180 && now-lastEmission>=45) emit(now);
  ctx.clearRect(0,0,innerWidth,innerHeight);
  ctx.save();
  ctx.beginPath(); ctx.rect(0,0,innerWidth,Math.max(0,heroShell?.getBoundingClientRect().bottom ?? 0)); ctx.clip();
  puffs = puffs.filter(puff => now-puff.born<puff.life);
  for (const puff of puffs) {
    const age=(now-puff.born)/puff.life, seconds=(now-puff.born)/1000;
    const expansion=1-Math.exp(-seconds*2.4), drift=(1-Math.exp(-seconds*.8))/.8;
    const size=(65+puff.size*expansion)*.455;
    const orbit=puff.side*Math.sin(puff.phase+seconds*.9)*(12+68*expansion)*.455;
    const x=puff.x+puff.vx*drift+puff.nx*orbit;
    const y=puff.y+puff.vy*drift+puff.ny*orbit-seconds*24;
    ctx.save(); ctx.translate(x,y); ctx.rotate(puff.rotation+puff.spin*seconds*.3);
    ctx.globalAlpha=(.35+.4*Math.min(1,seconds*5))*Math.pow(1-age,1.35);
    ctx.drawImage(textures[puff.texture],-size/2,-size/2,size,size*(.85+expansion*.25)); ctx.restore();
  }
  ctx.restore();
  if (puffs.length || now-cursor.moved<180) frame = requestAnimationFrame(draw);
}
document.addEventListener('pointermove',event => {
  if (!ctx || !enabled() || event.pointerType !== 'mouse') return;
  const now = performance.now();
  pointerPosition={x:event.clientX,y:event.clientY}; syncMode();
  if(mode === 'water') {
    if(now-lastRipple<95) return;
    const dark=Boolean((event.target as Element)?.closest?.('.dark'));
    ripples.push({x:event.clientX,y:event.clientY,born:now,dark}); ripples=ripples.slice(-14); lastRipple=now;
    if(!frame) frame=requestAnimationFrame(draw);
    return;
  }
  prepareTextures();
  const elapsed=now-cursor.moved, dt=Math.max(16,elapsed)/1000;
  if(elapsed>180) previousSource={x:event.clientX,y:event.clientY};
  const clamp=(value:number)=>Math.max(-600,Math.min(600,value));
  cursor={x:event.clientX,y:event.clientY,vx:elapsed>180?0:clamp((event.clientX-cursor.x)/dt),vy:elapsed>180?0:clamp((event.clientY-cursor.y)/dt),moved:now};
  if (!frame) frame = requestAnimationFrame(draw);
},{passive:true});
document.documentElement.addEventListener('pointerleave',()=>{cursor.moved=-10000;});
addEventListener('resize',resize); document.addEventListener('visibilitychange',clear);
addEventListener('scroll',()=>{clear(); syncMode();},{passive:true});
reduce.addEventListener('change',clear); pointer.addEventListener('change',clear);
new MutationObserver(() => { if (!enabled()) clear(); }).observe(root,{attributes:true,attributeFilter:['class']});
const toggle = document.querySelector<HTMLButtonElement>('#smoke-toggle');
if (toggle) {
  const sync = () => { toggle.disabled = reduce.matches; const paused = reduce.matches || root.classList.contains('motion-paused'); toggle.setAttribute('aria-pressed',String(paused)); toggle.title = paused ? '开启动效' : '暂停动效'; toggle.setAttribute('aria-label',toggle.title); toggle.textContent = paused ? '▷' : 'Ⅱ'; };
  toggle.onclick = () => { root.classList.toggle('motion-paused'); sync(); }; reduce.addEventListener('change',sync); sync();
}
resize();
export {};
