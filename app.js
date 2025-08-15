// app.js — square-grid flasher + 6 image zooms + centered 6-video zoom
// TEADS | fullscreen canvas 2D

// -------------------- PARAMS --------------------
const BG_COLOR = '#0f1113';
const GRID_OPACITY = 0.18;            // grid line strength (0..1)

// Overview density (tiles stay SQUARE; these are baselines)
const OVER_COLS_BASE = 44;
const OVER_ROWS_BASE = 44;

// Portrait defaults
const PORTRAIT = {
  ZOOM_COLS: 9,  ZOOM_ROWS: 16,
  VIDEO_WIN_COLS: 4, VIDEO_WIN_ROWS: 5,
  VIDEO_CENTER_COLS: 2, VIDEO_CENTER_ROWS: 3
};

// Landscape defaults
const LANDSCAPE = {
  ZOOM_COLS: 16, ZOOM_ROWS: 9,
  VIDEO_WIN_COLS: 5, VIDEO_WIN_ROWS: 4,
  VIDEO_CENTER_COLS: 3, VIDEO_CENTER_ROWS: 2
};

// These will be set in resize() according to orientation
let ZOOM_COLS, ZOOM_ROWS, VIDEO_WIN_COLS, VIDEO_WIN_ROWS, VIDEO_CENTER_COLS, VIDEO_CENTER_ROWS;

// Flip cadence (per-slot randomized)
const FLASH_MIN = 220;   // ms
const FLASH_MAX = 900;   // ms

// Camera choreography
const IMAGE_DWELL_MS = 3000;   // stay time when zoomed on images
const VIDEO_DWELL_MS = 5000;   // stay time when zoomed on videos
const CYCLE_GAP_MS   = 2000;   // pause in overview before next zoom
const ZOOM_TIME_MS   = 1600;   // tween duration

// Push-in factors (1=fit; >1 = tighter crop to hide margins)
const IMAGE_ZOOM_FACTOR = 1.20;
const VIDEO_ZOOM_FACTOR = 1.60;

// Groups + debug palettes (kept)
const GROUPS = ['plans','sections','siteplans','diagrams','perspectives','mockups'];
const PAL = {
  all:          ['#1abc9c','#16a085','#27ae60','#2ecc71','#3498db','#2980b9','#9b59b6','#8e44ad','#e67e22','#d35400','#e74c3c','#c0392b'],
  plans:        ['#22a6b3','#7ed6df','#4834d4','#686de0'],
  sections:     ['#badc58','#6ab04c','#2ecc71','#27ae60'],
  siteplans:    ['#e67e22','#f0932b','#d35400','#ffbe76'],
  diagrams:     ['#c23616','#e84118','#e74c3c','#c0392b'],
  perspectives: ['#be2edd','#9b59b6','#8e44ad','#e056fd'],
  mockups:      ['#f9ca24','#f6e58d','#f1c40f','#f39c12'],
};

// Put 6 videos here (or leave missing to see gray placeholders)
const VIDEO_SOURCES = [
  'media/v1.mp4','media/v2.mp4','media/v3.mp4',
  'media/v4.mp4','media/v5.mp4','media/v6.mp4',
];

// -------------------- helpers --------------------
const pick = (arr) => arr[(Math.random()*arr.length)|0];
const rand = (a,b) => a + Math.random()*(b-a);
const lerp = (a,b,t) => a + (b-a)*t;
const ease = (t) => (t<0?0:(t>1?1:1-Math.pow(1-t,3)));   // smooth, no overshoot

// -------------------- canvas --------------------
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { alpha:false });

// -------------------- world (persistent) --------------------
const world = {
  tile: 0, cols: 0, rows: 0, bleed: 1, slots: [],
  cam: { sx:1, sy:1, tx:0, ty:0 },
  camFrom:null, camTo:null, camT0:0, camT1:0,
  state: 'overview', mode: 'image', zoomRect: null, zoomGroup: null
};

// -------------------- Build tiles --------------------
function buildWorld(){
  const W = canvas.width, H = canvas.height;
  const tCols = Math.floor(W / OVER_COLS_BASE);
  const tRows = Math.floor(H / OVER_ROWS_BASE);
  const t = Math.max(1, Math.min(tCols, tRows));

  world.tile = t;
  world.cols = Math.ceil(W / t);
  world.rows = Math.ceil(H / t);

  world.slots.length = 0;
  const gx0 = -world.bleed, gx1 = world.cols + world.bleed;
  const gy0 = -world.bleed, gy1 = world.rows + world.bleed;

  for (let gy=gy0; gy<gy1; gy++){
    for (let gx=gx0; gx<gx1; gx++){
      const cx = gx*t, cy = gy*t;
      world.slots.push({
        gx, gy, cx, cy, w:t, h:t,
        color: pick(PAL.all), pool: 'all',
        nextFlip: performance.now() + rand(FLASH_MIN, FLASH_MAX),
      });
    }
  }
}

