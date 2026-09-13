// ============================================================
//  Widget: weather —— 天气小组件（自动定位 / 手动城市双模式）
//  ──────────────────────────────────────────────────────────
//  位置来源：
//   · auto（默认）—— navigator.geolocation 定位 → open-meteo 按经纬度查天气
//                     → BigDataCloud（免费无 key）反查城市名
//   · manual —— 城市名 → open-meteo geocoding → 经纬度 → 天气
//  缓存 20 分钟写入 entry；点击卡片强制刷新（重新定位 + 重新请求）。
//  依赖 core.js「先挂 DOM 再 render」的约定 —— 异步完成后用
//  body.isConnected 判断卡片是否还在，决定是否更新 DOM。
// ============================================================
import { Widgets, el, Store } from '../core.js';

// WMO weather code → 图标 + 中文描述
function describe(code) {
  if (code === 0)  return { icon: '☀️', text: '晴' };
  if (code <= 2)   return { icon: '🌤️', text: '少云' };
  if (code === 3)  return { icon: '☁️', text: '阴' };
  if (code <= 48)  return { icon: '🌫️', text: '雾' };
  if (code <= 57)  return { icon: '🌦️', text: '毛毛雨' };
  if (code <= 67)  return { icon: '🌧️', text: '雨' };
  if (code <= 77)  return { icon: '❄️', text: '雪' };
  if (code <= 82)  return { icon: '🌧️', text: '阵雨' };
  if (code <= 86)  return { icon: '🌨️', text: '阵雪' };
  if (code >= 95)  return { icon: '⛈️', text: '雷暴' };
  return { icon: '🌡️', text: '未知' };
}

function cityLabel(entry) {
  if (entry.cityName) return entry.cityName;
  if (entry.mode === 'auto') return '📍 当前位置';
  return entry.city || '未知';
}

function show(body, entry, cur) {
  const d = describe(cur.weather_code);
  const temp = Math.round(cur.temperature_2m);
  const unitSym = entry.unit === 'f' ? '°F' : '°C';
  const windSym = entry.unit === 'f' ? 'mph' : 'km/h';
  body.innerHTML = '';
  body.appendChild(el('div', 'weather-main', {
    html: `<span class="weather-icon">${d.icon}</span>`
          + `<span class="weather-temp">${temp}<span class="weather-unit">${unitSym}</span></span>`
  }));
  body.appendChild(el('div', 'weather-info', {
    html: `<div class="weather-city">${cityLabel(entry)}</div>`
          + `<div class="weather-desc">${d.text} · ${Math.round(cur.wind_speed_10m)} ${windSym}</div>`
  }));
}

function showMsg(body, msg) {
  body.innerHTML = '';
  body.appendChild(el('div', 'weather-loading', { text: msg }));
}

// ---------- 定位 ----------
function locate() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) { rej(new Error('定位失败')); return; }
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => rej(new Error('定位失败')),
      { timeout: 8000, maximumAge: 10 * 60 * 1000 }   // 8 秒超时，10 分钟内复用浏览器缓存位置
    );
  });
}

// 经纬度 → 城市名（BigDataCloud 反查，失败返回空串，不阻断主流程）
async function reverseCity(lat, lon) {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`
    ).then(r => r.json());
    return [r.city, r.locality, r.principalSubdivision].find(Boolean) || '';
  } catch { return ''; }
}

// 城市名 → 经纬度（open-meteo geocoding）
async function geocodeCity(entry) {
  const g = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(entry.city)}&count=1&language=zh&format=json`
  ).then(r => r.json());
  if (!g.results || !g.results.length) throw new Error('城市未找到');
  const r0 = g.results[0];
  entry.lat = r0.latitude;
  entry.lon = r0.longitude;
  entry.cityName = r0.name + (r0.admin1 ? ' · ' + r0.admin1 : '');
  entry._geoCity = entry.city;
}

