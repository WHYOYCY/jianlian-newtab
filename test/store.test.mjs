// ============================================================
//  存储层测试（js/core.js 的数据包 / 迁移 / 配额降级 / 多设备）
//  ──────────────────────────────────────────────────────────
//  这里把之前踩过的坑全部固化为断言，防止回归：
//    · sites 存在 sync 时会被「单 key 8KB」卡死 → 改为 local 主存储
//    · 数据源来自云端时忘记回写本地 → 云端不可用就回退到旧数据
//    · 本地写失败还去清理旧 key → 数据直接丢
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, wait, waitFor } from './helpers.mjs';

// core.js 是单例模块，用「多次 initApp」模拟反复打开新标签页
const core = await import('../js/core.js');
await import('../js/widgets/shortcut.js');
await import('../js/widgets/history.js');
await import('../js/widgets/clock.js');
await import('../js/widgets/weather.js');

const names = () => core.getSites().map(s => s.name || s.type);
const has = (name) => names().includes(name);

test('全新用户：写入默认布局并镜像到云端', async () => {
  const env = installEnv();
  await core.initApp();
  assert.ok(core.getSites().length >= 4, '应有默认卡片');
  assert.ok(env.store.local.data, '应写入本地数据包');
  assert.equal(env.store.local.data.v, 2, '数据包版本应为 2');
  assert.ok(env.store.sync.data, '应镜像到 sync');
  assert.ok(core.getSites().some(s => s.type === 'history'), '默认含历史记录');
  assert.ok(core.getSites().some(s => s.type === 'weather'), '默认含天气');
});

test('v1→v2 迁移：卡片与背景零丢失，旧 key 被清理', async () => {
  const env = installEnv({
    sync: {
      sites: [
        { type: 'history', name: '历史记录', w: 3, h: 2 },
        { type: 'shortcut', name: 'GitHub', url: 'https://github.com', color: '#24292f', label: 'G', w: 1, faviconStatus: 'ok', iconUrl: 'https://github.com/apple-touch-icon.png' },
      ],
      bg: 'https://example.com/wallpaper.jpg',
      hwRemoved: false, widgetsMigrated: true,
    },
  });
  await core.initApp();
  assert.ok(has('GitHub'), '卡片应保留');
  assert.equal(core.getSites().find(s => s.name === 'GitHub').iconUrl, 'https://github.com/apple-touch-icon.png', '图标缓存应保留');
  assert.equal(env.store.local.data.bg, 'https://example.com/wallpaper.jpg', '背景应迁移');
  assert.ok(!('sites' in env.store.sync), '旧 key 应被清理');
  assert.ok(env.store.sync.data, '应写入新格式镜像');
});

test('二次打开：无变化时不写存储', async () => {
  const env = installEnv({
    local: { data: { v: 2, at: Date.now(), sites: [{ type: 'shortcut', name: 'A', url: 'https://a.com', color: '#111', label: 'A', w: 1 }], bg: '', hwRemoved: true, widgetsMigrated: true } },
  });
  await core.initApp();
  assert.equal(env.counters.localSet, 0, '不应写本地');
  assert.equal(env.counters.syncSet, 0, '不应写云端');
});

test('配置超 8KB：本地完整保存，云端优雅跳过并提示', async () => {
  const env = installEnv({
    sync: { sites: [{ type: 'shortcut', name: '旧', url: 'https://old.com', color: '#111', label: '旧', w: 1 }], bg: '', hwRemoved: false, widgetsMigrated: true },
  });
  await core.initApp();
  const before = core.getSites().length;
  for (let i = 0; i < 45; i++) {
    core.getSites().push({ type: 'shortcut', name: '站点' + i, url: `https://site${i}.example.com`, color: '#123456', label: 'S' + i, w: 1, faviconStatus: 'ok', iconUrl: `https://site${i}.example.com/apple-touch-icon.png` });
  }
  await core.flushSaveNow();
  const sizeKB = JSON.stringify(env.store.local.data).length / 1024;
  assert.ok(sizeKB > 8, `数据应超过 8KB（实际 ${sizeKB.toFixed(2)}KB）`);
  assert.equal(env.store.local.data.sites.length, before + 45, '本地应完整保存全部卡片');
  assert.ok(env.tipTexts().some(t => t.includes('配置较大')), '应提示用户云端同步已暂停');

  // 关键：超限状态下继续修改，重开不丢
  const n = core.getSites().length;
  core.getSites().push({ type: 'shortcut', name: '新增', url: 'https://new.example.com', color: '#abc', label: '新', w: 1 });
  await core.flushSaveNow();
  await core.initApp();
  assert.equal(core.getSites().length, n + 1, '超 8KB 配置下的改动不应丢失');
});

