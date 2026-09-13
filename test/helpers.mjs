// ============================================================
//  test/helpers.mjs —— 无浏览器环境下的 chrome API + DOM 模拟
//  ──────────────────────────────────────────────────────────
//  用途：在 Node 里跑扩展的核心逻辑（存储、迁移、图标抓取、widget 注册）。
//  模拟尽量贴近真实行为，否则测试会漏掉真问题：
//    · chrome.storage 读写做深拷贝（真实 API 会序列化，切断对象引用）
//    · sync 有「单 key 8KB」配额，超限时设置 lastError 且不写入
//    · 通过 set 写入的 img 会异步触发 load / error，用 available 集合模拟「服务器上有哪些图标」
//    · className 与 classList 联动（真实 DOM 行为）
// ============================================================

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

// ---------- DOM 元素模拟 ----------
export function makeEl(tag = 'div') {
  const classes = new Set();
  const listeners = {};
  const e = {
    tag, children: [], parent: null, isConnected: true,
    src: '', alt: '', href: '', download: '', title: '', value: '', disabled: false,
    offsetParent: {}, dataset: {}, _cn: '', _html: '', _text: '', _removed: false,
    style: { setProperty() {}, removeProperty() {} },
    focus() {}, blur() {}, click() { e._clicked = true; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    fire(type, ev = {}) {
      (listeners[type] || []).forEach(fn => fn({
        type, target: e, currentTarget: e, key: ev.key, shiftKey: ev.shiftKey,
        preventDefault() {}, stopPropagation() {}, ...ev,
      }));
    },
    _listeners: listeners,
    appendChild(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = e; e.children.push(n); n.isConnected = e.isConnected; return n; },
    remove() {
      if (e.parent) { const i = e.parent.children.indexOf(e); if (i >= 0) e.parent.children.splice(i, 1); }
      e.isConnected = false; e._removed = true;
    },
    setAttribute() {}, getAttribute() {},
    // src 用访问器实现：赋值时才视为「发起了一次请求」（与真实浏览器一致）
    set src(v) { e._src = String(v); if (e._onSrcSet) e._onSrcSet(); },
    get src() { return e._src || ''; },
    set className(v) { e._cn = String(v); classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
    get className() { return e._cn; },
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, force) => { const want = force === undefined ? !classes.has(c) : force; want ? classes.add(c) : classes.delete(c); return want; },
    },
    _classes: classes,
    set innerHTML(v) { e._html = String(v); e.children.forEach(c => { c.isConnected = false; c.parent = null; }); e.children = []; },
    get innerHTML() { return e._html; },
    set textContent(v) { e._text = String(v); },
    get textContent() { return e._text; },
  };
  return e;
}

