// ============================================================
//  液态玻璃新标签页 · 入口
//  ──────────────────────────────────────────────────────────
//  这里只做两件事：
//   1. import 各 widget（让它们调用 Widgets.register 注册自己）
//   2. 调用 initApp() 启动
//  新增组件时：import './js/widgets/xxx.js' 一行即可。
// ============================================================

import { initApp } from './js/core.js';

// —— 内置 widget（顺序即「添加」菜单里的展示顺序）——
import './js/widgets/shortcut.js';
import './js/widgets/history.js';
import './js/widgets/clock.js';
import './js/widgets/weather.js';

// —— 启动 ——
document.addEventListener('DOMContentLoaded', initApp);
