// ============================================================
//  Widget: clock —— 时钟小组件（★ 扩展示例）
//  ──────────────────────────────────────────────────────────
//  这个文件是「如何添加新组件」的范本：
//   1. 在 js/widgets/ 下新建文件
//   2. 调用 Widgets.register({ ... })
//   3. 实现 render(body, entry, ctx) 填充卡片内部
//   4. （可选）提供 editorFields 让用户在「添加」弹窗里配置
//  不需要改 core.js / newtab.html / newtab.js 任何一行。
// ============================================================
import { Widgets, el } from '../core.js';

function pad(n) { return String(n).padStart(2, '0'); }

function build(body, entry) {
  body.classList.add('clock-body');
  const time = el('div', 'clock-time');
  const date = el('div', 'clock-date');
  body.appendChild(time);
  body.appendChild(date);

  const fmt24 = entry.fmt24 !== false;           // 默认 24h
  const showSec = entry.showSec === true;          // 默认不显示秒

  const tick = () => {
    if (!body.isConnected) return;                 // 卡片被移除后停止
    const d = new Date();
    let h = d.getHours();
    let suffix = '';
    if (!fmt24) {
      suffix = h >= 12 ? ' PM' : ' AM';
      h = h % 12 || 12;
    }
    const m = pad(d.getMinutes());
    const s = pad(d.getSeconds());
    time.textContent = `${pad(h)}:${m}${showSec ? ':' + s : ''}${suffix}`;

    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    date.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 周${week}`;
    requestAnimationFrame(tick);                   // 与屏幕刷新同步
  };
  tick();
}

Widgets.register({
  id: 'clock',
  name: '时钟',
  defaults: { w: 2, h: 1 },                        // 横向宽卡
  resizable: false,
  draggable: true,

  match(entry) { return entry.type === 'clock'; },

  createEntry() { return { type: 'clock', fmt24: true, showSec: false, w: 2, h: 1 }; },

  render(body, entry) { build(body, entry); },

  editorFields: [
    { key: 'fmt24',   label: '时间制式', type: 'segmented', default: true,
      options: [{ v: true, t: '24小时' }, { v: false, t: '12小时' }] },
    { key: 'showSec', label: '显示秒针', type: 'checkbox', default: false },
    { key: 'w',        label: '卡片尺寸', type: 'segmented', default: 2,
      options: [{ v: 2, t: '2×1' }, { v: 1, t: '1×1' }] },
  ],
});
