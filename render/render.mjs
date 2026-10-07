// Renders video/index.html frame by frame with Playwright and pipes the frames into FFmpeg.
//   node render/render.mjs --out build/video.mkv [--fps 60] [--workers 4] [--from 0] [--to 30]
//   node render/render.mjs --stills 4.5,9.2 --stills-dir build/stills      (inspect single frames)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const cues = JSON.parse(fs.readFileSync(path.join(ROOT, "video/cues.json"), "utf8"));
const levels = JSON.parse(fs.readFileSync(path.join(ROOT, "build/levels.json"), "utf8"));
const fps = Number(arg("fps", cues.fps));
const from = Number(arg("from", 0));
const to = Number(arg("to", cues.duration));
const workers = Number(arg("workers", 4));
const out = path.resolve(ROOT, arg("out", "build/video.mkv"));
const stills = arg("stills", null);
const stillsDir = path.resolve(ROOT, arg("stills-dir", "build/stills"));
// adaptive motion blur: each frame averages enough sub-frames, spread over a `shutter` fraction of the frame interval
// (0.5 = 180 degrees) and centred on the frame time, that no element jumps more than `blur-step` px between samples
const blur = process.argv.includes("--blur");
const shutter = Number(arg("shutter", 0.5));
const blurStep = Number(arg("blur-step", 2.5));
const maxSub = Number(arg("max-sub", 32));

// serve the repo over http (CSS masks are blocked on file:// URLs)
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf" };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.addInitScript(([c, l]) => { window.CUES = c; window.LEVELS = l; }, [cues, levels]);
  page.on("pageerror", (e) => { console.error("page error:", e.message); process.exitCode = 1; });
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error(`console ${m.type()}:`, m.text()); });
  page.on("requestfailed", (r) => { console.error("request failed:", r.url()); process.exitCode = 1; });
  await page.goto(`${BASE}/video/index.html`);
  await page.evaluate(() => window.__ready);
  const cdp = await page.context().newCDPSession(page);
  const shot = async (t) => {
    await page.evaluate((tt) => window.__seek(tt), t);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
    return Buffer.from(data, "base64");
  };
  const W = 1920, H = 1080, acc = new Uint32Array(W * H * 3);
  // one output frame as raw RGB, averaged over n sub-frames when it moves fast
  const frame = async (f) => {
    const t = f / fps, half = shutter / fps / 2;
    let n = 1;
    if (blur) {
      const m = await page.evaluate(([a, b]) => window.__motion(a, b), [Math.max(0, t - half), Math.min(cues.duration - 1e-4, t + half)]);
      n = Math.min(maxSub, Math.max(1, Math.ceil(m / blurStep)));
    }
    const out = Buffer.allocUnsafe(W * H * 3);
    if (n === 1) {
      const px = PNG.sync.read(await shot(t)).data;
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { out[j] = px[i]; out[j + 1] = px[i + 1]; out[j + 2] = px[i + 2]; }
      return { out, n };
    }
    acc.fill(0);
    for (let k = 0; k < n; k++) {
      const tk = Math.min(cues.duration - 1e-4, Math.max(0, t - half + ((k + 0.5) / n) * 2 * half));
      const px = PNG.sync.read(await shot(tk)).data;
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { acc[j] += px[i]; acc[j + 1] += px[i + 1]; acc[j + 2] += px[i + 2]; }
    }
    for (let j = 0; j < acc.length; j++) out[j] = (acc[j] + (n >> 1)) / n;
    return { out, n };
  };
  return { page, shot, frame };
}

function encoder(file) {
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1920x1080", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264rgb", "-crf", "0", "-preset", "ultrafast", file], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once("drain", res)));
  return { write, end: async () => { ff.stdin.end(); await done; } };
}

const browser = await chromium.launch({ args: ["--disable-gpu-vsync", "--disable-lcd-text", "--font-render-hinting=none"] });
try {
  if (stills) {
    fs.mkdirSync(stillsDir, { recursive: true });
    const { shot } = await openPage(browser);
    for (const t of stills.split(",").map(Number)) {
      fs.writeFileSync(path.join(stillsDir, `t${t.toFixed(2).padStart(5, "0")}.png`), await shot(t));
    }
    console.log(`stills -> ${stillsDir}`);
  } else {
    const first = Math.round(from * fps), last = Math.round(to * fps); // [first, last)
    const total = last - first;
    const CHUNK = 60;
    const chunks = [];
    for (let a = first; a < last; a += CHUNK) chunks.push([a, Math.min(last, a + CHUNK)]);
    const segDir = path.join(path.dirname(out), "segments");
    fs.rmSync(segDir, { recursive: true, force: true });
    fs.mkdirSync(segDir, { recursive: true });
    const started = Date.now();
    let doneFrames = 0, subFrames = 0, next = 0;
    const segs = chunks.map((_, i) => path.join(segDir, `seg${String(i).padStart(3, "0")}.mkv`));
    await Promise.all(Array.from({ length: workers }, async () => {
      const { frame } = await openPage(browser);
      while (next < chunks.length) {
        const ci = next++;
        const [a, b] = chunks[ci];
        const enc = encoder(segs[ci]);
        for (let f = a; f < b; f++) {
          const { out: buf, n } = await frame(f);
          subFrames += n;
          await enc.write(buf);
          if (++doneFrames % 150 === 0) console.log(`${doneFrames}/${total} frames (${subFrames} samples)  ${((Date.now() - started) / 1000).toFixed(0)}s`);
        }
        await enc.end();
      }
    }));
    const list = path.join(segDir, "list.txt");
    fs.writeFileSync(list, segs.map((s) => `file '${s}'`).join("\n"));
    await new Promise((res, rej) => spawn("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out], { stdio: "inherit" })
      .on("close", (c) => (c === 0 ? res() : rej(new Error("concat failed")))));
    console.log(`rendered ${total} frames (${subFrames} samples) in ${((Date.now() - started) / 1000).toFixed(0)}s -> ${out}`);
  }
} finally {
  await browser.close();
  server.close();
}