// ---------- 环境安装 ----------
export function installEnv(opts = {}) {
  const {
    sync = {}, local = {},
    syncItemLimit = 8192,          // 模拟 QUOTA_BYTES_PER_ITEM
    failLocal = false,             // 模拟本地存储不可写
    available = [],                // 「服务器上真实存在」的图标地址
    prefersDark = false,           // 系统是否偏好暗色
  } = opts;

  const store = { sync: clone(sync) || {}, local: clone(local) || {} };
  const counters = { syncSet: 0, syncRemove: 0, localSet: 0, localRemove: 0 };
  const createdImgs = [];
  const requestLog = [];           // 真正走网络的图片请求（同 URL 第二次起命中 HTTP 缓存）
  const httpCache = new Set();
  const tips = [];                 // 页面顶部提示
  const avail = new Set(available);

  const documentEl = {
    _els: {},
    _listeners: {},
    documentElement: makeEl('html'),
    body: makeEl('body'),
    activeElement: makeEl('body'),
    hidden: false,
    addEventListener(t, fn) { (documentEl._listeners[t] ||= []).push(fn); },
    fire(t, ev = {}) { (documentEl._listeners[t] || []).forEach(fn => fn({ type: t, preventDefault() {}, ...ev })); },
    createElement: (tag) => {
      const e = makeEl(tag);
      if (tag === 'a') anchors.push(e);
      if (tag === 'img') {
        createdImgs.push(e);
        // 赋值 src 时才模拟一次加载（空 src 不产生请求）
        // 同 URL 第二次起命中 HTTP 缓存：不产生网络请求（这就是「图标抓到后零请求」的原因）
        e._onSrcSet = () => setTimeout(() => {
          if (e._removed || !e._src) return;
          const src = e.src;
          const hit = httpCache.has(src);
          if (!hit) {
            requestLog.push(src);
            if (avail.has(src)) httpCache.add(src);      // 只缓存成功响应
          }
          e.fire(avail.has(src) ? 'load' : 'error');
        }, 1);
      }
      return e;
    },
    // 同一个选择器返回同一个元素（与真实 DOM 一致）：否则 core.js 里 $() 拿到的
    // 元素和测试里拿到的不是同一个，事件监听就对不上了
    querySelector: (sel) => {
      if (!documentEl._els[sel]) documentEl._els[sel] = makeEl();
      return documentEl._els[sel];
    },
    querySelectorAll: (sel) => documentEl._els[sel + ':all'] || [],
    // 测试里预置元素（元素会一直留存，core.js 初始化时拿到同一个）
    getEl(sel) { if (!documentEl._els[sel]) documentEl._els[sel] = makeEl(); return documentEl._els[sel]; },
  };

  globalThis.document = documentEl;
  globalThis.window = globalThis;
  globalThis.addEventListener = () => {};
  globalThis.location = { href: '', reload() { counters.reloaded = (counters.reloaded || 0) + 1; } };
  // Node 里 navigator 是只读 getter，必须用 defineProperty 覆盖
  Object.defineProperty(globalThis, 'navigator', { value: { geolocation: {} }, configurable: true, writable: true });
  // rAF 模拟：必须限次！时钟 widget 会递归 rAF 走时，无限制的话测试进程退不出
  let rafBudget = 8;
  globalThis.requestAnimationFrame = (fn) => { if (rafBudget-- > 0) setTimeout(fn, 0); return 0; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };

  // 导出 / 导入 相关：Blob、下载链、确认弹窗
  const blobs = [];
  const anchors = [];
  const confirmCalls = [];
  let confirmValue = true;
  globalThis.Blob = class { constructor(parts = [], opts = {}) { this.parts = parts; this.type = opts.type; } };
  const origCreateObjectURL = globalThis.URL.createObjectURL;
  globalThis.URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:mock/' + blobs.length; };
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.confirm = (msg) => { confirmCalls.push(msg); return confirmValue; };
  // 系统主题模拟：暴露 setSystemDark() 以便测试「跟随系统」的实时响应
  let systemDark = !!prefersDark;
  const mqlListeners = [];
  globalThis.matchMedia = (query) => ({
    matches: /dark/.test(query) ? systemDark : !systemDark,
    addEventListener(type, fn) { if (type === 'change') mqlListeners.push(fn); },
    removeEventListener() {},
  });
  globalThis.fetch = () => Promise.resolve({ json: () => ({ current: { temperature_2m: 20, weather_code: 0, wind_speed_10m: 3 } }) });

  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      sync: {
        get: (defaults, cb) => cb(clone({ ...defaults, ...store.sync })),
        set: (obj, cb) => {
          counters.syncSet++;
          const overItem = Object.keys(obj).find(k => JSON.stringify({ [k]: obj[k] }).length > syncItemLimit);
          if (overItem) {
            chrome.runtime.lastError = { message: `QUOTA_BYTES_PER_ITEM quota exceeded (${overItem})` };
            cb(); chrome.runtime.lastError = null; return;
          }
          Object.assign(store.sync, clone(obj)); cb();
        },
        remove: (keys, cb) => { counters.syncRemove++; const list = [].concat(keys); list.forEach(k => delete store.sync[k]); cb(); },
      },
      local: {
        get: (key, cb) => {
          const k = typeof key === 'string' ? key : null;
          if (k && store.local[k] !== undefined) { const v = { [k]: clone(store.local[k]) }; cb(v); }
          else if (Array.isArray(key)) { const v = {}; key.forEach(x => { if (store.local[x] !== undefined) v[x] = clone(store.local[x]); }); cb(v); }
          else cb({});
        },
        set: (obj, cb) => {
          counters.localSet++;
          if (failLocal) { chrome.runtime.lastError = { message: 'local storage unavailable' }; cb(); chrome.runtime.lastError = null; return; }
          Object.assign(store.local, clone(obj)); cb();
        },
        remove: (key, cb) => { counters.localRemove++; [].concat(key).forEach(k => delete store.local[k]); cb(); },
      },
    },
    history: {
      // 与真实 API 一致：maxResults 由浏览器端截断
      search: (q, cb) => {
        envRef.lastHistoryQuery = q;
        cb(historyItems.slice(0, q.maxResults || historyItems.length));
      },
    },
  };

  let historyItems = [];
  let envRef = {};
  const env = {
    store, counters, createdImgs, requestLog, tips, avail, httpCache,
    blobs, anchors, confirmCalls,
    documentEl,
    lastHistoryQuery: null,
    setHistory(items) { historyItems = items; },
    setConfirm(v) { confirmValue = !!v; },
    // 导入的文件对象只要满足 .text() 和 .name
    makeFile(text, name = 'config.json') { return { name, text: async () => text }; },
    // 模拟用户在系统里切换了深色/浅色
    setSystemDark(v) { systemDark = !!v; mqlListeners.forEach(fn => fn({ matches: systemDark })); },
    getSystemDark: () => systemDark,
    // 让图片加载成功后 flush 一轮
    settle: (ms = 30) => new Promise(r => setTimeout(r, ms)),
    // 页面提示（notify 会 appendChild 到 body）
    tipTexts: () => tips.map(t => t._html || ''),
    // 只统计真正从 storage 读/写的次数
    resync(next) { store.sync = clone(next) || {}; },
    relocal(next) { store.local = clone(next) || {}; },
  };
  // notify() 把提示挂到 document.body
  documentEl.body.appendChild = (n) => { tips.push(n); return n; };
  envRef = env;
  return env;
}

// 记录页面提示：core.js 的 notify() 会 document.body.appendChild(tip)
export function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// 等待某个条件成立（代替写死 sleep 的脆弱断言）：
// 防抖写入之类的异步行为，完成时间是波动的，轮询能让测试稳定
// 用法：await waitFor(() => store.local.data?.engine === 'google')
export async function waitFor(fn, { timeout = 3000, step = 20 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return true;
    await wait(step);
  }
  return false;
}
