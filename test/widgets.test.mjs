// ============================================================
//  Widget 层测试
//  ──────────────────────────────────────────────────────────
//  覆盖：注册表、编辑字段（含条件字段）、serialize 的缓存保留规则、
//        历史列表的「同域名只解析一次图标」与条数配置
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, makeEl, waitFor } from './helpers.mjs';

const core = await import('../js/core.js');
const { Widgets } = core;
await import('../js/widgets/shortcut.js');
await import('../js/widgets/history.js');
await import('../js/widgets/clock.js');
await import('../js/widgets/weather.js');

test('注册表：四个内置组件都在，且都可在「添加」菜单里选到', () => {
  const ids = Widgets.all().map(w => w.id).sort();
  assert.deepEqual(ids, ['clock', 'history', 'shortcut', 'weather']);
  for (const id of ids) assert.ok(Widgets.get(id), `Widgets.get('${id}') 应可用`);
});

test('shortcut.serialize：网址没变保留图标缓存，网址变了重置', () => {
  const w = Widgets.get('shortcut');
  const old = { url: 'https://github.com', faviconStatus: 'ok', iconUrl: 'https://github.com/apple-touch-icon.png', name: 'GitHub' };

  const keep = w.serialize({ name: '改名', url: 'https://github.com' }, old);
  assert.equal(keep.faviconStatus, 'ok');
  assert.equal(keep.iconUrl, old.iconUrl);
  assert.equal(keep.label, '改', 'label 应取名称首字');

  const reset = w.serialize({ name: 'X', url: 'https://gitlab.com' }, old);
  assert.equal(reset.faviconStatus, 'pending', '换网址应标记重新抓取');
  assert.equal(reset.iconUrl, '');

  const normalized = w.serialize({ name: 'Y', url: 'example.com' }, null);
  assert.equal(normalized.url, 'https://example.com', '应自动补全协议');
});

test('weather.serialize：位置相关参数变化时清坐标，并剥离旧的缓存字段', () => {
  const w = Widgets.get('weather');
  const old = { mode: 'manual', city: '北京', unit: 'c', lat: 39.9, lon: 116.4, cached: { t: 1 }, cachedAt: 123 };

  const same = w.serialize({ mode: 'manual', city: '北京', unit: 'c' }, old);
  assert.equal(same.lat, 39.9, '参数未变应保留坐标');
  assert.ok(!('cached' in same) && !('cachedAt' in same), '旧版本存在 sync 里的大字段应被剥离');

  const changed = w.serialize({ mode: 'manual', city: '上海', unit: 'c' }, old);
  assert.equal(changed.lat, null, '换城市应清坐标触发重新解析');

  const unitChanged = w.serialize({ mode: 'manual', city: '北京', unit: 'f' }, old);
  assert.equal(unitChanged.lat, null, '换单位也应清坐标（缓存 key 含单位）');
});

test('weather：定位模式下城市字段隐藏（条件字段 visible）', () => {
  const w = Widgets.get('weather');
  const city = w.editorFields.find(f => f.key === 'city');
  assert.equal(typeof city.visible, 'function', 'city 应是条件字段');
  assert.equal(city.visible({ mode: 'manual' }), true);
  assert.equal(city.visible({ mode: 'auto' }), false);
});

test('history：同域名条目只解析一次图标（4 条记录 → 2 个域名 → 2 个请求）', async () => {
  const env = installEnv({
    available: [
      'https://github.com/apple-touch-icon.png',
      'https://mp.weixin.qq.com/apple-touch-icon.png',
    ],
  });
  env.setHistory([
    { url: 'https://github.com/a', title: 'A', lastVisitTime: Date.now() },
    { url: 'https://github.com/b', title: 'B', lastVisitTime: Date.now() },
    { url: 'https://github.com/c', title: 'C', lastVisitTime: Date.now() },
    { url: 'https://mp.weixin.qq.com/x', title: 'X', lastVisitTime: Date.now() },
  ]);

  const w = Widgets.get('history');
  const body = makeEl();
  w.render(body, { type: 'history', name: '历史记录', limit: 12 }, { save: async () => {}, editMode: () => false });

  const list = body.children.find(c => c.classList.contains('history-list'));
  assert.ok(list, '应有列表容器');
  assert.equal(list.children.length, 4, '应渲染 4 条记录');

  const ok = await waitFor(() => env.requestLog.length >= 2);
  assert.ok(ok, '应至少发起 2 个图标请求');
  assert.equal(env.requestLog.length, 2, `同域名应复用解析结果（实际 ${env.requestLog.length} 个请求）`);

  const imgs = list.children.map(link => link.children[0]);
  assert.deepEqual(imgs.map(i => i.src), [
    'https://github.com/apple-touch-icon.png',
    'https://github.com/apple-touch-icon.png',
    'https://github.com/apple-touch-icon.png',
    'https://mp.weixin.qq.com/apple-touch-icon.png',
  ], '三条 github 记录应共用同一个图标地址');
});

