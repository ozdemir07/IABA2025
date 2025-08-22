// app.main.js — square-grid flasher + 6 image zooms + centered 6‑video zoom
// Public API used by intro/orchestrator:
//   window.gridAPI.prepare(): Promise<void>   // build grid + load manifests, no animation yet
//   window.gridAPI.seedRandom(count, pool)   // seed N empty slots with images
//   window.startMain(): Promise<void>        // start main loop (after intro)

const OUTRO_COMPLETE_EVENT = 'main:outro-complete';

// -------------------- PARAMS --------------------
const BG_COLOR = '#000000';
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

// Flip cadence
const FLASH_MIN = 600;
const FLASH_MAX = 1200;

// Camera choreography
const IMAGE_DWELL_MS = 9000;   // (kept) image zooms still cycle by dwell
const CYCLE_GAP_MS   = 6000;
const ZOOM_TIME_MS   = 0;

// Push-in factors
const IMAGE_ZOOM_FACTOR = 1.20;
const VIDEO_ZOOM_FACTOR = 1.60;

// Groups (must match manifest keys; we also accept "sitePlans")
const GROUPS = ['plans','sections','siteplans','diagrams','perspectives','mockups'];

// -------------------- helpers --------------------
const pick = (arr) => arr[(Math.random()*arr.length)|0];
const rand = (a,b) => a + Math.random()*(b-a);
const lerp = (a,b,t) => a + (b-a)*t;
const ease = (t) => (t<0?0:(t>1?1:1-Math.pow(1-t,3)));

// -------------------- canvas --------------------
const canvas = document.getElementById('c');
const ctx     = canvas.getContext('2d', { alpha:false });

// -------------------- manifests --------------------
const IMAGE_MANIFEST_URL = 'data/manifest.json';
const VIDEO_MANIFEST_URL = 'data/videos.json';

// image pools
const IMAGES = { plans:[], sections:[], siteplans:[], diagrams:[], perspectives:[], mockups:[] };
let ALL = []; // flattened

// placeholders OFF by default
let SHOW_PLACEHOLDERS = false;

// grayscale palette (used only if SHOW_PLACEHOLDERS = true)
const PAL = {
  all:          ['#9aa1a6','#8c9399','#7e858b','#70777d','#62686e','#545a60'],
  plans:        ['#a7adb2','#9aa1a6','#8c9399','#7e858b'],
  sections:     ['#b2b7bb','#a5abb0','#979ea4','#8a9197'],
  siteplans:    ['#9fa5aa','#92989d','#858b90','#777d82'],
  diagrams:     ['#9c9c9c','#8f8f8f','#828282','#757575'],
  perspectives: ['#b1b1b1','#a4a4a4','#979797','#8a8a8a'],
  mockups:      ['#c0c3c6','#b3b7bb','#a6abb0','#999fa4'],
};

// -------------------- progressive reveal (overlay) --------------------
// At the very start, paint BG-colored squares over every tile, then remove
// them randomly for REVEAL_DURATION_MS to give "grid populating" effect.
const REVEAL_ENABLED       = true;
const REVEAL_DURATION_MS   = 6000;
const REVEAL_BATCH_MIN     = 10;
const REVEAL_BATCH_MAX     = 50;
const REVEAL_EASE_STRENGTH = 0.8; // 0..1 — higher = faster finish

// -------------------- OUTRO (video ending takes over) --------------------
// Triggered after entering 6‑video zoom.
const OUTRO_START_DELAY_MS        = 100;    // small delay after video-zoom begins
const OUTRO_FADE_IMAGES_MS        = 1500;   // UNDERLAY fade time (images+grid disappear)
const OUTRO_DRIFT_DELAY_MS        = 500;    // wait before videos start drifting
const OUTRO_DRIFT_MS              = 10000;  // drift (and scale) duration
const OUTRO_DRIFT_DISTANCE_TILES  = 0.2;    // drift distance (in tile units)
const OUTRO_DRIFT_SCALE           = 1.15;   // max scale during drift
const OUTRO_VIDEO_FADE_DELAY_MS   = 69000;   // wait before fading the videos
const OUTRO_FADE_VIDEOS_MS        = 3000;   // OVERLAY fade time (videos disappear)

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
      img.loading  = 'eager';
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

