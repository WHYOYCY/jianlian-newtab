// ============================================================
//  图标服务测试（js/icons.js）
//  ──────────────────────────────────────────────────────────
//  覆盖：候选链抓取、会话备忘、storage.local 持久缓存、失败重试语义、
//        并发去重、缓存失效、以及「shortcut 与 history 共享同一份缓存」
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, wait } from './helpers.mjs';

// 每个用例用独立域名，避免模块内的会话备忘录互相影响
const D = (n) => `t${n}.example.com`;

test('候选链：前两个地址不存在时，会用第三个并写入本地缓存', async () => {
  const d = D(1);
  const env = installEnv({ available: [`https://${d}/favicon-32x32.png`] });
  const { getIcon } = await import('../js/icons.js');

  const src = await getIcon(d);
  assert.equal(src, `https://${d}/favicon-32x32.png`, '应回退到第三个候选');
  assert.equal(env.requestLog.length, 3, '应依次尝试 3 个地址');
  assert.equal(env.store.local['icon:' + d].src, src, '结果应写入 storage.local');
});

test('会话备忘：同一域名第二次调用不再发请求', async () => {
  const d = D(2);
  const env = installEnv({ available: [`https://${d}/favicon.ico`] });
  const { getIcon } = await import('../js/icons.js');

  await getIcon(d);
  const afterFirst = env.requestLog.length;
  await getIcon(d);
  assert.equal(env.requestLog.length, afterFirst, '第二次不应再发请求（命中会话备忘）');
});

test('持久缓存：storage.local 命中时零网络请求', async () => {
  const d = D(3);
  const env = installEnv({ local: { ['icon:' + d]: { src: `https://${d}/apple-touch-icon.png`, at: Date.now() } } });
  const { getIcon } = await import('../js/icons.js');

  const src = await getIcon(d);
  assert.equal(src, `https://${d}/apple-touch-icon.png`);
  assert.equal(env.requestLog.length, 0, '命中持久缓存不应发请求');
});

test('全部失败：返回 null、不写持久状态、同会话内不重复尝试', async () => {
  const d = D(4);
  const env = installEnv({ available: [] });          // 服务器上什么都没有
  const { getIcon } = await import('../js/icons.js');

  assert.equal(await getIcon(d), null);
  assert.equal(env.requestLog.length, 5, '应把所有候选试完');
  assert.equal(env.store.local['icon:' + d], undefined, '失败不应写缓存（下次打开要重试）');

  await getIcon(d);
  assert.equal(env.requestLog.length, 5, '同会话内已确认失败 → 不再尝试');
});

test('并发去重：同域名同时请求只走一遍候选链', async () => {
  const d = D(5);
  const env = installEnv({ available: [`https://${d}/favicon.png`] });
  const { getIcon } = await import('../js/icons.js');

  const [a, b, c] = await Promise.all([getIcon(d), getIcon(d), getIcon(d)]);
  assert.equal(a, b);
  assert.equal(b, c);
  // favicon.png 是第 4 个候选 → 只跑一条链共 4 个请求（否则会是 3×4=12）
  assert.equal(env.requestLog.length, 4, '三次并发只应跑一遍候选链');
});

test('缓存失效：invalidateIcon 后重新抓取并更新缓存', async () => {
  const d = D(6);
  const oldSrc = `https://${d}/favicon.ico`;
  const env = installEnv({
    local: { ['icon:' + d]: { src: oldSrc, at: Date.now() - 86400000 } },
    available: [`https://${d}/apple-touch-icon.png`, oldSrc],
  });
  const { getIcon, invalidateIcon, readCachedIcon } = await import('../js/icons.js');

  assert.equal(await getIcon(d), oldSrc, '先命中旧缓存');

  invalidateIcon(d);
  assert.equal(await readCachedIcon(d), '', '失效后本地缓存应被清除');

  const fresh = await getIcon(d);
  assert.equal(fresh, `https://${d}/apple-touch-icon.png`, '重新抓取应拿到优先级更高的地址');
  assert.equal(env.store.local['icon:' + d].src, fresh, '缓存应被更新');
});

test('共享缓存：history 与 shortcut 用同一份数据，同域名只抓一次', async () => {
  const d = D(7);
  const env = installEnv({ available: [`https://${d}/favicon.ico`] });
  const { getIcon } = await import('../js/icons.js');

  // 先模拟快捷卡片抓一次
  await getIcon(d);
  const n = env.requestLog.length;
  assert.ok(n > 0);

  // 再模拟历史列表里的 3 条同域名记录
  const results = await Promise.all([getIcon(d), getIcon(d), getIcon(d)]);
  assert.deepEqual(results, [results[0], results[0], results[0]]);
  assert.equal(env.requestLog.length, n, '历史列表不应产生额外请求（共享缓存）');
});

test('缓存写入失败：不影响图标返回，也不产生未处理的 Promise 错误', async () => {
  const d = D(8);
  // localStorage 不可写（隐私模式 / 配额满）——Store.localSet 会 reject
  installEnv({ failLocal: true, available: [`https://${d}/favicon.ico`] });
  const { getIcon } = await import('../js/icons.js');

  const rejections = [];
  const onRej = (e) => rejections.push(e);
  process.on('unhandledRejection', onRej);
  try {
    const src = await getIcon(d);
    assert.equal(src, `https://${d}/favicon.ico`, '缓存写失败也应正常返回图标地址');
    await wait(50);                       // 给潜在的 rejection 一个触发窗口
  } finally {
    process.off('unhandledRejection', onRej);
  }
  assert.equal(rejections.length, 0, '缓存写入失败不应冒泡为未处理的 Promise 错误');
});
