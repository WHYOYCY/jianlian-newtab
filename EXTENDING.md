# 简练首页 · 扩展开发指南

本指南面向**想给自己加新组件**的开发者。读完你能：在 `js/widgets/` 下加一个文件，零改动核心代码地新增任意卡片（时钟、便签、天气、热搜……）。

---

## 一、项目架构

```
D:/file/index/
├── manifest.json          # MV3 清单（chrome_url_overrides.newtab）
├── newtab.html            # 页面骨架 + 全部液态玻璃 CSS
├── newtab.js              # 入口：import core + 各 widget，启动 initApp()
├── js/
│   ├── core.js            # ★ 核心：Store/Data/Engines/Background/LiquidFX/Widgets/Grid/Modal/主题
│   ├── icons.js           # 图标服务：域名级缓存 + 回退链（各组件共用）
│   ├── presets.js         # 默认网址 / 预设背景 / 调色板（可自由改）
│   └── widgets/
│       ├── shortcut.js    # 网址快捷卡片（图标回退链 + 成功缓存/失败重试）
│       ├── history.js     # 历史记录小组件（chrome.history）
│       ├── clock.js       # 时钟（走时 + 12/24h 格式）
│       └── weather.js     # 天气（📍 自动定位 / ✍️ 手动城市双模式，open-meteo + BigDataCloud，带缓存）
└── EXTENDING.md           # 本文档
```

### 数据流

```
storage.local `data` 数据包  ──load──►  state.sites[]  ──render()──►  DOM
   （主存储，5MB）                           │
        ▲                                    │
        │                                    ▼
        │                        saveSites()（250ms 合并写入）
        │                                     │
        └──────── writeData() ◄───────────────┘
                     │
                     └─► storage.sync `data`（尽力镜像，仅跨设备同步）
```

- `state.sites` 是一个数组，每条 `entry` 描述一张卡片：`{ type, ...各widget自己的字段, w, h }`
- `entry.type` 决定由哪个 widget 渲染（如 `'shortcut'` / `'history'` / `'clock'`）
- 所有 entry 存在同一个 `sites` 数组里，统一拖拽排序、统一液态玻璃外壳

**存储分工**（重要，写新组件前必读）：

| 存什么 | 存哪里 | 为什么 |
|--------|--------|--------|
| 用户配置（卡片/背景/开关） | `storage.local` 的 `data` 数据包为主，`storage.sync` 尽力镜像 | sync 有**单 key 8KB 硬上限**，卡片一多就永久写不进去；local 有 5MB |
| 图标 / 天气等缓存 | `storage.local`（键前缀 `icon:` / `weather:`） | 缓存又大又频繁，不能塞进用户数据包 |

`data` 数据包结构：`{ v, at, sites, bg, hwRemoved, widgetsMigrated }`
- `v` schema 版本（便于未来迁移）、`at` 修改时间戳（多设备时取较新的一份）
- 启动时会在 local / sync / 旧版分散 key 之间自动选最新并迁移，无需手动处理

### 分层职责

| 层 | 文件 | 职责 |
|----|------|------|
| **外壳** | `core.js → Grid.render()` | 液态玻璃外观、拖拽、缩放、编辑/删除按钮、LiquidFX 视觉 |
| **内容** | `widgets/*.js → render()` | 只填充卡片内部 DOM，不碰外壳 |
| **编辑** | `core.js → Modal` | 按 `widget.editorFields` 动态生成表单 |
| **存储** | `core.js → Store` | `storage.local`（主）+ `storage.sync`（镜像）封装 |
| **图标** | `icons.js → getIcon()` | 域名级图标缓存与抓取，各组件共用 |
| **主题** | `core.js → applyTheme()` | 浅色 / 深色 / 跟随系统，用 `data-theme` 属性驱动 CSS |

> **关键设计**：widget 只负责"画里面"，外壳（液态玻璃、动画、按钮）由核心统一处理。所以新增组件**自动继承**整套液态玻璃视觉，不用重写 CSS。

---

## 二、液态玻璃视觉系统

### CSS 变量（`newtab.html :root`）

