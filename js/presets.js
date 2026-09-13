// ============================================================
//  预设数据：默认快捷网址 / 预设背景 / 调色板
//  扩展开发者可自由修改这里的默认值，不影响核心逻辑。
// ============================================================

// 默认快捷网址 —— 每条都带 type 字段，对应 widgets/ 下的 widget id
//   type: 'shortcut' —— 普通网址卡片
//   type: 'history'  —— 历史记录小组件
export const defaultSites = [
  { type: 'history',  name: '历史记录', w: 3, h: 2 },
  { type: 'clock',    name: '时钟',    fmt24: true, showSec: false, w: 2, h: 1 },
  { type: 'weather',  name: '天气',    city: '北京', unit: 'c', w: 2, h: 1 },
  { type: 'shortcut', name: 'GitHub',    url: 'https://github.com',          color: '#24292f', label: 'G',  w: 1 },
  { type: 'shortcut', name: 'YouTube',   url: 'https://youtube.com',         color: '#ff0000', label: 'Y',  w: 1 },
  { type: 'shortcut', name: 'Bilibili',  url: 'https://bilibili.com',        color: '#fb7299', label: 'B',  w: 1 },
  { type: 'shortcut', name: '知乎',      url: 'https://zhihu.com',          color: '#0084ff', label: '知', w: 1 },
  { type: 'shortcut', name: '微博',      url: 'https://weibo.com',          color: '#e6162d', label: '微', w: 1 },
  { type: 'shortcut', name: '淘宝',      url: 'https://taobao.com',         color: '#ff6a00', label: '淘', w: 1 },
  { type: 'shortcut', name: '京东',      url: 'https://jd.com',            color: '#e1251b', label: '京', w: 1 },
  { type: 'shortcut', name: '豆瓣',      url: 'https://douban.com',         color: '#007722', label: '豆', w: 1 },
  { type: 'shortcut', name: 'Stack',     url: 'https://stackoverflow.com',  color: '#f48024', label: 'S',  w: 1 },
  { type: 'shortcut', name: 'ChatGPT',   url: 'https://chat.openai.com',    color: '#10a37f', label: 'A',  w: 1 },
  { type: 'shortcut', name: 'MDN',       url: 'https://developer.mozilla.org', color: '#000000', label: 'M', w: 1 },
  { type: 'shortcut', name: '腾讯网',    url: 'https://qq.com',             color: '#1296db', label: '腾', w: 1 }
];

// 预设背景图
export const presetBgs = [
  { name: '无背景', url: '', thumb: '' },
  { name: '山脉', url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1920&q=80', thumb: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=200&q=70' },
  { name: '海洋', url: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=1920&q=80', thumb: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=200&q=70' },
  { name: '森林', url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1920&q=80', thumb: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=200&q=70' },
  { name: '星空', url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1920&q=80', thumb: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=200&q=70' },
  { name: '日落', url: 'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=1920&q=80', thumb: 'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=200&q=70' },
  { name: '极光', url: 'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=1920&q=80', thumb: 'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=200&q=70' },
  { name: '城市', url: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1920&q=80', thumb: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=200&q=70' },
  { name: '抽象', url: 'https://images.unsplash.com/photo-1554034483-04fda0d3507b?w=1920&q=80', thumb: 'https://images.unsplash.com/photo-1554034483-04fda0d3507b?w=200&q=70' }
];

// 图标配色板
export const colors = [
  '#24292f', '#ff0000', '#fb7299', '#0084ff', '#e6162d',
  '#ff6a00', '#e1251b', '#007722', '#f48024', '#10a37f',
  '#000000', '#1296db', '#8b5cf6', '#ec4899', '#14b8a6'
];
