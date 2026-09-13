// ============================================================
//  Widget: shortcut —— 普通网址快捷卡片
//  职责：渲染图标+名称+域名
//
//  图标缓存策略（重要）：
//   · 搜刮成功 / 用户自定义图标 → 持久化，下次直接用，不再刷新
//   · 搜刮失败 → 不写持久状态，下次打开继续尝试（和本次一样刷新获取）
//   · 双写：entry（chrome.storage.sync，跨设备）+ storage.local（兜底）
//     —— sync 有「单 key 8KB」「120 次写入/分钟」限制，写失败时由 local 兜住
//   · 同一次页面会话内，同域名只搜刮一次（成功 memo / 失败 memo）
// ============================================================
import { Widgets } from '../core.js';
import { getDomain, shade, el, Store } from '../core.js';
import { colors } from '../presets.js';

// 会话内备忘：同域名避免重复搜刮（跨次打开标签页不生效，靠持久缓存）
const domainOk = new Map();    // domain → 成功图标的 src
const domainFail = new Set();  // domain → 本次会话已确认失败

// ---------- storage.local 图标缓存（兜底保险）----------
// 为什么需要：sites 存在 chrome.storage.sync，写入可能因配额/频率限制失败，
// 导致「图标明明搜刮成功却没被记住」。local 有 5MB 且无写入频率限制。
const CACHE_PREFIX = 'icon:';
const cacheKey = (domain) => CACHE_PREFIX + domain;

async function readLocalIcon(domain) {
  try {
    const k = cacheKey(domain);
    const r = await Store.localGet(k);
    return (r && r[k] && r[k].src) || '';
  } catch { return ''; }
}

function writeLocalIcon(domain, src) {
  try { Store.localSet({ [cacheKey(domain)]: { src, at: Date.now() } }); } catch {}
}

// ---------- 渲染原语 ----------
// 不变式：icon 里同一时刻只能是「字母占位」或「一张图片」之一，绝不共存
// （icon 是 flex 容器，文本 + img 同时存在会并排/重叠显示）
function clearIcon(icon) {
  icon.innerHTML = '';
  icon.style.background = '';
}

// 品牌色渐变底板 + 字母（兜底占位）
function fallbackLetter(icon, entry) {
  clearIcon(icon);
  icon.style.background = `linear-gradient(135deg, ${entry.color} 0%, ${shade(entry.color, 0.28)} 100%)`;
  icon.appendChild(el('span', 'icon-letter', {
    text: entry.label || (entry.name?.[0] || '?').toUpperCase()
  }));
}

// 图标候选地址（按优先级）
function iconCandidates(domain) {
  return [
    `https://${domain}/apple-touch-icon.png`,
    `https://${domain}/apple-touch-icon-precomposed.png`,
    `https://${domain}/favicon-32x32.png`,
    `https://${domain}/favicon.png`,
    `https://${domain}/favicon.ico`
  ];
}

// 用某个已知 URL 渲染图标；加载失败 → 回到字母占位并重搜
// 同样采用「离屏加载、成功才就位」：期间保持字母占位，不会与图标重叠、也不会闪空白。
// 注意：这里不立刻清掉持久缓存 —— URL 可能只是偶发失败（网络抖动 / CDN 限流），
// 立刻删除会让下次又走完整候选链；重搜成功后会用新值覆盖。
function showIcon(icon, entry, src, save, domain) {
  if (!icon.children.length) fallbackLetter(icon, entry);   // 占位，避免加载期空白
  const img = el('img', '', { alt: entry.name, src });
  img.addEventListener('load', () => {
    if (!icon.isConnected) return;
    clearIcon(icon);
    icon.appendChild(img);
  });
  img.addEventListener('error', () => {
    domainOk.delete(domain);
    fallbackLetter(icon, entry);                 // 立即回到字母占位
    scrapeIcon(icon, entry, domain, save);
  });
}

// 逐个尝试候选地址；图片先「离屏加载」，成功后才替换字母占位
// —— 这样搜刮期间显示的是字母占位（不空白），且不会与图标叠在一起
//
// 搜刮按「域名」为单位：同域名的多张卡片（如 github.com 和 github.com/issues）
// 复用同一次候选链，不会各请求一遍。
const domainPending = new Map();     // domain → Promise<src|null>

function scrapeDomain(domain) {
  if (domainPending.has(domain)) return domainPending.get(domain);
  const list = iconCandidates(domain);
  const p = new Promise(resolve => {
    const keep = [];                            // 保持强引用，确保离屏 img 完成加载
    let i = 0;
    (function next() {
      if (i >= list.length) { domainFail.add(domain); resolve(null); return; }
      const src = list[i++];
      const img = el('img', '', { alt: '', src });
      keep.push(img);
      img.addEventListener('load', () => {
        domainOk.set(domain, src);
        writeLocalIcon(domain, src);             // ★ 兜底缓存（不受 sync 配额影响）
        resolve(src);
      });
      img.addEventListener('error', () => { img.remove(); next(); });
    })();
  });
  domainPending.set(domain, p);
  p.then(() => domainPending.delete(domain));
  return p;
}

