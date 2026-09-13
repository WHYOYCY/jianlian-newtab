// ============================================================
//  Widget: shortcut —— 普通网址快捷卡片
//  职责：渲染图标+名称+域名
//
//  图标策略（缓存的读取与网络抓取在 js/icons.js 里统一实现）：
//   · 搜刮成功 / 用户自定义图标 → 持久化到 entry，下次直接用，不再刷新
//   · 搜刮失败 → 不写持久状态，下次打开继续尝试
//   · 图片一律「离屏加载、成功才就位」，保证同一时刻只有字母占位或图片之一
// ============================================================
import { Widgets, getDomain, shade, el } from '../core.js';
import { getIcon, invalidateIcon } from '../icons.js';
import { colors } from '../presets.js';

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

// 用某个已知 URL 渲染图标；加载失败 → 回到字母占位并重搜
// 采用「离屏加载、成功才就位」：期间保持字母占位，不会与图标重叠、也不会闪空白。
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
    invalidateIcon(domain);                                 // 缓存里的地址失效了，作废
    fallbackLetter(icon, entry);                            // 立即回到字母占位
    scrapeIcon(icon, entry, domain, save);
  });
}

// 抓取并渲染：期间保持字母占位，成功后替换；全失败则清掉失效缓存，下次重试
function scrapeIcon(icon, entry, domain, save) {
  if (!domain) { fallbackLetter(icon, entry); return; }
  if (!icon.children.length) fallbackLetter(icon, entry);   // 抓取期间不空白
  getIcon(domain).then(src => {
    if (!icon.isConnected) return;                          // 卡片已删
    if (!src) {
      // 候选链全失败，说明旧缓存也已失效 → 清掉，下次重新完整尝试
      if (entry.iconUrl || entry.faviconStatus === 'ok') {
        entry.iconUrl = ''; entry.faviconStatus = 'pending'; save();
      }
      fallbackLetter(icon, entry);
      return;                                               // 不写 fail 状态：下次打开重新获取
    }
    if (entry.iconUrl !== src || entry.faviconStatus !== 'ok') {
      entry.iconUrl = src; entry.faviconStatus = 'ok'; save();   // ★ 主缓存，下次不再刷新
    }
    showIcon(icon, entry, src, save, domain);                // 清字母占位，挂图片
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
      // 自定义图标失效 → 用已抓取缓存兜底，没有再现场抓取
      if (entry.faviconStatus === 'ok' && entry.iconUrl) showIcon(icon, entry, entry.iconUrl, save, domain);
      else scrapeIcon(icon, entry, domain, save);
    });
    icon.appendChild(img);
    return icon;
  }

  if (!domain) { fallbackLetter(icon, entry); return icon; }

  // 2) entry 里的持久缓存（跨设备）→ 直接使用，不刷新
  if (entry.faviconStatus === 'ok' && entry.iconUrl) {
    showIcon(icon, entry, entry.iconUrl, save, domain);
    return icon;
  }

  // 3) 交给图标服务：依次命中「会话备忘 → storage.local 缓存 → 候选链抓取」
  fallbackLetter(icon, entry);                              // 先占位（通常几毫秒内就被替换）
  scrapeIcon(icon, entry, domain, save);
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
