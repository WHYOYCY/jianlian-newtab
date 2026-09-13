// ============================================================
//  make-icons.mjs —— 从一张源图生成扩展所需的各尺寸图标
//  ──────────────────────────────────────────────────────────
//  零依赖（只用 Node 内置 fs / zlib）：
//   1. 解码 PNG（支持 8bit RGB / RGBA / 灰度）
//   2. 按指定区域裁剪出「中间的图标」，补成正方形
//   3. 在**线性光**空间做区域平均缩放（gamma 正确 —— 细线条缩到 16px
//      仍能保持足够对比度，直接按 sRGB 平均会变成灰雾）
//   4. 编码回 PNG（8bit RGB）
//
//  用法：node tools/make-icons.mjs <源图.png> [输出目录]
//       默认输出到 icons/
// ============================================================
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// ---------- sRGB ↔ 线性光 查找表 ----------
const S2L = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const L2S = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) {
  const c = i / 4096;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  L2S[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
}
const lin2srgb = (v) => L2S[Math.max(0, Math.min(4096, Math.round(v * 4096)))];

// ---------- PNG 解码 ----------
function decodePNG(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG 文件');
  let off = 8, width = 0, height = 0, ct = 0, depth = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; ct = data[9];
      if (data[12] !== 0) throw new Error('暂不支持隔行扫描 PNG');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8) throw new Error('仅支持 8bit PNG，实际 ' + depth);
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : ct === 0 ? 1 : 0;
  if (!ch) throw new Error('不支持的颜色类型 ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a; else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { W: width, H: height, ch, data: out };
}

// ---------- PNG 编码（8bit RGB）----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(rgb, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8bit, truecolor RGB
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;                                          // filter: None
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 内容外接框检测 ----------
// 背景色估计：取四角平均（图标类素材几乎都是纯色底）
function backdropColor(img) {
  const { W, H, ch, data } = img;
  const at = (x, y) => { const p = (y * W + x) * ch; return [data[p], data[p + 1], data[p + 2]]; };
  const cs = [at(2, 2), at(W - 3, 2), at(2, H - 3), at(W - 3, H - 3)];
  return [0, 1, 2].map(i => Math.round(cs.reduce((s, c) => s + c[i], 0) / 4));
}

// 找出面积最大的「内容块」：
// 做法：先按行统计非背景像素 → 把行切成若干纵向段（允许小间隙）→ 取面积最大的一段及其外接框。
// 这样能自动跳过图上的标题/副标题/边角水印，只留下主体图标。
function largestBlock(img, bg, thresh = 36, maxGap = 18) {
  const { W, H, ch, data } = img;
  const ink = (x, y) => {
    const p = (y * W + x) * ch;
    return Math.abs(data[p] - bg[0]) + Math.abs(data[p + 1] - bg[1]) + Math.abs(data[p + 2] - bg[2]) > thresh;
  };
  const rowInk = new Int32Array(H);
  for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) if (ink(x, y)) n++; rowInk[y] = n; }

  // 行分段（允许 maxGap 的空白间隙）
  const segs = []; let start = -1, gap = 0;
  for (let y = 0; y < H; y++) {
    if (rowInk[y] > 2) { if (start < 0) start = y; gap = 0; }
    else if (start >= 0) { gap++; if (gap > maxGap) { segs.push([start, y - gap]); start = -1; } }
  }
  if (start >= 0) segs.push([start, H - 1]);

  // 每段算外接框，取面积最大的
  let best = null;
  for (const [y0, y1] of segs) {
    let x0 = W, x1 = 0;
    for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x++) if (ink(x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    if (x1 < x0) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const area = w * h;
    if (!best || area > best.area) best = { x0, y0, x1, y1, w, h, area };
    console.log(`  检测到内容块 y ${y0}~${y1} x ${x0}~${x1}  尺寸 ${w}×${h}  面积 ${area}`);
  }
  return best;
}

// ---------- 线性光区域平均缩放 ----------
// 小尺寸需要「细线加粗」：源图是细线条时，线宽缩到 16px 会变成亚像素，
// 直接平均会得到几乎看不见的浅灰。这里对「偏离白色的量」做幂曲线提升
// （类似字体渲染的 stem darkening），让小尺寸仍然看得清轮廓。
// 指数越小 = 加粗越强；可用环境变量覆盖：ICON_STEM="16:0.30,32:0.40"
// 当前值是按本项目的线条徽标实测选定的：16px 下对比度从 45 提升到 ~120，
// 而背景仍保持 250/255 的近白（看不出灰底）
const STEM = { 16: 0.25, 32: 0.38, 48: 0.62, 128: 1.00 };
if (process.env.ICON_STEM) {
  for (const kv of process.env.ICON_STEM.split(',')) {
    const [k, v] = kv.split(':').map(Number);
    if (k && v > 0) STEM[k] = v;
  }
}