function resnapTilesTo(t){
  world.tile = t;
  world.cols = Math.ceil(canvas.width  / t);
  world.rows = Math.ceil(canvas.height / t);
  for (const s of world.slots){
    s.w = s.h = t;
    s.cx = s.gx * t;
    s.cy = s.gy * t;
  }
}

// -------------------- zoom windows --------------------
function pickImageWindow(){
  const t = world.tile;
  const zw = ZOOM_COLS * t, zh = ZOOM_ROWS * t;
  const maxGX = Math.max(0, Math.floor((canvas.width  - zw)/t));
  const maxGY = Math.max(0, Math.floor((canvas.height - zh)/t));
  const gx0 = (Math.random()*(maxGX+1))|0;
  const gy0 = (Math.random()*(maxGY+1))|0;
  return { x: gx0*t, y: gy0*t, w: zw, h: zh, tile:t, gx0, gy0 };
}

function pickVideoWindow(){
  const t = world.tile;
  const vw = VIDEO_WIN_COLS * t, vh = VIDEO_WIN_ROWS * t;
  const maxGX = Math.max(0, Math.floor((canvas.width  - vw)/t));
  const maxGY = Math.max(0, Math.floor((canvas.height - vh)/t));
  const gx0 = (Math.random()*(maxGX+1))|0;
  const gy0 = (Math.random()*(maxGY+1))|0;
  return { x: gx0*t, y: gy0*t, w: vw, h: vh, tile:t, gx0, gy0 };
}

function retargetPools(rect, poolName){
  for (const s of world.slots){
    if (s.cx >= rect.x && s.cx < rect.x+rect.w &&
        s.cy >= rect.y && s.cy < rect.y+rect.h){
      s.pool = poolName;
    }
  }
}
function restorePools(rect){
  for (const s of world.slots){
    if (s.cx >= rect.x && s.cx < rect.x+rect.w &&
        s.cy >= rect.y && s.cy < rect.y+rect.h){
      s.pool = 'all';
    }
  }
}

// -------------------- camera --------------------
function startZoomTo(rect, factor){
  const sFill = Math.min(canvas.width / rect.w, canvas.height / rect.h);
  const s     = sFill * factor;
  const cx = rect.x + rect.w*0.5, cy = rect.y + rect.h*0.5;
  const tx = canvas.width*0.5  - cx*s;
  const ty = canvas.height*0.5 - cy*s;
  world.camFrom = { ...world.cam };
  world.camTo   = { sx:s, sy:s, tx, ty };
  world.camT0   = performance.now();
  world.camT1   = world.camT0 + ZOOM_TIME_MS;
  world.state   = 'toZoom';
}
function startZoomOut(){
  world.camFrom = { ...world.cam };
  world.camTo   = { sx:1, sy:1, tx:0, ty:0 };
  world.camT0   = performance.now();
  world.camT1   = world.camT0 + ZOOM_TIME_MS;
  world.state   = 'toOut';
}
function stepCamera(now){
  if (world.state==='toZoom' || world.state==='toOut'){
    const t = ease((now - world.camT0) / (world.camT1 - world.camT0));
    world.cam.sx = lerp(world.camFrom.sx, world.camTo.sx, t);
    world.cam.sy = lerp(world.camFrom.sy, world.camTo.sy, t);
    world.cam.tx = lerp(world.camFrom.tx, world.camTo.tx, t);
    world.cam.ty = lerp(world.camFrom.ty, world.camTo.ty, t);
    if (t >= 1) world.state = (world.state==='toZoom') ? 'zoom' : 'overview';
  }
}

// -------------------- videos --------------------
const videos = [];
for (let i=0;i<6;i++){
  const src = VIDEO_SOURCES[i];
  const el = document.createElement('video');
  el.muted = true; el.loop = true; el.playsInline = true; el.preload = 'auto';
  if (src) el.src = src;
  el.addEventListener('canplay', ()=>{ try{ el.play(); }catch{} }, { once:true });
  const v = { el, ready:false };
  el.addEventListener('playing', ()=> v.ready = true);
  el.addEventListener('loadeddata', ()=>{ try{ el.play(); }catch{} });
  videos.push(v);
}

function drawVideoInTile(v, x, y, size){
  const el = v.el;
  if (v.ready && el.videoWidth && el.videoHeight){
    const vw = el.videoWidth, vh = el.videoHeight;
    const scale = Math.max(size/vw, size/vh);
    const dw = vw*scale, dh = vh*scale;
    const dx = x + (size - dw)/2, dy = y + (size - dh)/2;
    try{ ctx.drawImage(el, dx, dy, dw, dh); }catch{ drawVidPlaceholder(x,y,size); }
  } else {
    drawVidPlaceholder(x,y,size);
  }
}
function drawVidPlaceholder(x,y,s){
  ctx.fillStyle = '#777a80';
  ctx.fillRect(x,y,s,s);
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.arc(x+s/2, y+s/2, s*0.22, 0, Math.PI*2); ctx.fill();
}

