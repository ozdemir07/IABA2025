// app.js — square-grid flasher + 6 image zooms + centered 6‑video zoom (assets via manifests)

// -------------------- PARAMS --------------------
const BG_COLOR = '#0f1113';
const GRID_OPACITY = 0.18; // grid line strength (0..1)

// Overview density (tiles stay SQUARE; baselines)
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

// Will be set in resize()
let ZOOM_COLS, ZOOM_ROWS, VIDEO_WIN_COLS, VIDEO_WIN_ROWS, VIDEO_CENTER_COLS, VIDEO_CENTER_ROWS;

// Flip cadence (per-slot randomized)
const FLASH_MIN = 600;   // ms
const FLASH_MAX = 1200;  // ms

// Camera choreography
const IMAGE_DWELL_MS = 2000;  // stay time when zoomed on images
const VIDEO_DWELL_MS = 10000; // stay time when zoomed on videos
const CYCLE_GAP_MS   = 1000;  // pause in overview before next zoom
const ZOOM_TIME_MS   = 1000;  // tween duration

// Push-in factors (1=fit; >1 = tighter crop to hide margins)
const IMAGE_ZOOM_FACTOR = 1.20;
const VIDEO_ZOOM_FACTOR = 1.60;

// Groups (must match manifest keys; we also accept "sitePlans")
const GROUPS = ['plans','sections','siteplans','diagrams','perspectives','mockups'];

// -------------------- helpers --------------------
const pick = (arr) => arr[(Math.random()*arr.length)|0];
const rand = (a,b) => a + Math.random()*(b-a);
const lerp = (a,b,t) => a + (b-a)*t;
const ease = (t) => (t<0?0:(t>1?1:1-Math.pow(1-t,3))); // smooth, no overshoot

// Draw an image to cover a square tile (no letterboxing)
function drawCover(img, x, y, s){
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return false;
  const k = Math.max(s/iw, s/ih);
  const dw = iw*k, dh = ih*k;
  const dx = x + (s - dw)/2, dy = y + (s - dh)/2;
  ctx.drawImage(img, dx, dy, dw, dh);
  return true;
}

// -------------------- canvas --------------------
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { alpha:false });

// -------------------- manifests --------------------
const IMAGE_MANIFEST_URL = 'data/manifest.json';
const VIDEO_MANIFEST_URL = 'data/videos.json';

// image pools: IMAGES[group] = [{img, ready}, ...]; ALL = flattened
const IMAGES = { plans:[], sections:[], siteplans:[], diagrams:[], perspectives:[], mockups:[] };
let ALL = []; // flattened

// grayscale placeholder palette for images (soft neutrals)
const PAL = {
  all:          ['#9aa1a6','#8c9399','#7e858b','#70777d','#62686e','#545a60'],
  plans:        ['#a7adb2','#9aa1a6','#8c9399','#7e858b'],
  sections:     ['#b2b7bb','#a5abb0','#979ea4','#8a9197'],
  siteplans:    ['#9fa5aa','#92989d','#858b90','#777d82'],
  diagrams:     ['#9c9c9c','#8f8f8f','#828282','#757575'],
  perspectives: ['#b1b1b1','#a4a4a4','#979797','#8a8a8a'],
  mockups:      ['#c0c3c6','#b3b7bb','#a6abb0','#999fa4'],
};

