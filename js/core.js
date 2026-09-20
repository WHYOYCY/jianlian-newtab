// ============================================================
//  液态玻璃新标签页 · 核心系统  (core.js)
//  ──────────────────────────────────────────────────────────
//  · Utils        通用工具
//  · Store        chrome.storage 封装（local 主存储 + sync 镜像）
//  · Data        用户数据包 { v, at, sites, bg, ... }（自动迁移 / 多设备取新）
//  · Engines      搜索引擎
//  · Background   背景管理
//  · LiquidFX     液态玻璃视觉增强（光斑跟随 / 3D 倾斜）
//  · Widgets      Widget 注册中心（★ 可扩展核心）
//  · Grid         统一卡片外壳 + 渲染引擎
//  · Modal        动态编辑表单（按 widget.editorFields 生成）
//  · initApp      启动入口
// ============================================================

import { defaultSites, presetBgs, colors } from './presets.js';

// ---------- 通用工具 ----------
export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function el(tag, cls, props = {}) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const k in props) {
    if (k === 'text')      n.textContent = props[k];
    // html 只用于写死的静态标记（图标 SVG 等）；用户可编辑的内容一律走 text
    else if (k === 'html') n.innerHTML = props[k];
    else if (k === 'style' && typeof props[k] === 'object') Object.assign(n.style, props[k]);
    else if (k.startsWith('on') && typeof props[k] === 'function') n.addEventListener(k.slice(2).toLowerCase(), props[k]);
    else if (k in n) n[k] = props[k];
    else n.setAttribute(k, props[k]);
  }
  return n;
}

// 取 host 而不是 hostname：保留端口号，这样 localhost:3000 与 localhost:8080
// 不会共用同一份图标缓存，也不会把图标请求打到错误的地址上。
export function getDomain(url) { try { return new URL(url).host; } catch { return ''; } }

export function hexA(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
export function shade(hex, p) {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * (1 - p));
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * (1 - p));
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * (1 - p));
  return `rgb(${r},${g},${b})`;
}

// ---------- 扩展上下文失效处理 ----------
// 「Extension context invalidated」= 扩展被刷新/更新/禁用后，已打开的旧页面成为“僵尸页面”，
// 所有 chrome.* API 都会失败。这不是数据问题也不是配额问题，唯一正确的处理是重载页面
// （重载后新页面会用新的扩展上下文）。
let _ctxInvalid = false;

function isCtxInvalid(err) {
  const m = (err && (err.message || String(err))) || '';
  return m.toLowerCase().indexOf('context invalidated') !== -1;
}

function handleContextInvalidated() {
  if (_ctxInvalid) return;
  _ctxInvalid = true;
  console.info('[简练首页] 扩展上下文已失效（扩展被刷新/更新），即将自动重载页面');
  try {
    notify('ctx', '<b>扩展已更新</b>：页面即将自动刷新以加载新版本…');
    setTimeout(() => { try { location.reload(); } catch {} }, 900);
  } catch { /* 页面可能已在销毁中，尽力而为 */ }
}

// ---------- Storage ----------
// 存储分工（重要）：
//  · 用户数据（卡片布局/背景/开关）→ 打包成单个 data 对象，以 chrome.storage.local 为主存储，
//    chrome.storage.sync 作为「尽力而为」的镜像，仅用于跨设备同步。
//    原因：sync 有 QUOTA_BYTES_PER_ITEM = 8KB 硬上限，卡片一多就永久写不进去（之前已踩过）。
//  · 图标 / 天气等缓存 → chrome.storage.local（5MB，无写入频率限制）
// 关键坑 1：set 失败时回调依然会被调用，错误只在 chrome.runtime.lastError 里，
//           不检查就会「看起来保存成功、其实没写进去」。
// 关键坑 2：扩展上下文失效（刷新/更新后旧页面）时 chrome.* 调用会同步抛错或带 lastError，
//           统一在此检测并触发「自动重载」，避免误报为存储故障。
export const Store = {
  get: (defaults) => new Promise(res => {
    try { chrome.storage.sync.get(defaults, res); }
    catch (e) { if (isCtxInvalid(e)) handleContextInvalidated(); res({}); }
  }),

  set(obj) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.sync.set(obj, () => {
          const err = chrome.runtime && chrome.runtime.lastError;
          if (err) {
            if (isCtxInvalid(err)) handleContextInvalidated();
            reject(new Error(err.message));
          } else resolve();
        });
      } catch (e) {
        if (isCtxInvalid(e)) handleContextInvalidated();
        reject(e);
      }
    });
  },

  remove(keys) {
    return new Promise(resolve => {
      try {
        chrome.storage.sync.remove(keys, () => {
          const err = chrome.runtime && chrome.runtime.lastError;
          if (err) {
            if (isCtxInvalid(err)) handleContextInvalidated();
            else console.warn('[简练首页] 清理旧同步数据失败：', err.message);
          }
          resolve();
        });
      } catch (e) {
        if (isCtxInvalid(e)) handleContextInvalidated();
        resolve();
      }
    });
  },

  // storage.local：5MB、无写入频率限制，用于主数据与各类缓存
  localGet(key) {
    return new Promise(res => {
      try { chrome.storage.local.get(key, res); }
      catch (e) { if (isCtxInvalid(e)) handleContextInvalidated(); res({}); }
    });
  },

  localRemove(key) {
    return new Promise(resolve => {
      try { chrome.storage.local.remove(key, () => resolve()); }
      catch (e) { if (isCtxInvalid(e)) handleContextInvalidated(); resolve(); }
    });
  },

  localSet(obj) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(obj, () => {
          const err = chrome.runtime && chrome.runtime.lastError;
          if (err) {
            if (isCtxInvalid(err)) handleContextInvalidated();
            reject(new Error(err.message));
          } else resolve();
        });
      } catch (e) {
        if (isCtxInvalid(e)) handleContextInvalidated();
        reject(e);
      }
    });
  },
};

