# make_all_videos.py  — build one looped morph per group in data/manifest.json
# Outputs H.264 MP4 (yuv420p, faststart) into ./media/*.mp4 for maximum browser compatibility.

import os, json, sys, subprocess
import numpy as np
import cv2 as cv

# ----------------------- PARAMS -----------------------
MANIFEST_PATH     = "data/manifest.json"
OUTPUT_DIR        = "media"         # write final videos here (your site reads from /media)
RESOLUTION        = (512, 512)      # (W, H)
FPS               = 30

HOLD_SEC          = 0.5             # hold each still before morph
TRANS_SEC         = 1.0             # morph duration

FLOW_ALGO         = "DIS"           # "DIS" (opencv-contrib) or "FARNEBACK"
FLOW_PYR_LEVELS   = 3
FLOW_RETRIES      = 1
FLOW_STRONG_SMOOTH= True

# Flow mask tuning (reduces ghosty “fade” look)
FB_MAX_PX_ERR     = 1.5
MASK_BLUR         = 7
EPS               = 1e-6
# ------------------------------------------------------


# ---------- small utils ----------
def ffmpeg_exists():
    try:
        subprocess.run(["ffmpeg","-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except FileNotFoundError:
        return False

def composite_on_white(img):
    if img is None: return None
    if img.ndim == 3 and img.shape[2] == 4:
        alpha = img[:, :, 3:4].astype(np.float32) / 255.0
        rgb   = img[:, :, :3].astype(np.float32)
        white = np.full_like(rgb, 255, dtype=np.float32)
        return (rgb * alpha + white * (1 - alpha)).astype(np.uint8)
    if img.ndim == 2:
        return cv.cvtColor(img, cv.COLOR_GRAY2BGR)
    if img.ndim == 3 and img.shape[2] == 3:
        return img
    return img

def center_square_resize(img, wh):
    h, w = img.shape[:2]
    side = min(w, h)
    x0 = (w - side)//2
    y0 = (h - side)//2
    img = img[y0:y0+side, x0:x0+side]
    return cv.resize(img, wh, interpolation=cv.INTER_LANCZOS4)

def load_prepped_images_from_list(file_list, wh):
    imgs = []
    for f in file_list:
        if not os.path.exists(f):
            print(f"⚠️  Missing file in manifest: {f}")
            continue
        im = cv.imread(f, cv.IMREAD_UNCHANGED)
        if im is None:
            print(f"⚠️  Unreadable: {f}")
            continue
        im = composite_on_white(im)
        im = center_square_resize(im, wh)
        if im.ndim == 2:
            im = cv.cvtColor(im, cv.COLOR_GRAY2BGR)
        elif im.shape[2] == 4:
            im = im[:, :, :3]
        imgs.append(im)
    return imgs


# ---------- optical flow ----------
def get_flow_DIS(a_gray, b_gray):
    dis = cv.DISOpticalFlow_create(cv.DISOPTICAL_FLOW_PRESET_ULTRAFAST)
    dis.setFinestScale(max(0, FLOW_PYR_LEVELS - 1))
    if FLOW_STRONG_SMOOTH:
        dis.setGradientDescentIterations(40)
        dis.setVariationalRefinementAlpha(20)
        dis.setVariationalRefinementDelta(5)
        dis.setVariationalRefinementGamma(10)
        dis.setUseSpatialPropagation(True)
    return dis.calc(a_gray, b_gray, None)

def get_flow_Farneback(a_gray, b_gray):
    return cv.calcOpticalFlowFarneback(
        a_gray, b_gray, None, 0.5, FLOW_PYR_LEVELS, 25, 3, 7, 1.5, 0
    )

def compute_flow(a, b):
    a_gray = cv.cvtColor(a, cv.COLOR_BGR2GRAY)
    b_gray = cv.cvtColor(b, cv.COLOR_BGR2GRAY)
    order = [FLOW_ALGO.upper()]
    if FLOW_RETRIES:
        order.append("FARNEBACK" if order[0] == "DIS" else "DIS")

    last_err = None
    for algo in order:
        try:
            f = get_flow_DIS(a_gray, b_gray) if algo == "DIS" else get_flow_Farneback(a_gray, b_gray)
            if f is not None and np.isfinite(f).all():
                return f, algo
        except Exception as e:
            last_err = e
    if last_err:
        print("⚠️  Flow failed; fallback to crossfade for this pair.", last_err)
    return None, None

def remap_with_flow(img, flow, scale_t):
    h, w = img.shape[:2]
    gx, gy = np.meshgrid(np.arange(w), np.arange(h))
    map_x = (gx + flow[..., 0] * scale_t).astype(np.float32)
    map_y = (gy + flow[..., 1] * scale_t).astype(np.float32)
    return cv.remap(img, map_x, map_y, interpolation=cv.INTER_LINEAR, borderMode=cv.BORDER_REFLECT)

def forward_backward_mask(flow_ab, flow_ba):
    h, w = flow_ab.shape[:2]
    gx, gy = np.meshgrid(np.arange(w), np.arange(h))
    px = gx + flow_ab[..., 0]
    py = gy + flow_ab[..., 1]
    bx = cv.remap(flow_ba[..., 0], px.astype(np.float32), py.astype(np.float32),
                  interpolation=cv.INTER_LINEAR, borderMode=cv.BORDER_REFLECT)
    by = cv.remap(flow_ba[..., 1], px.astype(np.float32), py.astype(np.float32),
                  interpolation=cv.INTER_LINEAR, borderMode=cv.BORDER_REFLECT)
    rx = flow_ab[..., 0] + bx
    ry = flow_ab[..., 1] + by
    err = np.sqrt(rx * rx + ry * ry)
    mask = (err <= FB_MAX_PX_ERR).astype(np.float32)
    if MASK_BLUR and MASK_BLUR > 1:
        k = int(MASK_BLUR) | 1
        mask = cv.GaussianBlur(mask, (k, k), 0)
    return np.clip(mask, 0.0, 1.0)

def morph_frame_pure(a, b, flow_ab, flow_ba, t):
    if flow_ab is None or flow_ba is None:
        return cv.addWeighted(a, 1.0 - t, b, t, 0.0)
    a_w = remap_with_flow(a, flow_ab, t)
    b_w = remap_with_flow(b, flow_ba, 1.0 - t)
    m = forward_backward_mask(flow_ab, flow_ba)[..., None]
    w = t * (1.0 - 0.25 * m) + 0.5 * (0.25 * m)  # compress toward 0.5 where flow is confident
    out = (a_w * (1.0 - w) + b_w * w).astype(np.uint8)
    return out


# ---------- writers ----------
class FFmpegWriter:
    def __init__(self, path, w, h, fps, crf=22, preset="veryfast"):
        self.path = path
        self.w, self.h, self.fps = w, h, fps
        self.proc = subprocess.Popen(
            [
                "ffmpeg","-y",
                "-f","rawvideo","-pix_fmt","bgr24",
                "-s",f"{w}x{h}",
                "-r",str(fps),
                "-i","-",
                "-an",
                "-c:v","libx264",
                "-pix_fmt","yuv420p",
                "-profile:v","high","-level","4.1",
                "-movflags","+faststart",
                "-crf",str(crf),
                "-preset",preset,
                "-g",str(int(fps*2)),
                path
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
    def write(self, frame_bgr):
        self.proc.stdin.write(frame_bgr.tobytes())
    def release(self):
        self.proc.stdin.close()
        self.proc.wait()

def open_writer(path, w, h, fps):
    if ffmpeg_exists():
        print("🟢 Using FFmpeg (H.264) writer.")
        return FFmpegWriter(path, w, h, fps), True
    else:
        print("🟠 FFmpeg not found — falling back to OpenCV writer (mp4v, not browser‑safe).")
        fourcc = cv.VideoWriter_fourcc(*"mp4v")
        return cv.VideoWriter(path, fourcc, fps, (w, h)), False


# ---------- loop builder ----------
def write_hold(writer, frame, frames, is_ffmpeg):
    for _ in range(frames):
        writer.write(frame if is_ffmpeg else frame)

def build_loop(imgs, writer, is_ffmpeg, fps, hold_sec, trans_sec):
    n = len(imgs)
    if n == 0: return
    if n == 1:
        write_hold(writer, imgs[0], int(round(fps * max(2.0, hold_sec))), is_ffmpeg)
        return

    hold_frames  = max(0, int(round(fps * hold_sec)))
    trans_frames = max(1, int(round(fps * trans_sec)))

    for i in range(n):
        a = imgs[i]
        b = imgs[(i + 1) % n]

        if hold_frames > 0:
            write_hold(writer, a, hold_frames, is_ffmpeg)

        flow_ab, _ = compute_flow(a, b)
        flow_ba, _ = compute_flow(b, a)

        for k in range(trans_frames):
            t = (k + 0.5) / trans_frames
            frame = morph_frame_pure(a, b, flow_ab, flow_ba, t)
            writer.write(frame)

# ---------- main ----------
def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    groups = [
        ("plans", "plans.mp4"),
        ("sections", "sections.mp4"),
        ("sitePlans", "siteplans.mp4"),
        ("diagrams", "diagrams.mp4"),
        ("perspectives", "perspectives.mp4"),
        ("mockups", "mockups.mp4"),
    ]

    W, H = RESOLUTION
    for key, out_name in groups:
        file_list = manifest.get(key) or manifest.get(key.lower()) or manifest.get(key.capitalize())
        print(f"\n— Processing group: {key}")
        if not file_list:
            print(f"⚠️  No files listed for '{key}'. Skipping.")
            continue

        imgs = load_prepped_images_from_list(file_list, (W, H))
        if len(imgs) < 2:
            print(f"⚠️  Need at least 2 images for '{key}'. Skipping.")
            continue

        out_path = os.path.join(OUTPUT_DIR, out_name)
        writer, is_ffmpeg = open_writer(out_path, W, H, FPS)
        if not is_ffmpeg and (not hasattr(writer, "isOpened") or not writer.isOpened()):
            print(f"❌ Could not open any writer for {out_path}")
            continue

        build_loop(imgs, writer, is_ffmpeg, FPS, HOLD_SEC, TRANS_SEC)
        writer.release() if is_ffmpeg else writer.release()
        print(f"🎬 Saved: {out_path}")

    print("\n✅ Done. Videos are H.264 (avc1), yuv420p, faststart — browser‑friendly.")

if __name__ == "__main__":
    main()
