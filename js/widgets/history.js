// ============================================================
//  Widget: history —— 历史记录小组件（系统数据，无编辑表单）
//  读取 chrome.history.search 渲染最近访问
// ============================================================
import { Widgets, getDomain, el } from '../core.js';

function fmtTime(ts) {
  const d = new Date(ts), now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return hh + ':' + mm;
  return (d.getMonth() + 1) + '/' + d.getDate();
}

function buildContent(card, entry) {
  const header = el('div', 'widget-header', {
    html: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>' + (entry.name || '历史记录') + '</span>'
  });
  const list = el('div', 'history-list');
  card.appendChild(header);
  card.appendChild(list);

  if (!chrome.history?.search) {
    list.innerHTML = '<div class="history-empty">历史记录不可用</div>';
    return;
  }

  // 扩展上下文失效（刷新/更新后旧页面）时 chrome.history.search 可能同步抛错，
  // 防御处理：显示不可用状态（core.js 的存储层会检测到并自动重载页面）
  try {
    chrome.history.search({ text: '', maxResults: 30, startTime: 0 }, (items) => {
    let count = 0;
    (items || []).forEach(item => {
      if (!item.url || item.url.indexOf('chrome') === 0) return;
      const link = el('a', 'history-item', { href: item.url });
      link.draggable = false;

      const img = el('img', '', { alt: '' });
      const domain = getDomain(item.url);
      if (domain) img.src = 'https://' + domain + '/favicon.ico';
      img.addEventListener('error', () => img.style.visibility = 'hidden');

      const title = el('span', 'hi-title', { text: item.title || domain || item.url });
      const time = el('span', 'hi-time', { text: fmtTime(item.lastVisitTime) });

      link.appendChild(img);
      link.appendChild(title);
      link.appendChild(time);
      list.appendChild(link);
      count++;
    });
    if (!count) list.innerHTML = '<div class="history-empty">暂无历史记录</div>';
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

  createEntry() { return { type: 'history', name: '历史记录', w: 3, h: 2 }; },

  render(body, entry) {
    body.classList.add('widget-card-body');
    buildContent(body, entry);
  },

  // 提供一个标题字段，使本组件出现在「添加」菜单里（删除后可恢复）
  editorFields: [
    { key: 'name', label: '标题', type: 'text', placeholder: '历史记录', default: '历史记录', required: true },
  ],
});