// -------------------- assets: images --------------------
async function loadImagesManifest() {
  let data;
  try {
    const res = await fetch(IMAGE_MANIFEST_URL, { cache:'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    console.error('[images] Failed to load manifest:', e);
    data = {};
  }

  // normalize "siteplans"/"sitePlans"
  const siteplans = data.siteplans || data.sitePlans || [];
  const map = {
    plans: data.plans || [],
    sections: data.sections || [],
    siteplans,
    diagrams: data.diagrams || [],
    perspectives: data.perspectives || [],
    mockups: data.mockups || []
  };

  Object.keys(map).forEach(group=>{
    IMAGES[group] = map[group].map(src=>{
      const img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.src = src;
      const o = { img, ready:false };
      img.addEventListener('load', ()=> o.ready = true);
      img.addEventListener('error', ()=> { o.ready = false; });
      return o;
    });
  });

  ALL = [...IMAGES.plans, ...IMAGES.sections, ...IMAGES.siteplans,
         ...IMAGES.diagrams, ...IMAGES.perspectives, ...IMAGES.mockups];

  console.log(`[images] pools loaded — total assets: ${ALL.length}`);
}

function pickAssetFromPool(poolName){
  if (poolName === 'all') return ALL.length ? pick(ALL) : null;
  const arr = IMAGES[poolName] || [];
  return arr.length ? pick(arr) : null;
}

// -------------------- world (persistent) --------------------
const world = {
  tile: 0, cols: 0, rows: 0, bleed: 1, slots: [],
  cam: { sx:1, sy:1, tx:0, ty:0 },
  camFrom:null, camTo:null, camT0:0, camT1:0,
  state: 'overview', mode: 'image', zoomRect: null, zoomGroup: null,
  phaseStart: 0,           // << store timing here (fixes "redeclare" issues)
  seqIndex: 0
};
// Slot: {gx,gy,cx,cy,w,h,pool,nextFlip,asset:{img,ready}|null,placeholderColor}

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
      const pool = 'all';
      world.slots.push({
        gx, gy, cx, cy, w:t, h:t,
        pool,
        asset: null, // will be seeded after manifest loads
        nextFlip: performance.now() + rand(FLASH_MIN, FLASH_MAX),
        placeholderColor: pick(PAL.all)
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
      s.asset = pickAssetFromPool(poolName) || s.asset;
      s.placeholderColor = pick(PAL[poolName] || PAL.all);
    }
  }
}
function restorePools(rect){
  for (const s of world.slots){
    if (s.cx >= rect.x && s.cx < rect.x+rect.w &&
        s.cy >= rect.y && s.cy < rect.y+rect.h){
      s.pool = 'all';
      s.asset = pickAssetFromPool('all') || s.asset;
      s.placeholderColor = pick(PAL.all);
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

// -------------------- videos (from data/videos.json) --------------------
const RANDOMIZE_VIDEO_START = true; // set false to always start at t=0
const videos = []; // up to 6 entries { el, ready }

async function loadVideos(){
  let sources = [];
  try{
    const res = await fetch(VIDEO_MANIFEST_URL, { cache:'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json(); // expect { "videos": [ "media/plans.mp4", ... ] }
    sources = Array.isArray(data.videos) ? data.videos : [];
    console.log('[videos] manifest loaded:', sources);
  }catch(err){
    console.error('[videos] Failed to load videos.json:', err);
  }

  for (let i=0;i<6;i++){
    const src = sources[i]; // may be undefined => placeholder
    const el = document.createElement('video');
    el.muted = true; el.loop = true; el.playsInline = true; el.preload = 'auto';
    if (src) el.src = src;

    const v = { el, ready:false };
    el.addEventListener('playing', ()=> v.ready = true);
    el.addEventListener('loadeddata', ()=>{
      try{
        if (RANDOMIZE_VIDEO_START && el.duration && isFinite(el.duration)){
          el.currentTime = Math.random() * el.duration * 0.85; // avoid edges
        } else {
          el.currentTime = 0;
        }
        el.play();
      }catch{}
    }, { once:true });

    videos.push(v);
  }
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
  ctx.fillStyle = '#808488';
  ctx.fillRect(x,y,s,s);
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.arc(x+s/2, y+s/2, s*0.22, 0, Math.PI*2); ctx.fill();
}

// -------------------- cycle --------------------
function cycle(now){
  if (world.state === 'overview'){
    if (now - world.phaseStart > CYCLE_GAP_MS){
      if (world.seqIndex < GROUPS.length){
        const rect = pickImageWindow();
        const grp  = GROUPS[world.seqIndex];
        world.mode = 'image';
        world.zoomRect = rect;
        world.zoomGroup = grp;
        retargetPools(rect, grp);
        startZoomTo(rect, IMAGE_ZOOM_FACTOR);
      } else {
        const rect = pickVideoWindow();
        world.mode = 'video';
        world.zoomRect = rect;
        world.zoomGroup = null; // surroundings keep flashing
        startZoomTo(rect, VIDEO_ZOOM_FACTOR);
      }
      world.phaseStart = now;
    }
  } else if (world.state === 'zoom'){
    const dwell = (world.mode==='video') ? VIDEO_DWELL_MS : IMAGE_DWELL_MS;
    if (now - world.phaseStart > dwell){
      if (world.zoomGroup) restorePools(world.zoomRect);
      startZoomOut();
      world.phaseStart = now;
      world.seqIndex = (world.seqIndex + 1) % (GROUPS.length + 1);
    }
  }
}

// -------------------- draw --------------------
function draw(now){
  ctx.save();
  ctx.setTransform(world.cam.sx, 0, 0, world.cam.sy, world.cam.tx, world.cam.ty);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvas.width/world.cam.sx, canvas.height/world.cam.sy);

  // flip due slots (choose new image from the slot's current pool)
  for (const s of world.slots){
    if (now >= s.nextFlip){
      const asset = pickAssetFromPool(s.pool);
      if (asset) s.asset = asset;
      s.nextFlip = now + rand(FLASH_MIN, FLASH_MAX);
      if (!asset) {
        s.placeholderColor = pick(PAL[s.pool] || PAL.all);
      }
    }
  }

  const t = world.tile;

  // compute video center indices if needed
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
        const idx = row * VIDEO_CENTER_COLS + col; // 0..5
        drawVideoInTile(videos[idx] || {el:{},ready:false}, s.cx, s.cy, t);
        continue;
      }
    }

    // draw image (or placeholder color if still loading)
    const asset = s.asset;
    if (asset && asset.ready){
      drawCover(asset.img, s.cx, s.cy, t);
    } else {
      ctx.fillStyle = s.placeholderColor;
      ctx.fillRect(s.cx, s.cy, t, t);
    }
  }

  // grid lines
  ctx.globalAlpha = GRID_OPACITY;
  ctx.strokeStyle = '#c8cacc';
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
async function init(){
  resize();

  // Load manifests
  await loadImagesManifest();
  await loadVideos();

  // Seed slots with assets now that pools exist
  for (const s of world.slots){
    s.asset = pickAssetFromPool(s.pool) || s.asset;
  }

  world.phaseStart = performance.now();
  requestAnimationFrame(tick);
}
function tick(now){
  stepCamera(now);
  cycle(now);
  draw(now);
  requestAnimationFrame(tick);
}
init();
