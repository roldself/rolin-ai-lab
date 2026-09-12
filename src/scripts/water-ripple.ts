const vertexSource = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const fragmentSource = `
precision mediump float;
varying vec2 uv;
uniform sampler2D portrait;
uniform vec2 viewport;
uniform vec2 imageSize;
uniform vec4 waves[6];
void main() {
  vec2 aspect = viewport / min(viewport.x, viewport.y);
  vec2 offset = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    vec2 delta = (uv - waves[i].xy) * aspect;
    float distance = length(delta);
    float age = waves[i].z;
    float front = distance - age * 0.28;
    float band = exp(-pow(front / 0.065, 2.0));
    float fade = pow(max(0.0, 1.0 - age / 1.8), 2.0) * smoothstep(0.0, 0.08, age);
    float bend = sin(front * 100.0) * band * fade * waves[i].w * 0.014;
    offset += delta / max(distance, 0.001) * bend / aspect;
  }
  float cover = max(viewport.x / imageSize.x, viewport.y / imageSize.y);
  vec2 crop = viewport / (imageSize * cover);
  vec2 sampleUV = (uv + clamp(offset, vec2(-0.025), vec2(0.025)) - 0.5) * crop + 0.5;
  gl_FragColor = texture2D(portrait, clamp(sampleUV, vec2(0.001), vec2(0.999)));
}`;

// A single image pass refracts the portrait along expanding, fading circular waves.
// The original <img> remains visible whenever rendering is unavailable or inactive.
export function createWaterRipple(hero: HTMLElement, image: HTMLImageElement, canvas: HTMLCanvasElement, enabled: () => boolean) {
  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let waveLocation: WebGLUniformLocation | null = null;
  let viewportLocation: WebGLUniformLocation | null = null;
  let imageLocation: WebGLUniformLocation | null = null;
  let ready = false;
  let failed = false;
  let frame = 0;
  let lastSpawn = -1000;
  let lastDraw = 0;
  let waves: { x: number; y: number; born: number; strength: number }[] = [];
  const values = new Float32Array(24);

  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    waves = [];
    canvas.classList.remove('ready');
  }

  function initialize() {
    if (failed || program) return;
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
    if (!gl) { failed = true; return; }
    const shaders: WebGLShader[] = [];
    for (const [kind, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
      const shader = gl.createShader(kind);
      if (!shader) { failed = true; break; }
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { failed = true; break; }
    }
    if (failed) { shaders.forEach(shader => gl!.deleteShader(shader)); return; }
    program = gl.createProgram();
    if (!program) { failed = true; shaders.forEach(shader => gl!.deleteShader(shader)); return; }
    shaders.forEach(shader => gl!.attachShader(program!, shader));
    gl.linkProgram(program);
    shaders.forEach(shader => gl!.deleteShader(shader));
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { failed = true; gl.deleteProgram(program); program = null; return; }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.uniform1i(gl.getUniformLocation(program, 'portrait'), 0);
    waveLocation = gl.getUniformLocation(program, 'waves[0]');
    viewportLocation = gl.getUniformLocation(program, 'viewport');
    imageLocation = gl.getUniformLocation(program, 'imageSize');
  }

  function prepareImage() {
    reset();
    ready = false;
    if (!enabled() || innerWidth <= 700 || !image.naturalWidth) return;
    initialize();
    if (!gl || !program || failed || gl.isContextLost()) return;
    const rect = hero.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio, 1.5, 1920 / rect.width);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(viewportLocation, canvas.width, canvas.height);
    gl.uniform2f(imageLocation, image.naturalWidth, image.naturalHeight);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      ready = gl.getError() === gl.NO_ERROR;
    } catch { ready = false; }
  }

  function draw(now: number) {
    frame = 0;
    if (!enabled() || document.hidden || innerWidth <= 700 || !gl || gl.isContextLost()) return reset();
    waves = waves.filter(wave => now - wave.born < 1800);
    if (!waves.length) return reset();
    if (now - lastDraw < 30) { frame = requestAnimationFrame(draw); return; }
    lastDraw = now;
    values.fill(0);
    waves.forEach((wave, index) => values.set([wave.x, wave.y, (now - wave.born) / 1000, wave.strength], index * 4));
    gl.uniform4fv(waveLocation, values);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    canvas.classList.add('ready');
    frame = requestAnimationFrame(draw);
  }

  function disturb(event: PointerEvent, strong = false) {
    if (!enabled() || document.hidden || innerWidth <= 700) return;
    if (event.target instanceof Element && event.target.closest('a, button')) return;
    const now = performance.now();
    if (!strong && now - lastSpawn < 150) return;
    if (!ready) prepareImage();
    if (!ready) return;
    const rect = hero.getBoundingClientRect();
    waves.push({ x: (event.clientX - rect.left) / rect.width, y: 1 - (event.clientY - rect.top) / rect.height, born: now, strength: strong ? 1.4 : 0.8 });
    if (waves.length > 6) waves.shift();
    lastSpawn = now;
    if (!frame) frame = requestAnimationFrame(draw);
  }

  hero.addEventListener('pointermove', event => disturb(event));
  hero.addEventListener('pointerdown', event => { if (event.button === 0) disturb(event, true); });
  image.addEventListener('load', prepareImage);
  new ResizeObserver(prepareImage).observe(hero);
  canvas.addEventListener('webglcontextlost', () => { ready = false; failed = true; reset(); });
  if (image.complete) prepareImage();
  return reset;
}
