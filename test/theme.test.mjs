// ============================================================
//  主题（浅色 / 深色 / 跟随系统）测试
//  ──────────────────────────────────────────────────────────
//  覆盖：默认值、显式选择、持久化、非法值回退、
//        「跟随系统」时实时响应系统切换、以及 localStorage 镜像
//        （镜像用于首屏内联脚本，避免加载时闪一下浅色）
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, waitFor } from './helpers.mjs';

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

test('工具栏按钮：标题与图标随状态变化，点击循环 跟随系统 → 浅色 → 深色', async () => {
  const env = installEnv();
  const btn = env.documentEl.getEl('#themeBtn');
  const icon = env.documentEl.getEl('#themeIcon');
  await core.initApp();

  assert.match(btn.title, /跟随系统/, '初始应显示「跟随系统」');

  btn.fire('click');
  assert.match(btn.title, /浅色/);
  assert.equal(themeAttr(), 'light');
  const iconAfterFirst = icon.innerHTML;

  btn.fire('click');
  assert.match(btn.title, /深色/);
  assert.equal(themeAttr(), 'dark');
  assert.notEqual(icon.innerHTML, iconAfterFirst, '图标应随状态变化');

  btn.fire('click');
  assert.match(btn.title, /跟随系统/, '第三次点击应回到「跟随系统」');
});