test('history：limit 传给浏览器（maxResults），列表不超过该条数', () => {
  const env = installEnv();
  env.setHistory([
    { url: 'https://a1.com/', title: '1', lastVisitTime: Date.now() },
    { url: 'https://a2.com/', title: '2', lastVisitTime: Date.now() },
    { url: 'https://a3.com/', title: '3', lastVisitTime: Date.now() },
  ]);
  const w = Widgets.get('history');
  const body = makeEl();
  w.render(body, { type: 'history', limit: 2 }, { save: async () => {}, editMode: () => false });
  assert.equal(env.lastHistoryQuery.maxResults, 2, '应向 chrome.history.search 传 maxResults');
  const list = body.children.find(c => c.classList.contains('history-list'));
  assert.equal(list.children.length, 2, 'limit=2 时只应渲染 2 条');
});

test('history：无历史时的空状态', () => {
  const env = installEnv();
  env.setHistory([]);
  const w = Widgets.get('history');
  const body = makeEl();
  w.render(body, { type: 'history' }, { save: async () => {}, editMode: () => false });
  const list = body.children.find(c => c.classList.contains('history-list'));
  assert.match(list.innerHTML, /暂无历史记录/);
});

test('getDomain：保留端口号，不同端口不共用图标缓存', () => {
  assert.equal(core.getDomain('https://github.com/a'), 'github.com');
  assert.equal(core.getDomain('http://localhost:3000/x'), 'localhost:3000');
  assert.equal(core.getDomain('https://example.com:8443/'), 'example.com:8443');
  assert.equal(core.getDomain('https://example.com:443/'), 'example.com', '默认端口应被规范化掉');
  assert.equal(core.getDomain('不是网址'), '');
});

test('weather：默认配置不预填城市（定位失败不会被静默换成北京）', async () => {
  const { defaultSites } = await import('../js/presets.js');
  const entry = Widgets.get('weather').createEntry();
  assert.equal(entry.mode, 'auto');
  assert.equal(entry.city, undefined, 'createEntry 不应带默认城市');
  const preset = defaultSites.find(s => s.type === 'weather');
  assert.ok(preset, '默认布局应含天气卡片');
  assert.equal(preset.city, undefined, '预设布局不应带默认城市');
});

test('weather：定位失败且用户没配置城市 → 提示重试，且不写入坐标', async () => {
  installEnv();                             // 模拟 navigator.geolocation 不可用
  const w = Widgets.get('weather');
  const entry = w.createEntry();
  const body = makeEl();
  w.render(body, entry, { entry, index: 0, save: async () => {}, editMode: () => false, render() {} });

  const ok = await waitFor(() => body.children.some(c => /定位失败/.test(c.textContent)));
  assert.ok(ok, '应显示「定位失败 · 点击重试」');
  assert.equal(entry.lat, undefined, '定位失败不应留下坐标');
});

test('weather：城市名按纯文本渲染，不会被当成 HTML 解析', async () => {
  installEnv();
  const w = Widgets.get('weather');
  const payload = '<img src=x onerror=alert(1)>';
  // manual + _geoCity 与 city 一致 → 跳过地理编码，直接走「取天气 → 渲染」
  const entry = { type: 'weather', mode: 'manual', city: 'x', unit: 'c', lat: 1, lon: 2, _geoCity: 'x', cityName: payload, w: 2 };
  const body = makeEl();
  w.render(body, entry, { entry, index: 0, save: async () => {}, editMode: () => false, render() {} });

  const ok = await waitFor(() => body.children.some(c => c.classList.contains('weather-info')));
  assert.ok(ok, '应渲染出 weather-info');
  const city = body.children.find(c => c.classList.contains('weather-info')).children[0];
  assert.equal(city.textContent, payload, '城市名应原样作为文本');
  assert.equal(city.innerHTML, '', '城市节点不应写入 innerHTML');
});

test('history：标题按纯文本渲染（含 HTML 字符也不解析）', () => {
  const env = installEnv();
  env.setHistory([]);
  const w = Widgets.get('history');
  const body = makeEl();
  w.render(body, { type: 'history', name: '<b>x</b>', limit: 8 }, { save: async () => {}, editMode: () => false });

  const header = body.children.find(c => c.classList.contains('widget-header'));
  const title = header.children.find(c => c.tag === 'span');
  assert.ok(title, '标题应是独立节点');
  assert.equal(title.textContent, '<b>x</b>', '标题应原样作为文本');
});
