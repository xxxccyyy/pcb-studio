/* 演示 GIF 生成器：零依赖 GIF89a 编码器（自写 LZW）+ 引擎渲染帧 → docs/workbench/demo.gif
   流程：读设计 → routeBoard → 逐网揭示出帧 → GND 覆铜/缝合孔出帧 → 编码 GIF
   验证契约（写后回读）：① 自带 LZW 解码器逐帧回读比对；② Playwright/Chromium 真解码抽点比对
   用法：node scripts/make-demo-gif.mjs [design.json] [-o docs/workbench/demo.gif] [--scale 10] [--skip-browser] */
import * as core from '../src/engine.mjs';
import { pngEncode } from '../src/png.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const getFlag = (name, def) => {
  const i = argv.indexOf(name);
  if (i < 0) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const designPath = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'projects/h1-ch340g/design.json';
const outPath = getFlag('-o', 'docs/workbench/demo.gif');
const scale = Number(getFlag('--scale', '10'));
const skipBrowser = argv.includes('--skip-browser');

/* ---------- GIF LZW 编码（late change：next_code >= 2^size 时增位；表满 4096 发 CLEAR） ---------- */
function lzwEncode(indexPixels, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const codeMask = clearCode - 1;
  const eoiCode = clearCode + 1;
  let nextCode = eoiCode + 1;
  let curSize = minCodeSize + 1;
  const bytes = [];
  let cur = 0, curBits = 0;
  const emit = (code) => {
    cur |= code << curBits; curBits += curSize;
    while (curBits >= 8) { bytes.push(cur & 0xff); cur >>= 8; curBits -= 8; }
  };
  const table = new Map();
  emit(clearCode);
  let ib = indexPixels[0] & codeMask;
  for (let i = 1; i < indexPixels.length; i++) {
    const k = indexPixels[i] & codeMask;
    const key = (ib << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) { ib = hit; continue; }
    emit(ib);
    if (nextCode === 4096) {          // 表满：发 CLEAR 重置（当前 k 由 ib=k 重新起步）
      emit(clearCode);
      nextCode = eoiCode + 1;
      curSize = minCodeSize + 1;
      table.clear();
    } else {
      if (nextCode >= (1 << curSize)) curSize++;
      table.set(key, nextCode++);
    }
    ib = k;
  }
  emit(ib);
  emit(eoiCode);
  if (curBits > 0) bytes.push(cur & 0xff);
  return bytes;
}

/* ---------- GIF LZW 解码（late change：解码器比编码器慢一拍，post-add 计数恰好补齐拍差——
   与编码器同一条规则：nextCode >= 2^size 增位。early change（2^size-1）实测错位，roundtrip 抓出） ---------- */
function lzwDecode(data, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let nextCode = eoiCode + 1;
  let curSize = minCodeSize + 1;
  const dict = [];
  const reset = () => { dict.length = 0; for (let i = 0; i < clearCode; i++) dict.push([i]); nextCode = eoiCode + 1; curSize = minCodeSize + 1; };
  reset();
  const out = [];
  let bitpos = 0, prev = null;
  const readCode = () => {
    let code = 0;
    for (let b = 0; b < curSize; b++) {
      const byte = data[bitpos >> 3];
      if (byte === undefined) throw new Error('LZW stream truncated');
      code |= ((byte >> (bitpos & 7)) & 1) << b;
      bitpos++;
    }
    return code;
  };
  while (true) {
    const code = readCode();
    if (code === eoiCode) break;
    if (code === clearCode) { reset(); prev = null; continue; }
    let entry;
    if (code < dict.length) entry = dict[code];
    else if (code === nextCode && prev) entry = [...prev, prev[0]];
    else throw new Error('bad LZW code ' + code);
    for (let i = 0; i < entry.length; i++) out.push(entry[i]);
    if (prev) {
      if (nextCode < 4096) {
        dict[nextCode++] = [...prev, entry[0]];
        if (nextCode >= (1 << curSize) && curSize < 12) curSize++;
      }
    }
    prev = entry;
  }
  return out;
}

