// ============================================================
//  主题（浅色 / 深色 / 跟随系统）测试
//  ──────────────────────────────────────────────────────────
//  覆盖：默认值、显式选择、持久化、非法值回退、
//        「跟随系统」时实时响应系统切换、以及 localStorage 镜像
//        （镜像用于首屏内联脚本，避免加载时闪一下浅色）
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, makeEl, waitFor } from './helpers.mjs';

const core = await import('../js/core.js');
await import('../js/widgets/shortcut.js');
await import('../js/widgets/history.js');
await import('../js/widgets/clock.js');
await import('../js/widgets/weather.js');

const themeAttr = () => globalThis.document.documentElement.dataset.theme;

test('默认「跟随系统」：系统浅色 → light，系统深色 → dark', async () => {
  installEnv({ prefersDark: false });
  await core.initApp();
  assert.equal(themeAttr(), 'light', '系统浅色时应为 light');

  installEnv({ prefersDark: true });
  await core.initApp();
  assert.equal(themeAttr(), 'dark', '系统深色时应为 dark');
});

test('显式选择深色：写入 DOM、镜像到 localStorage、并落盘', async () => {
  const env = installEnv({ prefersDark: false });
  await core.initApp();
  core.setTheme('dark');

  assert.equal(themeAttr(), 'dark', '应切换为深色');
  assert.equal(globalThis.localStorage.getItem('theme'), 'dark', '应写 localStorage 镜像（供首屏使用）');
  assert.ok(await waitFor(() => env.store.local.data?.theme === 'dark'), '应持久化到数据包');
});

test('重开标签页记住选择', async () => {
  const env = installEnv();
  await core.initApp();
  core.setTheme('light');
  await waitFor(() => env.store.local.data?.theme === 'light');

  // 模拟重开：同一份存储，系统偏好相反也不应影响用户选择
  env.setSystemDark(true);
  await core.initApp();
  assert.equal(themeAttr(), 'light', '用户显式选浅色时不应跟随系统');
});

test('非法主题值回退为「跟随系统」', async () => {
  const env = installEnv({ prefersDark: true });
  await core.initApp();
  env.relocal({ data: { ...env.store.local.data, theme: 'neon' } });
  await core.initApp();
  assert.equal(themeAttr(), 'dark', '非法值应回退 auto（系统深色 → dark）');
});

test('跟随系统时，系统切换会实时生效', async () => {
  const env = installEnv({ prefersDark: false });
  await core.initApp();
  assert.equal(themeAttr(), 'light');

  env.setSystemDark(true);
  await waitFor(() => themeAttr() === 'dark');
  assert.equal(themeAttr(), 'dark', '系统切到深色应自动跟随');

  env.setSystemDark(false);
  await waitFor(() => themeAttr() === 'light');
  assert.equal(themeAttr(), 'light', '系统切回浅色应自动跟随');
});

test('非「跟随系统」时，系统切换不影响用户选择', async () => {
  const env = installEnv({ prefersDark: false });
  await core.initApp();
  core.setTheme('dark');
  assert.equal(themeAttr(), 'dark');

  env.setSystemDark(false);
  await waitFor(() => false, { timeout: 120 });     // 给潜在的错误监听一点时间
  assert.equal(themeAttr(), 'dark', '用户显式选深色时不应被系统设置覆盖');
});

test('工具栏按钮：白天/黑夜互换，第一次点击就必须真的变（不会空点）', async () => {
  const env = installEnv({ prefersDark: false });      // 系统浅色 —— 旧版在这里会「点了没反应」
  const btn = env.documentEl.getEl('#themeBtn');
  const icon = env.documentEl.getEl('#themeIcon');
  await core.initApp();

  assert.equal(themeAttr(), 'light', '跟随系统 + 系统浅色 → light');
  assert.match(btn.title, /浅色/, '标题应写明当前是浅色');
  assert.match(btn.title, /跟随系统/, '跟随系统时应标注来源');

  btn.fire('click');
  assert.equal(themeAttr(), 'dark', '第一次点击就必须切到深色');
  assert.match(btn.title, /深色/, '标题应更新为深色');
  const iconAfterFirst = icon.innerHTML;

  btn.fire('click');
  assert.equal(themeAttr(), 'light', '再点一次应回到浅色');
  assert.notEqual(icon.innerHTML, iconAfterFirst, '图标应随状态变化');
});

test('系统深色时，主题按钮同样能切到浅色', async () => {
  const env = installEnv({ prefersDark: true });
  const btn = env.documentEl.getEl('#themeBtn');
  await core.initApp();
  assert.equal(themeAttr(), 'dark');

  btn.fire('click');
  assert.equal(themeAttr(), 'light');
});

test('设置弹窗：主题可选「跟随系统 / 浅色 / 深色」，选完回到实时跟随系统', async () => {
  const env = installEnv({ prefersDark: false });
  // 模拟弹窗里的三个分段按钮（假 DOM 的 querySelectorAll 需要预置）
  const seg = ['auto', 'light', 'dark'].map(mode => {
    const b = makeEl('button');
    b.dataset.themeMode = mode;
    return b;
  });
  env.documentEl._els['#themeSeg button:all'] = seg;
  await core.initApp();

  assert.ok(seg[0].classList.contains('active'), '初始应高亮「跟随系统」');

  seg[2].fire('click');
  assert.equal(themeAttr(), 'dark', '选深色应立刻生效');
  assert.ok(seg[2].classList.contains('active'), '应高亮深色');
  assert.ok(!seg[0].classList.contains('active'), '「跟随系统」不应再高亮');

  env.setSystemDark(true);
  seg[0].fire('click');
  assert.equal(themeAttr(), 'dark', '选「跟随系统」后按系统解析（系统深色 → dark）');

  env.setSystemDark(false);
  assert.ok(await waitFor(() => themeAttr() === 'light'), '之后系统切换应实时跟随');
});