// -------------------- cycle --------------------
let phaseStart = 0, seqIndex = 0;
function cycle(now){
  if (world.state === 'overview'){
    if (now - phaseStart > CYCLE_GAP_MS){
      if (seqIndex < GROUPS.length){
        const rect = pickImageWindow();
        const grp  = GROUPS[seqIndex];
        world.mode = 'image';
        world.zoomRect = rect;
        world.zoomGroup = grp;
        retargetPools(rect, grp);
        startZoomTo(rect, IMAGE_ZOOM_FACTOR);
      } else {
        const rect = pickVideoWindow();
        world.mode = 'video';
        world.zoomRect = rect;
        world.zoomGroup = null;
        startZoomTo(rect, VIDEO_ZOOM_FACTOR);
      }
      phaseStart = now;
    }
  } else if (world.state === 'zoom'){
    const dwell = (world.mode==='video') ? VIDEO_DWELL_MS : IMAGE_DWELL_MS;
    if (now - phaseStart > dwell){
      if (world.zoomGroup) restorePools(world.zoomRect);
      startZoomOut();
      phaseStart = now;
      seqIndex = (seqIndex + 1) % (GROUPS.length + 1);
    }
  }
}

// -------------------- draw --------------------
function draw(now){
  ctx.save();
  ctx.setTransform(world.cam.sx, 0, 0, world.cam.sy, world.cam.tx, world.cam.ty);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvas.width/world.cam.sx, canvas.height/world.cam.sy);

  for (const s of world.slots){
    if (now >= s.nextFlip){
      const pal = PAL[s.pool] || PAL.all;
      let c; do { c = pick(pal); } while (pal.length>1 && c===s.color);
      s.color = c;
      s.nextFlip = now + rand(FLASH_MIN, FLASH_MAX);
    }
  }

  const t = world.tile;
  let vx0=-1, vy0=-1;
  if (world.mode==='video' && world.zoomRect){
    vx0 = world.zoomRect.gx0 + Math.floor((VIDEO_WIN_COLS - VIDEO_CENTER_COLS)/2);
    vy0 = world.zoomRect.gy0 + Math.floor((VIDEO_WIN_ROWS - VIDEO_CENTER_ROWS)/2);
  }

  for (const s of world.slots){
    const inRect = world.zoomRect &&
                   s.cx >= world.zoomRect.x && s.cx < world.zoomRect.x + world.zoomRect.w &&
                   s.cy >= world.zoomRect.y && s.cy < world.zoomRect.y + world.zoomRect.h;

    if (inRect && world.mode==='video'){
      const gx = s.gx, gy = s.gy;
      const inCenter = gx >= vx0 && gx < vx0 + VIDEO_CENTER_COLS &&
                       gy >= vy0 && gy < vy0 + VIDEO_CENTER_ROWS;
      if (inCenter){
        const col = gx - vx0, row = gy - vy0;
        const idx = row * VIDEO_CENTER_COLS + col;
        drawVideoInTile(videos[idx] || videos[0], s.cx, s.cy, t);
        continue;
      }
    }
    ctx.fillStyle = s.color;
    ctx.fillRect(s.cx, s.cy, t, t);
  }

  ctx.globalAlpha = GRID_OPACITY;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1 / world.cam.sx;
  ctx.beginPath();
  const gx0 = (-world.bleed) * t, gx1 = (world.cols + world.bleed) * t;
  const gy0 = (-world.bleed) * t, gy1 = (world.rows + world.bleed) * t;
  for (let x=gx0; x<=gx1; x+=t){ ctx.moveTo(x, gy0); ctx.lineTo(x, gy1); }
  for (let y=gy0; y<=gy1; y+=t){ ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

// -------------------- resize --------------------
function resize(){
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const mode = (canvas.height > canvas.width) ? PORTRAIT : LANDSCAPE;
  ZOOM_COLS = mode.ZOOM_COLS;
  ZOOM_ROWS = mode.ZOOM_ROWS;
  VIDEO_WIN_COLS = mode.VIDEO_WIN_COLS;
  VIDEO_WIN_ROWS = mode.VIDEO_WIN_ROWS;
  VIDEO_CENTER_COLS = mode.VIDEO_CENTER_COLS;
  VIDEO_CENTER_ROWS = mode.VIDEO_CENTER_ROWS;

  if (world.slots.length === 0){
    buildWorld();
  } else {
    const tCols = Math.floor(canvas.width  / OVER_COLS_BASE);
    const tRows = Math.floor(canvas.height / OVER_ROWS_BASE);
    const t = Math.max(1, Math.min(tCols, tRows));
    resnapTilesTo(t);
  }
}
window.addEventListener('resize', resize);

// -------------------- main --------------------
function init(){
  resize();
  phaseStart = performance.now();
  requestAnimationFrame(tick);
}
function tick(now){
  stepCamera(now);
  cycle(now);
  draw(now);
  requestAnimationFrame(tick);
}
init();