// 页面顶部提示（同类提示 60 秒内只出现一次，避免刷屏）
const _tipAt = {};
function notify(key, html) {
  const now = Date.now();
  if (_tipAt[key] && now - _tipAt[key] < 60000) return;
  _tipAt[key] = now;
  const tip = el('div', 'storage-warn', { html });
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 15000);
}

// ---------- 搜索引擎 ----------
export const Engines = {
  google: 'https://www.google.com/search?q=',
  bing:   'https://www.bing.com/search?q=',
  baidu:  'https://www.baidu.com/s?wd=',
};
export function setEngine(id) {
  state.engine = id;
  saveSites();                              // 记住选择，下次打开新标签页仍然是它
}
export function searchUrl(q)  { return (Engines[state.engine] || Engines.baidu) + encodeURIComponent(q); }

// ---------- 背景管理 ----------
export const Background = {
  current: '',
  apply(url) {
    this.current = url;
    const layer = $('#bgLayer');
    if (url) {
      layer.style.backgroundImage = `url("${url}")`;
      document.body.classList.add('has-bg');
    } else {
      layer.style.backgroundImage = '';
      document.body.classList.remove('has-bg');
    }
  },
};

// ============================================================
//  LiquidFX —— 液态玻璃视觉增强
//  给任意卡片绑定「鼠标跟随光斑 + 3D 倾斜」，所有 widget 共享
// ============================================================
export const LiquidFX = {
  _frame: null,
  attach(node, { tilt = true } = {}) {
    if (node.__fx) return;
    node.__fx = true;

    let pending = null;
    const flush = () => {
      pending = null;
      const { mx, my } = node.__fxState;
      node.style.setProperty('--mx', mx);
      node.style.setProperty('--my', my);
      if (tilt) {
        node.style.setProperty('--tiltX', ((0.5 - my) * 7).toFixed(2) + 'deg');
        node.style.setProperty('--tiltY', ((mx - 0.5) * 9).toFixed(2) + 'deg');
      }
    };
    node.__fxState = { mx: 0.5, my: 0.5 };

    node.addEventListener('pointermove', (e) => {
      const r = node.getBoundingClientRect();
      node.__fxState.mx = ((e.clientX - r.left) / r.width).toFixed(3);
      node.__fxState.my = ((e.clientY - r.top) / r.height).toFixed(3);
      if (!pending) pending = requestAnimationFrame(flush);
    });
    node.addEventListener('pointerleave', () => {
      node.__fxState.mx = 0.5; node.__fxState.my = 0.5;
      node.style.setProperty('--mx', 0.5);
      node.style.setProperty('--my', 0.5);
      node.style.setProperty('--tiltX', '0deg');
      node.style.setProperty('--tiltY', '0deg');
    });
  },
};

// ============================================================
//  Widgets —— Widget 注册中心  ★ 可扩展核心
//  ----------------------------------------------------------
//  每种卡片（网址快捷 / 历史 / 时钟 / ...）注册为一个 widget：
//
//    {
//      id:         'shortcut',          // 唯一标识，存入 entry.type
//      name:       '网址快捷',           // 显示名（用于「添加」类型选择）
//      defaults:   { w:1, h:1 },        // 默认尺寸
//      resizable:  true,                // 是否显示横向缩放手柄
//      draggable:  true,                // 是否参与拖拽排序
//      match(entry){ return !entry.type || entry.type === this.id; },
//      createEntry(){ return { type:'shortcut', ... }; },
//      render(body, entry, ctx){ ... }, // 填充卡片内部 DOM
//      editorFields: [ ... ],           // 可选：编辑表单字段
//      serialize?(form, entry){...},    // 可选：自定义表单→entry
//    }
//
//  新增组件：在 js/widgets/ 下新建文件 → import 注册即可。
// ============================================================
export const Widgets = {
  _reg: {},
  _order: [],
  register(def) {
    if (!def?.id) throw new Error('widget 必须有 id');
    this._reg[def.id] = def;
    if (!this._order.includes(def.id)) this._order.push(def.id);
    return def;
  },
  get(id)     { return this._reg[id]; },
  all()       { return this._order.map(id => this._reg[id]); },
  editable()  { return this.all().filter(w => w.editorFields?.length); },
  /** 根据一个 entry 找到对应的 widget（兜底返回第一个 match 的，再兜底 shortcut） */
  forEntry(entry) {
    for (const id of this._order) {
      const w = this._reg[id];
      if (w.match && w.match(entry)) return w;
    }
    return this._reg.shortcut;
  },
};