function resample(img, crop, size) {
  const { W, ch, data } = img;
  const out = Buffer.alloc(size * size * 3);
  const { cx, cy, side } = crop;
  const exp = STEM[size] ?? 1;
  const boost = (v) => exp >= 1 ? v : 1 - Math.pow(Math.max(0, 1 - v), exp);
  for (let j = 0; j < size; j++) {
    const sy0 = cy + j * side / size, sy1 = cy + (j + 1) * side / size;
    for (let i = 0; i < size; i++) {
      const sx0 = cx + i * side / size, sx1 = cx + (i + 1) * side / size;
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) {
        if (y < 0 || y >= img.H) continue;
        const wy = Math.min(y + 1, sy1) - Math.max(y, sy0);
        if (wy <= 0) continue;
        for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
          if (x < 0 || x >= W) continue;
          const wx = Math.min(x + 1, sx1) - Math.max(x, sx0);
          if (wx <= 0) continue;
          const wt = wx * wy;
          const p = (y * W + x) * ch;
          r += S2L[data[p]] * wt;
          g += S2L[data[p + 1]] * wt;
          b += S2L[data[p + 2]] * wt;
          wsum += wt;
        }
      }
      const o = (j * size + i) * 3;
      out[o]     = lin2srgb(boost(r / wsum));
      out[o + 1] = lin2srgb(boost(g / wsum));
      out[o + 2] = lin2srgb(boost(b / wsum));
    }
  }
  return out;
}

// ---------- 主流程 ----------
// 用法:
//   node tools/make-icons.mjs <源图.png> [输出目录]
//   node tools/make-icons.mjs <源图.png> <输出目录> --box=x0,y0,x1,y1   （手动指定图标区域）
const SIZES = [16, 32, 48, 128];
const src = process.argv[2];
const outDir = process.argv[3] || 'icons';
const boxArg = (process.argv.find(a => a.startsWith('--box=')) || '').slice(6);
if (!src) { console.error('用法: node tools/make-icons.mjs <源图.png> [输出目录] [--box=x0,y0,x1,y1]'); process.exit(1); }

const img = decodePNG(src);
console.log(`源图: ${path.basename(src)}  ${img.W}×${img.H}  ${img.ch >= 3 ? img.ch + ' 通道' : '灰度'}`);

const bg = backdropColor(img);
console.log(`背景色估计: RGB(${bg.join(',')})`);

let box;
if (boxArg) {
  const [x0, y0, x1, y1] = boxArg.split(',').map(Number);
  box = { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  console.log(`手动指定区域: x ${x0}~${x1}  y ${y0}~${y1}`);
} else {
  console.log('自动检测内容块:');
  box = largestBlock(img, bg);
  if (!box) { console.error('未检测到内容，请用 --box=x0,y0,x1,y1 手动指定'); process.exit(1); }
  console.log(`→ 采用最大块（主图标）: ${box.w}×${box.h}  宽高比 ${(box.w / box.h).toFixed(3)}`);
}

// 正方形裁剪：以内容中心为中心，边长 = 长边 × (1 + 留白)
const pad = Number(process.env.ICON_PAD || 0.10);
const side = Math.round(Math.max(box.w, box.h) * (1 + pad));
const crop = {
  cx: Math.round((box.x0 + box.x1) / 2) - Math.round(side / 2),
  cy: Math.round((box.y0 + box.y1) / 2) - Math.round(side / 2),
  side,
};
console.log(`裁剪窗口: ${side}×${side} @ (${crop.cx}, ${crop.cy})  留白 ${(pad * 100).toFixed(0)}%`);

fs.mkdirSync(outDir, { recursive: true });
for (const s of SIZES) {
  const rgb = resample(img, crop, s);
  const png = encodePNG(rgb, s);
  const file = path.join(outDir, `icon${s}.png`);
  fs.writeFileSync(file, png);
  console.log(`  → ${file}  ${png.length} 字节`);
}
console.log('完成。');
