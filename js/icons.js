// ============================================================
//  icons.js —— 图标服务（域名级缓存 + 回退链），供各 widget 共用
//  ──────────────────────────────────────────────────────────
//  为什么要独立成模块：shortcut 卡片和 history 列表都要显示网站图标，
//  同域名的图标只需抓取一次。集中到这里后：
//    · 同一次页面会话内，同域名只走一遍候选链（进行中的请求也会复用）
//    · 抓取结果写入 chrome.storage.local，下次打开标签页零网络请求
//    · shortcut 卡片与历史列表共享同一份缓存（github.com 只抓一次）
//
//  三层缓存：
//    ① 本模块的内存备忘（ok / fail）—— 最快，同页多次使用
//    ② chrome.storage.local（键 icon:<domain>）—— 跨次打开持久，5MB 无写入频率限制
//    ③ 调用方自己的持久字段（如 shortcut 的 entry.iconUrl）—— 跨设备
//
//  抓取失败**不写任何持久状态** → 下次打开自动重试（符号「失败会被记住」的坑）
// ============================================================
import { el, Store } from './core.js';

const PREFIX = 'icon:';
const ok = new Map();        // domain → src（本次会话已拿到的图标）
const fail = new Set();      // domain → 本次会话已确认抓不到
const pending = new Map();   // domain → Promise<src|null>（进行中的抓取，同域名复用）

// 图标候选地址（按优先级）
export function candidates(domain) {
  return [
    `https://${domain}/apple-touch-icon.png`,
    `https://${domain}/apple-touch-icon-precomposed.png`,
    `https://${domain}/favicon-32x32.png`,
    `https://${domain}/favicon.png`,
    `https://${domain}/favicon.ico`
  ];
}

// 只读 storage.local 缓存，不发起网络请求
export async function readCachedIcon(domain) {
  if (!domain) return '';
  try {
    const k = PREFIX + domain;
    const r = await Store.localGet(k);
    return (r && r[k] && r[k].src) || '';
  } catch { return ''; }
}

function writeCachedIcon(domain, src) {
  try { Store.localSet({ [PREFIX + domain]: { src, at: Date.now() } }); } catch { /* 缓存写失败不影响显示 */ }
}

// 让某域名的缓存失效（图标地址真的挂了时调用），下次 getIcon 会重新抓取
export function invalidateIcon(domain) {
  if (!domain) return;
  ok.delete(domain);
  fail.delete(domain);
  try { Store.localRemove(PREFIX + domain); } catch { /* 忽略 */ }
}

// 离屏加载一张图，只为了判断这个地址是否可用（不插入 DOM）
function tryLoad(src, keep) {
  return new Promise(resolve => {
    const img = el('img', '', { alt: '', src });
    keep.push(img);                        // 保持强引用，确保离屏 img 完成加载
    img.addEventListener('load', () => resolve(true));
    img.addEventListener('error', () => { img.remove(); resolve(false); });
  });
}

// 主入口：拿到该域名的图标地址。命中缓存直接返回；否则走候选链抓取。
// 抓不到返回 null（本次会话内不再重试，但下次打开会重新尝试）
export function getIcon(domain) {
  if (!domain) return Promise.resolve(null);
  if (ok.has(domain)) return Promise.resolve(ok.get(domain));
  if (fail.has(domain)) return Promise.resolve(null);
  if (pending.has(domain)) return pending.get(domain);      // 同域名的并发请求复用同一次抓取

  const p = (async () => {
    const cached = await readCachedIcon(domain);
    if (cached) { ok.set(domain, cached); return cached; }

    const keep = [];
    for (const src of candidates(domain)) {
      if (await tryLoad(src, keep)) {
        ok.set(domain, src);
        writeCachedIcon(domain, src);
        return src;
      }
    }
    fail.add(domain);
    return null;                            // 失败不写持久状态：下次打开继续尝试
  })();

  pending.set(domain, p);
  p.finally(() => pending.delete(domain));
  return p;
}