// 把所有内置 widget 的 id 声明为可被「添加」的类型
Widgets.builtinIds = ['shortcut', 'history', 'clock'];

// ============================================================
//  Grid —— 统一卡片外壳 + 渲染引擎
//  外壳负责：液态玻璃外观、拖拽排序、缩放、编辑/删除按钮
//  内部 .widget-body 由对应 widget 的 render() 填充
// ============================================================
const state = {
  sites: [],
  bg: '',
  hwRemoved: false,
  widgetsMigrated: false,
  engine: 'baidu',                 // 当前搜索引擎（持久化，用户可选）
  theme: 'auto',                   // 'auto' | 'light' | 'dark'（持久化）
  editingIndex: -1,
};

// ---------- 用户数据包（local 主存储 + sync 尽力镜像）----------
// 打包好处：一次原子读写、自带版本号（便于未来迁移）、
// 带修改时间戳 at（多设备时取较新的一份，LWW 语义）。
const DATA_KEY = 'data';
const DATA_V = 2;
const SYNC_SAFE_BYTES = 7500;    // sync 单 key 上限 8KB，留一点余量
let _dataAt = 0;                 // 当前数据的时间戳，保证单调递增（避开设备间时钟偏差）

function packData() {
  _dataAt = Math.max(Date.now(), _dataAt + 1);
  return {
    v: DATA_V,
    at: _dataAt,
    sites: state.sites,
    bg: state.bg,
    hwRemoved: state.hwRemoved,
    widgetsMigrated: state.widgetsMigrated,
    engine: state.engine,
    theme: state.theme,
  };
}

// 读取：local 主 → sync 镜像 → sync 旧格式（v1 升级）→ 默认值
async function readData() {
  const [l, s] = await Promise.all([
    Store.localGet(DATA_KEY),
    Store.get({ [DATA_KEY]: null, sites: null, bg: '', hwRemoved: false, widgetsMigrated: false }),
  ]);
  const localP  = (l && l[DATA_KEY]) || null;
  const syncP   = s[DATA_KEY] || null;
  const legacyP = s.sites
    ? { v: 1, at: 0, sites: s.sites, bg: s.bg || '', hwRemoved: !!s.hwRemoved, widgetsMigrated: !!s.widgetsMigrated }
    : null;

  // 取修改时间最新的一份（旧格式 at=0，仅在没有新格式数据时生效）
  let pick = null;
  for (const c of [localP, syncP, legacyP]) {
    if (c && (!pick || (c.at || 0) > (pick.at || 0))) pick = c;
  }
  return { pick, localP, legacyP };
}

// 写入：local 必定写（可靠）；sync 尽力镜像（超限自动跳过，只影响跨设备同步，不影响本地）
async function writeData() {
  const data = packData();
  let localOk = false;
  try { await Store.localSet({ [DATA_KEY]: data }); localOk = true; }
  catch (e) {
    // 扩展上下文失效（被刷新/更新）：Store 层已提示并安排自动重载，不再弹存储故障告警
    if (_ctxInvalid) return false;
    console.warn('[简练首页] 本地存储写入失败：', e.message);
    notify('local', '<b>数据保存失败</b>：本机存储写入出错，改动可能未保存。请检查扩展存储权限后重试。');
  }

  const size = JSON.stringify(data).length;
  if (size > SYNC_SAFE_BYTES) {
    console.warn(`[简练首页] 配置 ${(size / 1024).toFixed(1)}KB 超出同步存储单 key 上限，已跳过云端镜像（本地保存正常）`);
    notify('mirror', `<b>配置较大</b>（${(size / 1024).toFixed(1)}KB，云端单 key 上限 8KB）`
      + '<br>改动已保存到本机，跨设备同步已暂停。可以减少卡片数量或稍后使用导出备份。');
  } else {
    try { await Store.set({ [DATA_KEY]: data }); }
    catch (e) { console.warn('[简练首页] 云端镜像失败（本地已保存，不影响使用）：', e.message); }
  }
  return localOk;
}

export function getSites() { return state.sites; }

