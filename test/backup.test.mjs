// ============================================================
//  配置导出 / 导入测试
//  ──────────────────────────────────────────────────────────
//  覆盖：导出内容完整可解析、导入替换全部设置并落盘、
//        用户取消不改变数据、坏文件报错且不破坏现有数据
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, waitFor } from './helpers.mjs';

const core = await import('../js/core.js');
await import('../js/widgets/shortcut.js');
await import('../js/widgets/history.js');
await import('../js/widgets/clock.js');
await import('../js/widgets/weather.js');

const names = () => core.getSites().map(s => s.name || s.type);

// 触发一次导出（走真实的按钮点击路径）
function clickExport(env) {
  env.documentEl.getEl('#btnExport').fire('click');
}

// 触发一次导入
async function doImport(env, file) {
  const input = env.documentEl.getEl('#importFile');
  input.files = [file];
  await input.fire('change');
  await waitFor(() => true, { timeout: 60 });   // 让异步导入有机会跑完
}

test('导出：生成可解析的 JSON，字段与数据包一致', async () => {
  const env = installEnv();
  await core.initApp();
  core.setEngine('bing');
  core.setTheme('dark');
  await core.flushSaveNow();

  clickExport(env);
  assert.equal(env.blobs.length, 1, '应创建一次下载 Blob');

  const json = JSON.parse(env.blobs[0].parts[0]);
  assert.equal(env.blobs[0].type, 'application/json');
  for (const k of ['v', 'at', 'sites', 'bg', 'hwRemoved', 'widgetsMigrated', 'engine', 'theme']) {
    assert.ok(k in json, `导出内容应包含 ${k}`);
  }
  assert.equal(json.engine, 'bing');
  assert.equal(json.theme, 'dark');
  assert.equal(json.sites.length, core.getSites().length);

  const a = env.anchors.at(-1);
  assert.match(a.download, /^jianlian-newtab-\d{8}\.json$/, '文件名应含日期');
  assert.ok(a._clicked, '应触发下载点击');
});

test('导入：替换卡片与全部设置并落盘', async () => {
  const env = installEnv();
  await core.initApp();
  const before = core.getSites().length;

  const payload = {
    v: 2, at: Date.now(),
    sites: [
      { type: 'history', name: '历史记录', w: 3, h: 2 },
      { type: 'shortcut', name: '导入站A', url: 'https://a.example.com', color: '#111', label: 'A', w: 1 },
      { type: 'shortcut', name: '导入站B', url: 'https://b.example.com', color: '#222', label: 'B', w: 2 },
    ],
    bg: 'https://example.com/imported.jpg',
    hwRemoved: false, widgetsMigrated: true,
    engine: 'google', theme: 'dark',
  };

  await doImport(env, env.makeFile(JSON.stringify(payload)));
  await waitFor(() => env.store.local.data?.bg === 'https://example.com/imported.jpg');

  assert.equal(core.getSites().length, 3, `卡片应被替换（原先 ${before} 张）`);
  assert.ok(names().includes('导入站A'));
  assert.ok(names().includes('导入站B'));
  assert.equal(env.store.local.data.engine, 'google');
  assert.equal(env.store.local.data.theme, 'dark');
  assert.equal(globalThis.document.documentElement.dataset.theme, 'dark', '主题应立即生效');
  assert.ok(core.searchUrl('x').startsWith('https://www.google.com'), '搜索引擎应立即生效');
  assert.equal(env.confirmCalls.length, 1, '应弹一次确认');
});

test('导入：用户取消时不改变任何数据', async () => {
  const env = installEnv();
  await core.initApp();
  const snapshot = JSON.stringify(core.getSites());

  env.setConfirm(false);
  await doImport(env, env.makeFile(JSON.stringify({
    sites: [{ type: 'shortcut', name: '不该出现', url: 'https://nope.com', color: '#111', label: '不', w: 1 }],
  })));

  assert.equal(JSON.stringify(core.getSites()), snapshot, '取消后数据应保持原样');
  assert.ok(!names().includes('不该出现'));
});

test('导入：坏文件报错且不影响现有数据', async () => {
  const env = installEnv();
  await core.initApp();
  const snapshot = JSON.stringify(core.getSites());

  await doImport(env, env.makeFile('{ 这不是 JSON'));
  assert.ok(env.tipTexts().some(t => t.includes('导入失败')), '应提示导入失败');
  assert.equal(JSON.stringify(core.getSites()), snapshot, '数据不应被破坏');

  // 合法 JSON 但没有卡片数据
  env.setConfirm(true);
  await doImport(env, env.makeFile(JSON.stringify({ foo: 1 })));
  assert.equal(JSON.stringify(core.getSites()), snapshot, '缺少 sites 时也不应改动数据');
});

test('导入：非法 engine/theme 回退为默认值', async () => {
  const env = installEnv();
  await core.initApp();

  await doImport(env, env.makeFile(JSON.stringify({
    sites: [{ type: 'shortcut', name: 'X', url: 'https://x.com', color: '#111', label: 'X', w: 1 }],
    engine: 'evil-search', theme: 'neon',
  })));
  await waitFor(() => core.getSites().length === 1);

  assert.ok(core.searchUrl('q').startsWith('https://www.baidu.com'), '非法引擎应回退百度');
  assert.equal(env.store.local.data.theme, 'auto', '非法主题应回退 auto');
});