// 搜刮并渲染：期间保持字母占位，成功后替换；全失败则清掉失效缓存，下次重试
function scrapeIcon(icon, entry, domain, save) {
  if (!domain || domainFail.has(domain)) { fallbackLetter(icon, entry); return; }
  if (!icon.children.length) fallbackLetter(icon, entry);   // 搜刮期间不空白
  scrapeDomain(domain).then(src => {
    if (!icon.isConnected) return;                          // 卡片已删
    if (!src) {
      // 候选链全失败，说明旧缓存也已失效 → 清掉，下次重新完整尝试
      if (entry.iconUrl || entry.faviconStatus === 'ok') {
        entry.iconUrl = ''; entry.faviconStatus = 'pending'; save();
      }
      fallbackLetter(icon, entry);
      return;                                              // 不写 fail 状态：下次打开重新获取
    }
    if (entry.iconUrl !== src || entry.faviconStatus !== 'ok') {
      entry.iconUrl = src; entry.faviconStatus = 'ok'; save();   // ★ 主缓存，下次不再刷新
    }
    showIcon(icon, entry, src, save, domain);               // 清字母占位，挂图片
  }).catch(() => { if (icon.isConnected) fallbackLetter(icon, entry); });
}

function buildIcon(entry, save) {
  const icon = el('div', 'icon');
  const domain = getDomain(entry.url);

  // 1) 用户自定义图标：永久优先（entry.customIcon 会持久化，下次直接用，不搜刮）
  if (entry.customIcon) {
    const img = el('img', '', { alt: entry.name, src: entry.customIcon });
    img.addEventListener('error', () => {
      img.remove();
      clearIcon(icon);
      // 自定义图标失效 → 用已搜刮缓存兜底，没有再现场搜刮
      if (entry.faviconStatus === 'ok' && entry.iconUrl) showIcon(icon, entry, entry.iconUrl, save, domain);
      else scrapeIcon(icon, entry, domain, save);
    });
    icon.appendChild(img);
    return icon;
  }

  if (!domain) { fallbackLetter(icon, entry); return icon; }

  // 2) 本会话同域名已搜刮成功过 → 直接用，并补写进这个 entry
  if (domainOk.has(domain)) {
    const src = domainOk.get(domain);
    showIcon(icon, entry, src, save, domain);
    if (entry.iconUrl !== src || entry.faviconStatus !== 'ok') {
      entry.iconUrl = src; entry.faviconStatus = 'ok'; save();
    }
    return icon;
  }

  // 3) entry 里的持久缓存（sync 主缓存）→ 直接用，不刷新
  if (entry.faviconStatus === 'ok' && entry.iconUrl) {
    showIcon(icon, entry, entry.iconUrl, save, domain);
    return icon;
  }

  // 4) entry 没缓存 → 先查 storage.local 兜底（sync 写入曾失败时仍能命中），没有才搜刮
  fallbackLetter(icon, entry);                         // 先显示字母占位，local 读取通常几毫秒
  readLocalIcon(domain).then(src => {
    if (!icon.isConnected || domainFail.has(domain)) return;
    // 查询期间同域名的另一张卡片已搜刮成功 → 直接用它（否则字母占位会一直留着）
    if (domainOk.has(domain)) {
      const s = domainOk.get(domain);
      entry.iconUrl = s; entry.faviconStatus = 'ok'; save();
      showIcon(icon, entry, s, save, domain);
      return;
    }
    if (src) {
      domainOk.set(domain, src);
      entry.iconUrl = src; entry.faviconStatus = 'ok'; save();   // 补写主缓存
      showIcon(icon, entry, src, save, domain);
    } else {
      scrapeIcon(icon, entry, domain, save);           // 字母占位保持，后台离屏搜刮
    }
  }).catch(() => { if (icon.isConnected) scrapeIcon(icon, entry, domain, save); });

  return icon;
}

Widgets.register({
  id: 'shortcut',
  name: '网址快捷',
  defaults: { w: 1, h: 1 },
  resizable: true,
  draggable: true,

  match(entry) { return !entry.type || entry.type === 'shortcut'; },

  createEntry() {
    return {
      type: 'shortcut',
      name: '', url: '', color: colors[Math.floor(Math.random() * colors.length)],
      label: '', customIcon: '', faviconStatus: 'pending', w: 1,
    };
  },

  render(body, entry, ctx) {
    body.classList.add('shortcut-body');
    // icon
    body.appendChild(buildIcon(entry, ctx.save));
    // 文字区：名称 + 域名（宽卡显示域名）
    const text = el('div', 'text');
    const name = el('span', 'name', { text: entry.name });
    const domain = el('span', 'domain', { text: getDomain(entry.url) });
    text.appendChild(name);
    text.appendChild(domain);
    body.appendChild(text);
  },

  editorFields: [
    { key: 'name',       label: '名称',     type: 'text', placeholder: '如：GitHub', maxlength: 12, required: true },
    { key: 'url',         label: '网址',     type: 'text', placeholder: 'github.com', required: true },
    { key: 'customIcon',  label: '图标（可选，图片地址或 data URI）', type: 'text', placeholder: '粘贴图片 URL 或 data:image/...' },
    { key: 'color',       label: '图标颜色', type: 'colors', options: colors },
    { key: 'w',           label: '卡片尺寸', type: 'segmented', default: 1, options: [{ v: 1, t: '1×1' }, { v: 2, t: '2×1' }] },
  ],

  serialize(form, oldEntry) {
    const entry = { ...form };
    entry.label = (entry.name?.[0] || '?').toUpperCase();
    if (entry.url && !/^https?:\/\//.test(entry.url)) entry.url = 'https://' + entry.url;

    // 图标缓存策略：
    //  · 网址没变 → 保留已缓存的图标（搜刮成功过就下次直接用，不再刷新）
    //  · 网址变了 → 旧图标失效，标记重新搜刮
    if (oldEntry && oldEntry.url === entry.url) {
      entry.faviconStatus = oldEntry.faviconStatus || 'pending';
      entry.iconUrl = oldEntry.iconUrl || '';
    } else {
      entry.faviconStatus = 'pending';
      entry.iconUrl = '';
    }
    if (!entry.customIcon) delete entry.customIcon;
    return entry;
  },
});