async function loadSites() {
  const { pick, localP, legacyP } = await readData();

  state.sites = (pick?.sites && pick.sites.length) ? pick.sites : [...defaultSites];
  state.bg = pick?.bg || '';
  state.hwRemoved = !!pick?.hwRemoved;
  state.widgetsMigrated = !!pick?.widgetsMigrated;
  state.engine = Engines[pick?.engine] ? pick.engine : 'baidu';   // 搜索引擎（非法值回退百度）
  state.theme = ['auto', 'light', 'dark'].includes(pick?.theme) ? pick.theme : 'auto';
  _dataAt = pick?.at || 0;
  let changed = false;

  // 历史记录小组件迁移：未主动删除且不存在 → 插入首位
  if (!state.sites.some(s => s.type === 'history') && !state.hwRemoved) {
    state.sites.unshift({ type: 'history', name: '历史记录', w: 3, h: 2 });
    changed = true;
  }

  // v2.1 迁移：老用户首次升级自动补充时钟/天气（只补一次；主动删过的不补）
  if (!state.widgetsMigrated) {
    const pushIfMissing = (type, def) => {
      if (!state.sites.some(s => s.type === type)) state.sites.push(def);
    };
    pushIfMissing('clock',   { type: 'clock', name: '时钟', fmt24: true, showSec: false, w: 2, h: 1 });
    // 天气不预填城市：定位失败时按文档提示「点击重试」，
    // 而不是在用户没配置过城市的情况下静默去查北京。
    pushIfMissing('weather', { type: 'weather', name: '天气', unit: 'c', w: 2, h: 1 });
    state.widgetsMigrated = true;
    changed = true;
  }

  // 需要回写的情况：
  //  · 本地还没有数据包（首次迁移/全新用户）
  //  · 跑过一次性迁移（补了历史记录/时钟/天气）
  //  · 本次采用的数据源不是本地（来自云端镜像或旧格式）→ 需要落到本地作为主副本
  const needWrite = !localP || changed || pick !== localP;
  const localSaved = needWrite ? await writeData() : true;

  // v1 → v2 迁移：旧的分散 key 已并入 data 包，清理掉以免新旧两份占双倍配额；
  // 只在新的本地存储确认写入成功后才清理，避免中途失败导致数据丢失
  if (legacyP && localSaved) {
    await Store.remove(['sites', 'bg', 'hwRemoved', 'widgetsMigrated']);
    console.info('[简练首页] 存储结构已升级：用户数据存本机，云端仅作镜像');
  }

  Background.current = state.bg;
}

// 合并短时间内的多次保存为一次写入：
// 打开新标签页时多个图标可能同时搜刮完成、天气加载完成等，各自触发 save，
// 合并后只落盘一次（减少磁盘 IO，也让云端镜像更稳定）。
// 返回的 Promise 立即 resolve（调用方无需等待落盘），实际写入在 250ms 后合并执行。
let _saveTimer = null;

export function saveSites() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { _saveTimer = null; writeData(); }, 250);
  return Promise.resolve();
}

// 立即落盘（背景/开关等单次操作，以及页面即将销毁时）
export function flushSaveNow() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  return writeData();
}

export async function saveBg(url) { state.bg = url; await flushSaveNow(); }
export async function setHwRemoved(v) { state.hwRemoved = v; await flushSaveNow(); }

// 统一尺寸类（2×1 宽卡）
function applySizeClass(node, w) {
  node.classList.toggle('card-wide', w === 2);
}

// ---------- 删除撤销 ----------
// 删除后 6 秒内可撤销：卡片插回原位置；若是历史记录组件，同时清掉「已主动删除」标记
let _undo = null;

function dismissUndo() {
  if (!_undo) return;
  clearTimeout(_undo.timer);
  const toast = _undo.toast;
  toast.classList.remove('show');
  setTimeout(() => toast.remove(), 300);       // 等淡出动画结束再移除
  _undo = null;
}

function showUndo(entry, index) {
  dismissUndo();                               // 只保留最近一次撤销机会
  const toast = el('div', 'undo-toast');
  toast.appendChild(el('span', '', { text: `已删除「${entry.name || '卡片'}」` }));
  toast.appendChild(el('button', 'undo-btn', { text: '撤销', type: 'button', onClick: () => undoDelete() }));
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  _undo = { entry, index, toast, timer: setTimeout(dismissUndo, 6000) };
}

async function undoDelete() {
  if (!_undo) return;
  const { entry, index } = _undo;
  dismissUndo();
  state.sites.splice(Math.min(index, state.sites.length), 0, entry);   // 插回原位置
  if (entry.type === 'history') state.hwRemoved = false;               // 撤销掉「历史组件被主动删除」
  await saveSites();
  render();
}

function makeDeleteBtn(onClick) {
  return el('button', 'delete-btn', { text: '×', 'aria-label': '删除卡片', title: '删除', onClick });
}
function makeEditBtn(onClick) {
  return el('button', 'edit-btn-shortcut', {
    html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    'aria-label': '编辑卡片', title: '编辑', onClick,
  });
}
function makeResizeHandle(node, entry, w) {
  const handle = el('div', 'resize-handle');
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    node.draggable = false;
    const gap = 14;
    const cols = getComputedStyle($('#shortcuts')).gridTemplateColumns.split(' ').length;
    const cellW = ($('#shortcuts').clientWidth - (cols - 1) * gap) / cols;
    const startX = e.clientX, startW = w; let curW = startW;
    const onMove = (ev) => {
      const nw = Math.min(2, Math.max(1, startW + Math.round((ev.clientX - startX) / (cellW + gap))));
      if (nw !== curW) {
        curW = nw;
        node.style.gridColumn = nw > 1 ? 'span ' + nw : '';
        applySizeClass(node, nw);
      }
    };
    const onUp = async () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      entry.w = curW;
      await saveSites(); render();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
  handle.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  return handle;
}