| 变量 | 作用 |
|------|------|
| `--glass-bg / --glass-border / --glass-blur` | 玻璃底色/边框/模糊 |
| `--glass-shadow` / `--glass-shadow-hover` | 多层投影 + inset 高光（液态玻璃的"厚度感"来源） |
| `--mx / --my` | **鼠标位置 0~1**，由 `LiquidFX` 实时更新，驱动跟随光斑 |
| `--tiltX / --tiltY` | **3D 倾斜角度**，由 `LiquidFX` 实时更新 |
| `--ease-spring` | `cubic-bezier(.34,1.56,.64,1)` 弹性回弹 |
| `--tint` | 卡片品牌色晕染（shortcut 用） |

### 卡片的三层结构

每张 `.shortcut` 卡片由三层叠加而成：

1. **底色层**（`background`）— 液态玻璃半透明 + 品牌色晕染
2. **`::before` 鼠标跟随光斑** — `radial-gradient at calc(var(--mx)*100%) calc(var(--my)*100%)`，hover 时显现，光斑跟着鼠标走（液态玻璃灵魂效果）
3. **`::after` specular 高光** — 对角亮线 + 左上环境光晕（常显，模拟玻璃折射）

hover 时叠加 `transform: perspective(900px) rotateX(var(--tiltX)) rotateY(var(--tiltY))`，卡片随鼠标方向轻微倾斜。

### LiquidFX API（`core.js`）

```js
import { LiquidFX } from './core.js';
LiquidFX.attach(node, { tilt: true });   // 给任意元素加光斑跟随+3D倾斜
LiquidFX.attach(node, { tilt: false });   // 只要光斑，不倾斜（如搜索框）
```

核心 `Grid.render()` 已自动给每张卡片调用，**你通常不用手动调**。

### 自动主题切换

- `body.has-bg` —— 设置了背景图后，玻璃自动切深色半透明
- `@media (prefers-color-scheme: dark)` —— 系统暗色自动切换所有变量

---

## 三、Widget API

注册一个 widget：

```js
import { Widgets } from '../core.js';
Widgets.register({
  id:         'myWidget',          // ★ 唯一标识，存入 entry.type
  name:       '我的组件',           // 「添加」菜单里显示的名字
  defaults:    { w: 1, h: 1 },       // 默认尺寸（列数×行数）
  resizable:  true,                 // 是否显示横向缩放手柄
  draggable:  true,                 // 是否参与拖拽排序

  // 判断一个 entry 是否属于本 widget（用于渲染时路由）
  match(entry) { return entry.type === 'myWidget'; },

  // 新建一个默认 entry（点「添加」→选本类型时调用）
  createEntry() { return { type: 'myWidget', title: '新便签', w: 1, h: 1 }; },

  // ★ 核心：渲染卡片内部 DOM（外壳已由 Grid 处理好）
  render(body, entry, ctx) {
    // body: <div class="widget-body"> 容器，往里塞你的内容
    // entry: 当前卡片的数据
    // ctx: { save, render, editMode, index } —— 工具方法
    body.textContent = entry.title;
  },

  // 可选：编辑表单字段（不写则卡片无编辑按钮、不能从「添加」菜单新建）
  editorFields: [
    { key: 'title', label: '标题', type: 'text', placeholder: '输入...', required: true },
  ],

  // 可选：自定义「表单值 → entry」的转换（默认直接 {...form}）
  serialize(form, oldEntry) {
    return { ...form, extra: oldEntry?.extra };
  },
});
```

### `render(body, entry, ctx)` 详解

| 参数 | 说明 |
|------|------|
| `body` | `div.widget-body`，已设好 flex 居中。你往里 `appendChild` 即可 |
| `entry` | 当前卡片数据对象 |
| `ctx.entry` / `ctx.index` | 同 entry / 在 sites 数组的下标 |
| `ctx.save` | `async () => saveSites()`，**改了 entry 后调用以持久化** |
| `ctx.render` | `() => render()`，全量重渲染（少用） |
| `ctx.editMode()` | 当前是否编辑模式 |

> ⚠️ 如果你的 widget 内部有定时器/监听（如时钟），务必在 `body` 被移除后停止。用 `body.isConnected` 判断（见 `clock.js`）。

### `editorFields` 字段类型

| `type` | 用途 | `options` 格式 | 取值 |
|--------|------|----------------|------|
| `'text'` | 文本输入 | — | `string` |
| `'colors'` | 调色板 | `['#fff', '#000', ...]` | 选中色值 |
| `'segmented'` | 分段按钮 | `[{v:1,t:'1×1'}, {v:2,t:'2×1'}]` | `o.v` |
| `'select'` | 下拉 | `[{v:'a',t:'A'}, ...]` | `o.v` |
| `'checkbox'` | 开关 | — | `boolean` |