async function fetchWeather(lat, lon, unit) {
  const unitParam = unit === 'f' ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '';
  return fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto${unitParam}`
  ).then(r => r.json());
}

// ---------- 本地缓存（storage.local）----------
// 为什么不存 entry：entry 在 chrome.storage.sync 里，单 key 上限 8KB 且写入有频率限制，
// 天气缓存又大又频繁变动，存那里既占配额又容易丢。storage.local 有 5MB 且无频率限制。
const CACHE_TTL = 20 * 60 * 1000;
const cacheKey = (e) => `weather:${e.lat},${e.lon},${e.unit || 'c'}`;

async function readWeatherCache(entry) {
  try {
    const k = cacheKey(entry);
    const r = await Store.localGet(k);
    const c = r && r[k];
    if (c && c.data && (Date.now() - c.at) < CACHE_TTL) return c.data;
    return null;
  } catch { return null; }
}

function writeWeatherCache(entry, data) {
  try { Store.localSet({ [cacheKey(entry)]: { data, at: Date.now() } }); } catch {}
}

// 确定经纬度：auto 定位（失败且有手动城市则降级），manual 按城市解析
// 返回是否发生了变化（变了才需要写回 entry，减少 sync 写入）
async function resolveLocation(entry, force) {
  const before = `${entry.lat},${entry.lon},${entry.cityName || ''}`;
  if (entry.mode === 'manual') {
    if (entry.lat == null || entry._geoCity !== entry.city) await geocodeCity(entry);
  } else {
    // auto
    if (force || entry.lat == null) {
      try {
        const pos = await locate();
        entry.lat = pos.lat;
        entry.lon = pos.lon;
        const city = await reverseCity(pos.lat, pos.lon);
        if (city) entry.cityName = city;
      } catch {
        // 定位失败 → 若配置过手动城市则降级，否则抛错
        if (entry.city && entry.lat == null) {
          await geocodeCity(entry);
        } else {
          throw new Error('定位失败');
        }
      }
    }
  }
  return before !== `${entry.lat},${entry.lon},${entry.cityName || ''}`;
}

async function load(body, entry, ctx, force = false) {
  if (body.__loading) return;                      // 防连点并发
  body.__loading = true;
  try {
    // 旧版本把天气缓存写在 entry(sync) 里，现已改存 storage.local → 顺手清理释放配额
    if (entry.cached || entry.cachedAt) {
      delete entry.cached; delete entry.cachedAt; ctx.save();
    }

    // 位置已知且非强制刷新 → 先看本地缓存（零网络）
    if (!force && entry.lat != null) {
      const hit = await readWeatherCache(entry);
      if (hit) { show(body, entry, hit); return; }
    }

    showMsg(body, '加载中…');
    if (await resolveLocation(entry, force)) await ctx.save();   // 坐标变了才写回

    // 位置刚解析出来 → 再试一次本地缓存
    if (!force) {
      const hit = await readWeatherCache(entry);
      if (hit) { if (body.isConnected) show(body, entry, hit); return; }
    }

    const w = await fetchWeather(entry.lat, entry.lon, entry.unit);
    if (!body.isConnected) return;                 // 卡片已删，放弃更新
    writeWeatherCache(entry, w.current);
    show(body, entry, w.current);
  } catch (e) {
    if (!body.isConnected) return;
    const msg = e.message === '城市未找到' ? '城市未找到'
              : e.message === '定位失败'  ? '定位失败 · 点击重试'
              : '加载失败';
    showMsg(body, msg);
  } finally {
    body.__loading = false;
  }
}

Widgets.register({
  id: 'weather',
  name: '天气',
  defaults: { w: 2, h: 1 },
  resizable: false,
  draggable: true,

  match(entry) { return entry.type === 'weather'; },

  createEntry() { return { type: 'weather', mode: 'auto', city: '北京', unit: 'c', w: 2, h: 1 }; },

  render(body, entry, ctx) {
    body.classList.add('weather-body');
    body.title = '点击刷新';
    body.addEventListener('click', () => {
      if (ctx.editMode()) return;                  // 编辑模式下不刷新
      load(body, entry, ctx, true);                // 点击 = 强制刷新（重新定位）
    });
    load(body, entry, ctx);
  },

  editorFields: [
    { key: 'mode', label: '位置', type: 'segmented', default: 'auto',
      options: [{ v: 'auto', t: '📍 自动定位' }, { v: 'manual', t: '✍️ 手动城市' }] },
    { key: 'city', label: '城市', type: 'text', placeholder: '如：北京 / Shanghai', required: true, default: '北京',
      visible: form => form.mode === 'manual' },   // 自动定位模式下隐藏
    { key: 'unit', label: '温度单位', type: 'segmented', default: 'c',
      options: [{ v: 'c', t: '°C' }, { v: 'f', t: '°F' }] },
  ],

  // 模式/城市/单位变了 → 清坐标，触发重新定位或重新解析
  // （天气缓存以 lat/lon/unit 为 key 存在 storage.local，参数一变 key 自然失效，无需手动清理）
  serialize(form, oldEntry) {
    const entry = { ...form };
    delete entry.cached; delete entry.cachedAt;      // 旧字段：不再存进 sync
    if (oldEntry) {
      const changed = form.mode !== oldEntry.mode
                   || form.city !== oldEntry.city
                   || form.unit !== oldEntry.unit;
      if (changed) { entry.lat = null; entry.lon = null; }
    }
    return entry;
  },
});