// -------------------- world --------------------
const world = {
  tile: 0, cols: 0, rows: 0, bleed: 1, slots: [],

  cam: { sx:1, sy:1, tx:0, ty:0 },
  camFrom:null, camTo:null, camT0:0, camT1:0,

  state: 'overview', mode: 'image', zoomRect: null, zoomGroup: null,
  phaseStart: 0, seqIndex: 0,

  // reveal overlay
  revealActive: false,
  revealStart: 0,
  coverSet: null, // Set of covered tile indices (gx,gy → idx)

  // outro
  outro: {
    active: false,
    t0: 0,                // start timestamp (after OUTRO_START_DELAY_MS has elapsed)
    startRequest: 0,      // when we decided to start (we'll wait OUTRO_START_DELAY_MS)
    underAlpha: 0,        // images+grid fade alpha (via underlay)
    overAlpha: 0,         // videos fade alpha (via overlay)
    base: [],             // 6 entries: {x,y,size, dirX,dirY} in TILE SPACE
  }
};

// Slot model: {gx,gy,cx,cy,w,h,pool,nextFlip,asset:{img,ready}|null,placeholderColor}

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
        asset: null, // seeded later
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
const RANDOMIZE_VIDEO_START = true;
const videos = []; // up to 6 entries { el, ready }