// ===== 主渲染 =====
export function render() {
  const container = $('#shortcuts');
  const addCard = $('#addCard');
  container.innerHTML = '';

  state.sites.forEach((entry, i) => {
    const widget = Widgets.forEntry(entry);
    const isWidget = widget.id !== 'shortcut';
    const node = el(widget.id === 'shortcut' ? 'a' : 'div', 'shortcut' + (isWidget ? ' widget-card' : ''));
    if (widget.id === 'shortcut') node.href = entry.url;
    node.draggable = widget.draggable !== false;
    node.dataset.index = i;

    // 尺寸（快捷方式 1×1/2×1；小组件按自身 defaults，history 固定 3×2）
    const w = widget.defaults && entry.w ? Math.min(Math.max(entry.w, 1), widget.resizable ? 2 : (entry.w || 1)) : (entry.w || 1);
    const h = entry.h || widget.defaults?.h || 1;
    if (w > 1) node.style.gridColumn = 'span ' + w;
    if (h > 1) node.style.gridRow = 'span ' + h;
    // card-wide（横排）只对网址快捷生效，其他 widget 内部布局各自决定
    if (widget.id === 'shortcut') applySizeClass(node, w);

    // 品牌色晕染（仅 shortcut 类）
    if (widget.id === 'shortcut' && entry.color) {
      node.style.setProperty('--tint', hexA(entry.color, w >= 2 ? 0.20 : 0.12));
    }

    // 统一液态玻璃视觉增强
    LiquidFX.attach(node, { tilt: true });

    // 编辑模式禁止跳转
    node.addEventListener('click', (e) => {
      if (document.body.classList.contains('edit-mode')) e.preventDefault();
    });

    // ----- 拖拽排序 -----
    if (widget.draggable !== false) {
      node.addEventListener('dragstart', (e) => {
        if (!document.body.classList.contains('edit-mode')) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        node.classList.add('dragging');
      });
      node.addEventListener('dragend', () => {
        node.classList.remove('dragging');
        $$('.shortcut').forEach(s => s.classList.remove('drag-over'));
      });
      node.addEventListener('dragover', (e) => {
        if (!document.body.classList.contains('edit-mode')) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        node.classList.add('drag-over');
      });
      node.addEventListener('dragleave', () => node.classList.remove('drag-over'));
      node.addEventListener('drop', async (e) => {
        e.preventDefault(); e.stopPropagation();
        node.classList.remove('drag-over');
        const from = parseInt(e.dataTransfer.getData('text/plain'));
        const to = parseInt(node.dataset.index);
        if (isNaN(from) || isNaN(to) || from === to) return;
        const moved = state.sites.splice(from, 1)[0];
        state.sites.splice(to, 0, moved);
        await saveSites(); render();
      });
    }

    // ----- 内容区（由 widget 填充） -----
    const body = el('div', 'widget-body');
    node.appendChild(body);
    // 先挂到 DOM 再调 render —— 让 widget 内部能可靠用 body.isConnected 判断生命周期
    // （时钟/天气等含定时器或异步请求的组件依赖此点）
    container.appendChild(node);
    const ctx = {
      entry,
      index: i,
      save: saveSites,
      render,
      editMode: () => document.body.classList.contains('edit-mode'),
    };
    widget.render(body, entry, ctx);

    // ----- 删除按钮（所有 widget 都有） -----
    node.appendChild(makeDeleteBtn(async (e) => {
      e.preventDefault(); e.stopPropagation();
      const removed = state.sites.splice(i, 1)[0];
      if (widget.id === 'history') state.hwRemoved = true;
      await saveSites();
      render();
      showUndo(removed, i);                  // 6 秒内可撤销
    }));

    // ----- 编辑按钮（有 editorFields 才显示） -----
    if (widget.editorFields?.length) {
      node.appendChild(makeEditBtn((e) => {
        e.preventDefault(); e.stopPropagation();
        Modal.open(widget, i);
      }));
    }

    // ----- 缩放手柄（resizable 且 h<=1 才有，横向 1×1↔2×1） -----
    if (widget.resizable && h <= 1) {
      node.appendChild(makeResizeHandle(node, entry, w));
    }
  });
  container.appendChild(addCard);
}