字段通用属性：`key`（存入 entry 的键）、`label`、`placeholder`、`maxlength`、`required`、`default`。

> 表单提交后，核心会自动给 entry 加 `type = widget.id` 并存入 `state.sites`。

---

## 四、手把手：加一个新 Widget

以**便签 widget**为例（纯本地存储，无依赖，最适合照抄）。

### 第 1 步：新建 `js/widgets/notes.js`

```js
import { Widgets, el } from '../core.js';

Widgets.register({
  id: 'notes',
  name: '便签',
  defaults: { w: 1, h: 1 },
  resizable: true,
  draggable: true,

  match(entry) { return entry.type === 'notes'; },
  createEntry() { return { type: 'notes', text: '双击编辑…', w: 1, h: 1 }; },

  render(body, entry, ctx) {
    body.classList.add('notes-body');
    const pre = el('div', 'notes-text', { text: entry.text || '空' });
    // 双击进入行内编辑
    pre.addEventListener('dblclick', () => {
      const area = el('textarea', 'notes-area', { value: entry.text });
      pre.replaceWith(area); area.focus();
      const done = async () => {
        entry.text = area.value;
        await ctx.save();        // 持久化
        ctx.render();            // 重渲染
      };
      area.addEventListener('blur', done, { once: true });
      area.addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) area.blur(); });
    });
    body.appendChild(pre);
  },

  editorFields: [
    { key: 'text', label: '内容', type: 'text', placeholder: '便签内容…', required: true },
    { key: 'w',     label: '尺寸', type: 'segmented', default: 1, options: [{v:1,t:'1×1'},{v:2,t:'2×1'}] },
  ],
});
```

### 第 2 步：加样式（`newtab.html` 的 `<style>` 末尾）

```css
.notes-body { padding: 4px; }
.notes-text { font-size: 13px; color: var(--text); line-height: 1.4;
  overflow: auto; height: 100%; cursor: pointer; }
.notes-area { width: 100%; height: 100%; border: none; background: transparent;
  color: var(--text); font: inherit; resize: none; outline: none; }
```

### 第 3 步：在入口注册（`newtab.js`）

```js
import './js/widgets/shortcut.js';
import './js/widgets/history.js';
import './js/widgets/clock.js';
import './js/widgets/notes.js';   // ← 加这一行
```

**完成。** 现在「编辑模式 → + 添加」菜单里会出现"便签"类型，用户能添加、编辑、拖拽、删除便签卡片，且自动获得液态玻璃外观。

### 进阶：带网络请求的 widget（如天气）

> 💡 本项目已内置天气组件（`js/widgets/weather.js`），用的就是下面的模式，直接读源码参考。

widget 的 `render` 里可以自由 `fetch`，但要注意：

1. **跨域**：在 `manifest.json` 的 `host_permissions` 加上数据源域名，例如本项目加的 `https://api.open-meteo.com/`
2. **缓存**：隔一段时间才变的数据（天气、股票、新闻……）应缓存，避免每次渲染都请求
3. **图标**：需要网站图标时**别自己发请求**，直接用共享的图标服务：

   ```js
   import { getIcon } from '../icons.js';
   const src = await getIcon('github.com');   // 命中缓存，或自动走候选链抓取；失败返回 null
   ```

   同一次页面会话内同域名只抓一次，结果写入 `storage.local`，下次打开零网络请求；
   因此快捷卡片与历史列表能复用同一份缓存。
4. **主题**：样式请用核心提供的 CSS 变量（`--text` / `--sub` / `--glass-bg` / `--glass-border`…），
   它们会随主题自动变化；确实需要单独调暗色时用属性选择器：

   ```css
   :root[data-theme="dark"] .your-class { background: rgba(255,255,255,0.08); }
   ```
5. **取消**：`fetch` 返回后检查 `body.isConnected`，卡片已移除就别动 DOM

