// ============================================================
//  make-zip.mjs —— 打包扩展为可上传的 zip
//  ──────────────────────────────────────────────────────────
//  只包含扩展运行需要的文件（不含文档、测试、开发脚本），零依赖：
//  Node 内置 zlib 做 deflate，自己写 zip 结构（本地头 + 中央目录 + EOCD）。
//
//  用法：node tools/make-zip.mjs [输出目录]
//  产物：dist/jianlian-newtab-<版本>.zip
// ============================================================
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const outDir = process.argv[2] || path.join(ROOT, 'dist');

// 扩展运行所需的文件（按目录收集）
const INCLUDE_FILES = ['manifest.json', 'newtab.html', 'newtab.js'];
const INCLUDE_DIRS = ['js', 'icons'];

function collect(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${base}/${entry.name}`;
    if (entry.isDirectory()) out.push(...collect(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const files = [...INCLUDE_FILES];
for (const d of INCLUDE_DIRS) files.push(...collect(d));
files.sort();

// ---------- zip 写入 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

const DOS_TIME = ((new Date().getHours() << 11) | (new Date().getMinutes() << 5) | (new Date().getSeconds() >> 1)) & 0xffff;
const DOS_DATE = ((((new Date().getFullYear() - 1980) & 0x7f) << 9) | ((new Date().getMonth() + 1) << 5) | new Date().getDate()) & 0xffff;

const locals = [];
const centrals = [];
let offset = 0;

for (const rel of files) {
  const data = fs.readFileSync(path.join(ROOT, rel));
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const name = Buffer.from(rel.split(path.sep).join('/'), 'utf8');
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);              // 需要版本
  local.writeUInt16LE(0x0800, 6);          // 通用标志：文件名为 UTF-8
  local.writeUInt16LE(8, 8);               // 压缩方式：deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);              // 扩展字段长度
  locals.push(local, name, comp);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 38);            // 外部属性
  central.writeUInt32LE(offset, 42);       // 本地头偏移
  centrals.push(central, name);

  offset += local.length + name.length + comp.length;
}

const centralBuf = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
fs.mkdirSync(outDir, { recursive: true });
const zipPath = path.join(outDir, `jianlian-newtab-${version}.zip`);
fs.writeFileSync(zipPath, Buffer.concat([...locals, centralBuf, eocd]));

const srcBytes = files.reduce((s, f) => s + fs.statSync(path.join(ROOT, f)).size, 0);
const zipBytes = fs.statSync(zipPath).size;
console.log(`打包完成: ${path.relative(ROOT, zipPath)}`);
console.log(`  ${files.length} 个文件  ${(srcBytes / 1024).toFixed(0)}KB → ${(zipBytes / 1024).toFixed(0)}KB`);
for (const f of files) console.log('  · ' + f);