// ============================================================
//  Modal —— 动态编辑表单（按 widget.editorFields 生成）
//  字段 type: 'text' | 'colors' | 'segmented' | 'select' | 'checkbox'
// ============================================================
const Modal = {
  cur: null,         // 当前 widget
  editingIndex: -1,
  form: {},          // 当前表单值

  open(widget, index = -1) {
    this.cur = widget;
    this.editingIndex = index;
    this._returnFocus = document.activeElement;      // 关闭时把焦点还回触发元素
    const entry = index >= 0 ? state.sites[index] : widget.createEntry();
    this.form = { ...entry };

    $('#modalTitle').textContent = (index >= 0 ? '编辑' : '添加') + widget.name;
    this.renderTypeSelector(widget.id);
    this.renderFields(widget, entry);
    $('#modalOverlay').classList.add('show');
    const first = $('#modalFields input');
    if (first) first.focus();
  },

  // 「添加」时的 widget 类型选择器
  renderTypeSelector(activeId) {
    const wrap = $('#modalType');
    const editable = Widgets.editable();
    // 只在「新增」且存在多个可编辑 widget 时才显示类型选择器（编辑现有项时锁定类型，避免混淆）
    if (editable.length <= 1 || this.editingIndex >= 0) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    wrap.innerHTML = '<span class="type-label">类型</span>';
    const seg = el('div', 'type-seg');
    editable.forEach(w => {
      seg.appendChild(el('button', (w.id === activeId ? 'active' : ''), {
        text: w.name, type: 'button', 'data-v': w.id,
        onClick: (e) => {
          e.preventDefault();
          const next = Widgets.get(w.id);
          this.cur = next;
          this.editingIndex = -1;            // 切换类型视为新增
          this.form = next.createEntry();
          $('#modalTitle').textContent = '添加' + next.name;
          this.renderTypeSelector(w.id);
          this.renderFields(next, this.form);
        }
      }));
    });
    wrap.appendChild(seg);
  },

  renderFields(widget, entry) {
    const wrap = $('#modalFields');
    wrap.innerHTML = '';
    widget.editorFields.forEach(f => {
      // 条件显示：visible(form) 返回 false 时隐藏该字段（如「自动定位」模式下隐藏城市输入）
      if (f.visible && !f.visible(entry)) return;
      const group = el('div', 'form-group');
      group.appendChild(el('label', '', { text: f.label }));
      const v = entry[f.key] ?? f.default ?? '';
      this.form[f.key] = v;

      if (f.type === 'colors') {
        const row = el('div', 'color-row');
        (f.options || colors).forEach(c => {
          row.appendChild(el('div', 'color-swatch' + (c === v ? ' selected' : ''), {
            style: { background: c },
            onClick: (ev) => {
              this.form[f.key] = c;
              [...row.children].forEach(x => x.classList.remove('selected'));
              ev.currentTarget.classList.add('selected');
            }
          }));
        });
        group.appendChild(row);
      } else if (f.type === 'segmented') {
        const seg = el('div', 'size-seg');
        f.options.forEach(o => {
          seg.appendChild(el('button', (String(o.v) === String(v) ? 'active' : ''), {
            text: o.t, type: 'button', 'data-v': o.v,
            onClick: (e) => {
              e.preventDefault();
              this.form[f.key] = o.v;
              [...seg.children].forEach(x => x.classList.remove('active'));
              e.target.classList.add('active');
              // 存在条件字段时联动重渲染（如位置模式切换）
              if (widget.editorFields.some(x => x.visible)) this.renderFields(widget, this.form);
            }
          }));
        });
        group.appendChild(seg);
      } else if (f.type === 'select') {
        const sel = el('select', '', {
          onChange: (e) => this.form[f.key] = e.target.value
        });
        f.options.forEach(o => sel.appendChild(el('option', '', {
          text: o.t, value: o.v, selected: String(o.v) === String(v)
        })));
        group.appendChild(sel);
      } else if (f.type === 'checkbox') {
        group.appendChild(el('input', '', {
          type: 'checkbox', checked: !!v,
          onChange: (e) => this.form[f.key] = e.target.checked
        }));
      } else {
        // text
        group.appendChild(el('input', '', {
          type: 'text', placeholder: f.placeholder || '',
          maxlength: f.maxlength || null, value: v,
          onInput: (e) => this.form[f.key] = e.target.value
        }));
      }
      wrap.appendChild(group);
    });
  },

  async submit() {
    const widget = this.cur;
    // 自定义序列化优先
    let entry = widget.serialize ? widget.serialize(this.form, this.editingIndex >= 0 ? state.sites[this.editingIndex] : null)
                                 : { ...this.form };
    entry.type = widget.id;
    // 必填校验（跳过当前不可见的条件字段）
    const required = widget.editorFields.filter(f => f.required && (!f.visible || f.visible(this.form)));
    for (const f of required) {
      if (!String(entry[f.key] ?? '').trim()) return;
    }
    if (this.editingIndex >= 0) {
      // 网址未变则保留图标缓存（shortcut 专用）
      if (widget.id === 'shortcut' && state.sites[this.editingIndex].url === entry.url) {
        entry.faviconStatus = state.sites[this.editingIndex].faviconStatus;
        entry.iconUrl = state.sites[this.editingIndex].iconUrl;
      }
      state.sites[this.editingIndex] = entry;
    } else {
      state.sites.push(entry);
    }
    await saveSites();
    this.close();
    render();
  },

  close() {
    $('#modalOverlay').classList.remove('show');
    const back = this._returnFocus;
    this._returnFocus = null;
    if (back && typeof back.focus === 'function') back.focus();
  },
};