> ⚠️ **缓存请存 `chrome.storage.local`，不要塞进 `entry`**。
>
> `entry`（即 `ctx.save()` 写入的数据包）虽然是存本机为主，但：
> 1. 它会被镜像到 `chrome.storage.sync`，而 sync 有**单 key 8KB 上限**——数据包太大就会暂停跨设备同步；
> 2. 用户配置应当保持轻盈（只放用户设置，不放几百字节的请求结果）。
>
> 缓存数据一律用 `storage.local`，键名加自己的前缀避免冲突（本项目用 `icon:` / `weather:`）：
>
> ```js
> import { Widgets, el, Store } from '../core.js';
>
> const KEY = 'mywidget:cache';
> const TTL = 30 * 60 * 1000;
>
> async function load(body, entry, ctx) {
>   // ① 先读本地缓存（5MB、无写入频率限制）
>   const r = await Store.localGet(KEY);
>   const c = r[KEY];
>   if (c && Date.now() - c.at < TTL) { render(body, c.data); return; }
>
>   // ② 没缓存/过期 → 请求并写入 local
>   try {
>     const d = await fetch('https://api.example.com/data').then(r => r.json());
>     if (!body.isConnected) return;              // 卡片可能已删
>     Store.localSet({ [KEY]: { data: d, at: Date.now() } });
>     render(body, d);
>   } catch { body.textContent = '加载失败'; }
> }
> ```
>
> `entry` 里只放**用户配置**（城市、单位、开关……）这类轻量数据。
> `ctx.save()` 已经做了写入合并（250ms 内的多次保存只写一次），可以放心调用。

---

## 五、其他自定义

### 改默认网址 / 背景 / 配色

编辑 `js/presets.js`：`defaultSites`、`presetBgs`、`colors` 三个数组，随意增删。

### 加搜索引擎

`js/core.js` 顶部的 `Engines` 对象加一条，再到 `newtab.html` 的 `#engineTabs` 加一个 `<button class="engine-tab" data-engine="xxx">名字</button>`。

### 调液态玻璃质感

调 `newtab.html :root` 里：
- `--glass-blur`：增大 `blur()` 更糊更"液态"，减小更清
- `--glass-shadow` 的 inset 层：调高光/暗边强度
- 卡片 hover 缩放：`.shortcut:hover` 的 `scale(1.06)` 和 `translateY(-8px)`
- 倾斜幅度：`LiquidFX.attach` 里 `(0.5 - my) * 7` 的系数

### 让 widget 也参与「添加」菜单

只要 widget 定义了 `editorFields`，它会自动出现在「添加」弹窗的类型选择器里（由 `Widgets.editable()` 驱动）。无需额外注册。

---

## 六、加载与调试

1. Chrome 打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选 `D:/file/index` 目录
4. 打开新标签页即可看到效果
5. 改代码后回到 `chrome://extensions` 点扩展的「刷新」按钮（已打开的标签页会自动重载）

### 跑测试

新增组件建议配一个测试文件（不需要浏览器）：

```bash
npm test                                     # 跑全部（42 个用例）
node --test test/widgets.test.mjs            # 只跑某个文件
```

模拟环境在 `test/helpers.mjs`（chrome 存储、DOM、图片加载、HTTP 缓存都有），
写法参考 `test/widgets.test.mjs`：`installEnv()` 建环境 → 直接调 `Widgets.get('xxx').render(...)` 验证输出。

### 常见问题

- **改了代码没生效**：扩展需要点「刷新」⟳；CSS/JS 缓存可强制刷新 `Ctrl+Shift+R`
- **模块报错 "Cannot use import"**：确认 `newtab.html` 用的是 `<script type="module" src="newtab.js">`
- **历史记录小组件不显示**：检查 `manifest.json` 的 `permissions` 含 `"history"`
- **图标不显示**：网址的 favicon 受目标站点 CSP 影响，失败会自动回退纯色字母，属正常；失败不会被永久记住，下次打开标签页会自动重试（搜刮成功则缓存进 `entry.iconUrl`，之后不再刷新）

---

## 附：完整 Widget 接口速查表

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `id` | ✅ | string | 唯一标识 |
| `name` | ✅ | string | 显示名 |
| `defaults` | — | `{w,h}` | 默认尺寸 |
| `resizable` | — | bool | 显示缩放手柄（默认 false） |
| `draggable` | — | bool | 参与拖拽（默认 true） |
| `match(entry)` | ✅ | fn→bool | 路由判断 |
| `createEntry()` | ✅ | fn→entry | 新建默认数据 |
| `render(body,entry,ctx)` | ✅ | fn | 渲染内部 |
| `editorFields` | — | array | 编辑表单 |
| `serialize(form,old)` | — | fn→entry | 表单转数据 |

**新组件最小实现**：`id` + `name` + `match` + `createEntry` + `render`，五项即可跑起来。
