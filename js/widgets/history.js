// ============================================================
//  Widget: history —— 历史记录小组件
//  ──────────────────────────────────────────────────────────
//  性能要点：历史条目里同一域名会重复出现（比如连点几次 github.com）。
//  图标解析按**域名**去重，并与快捷网址卡片共享同一套缓存（js/icons.js）：
//    · 首次打开：只为「没缓存过的域名」发请求（通常 3~8 个），不是每条一个
//    · 之后打开：全部命中 chrome.storage.local，零网络请求
// ============================================================
import { Widgets, getDomain, el } from '../core.js';
import { getIcon, invalidateIcon } from '../icons.js';

function fmtTime(ts) {
  const d = new Date(ts), now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return hh + ':' + mm;
  return (d.getMonth() + 1) + '/' + d.getDate();
}

function buildContent(card, entry) {
  const header = el('div', 'widget-header');
  // 图标是静态 SVG（可以走 innerHTML），标题是用户可编辑文本 → 单独用 textContent 追加
  header.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  header.appendChild(el('span', '', { text: entry.name || '历史记录' }));
  const list = el('div', 'history-list');
  card.appendChild(header);
  card.appendChild(list);

  if (!chrome.history?.search) {
    list.innerHTML = '<div class="history-empty">历史记录不可用</div>';
    return;
  }

  const limit = Number(entry.limit) || 12;

  // 扩展上下文失效（刷新/更新后旧页面）时 chrome.history.search 可能同步抛错，
  // 防御处理：显示不可用状态（core.js 的存储层会检测到并自动重载页面）
  try {
    chrome.history.search({ text: '', maxResults: limit, startTime: 0 }, (items) => {
      let count = 0;
      const byDomain = new Map();          // domain → [img, ...]（同域名共用一次解析结果）

      (items || []).forEach(item => {
        if (!item.url || item.url.indexOf('chrome') === 0) return;
        const link = el('a', 'history-item', { href: item.url });
        link.draggable = false;

        const img = el('img', '', { alt: '' });
        img.style.visibility = 'hidden';   // 拿到图标后再显示，避免破图闪烁
        const domain = getDomain(item.url);
        if (domain) {
          if (!byDomain.has(domain)) byDomain.set(domain, []);
          byDomain.get(domain).push(img);
        }

        const title = el('span', 'hi-title', { text: item.title || domain || item.url });
        const time = el('span', 'hi-time', { text: fmtTime(item.lastVisitTime) });

        link.appendChild(img);
        link.appendChild(title);
        link.appendChild(time);
        list.appendChild(link);
        count++;
      });

      if (!count) { list.innerHTML = '<div class="history-empty">暂无历史记录</div>'; return; }

      // 每个域名只解析一次，结果分发给该域名下的所有条目
      for (const [domain, imgs] of byDomain) {
        getIcon(domain).then(src => {
          if (!src || !card.isConnected) return;
          imgs.forEach(im => {
            if (!im.isConnected) return;
            im.src = src;                  // 同 src 的重复请求会命中浏览器缓存
            im.style.visibility = 'visible';
            im.addEventListener('error', () => {
              im.style.visibility = 'hidden';
              invalidateIcon(domain);      // 地址失效，下次重新抓
            });
          });
        }).catch(() => { /* 抓不到就保持隐藏 */ });
      }
    });
  } catch {
    list.innerHTML = '<div class="history-empty">历史记录不可用</div>';
  }
}

Widgets.register({
  id: 'history',
  name: '历史记录',
  defaults: { w: 3, h: 2 },
  resizable: false,
  draggable: true,

  match(entry) { return entry.type === 'history'; },

  createEntry() { return { type: 'history', name: '历史记录', limit: 12, w: 3, h: 2 }; },

  render(body, entry) {
    body.classList.add('widget-card-body');
    buildContent(body, entry);
  },

  // 有 editorFields 才会出现在「添加」菜单里（删除后可恢复）
  editorFields: [
    { key: 'name',  label: '标题',     type: 'text',   placeholder: '历史记录', default: '历史记录', maxlength: 16, required: true },
    { key: 'limit', label: '显示条数', type: 'select', default: 12,
      options: [
        { v: 8,  t: '8 条' },
        { v: 12, t: '12 条（推荐）' },
        { v: 20, t: '20 条' },
        { v: 30, t: '30 条' },
      ] },
  ],
});