test('多设备：云端较新时采用云端并回写本地', async () => {
  const env = installEnv({
    local: { data: { v: 2, at: 1000, sites: [{ type: 'history', name: '历史记录', w: 3, h: 2 }, { type: 'shortcut', name: '本机旧', url: 'https://o.com', color: '#111', label: '旧', w: 1 }], bg: '', hwRemoved: false, widgetsMigrated: true } },
    sync: { data: { v: 2, at: 2000, sites: [{ type: 'history', name: '历史记录', w: 3, h: 2 }, { type: 'shortcut', name: '云端新', url: 'https://a.com', color: '#222', label: '新', w: 1 }], bg: '', hwRemoved: false, widgetsMigrated: true } },
  });
  await core.initApp();
  assert.ok(has('云端新'), '应采用云端数据');
  assert.ok(!has('本机旧'), '本机旧数据应被覆盖');
  assert.ok(env.store.local.data.at > 2000, '应回写本地，让本地成为主副本');

  // 云端随后不可用，本地仍能用
  env.resync({});
  await core.initApp();
  assert.ok(has('云端新'), '云端不可用时仍应从本地读到最新数据');
});

test('本机较新：不会被云端旧数据回退', async () => {
  installEnv({
    local: { data: { v: 2, at: Date.now() + 1e6, sites: [{ type: 'history', name: '历史记录', w: 3, h: 2 }, { type: 'shortcut', name: '本机新', url: 'https://m.com', color: '#111', label: '本', w: 1 }], bg: '', hwRemoved: false, widgetsMigrated: true } },
    sync: { data: { v: 2, at: Date.now(), sites: [{ type: 'history', name: '历史记录', w: 3, h: 2 }, { type: 'shortcut', name: '云端旧', url: 'https://c.com', color: '#222', label: '云', w: 1 }], bg: '', hwRemoved: false, widgetsMigrated: true } },
  });
  await core.initApp();
  assert.ok(has('本机新'), '应使用本机较新的数据');
  assert.ok(!has('云端旧'), '不应被云端旧数据覆盖');
});

test('本地写入失败：加载照常、且不清理旧格式数据（避免丢数据）', async () => {
  const env = installEnv({
    sync: { sites: [{ type: 'shortcut', name: '宝贵数据', url: 'https://p.com', color: '#111', label: '宝', w: 1 }], bg: '', hwRemoved: true, widgetsMigrated: true },
    failLocal: true,
  });
  await core.initApp();
  assert.ok(has('宝贵数据'), '数据仍应加载');
  assert.ok('sites' in env.store.sync, '本地写失败时不应清理旧 key（否则数据无处可寻）');
});

test('搜索引擎：持久化、非法值回退、旧数据无字段时用默认', async () => {
  const env = installEnv();
  await core.initApp();
  assert.ok(core.searchUrl('x').startsWith('https://www.baidu.com'), '默认百度');

  core.setEngine('google');
  assert.ok(await waitFor(() => env.store.local.data?.engine === 'google'), '选择应在防抖后落盘');
  assert.ok(core.searchUrl('x').startsWith('https://www.google.com'));

  await core.initApp();
  assert.ok(core.searchUrl('x').startsWith('https://www.google.com'), '重开应记住选择');

  env.relocal({ data: { ...env.store.local.data, engine: 'evil' } });
  await core.initApp();
  assert.ok(core.searchUrl('x').startsWith('https://www.baidu.com'), '非法值应回退到百度');
});

test('历史记录组件：缺失时自动补回，用户主动删除后不再补', async () => {
  const env = installEnv({
    local: { data: { v: 2, at: Date.now(), sites: [{ type: 'shortcut', name: 'A', url: 'https://a.com', color: '#111', label: 'A', w: 1 }], bg: '', hwRemoved: false, widgetsMigrated: true } },
  });
  await core.initApp();
  assert.ok(has('历史记录'), '未主动删除时自动补回');

  // 模拟用户点删除按钮（会把 hwRemoved 置为 true）
  env.relocal({ data: { v: 2, at: Date.now() + 10, sites: [{ type: 'shortcut', name: 'A', url: 'https://a.com', color: '#111', label: 'A', w: 1 }], bg: '', hwRemoved: true, widgetsMigrated: true } });
  await core.initApp();
  assert.ok(!has('历史记录'), '用户主动删除后不应再补回');
});