// ============================================================
//  初始化各交互
// ============================================================
async function initSearch() {
  // 搜索框也获得光斑跟随（与卡片视觉统一，不倾斜）
  LiquidFX.attach($('.search-wrap'), { tilt: false });
  // 恢复上次使用的搜索引擎
  $$('.engine-tab').forEach(t => t.classList.toggle('active', t.dataset.engine === state.engine));
  $('#engineTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.engine-tab');
    if (!tab) return;
    $$('.engine-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    setEngine(tab.dataset.engine);          // 内部会持久化
    $('#searchBox').focus();
  });
  const doSearch = () => {
    const q = $('#searchBox').value.trim();
    if (q) location.href = searchUrl(q);
  };
  $('#searchBtn').addEventListener('click', doSearch);
  $('#searchBox').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
}

function initToolbar() {
  $('#editBtn').addEventListener('click', () => document.body.classList.toggle('edit-mode'));

  // 主题按钮 = 白天/黑夜 互换，保证每次点击外观都真的变。
  // 旧版是「跟随系统 → 浅色 → 深色」三态循环：系统本来就是浅色时，
  // 第一次点击（auto → light）解析结果与当前完全相同，看起来就像按钮坏了。
  // 「跟随系统」现在放在设置弹窗里选（#themeSeg）。
  $('#themeBtn').addEventListener('click', () => {
    const shownDark = document.documentElement.dataset.theme === 'dark';
    setTheme(shownDark ? 'light' : 'dark');
  });
}

// 设置弹窗里的主题选择（跟随系统 / 浅色 / 深色）
function initThemeSeg() {
  $$('#themeSeg button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      setTheme(btn.dataset.themeMode);
    });
  });
}

// ---------- 主题 ----------
// 用 <html data-theme="dark|light"> 驱动样式（单一来源，不用把媒体查询整块复制）。
// 选「跟随系统」时监听系统设置变化，实时切换。
const THEME_ICONS = {
  auto:  '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/>',
  light: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2 12h2.4M19.6 12H22M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/>',
  dark:  '<path d="M20.5 15.2A8.6 8.6 0 1 1 8.8 3.5a6.8 6.8 0 0 0 11.7 11.7z"/>',
};
function systemPrefersDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
}

// 把当前设置解析成实际主题并写入 DOM（同时维护 localStorage 镜像，供首屏内联脚本使用）
export function applyTheme() {
  const resolved = state.theme === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : state.theme;
  document.documentElement.dataset.theme = resolved;
  try { localStorage.setItem('theme', state.theme); } catch { /* 隐私模式等场景忽略 */ }

  const icon = $('#themeIcon');
  if (icon) icon.innerHTML = THEME_ICONS[state.theme] || THEME_ICONS.auto;
  const btn = $('#themeBtn');
  if (btn) {
    // 标题里写清「现在是什么」和「点一下会变成什么」，免得用户以为按钮没反应
    const shown = resolved === 'dark' ? '深色' : '浅色';
    const next  = resolved === 'dark' ? '浅色' : '深色';
    const suffix = state.theme === 'auto' ? '（跟随系统）' : '';
    btn.title = `主题：${shown}${suffix} · 点击切换为${next}`;
  }
  // 设置弹窗里的主题分段控件（跟随系统 / 浅色 / 深色）
  $$('#themeSeg button').forEach(b => b.classList.toggle('active', b.dataset.themeMode === state.theme));
}

// 用户切换主题
export function setTheme(mode) {
  state.theme = ['auto', 'light', 'dark'].includes(mode) ? mode : 'auto';
  applyTheme();
  saveSites();                              // 记住选择
}

// 系统主题变化（仅「跟随系统」时生效）
function watchSystemTheme() {
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (state.theme === 'auto') applyTheme();
    });
  } catch { /* 旧环境不支持 addEventListener，忽略 */ }
}

function initAddButton() {
  $('#addCard').addEventListener('click', () => {
    // 默认打开 shortcut（最常用），用户可在 modal 内切换类型
    Modal.open(Widgets.get('shortcut'), -1);
  });
}