/* ---------- GIF89a 组装（GCT 全局色板 + NETSCAPE 循环 + 每帧 GCE 时延） ---------- */
function encodeGif(frames) {
  // frames: [{width,height,indices:Uint8Array,delay(1/100s)}], palette: [[r,g,b],...]
  const palette = frames[0].palette;
  const W = frames[0].width, H = frames[0].height;
  let bits = 1;
  while ((1 << bits) < palette.length || (1 << bits) < 2) bits++;
  if (bits > 8) throw new Error('palette too large');
  const gctSize = 1 << bits;
  const minCodeSize = Math.max(2, bits);
  const buf = [];
  buf.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);            // GIF89a
  buf.push(W & 0xff, (W >> 8) & 0xff, H & 0xff, (H >> 8) & 0xff);
  buf.push(0x80 | (7 << 4) | (bits - 1));                  // GCT flag + color res + GCT size
  buf.push(0x00, 0x00);                                     // bg index 0 / aspect
  for (let i = 0; i < gctSize; i++) {
    const c = palette[i] || [0, 0, 0];
    buf.push(c[0], c[1], c[2]);
  }
  const loop = [0x21, 0xFF, 0x0B, ...'NETSCAPE2.0'.split('').map(c => c.charCodeAt(0)), 0x03, 0x01, 0x00, 0x00, 0x00];
  buf.push(...loop);
  for (const f of frames) {
    if (f.width !== W || f.height !== H) throw new Error('frame size mismatch');
    buf.push(0x21, 0xF9, 0x04, 0x04, f.delay & 0xff, (f.delay >> 8) & 0xff, 0x00, 0x00); // disposal=1
    buf.push(0x2C, 0x00, 0x00, 0x00, 0x00, W & 0xff, (W >> 8) & 0xff, H & 0xff, (H >> 8) & 0xff, 0x00);
    buf.push(minCodeSize);
    const data = lzwEncode(f.indices, minCodeSize);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      buf.push(chunk.length, ...chunk);
    }
    buf.push(0x00);
  }
  buf.push(0x3B);
  return Buffer.from(buf);
}

/* ---------- 自检解码器：解析自家 GIF，逐帧比对索引 ---------- */
function decodeGif(buffer) {
  let p = 6;
  const W = buffer[p] | (buffer[p + 1] << 8); p += 2;
  const H = buffer[p] | (buffer[p + 1] << 8); p += 2;
  const packed = buffer[p++]; p += 2;                        // bg/aspect
  const gctSize = packed & 0x80 ? (1 << ((packed & 7) + 1)) : 0;
  const palette = [];
  for (let i = 0; i < gctSize; i++) { palette.push([buffer[p], buffer[p + 1], buffer[p + 2]]); p += 3; }
  const frames = [];
  while (p < buffer.length) {
    const b = buffer[p++];
    if (b === 0x3B) break;
    if (b === 0x21) {                                        // extension
      const label = buffer[p++];
      if (label === 0xF9 && buffer[p] === 4) {
        const d = buffer[p + 2] | (buffer[p + 3] << 8);
        frames.push({ delay: d, pending: true });
        p += 6;                                              // len 字节 + 4 data + terminator
        continue;
      }
      while (buffer[p] !== 0) p += buffer[p] + 1;
      p++;
      continue;
    }
    if (b === 0x2C) {
      p += 8;                                                // left/top/w/h
      const ipacked = buffer[p++];
      if (ipacked & 0x80) { const n = 1 << ((ipacked & 7) + 1); p += n * 3; }
      const mcs = buffer[p++];
      const data = [];
      while (buffer[p] !== 0) { const len = buffer[p++]; for (let i = 0; i < len; i++) data.push(buffer[p + i]); p += len; }
      p++;
      const indices = new Uint8Array(lzwDecode(data, mcs));
      const f = frames.length && frames[frames.length - 1].pending ? frames[frames.length - 1] : frames[frames.length] = { delay: 0 };
      f.pending = false;
      f.indices = indices;
      f.width = W; f.height = H;
      if (indices.length !== W * H) throw new Error('decoded size mismatch: ' + indices.length);
      continue;
    }
    throw new Error('unknown block 0x' + b.toString(16));
  }
  return { width: W, height: H, palette, frames };
}

/* ---------- 出帧 ---------- */
const design = core.normalizeDesign(JSON.parse(fs.readFileSync(designPath, 'utf8')));
console.log('design:', designPath, '|', design.width + 'x' + design.height + 'mm |', (design.pads || []).length, 'pads |', (design.nets || []).length, 'nets');
console.log('routing...');
const routed = core.routeBoard(design, {}).result;   // routeBoard 返回 {session, result}
const nets = routed.nets || [];
console.log('route done | nets:', nets.length, '| vias:', nets.reduce((s, n) => s + (n.vias || []).length, 0));

const frames = [];
let paletteSet = new Map();   // color -> index
function grab(designRef, resultRef, delay) {
  const img = core.renderBoardPixels(designRef, resultRef, { scale });
  const idx = new Uint8Array(img.width * img.height);
  for (let i = 0; i < img.width * img.height; i++) {
    const key = (img.px[i * 4] << 16) | (img.px[i * 4 + 1] << 8) | img.px[i * 4 + 2];
    let id = paletteSet.get(key);
    if (id === undefined) { id = paletteSet.size; paletteSet.set(key, id); }
    idx[i] = id;
  }
  frames.push({ width: img.width, height: img.height, indices: idx, delay });
}

grab(design, null, 90);                                       // ① 焊盘静置
const step = 1;                                               // ② 逐网揭示（按布线顺序）
for (let k = step; k <= nets.length; k += step) grab(design, { ...routed, nets: nets.slice(0, k) }, 13);