async function loadVideos(){
  let sources = [];
  try{
    const res = await fetch(VIDEO_MANIFEST_URL, { cache:'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json(); // { videos: [...] }
    sources = Array.isArray(data.videos) ? data.videos : [];
    console.log('[videos] manifest loaded:', sources);
  }catch(err){
    console.error('[videos] Failed to load videos.json:', err);
  }

  for (let i=0;i<6;i++){
    const src = sources[i];
    const el = document.createElement('video');
    el.muted = true; el.loop = true; el.playsInline = true; el.preload = 'auto';
    if (src) el.src = src;
    const v = { el, ready:false };
    el.addEventListener('playing', ()=> v.ready = true);
    el.addEventListener('loadeddata', ()=>{
      try{
        if (RANDOMIZE_VIDEO_START && el.duration && isFinite(el.duration)){
          el.currentTime = Math.random() * el.duration * 0.85;
        } else el.currentTime = 0;
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
  if (!SHOW_PLACEHOLDERS) return;
  ctx.fillStyle = '#808488';
  ctx.fillRect(x,y,s,s);
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.arc(x+s/2, y+s/2, s*0.22, 0, Math.PI*2); ctx.fill();
}

// -------------------- cycle --------------------
function cycle(now){
  // pause normal cycle entirely during outro
  if (world.outro.active) return;

  // During reveal, we still draw (images under overlay). When done, fall through to overview.
  if (world.revealActive){
    return;
  }

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
        world.zoomGroup = null;
        startZoomTo(rect, VIDEO_ZOOM_FACTOR);
      }
      world.phaseStart = now;
    }
  } else if (world.state === 'zoom'){
    if (world.mode === 'image'){
      // images still auto-cycle by dwell
      if (now - world.phaseStart > IMAGE_DWELL_MS){
        if (world.zoomGroup) restorePools(world.zoomRect);
        startZoomOut();
        world.phaseStart = now;
        world.seqIndex = (world.seqIndex + 1) % (GROUPS.length + 1);
      }
    } else if (world.mode === 'video'){
      // video: DO NOT auto-zoom-out. Let the outro take over.
      if (!world.outro.active && !world.outro.startRequest){
        world.outro.startRequest = now; // mark request time
      }
      // (no dwell exit for video)
    }
  }
}

// -------------------- OUTRO control --------------------
function startOutro(now){
  // Build base positions for the 2x3 video cluster in TILE space (from the current zoomRect)
  const t = world.tile;
  const vz = world.zoomRect;
  if (!vz) return;

  const vx0 = vz.gx0 + Math.floor((VIDEO_WIN_COLS - VIDEO_CENTER_COLS)/2);
  const vy0 = vz.gy0 + Math.floor((VIDEO_WIN_ROWS - VIDEO_CENTER_ROWS)/2);
  const cx = (vx0 + VIDEO_CENTER_COLS/2) * t;
  const cy = (vy0 + VIDEO_CENTER_ROWS/2) * t;

  const base = [];
  for (let row=0; row<VIDEO_CENTER_ROWS; row++){
    for (let col=0; col<VIDEO_CENTER_COLS; col++){
      const gx = vx0 + col;
      const gy = vy0 + row;
      const x = gx * t;
      const y = gy * t;
      const mx = x + t*0.5 - cx;
      const my = y + t*0.5 - cy;
      const len = Math.max(1e-6, Math.hypot(mx,my));
      base.push({ x, y, size:t, dirX: mx/len, dirY: my/len });
    }
  }

  world.outro.base = base;
  world.outro.t0 = now;
  world.outro.active = true;
}

function maybeKickOutro(now){
  if (world.mode !== 'video') return;
  if (!world.outro.startRequest || world.outro.active) return;
  if (now - world.outro.startRequest >= OUTRO_START_DELAY_MS){
    startOutro(now);
  }
}

function outroFinished(now){
  if (!world.outro.active) return false;
  const elapsed = now - world.outro.t0;
  // Finished when videos fully faded
  return (elapsed >= OUTRO_VIDEO_FADE_DELAY_MS + OUTRO_FADE_VIDEOS_MS);
}

// -------------------- draw --------------------
function draw(now){
  ctx.save();
  ctx.setTransform(world.cam.sx, 0, 0, world.cam.sy, world.cam.tx, world.cam.ty);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvas.width/world.cam.sx, canvas.height/world.cam.sy);

  // flip due slots (we can keep flips; during outro they’ll be hidden by underlay)
  if (!world.outro.active){
    for (const s of world.slots){
      if (now >= s.nextFlip){
        const asset = pickAssetFromPool(s.pool);
        if (asset) s.asset = asset;
        s.nextFlip = now + rand(FLASH_MIN, FLASH_MAX);
        if (!asset && SHOW_PLACEHOLDERS) {
          s.placeholderColor = pick(PAL[s.pool] || PAL.all);
        }
      }
    }
  }

  const t = world.tile;

  // video center indices for live video region
  let vx0=-1, vy0=-1;
  if (world.zoomRect){
    vx0 = world.zoomRect.gx0 + Math.floor((VIDEO_WIN_COLS - VIDEO_CENTER_COLS)/2);
    vy0 = world.zoomRect.gy0 + Math.floor((VIDEO_WIN_ROWS - VIDEO_CENTER_ROWS)/2);
  }

  // --- LAYER 1: draw images/placeholders, but SKIP center video tiles ---
  for (const s of world.slots){
    let isCenterVideoTile = false;
    if (world.mode==='video' && world.zoomRect){
      const gx = s.gx, gy = s.gy;
      isCenterVideoTile = (gx >= vx0 && gx < vx0 + VIDEO_CENTER_COLS &&
                           gy >= vy0 && gy < vy0 + VIDEO_CENTER_ROWS);
    }
    if (isCenterVideoTile){
      continue; // videos will render here
    }

    const a = s.asset;
    if (a && a.ready){
      const iw = a.img.naturalWidth || a.img.width;
      const ih = a.img.naturalHeight || a.img.height;
      if (iw && ih){
        const k = Math.max(t/iw, t/ih);
        const dw = iw*k, dh = ih*k;
        const dx = s.cx + (t - dw)/2, dy = s.cy + (t - dh)/2;
        ctx.drawImage(a.img, dx, dy, dw, dh);
      }
    } else if (SHOW_PLACEHOLDERS){
      ctx.fillStyle = s.placeholderColor;
      ctx.fillRect(s.cx, s.cy, t, t);
    }
  }

  // Progressive reveal overlay (BG-colored squares that hide images until removed)
  if (world.revealActive && world.coverSet && world.coverSet.size){
    ctx.fillStyle = BG_COLOR;
    for (const idx of world.coverSet){
      const cols = world.cols;
      const gx = idx % cols;
      const gy = (idx / cols) | 0;
      ctx.fillRect(gx*world.tile, gy*world.tile, world.tile, world.tile);
    }
  }

  // --- Images+Grid UNDERLAY fade (during outro) ---
  if (world.outro.active){
    const tImg = Math.min(1, OUTRO_FADE_IMAGES_MS > 0 ? (now - world.outro.t0) / OUTRO_FADE_IMAGES_MS : 1);
    world.outro.underAlpha = Math.max(0, Math.min(1, tImg));
    if (world.outro.underAlpha > 0){
      ctx.save();
      ctx.globalAlpha = world.outro.underAlpha;
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(-10000, -10000, 20000, 20000); // generous world cover
      ctx.restore();
    }
  }

  // --- LAYER 2: draw the 6 videos (either static tiles or drifting in outro) ---
  if (world.mode==='video' && world.zoomRect){
    const basePositions = [];
    if (world.outro.active && world.outro.base.length === 6){
      const elapsed = now - world.outro.t0;
      const driftElapsed = Math.max(0, elapsed - OUTRO_DRIFT_DELAY_MS);
      const driftT = OUTRO_DRIFT_MS > 0 ? Math.min(1, driftElapsed / OUTRO_DRIFT_MS) : 1;
      const eased = ease(driftT);
      const dist = OUTRO_DRIFT_DISTANCE_TILES * world.tile * eased;
      const scale = lerp(1, OUTRO_DRIFT_SCALE, eased);

      for (let i=0;i<6;i++){
        const b = world.outro.base[i];
        const x = b.x + b.dirX * dist;
        const y = b.y + b.dirY * dist;
        const s = b.size * scale;
        basePositions.push({ x, y, s });
      }
    } else {
      for (let row=0; row<VIDEO_CENTER_ROWS; row++){
        for (let col=0; col<VIDEO_CENTER_COLS; col++){
          const gx = vx0 + col;
          const gy = vy0 + row;
          basePositions.push({ x: gx*world.tile, y: gy*world.tile, s: world.tile });
        }
      }
    }

    for (let i=0;i<6;i++){
      const p = basePositions[i];
      if (!p) continue;
      drawVideoInTile(videos[i] || {el:{},ready:false}, p.x, p.y, p.s);
    }
  }

  // --- Grid lines (skip if outro underlay is fully opaque) ---
  if (!(world.outro.active && world.outro.underAlpha >= 1)){
    ctx.globalAlpha = GRID_OPACITY * (world.outro.active ? (1 - world.outro.underAlpha) : 1);
    ctx.strokeStyle = '#c8cacc';
    ctx.lineWidth = 1 / world.cam.sx;
    ctx.beginPath();
    const gx0 = (-world.bleed) * t, gx1 = (world.cols + world.bleed) * t;
    const gy0 = (-world.bleed) * t, gy1 = (world.rows + world.bleed) * t;
    for (let x=gx0; x<=gx1; x+=t){ ctx.moveTo(x, gy0); ctx.lineTo(x, gy1); }
    for (let y=gy0; y<=gy1; y+=t){ ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // --- Videos OVERLAY fade (during outro) ---
  if (world.outro.active){
    const elapsed = now - world.outro.t0;
    const ovElapsed = Math.max(0, elapsed - OUTRO_VIDEO_FADE_DELAY_MS);
    const tVid = Math.min(1, OUTRO_FADE_VIDEOS_MS > 0 ? ovElapsed / OUTRO_FADE_VIDEOS_MS : 1);
    world.outro.overAlpha = Math.max(0, Math.min(1, tVid));
    if (world.outro.overAlpha > 0){
      ctx.save();
      ctx.globalAlpha = world.outro.overAlpha;
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(-10000, -10000, 20000, 20000);
      ctx.restore();
    }
  }

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

// -------------------- main loop --------------------
let _rafId = 0;
let _coverInitialCount = 0;

function tick(now){
  stepCamera(now);

  // Handle reveal progression
  if (world.revealActive && world.coverSet){
    const elapsed = now - world.revealStart;
    const dur = Math.max(1, REVEAL_DURATION_MS);
    const prog = Math.min(1, elapsed / dur);
    const eased = 1 - Math.pow(1 - prog, 1 + REVEAL_EASE_STRENGTH*3); // front-loaded reveal
    const targetLeft = Math.floor((1 - eased) * _coverInitialCount);
    const needRemove = Math.max(0, world.coverSet.size - targetLeft);
    if (needRemove > 0){
      const batch = Math.min(needRemove, Math.floor(rand(REVEAL_BATCH_MIN, REVEAL_BATCH_MAX)));
      const arr = Array.from(world.coverSet);
      for (let i=0;i<batch && arr.length;i++){
        const k = (Math.random()*arr.length)|0;
        const idx = arr[k];
        world.coverSet.delete(idx);
        arr[k] = arr[arr.length-1];
        arr.pop();
      }
    }
    if (elapsed >= dur || world.coverSet.size === 0){
      world.revealActive = false; // done, normal cycle continues
    }
  }

  // If we’re in video zoom, maybe kick the outro
  maybeKickOutro(now);

  cycle(now);
  draw(now);

  // Stop when outro fully finished — and signal to the outside world
  if (outroFinished(now)){
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = 0;
    try {
      window.dispatchEvent(new CustomEvent(OUTRO_COMPLETE_EVENT));
    } catch {}
    return;
  }

  _rafId = requestAnimationFrame(tick);
}

// -------------------- prepare & start (public) --------------------
let _prepared = false;

// minimal reset to allow clean replays without reloading all assets
function resetForNewRun() {
  // camera
  world.cam = { sx:1, sy:1, tx:0, ty:0 };
  world.camFrom = null; world.camTo = null; world.camT0 = 0; world.camT1 = 0;

  // sequencing
  world.state = 'overview';
  world.mode = 'image';
  world.zoomRect = null;
  world.zoomGroup = null;
  world.seqIndex = 0;

  // reveal overlay fresh
  world.revealActive = false;
  world.revealStart = 0;
  world.coverSet = null;

  // outro flags
  world.outro.active = false;
  world.outro.t0 = 0;
  world.outro.startRequest = 0;
  world.outro.underAlpha = 0;
  world.outro.overAlpha = 0;
  world.outro.base = [];

  // ensure each slot has something to draw (seed once per run if empty)
  for (const s of world.slots){
    if (!s.asset) s.asset = pickAssetFromPool('all') || s.asset;
    // nudge the flip timers so the mosaic feels fresh each run
    s.nextFlip = performance.now() + rand(FLASH_MIN, FLASH_MAX);
  }
}

async function prepare(){
  if (_prepared) return;

  resize();                 // build grid to current viewport
  await loadImagesManifest();
  await loadVideos();

  // Seed ALL slots once so reveal covers real images underneath
  for (const s of world.slots){
    s.asset = pickAssetFromPool('all') || s.asset;
  }

  _prepared = true;
}

// Start main loop (called by orchestrator after intro)
async function startMain(){
  await prepare(); // safe if already done

  // reset transient state so a looped replay starts clean
  resetForNewRun();

  // Progressive reveal: initialize coverage set
  if (REVEAL_ENABLED){
    const cols = world.cols, rows = world.rows;
    const set = new Set();
    for (let gy=0; gy<rows; gy++){
      for (let gx=0; gx<cols; gx++){
        set.add(gy*cols + gx);
      }
    }
    world.coverSet = set;
    _coverInitialCount = set.size;
    world.revealStart = performance.now();
    world.revealActive = true;
  } else {
    world.revealActive = false;
    world.coverSet = null;
  }

  world.phaseStart = performance.now();
  if (_rafId) cancelAnimationFrame(_rafId);
  _rafId = requestAnimationFrame(tick);
}

// -------------------- public API --------------------
window.gridAPI = {
  prepare,
  setPlaceholders(enabled){ SHOW_PLACEHOLDERS = !!enabled; },
  getMetrics(){ return { tile:world.tile, cols:world.cols, rows:world.rows }; },
  seedRandom(count=1, pool='all'){
    const empties = world.slots.filter(s=>!s.asset);
    for (let i=0;i<count && empties.length;i++){
      const idx = (Math.random()*empties.length)|0;
      const s = empties.splice(idx,1)[0];
      s.pool = pool;
      s.asset = pickAssetFromPool(pool) || s.asset;
    }
  }
};

window.startMain = startMain;