function initModal() {
  $('#btnCancel').addEventListener('click', () => Modal.close());
  $('#modalOverlay').addEventListener('click', (e) => { if (e.target === $('#modalOverlay')) Modal.close(); });
  $('#btnSave').addEventListener('click', () => Modal.submit());

  // 弹窗内 Tab 焦点循环，不让键盘焦点跑到弹窗背后
  $('#modalOverlay').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = $$('#modalOverlay button, #modalOverlay input, #modalOverlay select')
      .filter(x => !x.disabled && x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

// 全局键盘：Esc 逐层关闭（弹窗 → 背景弹窗 → 退出编辑模式）
function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('#modalOverlay').classList.contains('show')) { Modal.close(); return; }
    if ($('#bgOverlay2').classList.contains('show')) { $('#bgOverlay2').classList.remove('show'); return; }
    if (document.body.classList.contains('edit-mode')) document.body.classList.remove('edit-mode');
  });
}

// 轻提示（底部玻璃胶囊，无按钮）—— 用于导出成功之类的反馈
let _toastEl = null, _toastTimer = null;
function toast(msg, ms = 2800) {
  if (_toastEl) { clearTimeout(_toastTimer); _toastEl.remove(); _toastEl = null; }
  const t = el('div', 'undo-toast plain');
  t.appendChild(el('span', '', { text: msg }));
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  _toastEl = t;
  _toastTimer = setTimeout(() => {
    t.classList.remove('show');
    _toastEl = null;
    setTimeout(() => t.remove(), 300);
  }, ms);
}

// ---------- 配置导出 / 导入 ----------
const pad2 = (n) => String(n).padStart(2, '0');

function exportConfig() {
  const data = packData();                    // 统一从数据包导出，字段与存储一致
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  const a = el('a', '', { href: url, download: `jianlian-newtab-${stamp}.json` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`已导出 ${state.sites.length} 张卡片与全部设置`);
}

async function importConfig(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const sites = Array.isArray(parsed.sites) ? parsed.sites.filter(s => s && typeof s === 'object') : [];
    if (!sites.length) throw new Error('文件里没有可用的卡片数据');

    const ok = window.confirm(`导入将覆盖当前的 ${state.sites.length} 张卡片与所有设置，确定继续？`);
    if (!ok) return;

    state.sites = sites;
    state.bg = typeof parsed.bg === 'string' ? parsed.bg : '';
    state.hwRemoved = !!parsed.hwRemoved;
    state.widgetsMigrated = true;              // 导入的是完整配置，不再跑一次性迁移
    state.engine = Engines[parsed.engine] ? parsed.engine : 'baidu';
    state.theme = ['auto', 'light', 'dark'].includes(parsed.theme) ? parsed.theme : 'auto';
    await flushSaveNow();

    Background.apply(state.bg);
    applyTheme();
    render();
    toast(`已导入 ${sites.length} 张卡片`);
  } catch (e) {
    notify('import', '<b>导入失败</b>：' + (e.message || '文件格式不正确') + '<br>请选择本扩展导出的 JSON 文件。');
  }
}

function initBackground() {
  const renderGrid = () => {
    const grid = $('#bgGrid');
    grid.innerHTML = '';
    presetBgs.forEach(bg => {
      let thumb;
      if (bg.url === '') {
        thumb = el('div', 'bg-thumb bg-thumb-none' + (state.bg === '' ? ' selected' : ''), { text: '无' });
      } else {
        thumb = el('div', 'bg-thumb' + (state.bg === bg.url ? ' selected' : ''));
        thumb.style.backgroundImage = `url("${bg.thumb}")`;
        thumb.appendChild(el('span', 'thumb-label', { text: bg.name }));
      }
      thumb.addEventListener('click', async () => {
        await saveBg(bg.url);
        Background.apply(bg.url);
        $('#bgOverlay2').classList.remove('show');
      });
      grid.appendChild(thumb);
    });
  };

  $('#bgBtn').addEventListener('click', () => {
    renderGrid();
    $('#bgUrl').value = (state.bg && state.bg.indexOf('unsplash') === -1) ? state.bg : '';
    $('#bgOverlay2').classList.add('show');
  });
  $('#bgCancel').addEventListener('click', () => $('#bgOverlay2').classList.remove('show'));
  $('#bgOverlay2').addEventListener('click', (e) => { if (e.target === $('#bgOverlay2')) $('#bgOverlay2').classList.remove('show'); });
  $('#bgApply').addEventListener('click', async () => {
    const url = $('#bgUrl').value.trim();
    await saveBg(url || '');
    Background.apply(url || '');
    toast(url ? '背景已应用' : '已清除背景');
    $('#bgOverlay2').classList.remove('show');
  });

  // 配置导出 / 导入
  $('#btnExport').addEventListener('click', () => exportConfig());
  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    await importConfig(file);
    e.target.value = '';                       // 允许重复选同一个文件
  });
}

// ============================================================
//  启动
// ============================================================
export async function initApp() {
  await loadSites();
  Background.apply(state.bg);
  render();
  initSearch();
  initToolbar();
  applyTheme();
  watchSystemTheme();
  initAddButton();
  initModal();
  initKeyboard();
  initBackground();
  initThemeSeg();
  // 切走/关闭页面前把合并中的保存落盘，避免 debounce 窗口内丢改动
  window.addEventListener('pagehide', flushSaveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSaveNow(); });
}