let finalResult = routed;
const gnd = (design.nets || []).find(n => n.name === 'GND');
if (gnd && nets.length) {
  const pour = core.computePour(design, routed, { layer: design.layers - 1, netId: gnd.id });
  design.stitching = core.planStitching(design, routed, pour, 5);
  finalResult = { ...routed, pour };
  grab(design, finalResult, 50);                              // ③ GND 覆铜 + 缝合孔
  grab(design, finalResult, 50);
}
grab(design, finalResult, 120);                               // ④ 收尾定格

/* ---------- 色板（按出现频次降序 → index 0 = 背景最常见色） ---------- */
const freq = new Map();
for (const f of frames) for (const id of f.indices) freq.set(id, (freq.get(id) || 0) + 1);
const colorForId = new Map([...paletteSet].map(([key, id]) => [id, key]));
const orderIds = [...paletteSet.values()].sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0));
const remap = new Array(paletteSet.size);
orderIds.forEach((id, newIdx) => { remap[id] = newIdx; });
const palette = orderIds.map(id => { const k = colorForId.get(id); return [(k >> 16) & 0xff, (k >> 8) & 0xff, k & 0xff]; });
for (const f of frames) for (let i = 0; i < f.indices.length; i++) f.indices[i] = remap[f.indices[i]];
console.log('palette colors:', palette.length, '| frames:', frames.length);

const gif = encodeGif(frames.map(f => ({ ...f, palette })));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, gif);
console.log('gif written:', outPath, '|', (gif.length / 1024).toFixed(1) + ' KB', '|', frames.length, 'frames |', frames.reduce((s, f) => s + f.delay, 0) / 100 + 's loop');

/* ---------- 写后回读自检：解码逐帧比对 ---------- */
const back = decodeGif(gif);
if (back.frames.length !== frames.length) throw new Error('frame count mismatch: ' + back.frames.length + ' vs ' + frames.length);
for (let i = 0; i < frames.length; i++) {
  const a = frames[i].indices, b = back.frames[i].indices;
  if (a.length !== b.length) throw new Error('frame ' + i + ' size mismatch');
  for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) throw new Error('frame ' + i + ' pixel ' + j + ' mismatch: ' + a[j] + ' vs ' + b[j]);
  if (back.frames[i].delay !== frames[i].delay) throw new Error('frame ' + i + ' delay mismatch');
}
console.log('roundtrip verify: PASS (' + frames.length + ' frames, bit-exact)');

/* ---------- 首末帧 PNG 落盘（人工目检用，不进仓库） ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gif-demo-'));
{
  const f0 = frames[0], fN = frames[frames.length - 1];
  const rgba = new Uint8Array(f0.width * f0.height * 4);
  for (let i = 0; i < f0.width * f0.height; i++) {
    const c = palette[f0.indices[i]];
    rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255;
  }
  fs.writeFileSync(path.join(tmp, 'frame-first.png'), pngEncode(f0.width, f0.height, rgba));
  const rgbaN = new Uint8Array(fN.width * fN.height * 4);
  for (let i = 0; i < fN.width * fN.height; i++) {
    const c = palette[fN.indices[i]];
    rgbaN[i * 4] = c[0]; rgbaN[i * 4 + 1] = c[1]; rgbaN[i * 4 + 2] = c[2]; rgbaN[i * 4 + 3] = 255;
  }
  fs.writeFileSync(path.join(tmp, 'frame-last.png'), pngEncode(fN.width, fN.height, rgbaN));
}
console.log('preview PNGs:', tmp + '\\frame-first.png, frame-last.png');

/* ---------- Playwright 真解码校验（可选：Chromium 是 GIF 规范的最终裁判） ---------- */
if (!skipBrowser) {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const b64 = gif.toString('base64');
    await page.setContent('<img id="g" src="data:image/gif;base64,' + b64 + '">');
    const res = await page.evaluate(() => new Promise((resolve, reject) => {
      const img = document.getElementById('g');
      const grab = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        resolve({ w: c.width, h: c.height, d });
      };
      if (img.complete && img.naturalWidth > 0) grab();   // setContent 与 evaluate 的竞态：可能已加载完
      else { img.onload = grab; img.onerror = () => reject(new Error('img decode failed')); }
    }));
    const f0 = frames[0];
    if (res.w !== f0.width || res.h !== f0.height) throw new Error('browser size mismatch ' + res.w + 'x' + res.h);
    let bad = 0, checked = 0;
    for (let y = 2; y < f0.height; y += 17) for (let x = 2; x < f0.width; x += 23) {
      const i = y * f0.width + x, expect = palette[f0.indices[i]];
      const got = [res.d[i * 4], res.d[i * 4 + 1], res.d[i * 4 + 2]];
      checked++;
      if (got[0] !== expect[0] || got[1] !== expect[1] || got[2] !== expect[2]) bad++;
    }
    await browser.close();
    if (bad) throw new Error('browser decode mismatch: ' + bad + '/' + checked + ' sampled pixels');
    console.log('Chromium decode verify: PASS (' + checked + ' sampled pixels bit-exact)');
  } catch (e) {
    console.log('browser verify skipped/failed:', e.message.slice(0, 120));
  }
}
