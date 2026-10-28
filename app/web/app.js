import { evaluateFrameBudget } from './frame-budget.js?v=20261021-perf1';
import { initReleaseMotion, animateMenuOpen, animateMenuClose } from './release-motion.js?v=20261026-performance1';

const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const toastRoot = document.querySelector('#toast-root');

const KIND_NAMES = { ceremony: '典礼', performance: '演出', sports: '体育', custom: '自定义' };
const VERDICT_NAMES = { undecided: '待处理', keep: '保留', reject: '疑似废片', uncertain: '待确认' };
const CHECK_NAMES = {
  focus: '主体失焦或手抖', closed_eye: '闭眼或表情不合适', exposure: '严重过曝或欠曝',
  occlusion: '主体遮挡或重要部分裁切', composition: '构图不好或画面杂乱',
};
const MODE_OPTIONS = { strict: '严格筛选', remind: '只提醒', skip: '不检查' };
const SUGGESTION_NAMES = { keep: '建议保留', reject: '建议排除', uncertain: '待确认' };
const SUGGESTION_SHORT = { keep: '保留', reject: '排除', uncertain: '待确认' };
const JOB_STATUS = {
  queued: '排队中', running: '运行中', pausing: '暂停中', paused: '已暂停',
  done: '已完成', failed: '失败', cancelled: '已取消',
};
const RESULT_NAMES = { ok: '未见明显问题', suspect: '疑似问题', uncertain: '无法确认' };
const STAGE_ORDER = ['activity', 'import', 'rules', 'trial', 'analyze', 'review', 'check', 'export'];
const STEP_LABELS = {
  activity: '活动', import: '导入', rules: '规则', trial: '试筛',
  analyze: '分析', review: '复核', check: '检查', export: '导出',
};
const STEP_ICONS = {
  activity: 'camera', import: 'upload', rules: 'sliders', trial: 'scan',
  analyze: 'layers', review: 'eye', check: 'checklist', export: 'download',
};

const ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5L5 20"/>',
  camera: '<path d="M4 7h3l2-2h6l2 2h3v13H4z"/><circle cx="12" cy="13" r="4"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  arrowLeft: '<path d="M19 12H5m0 0 6-6m-6 6 6 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5"/><path d="M12 17h.01"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v6M14 11v6"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m14 6 4 4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/>',
  alert: '<path d="M12 3 2 21h20z"/><path d="M12 9v5M12 18h.01"/>',
  sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  undo: '<path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5M4 10l5 5" transform="translate(0 -2)"/>',
  arrowRight: '<path d="M5 12h14m0 0-6-6m6 6-6 6"/>',
  upload: '<path d="M12 16V3m0 0-4 4m4-4 4 4M4 15v5h16v-5"/>',
  folderOpen: '<path d="M3 8V5h7l2 2h8v4M3 8h7l2 3h10l-4 9H4L2 9z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  compare: '<rect x="3" y="5" width="7" height="14" rx="1.5"/><rect x="14" y="5" width="7" height="14" rx="1.5"/>',
  scan: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M7 12h10M10 8h4M10 16h4"/>',
  sliders: '<path d="M4 7h8M16 7h4M4 17h3M11 17h9"/><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  checklist: '<path d="M9 6h11M9 12h11M9 18h11M3 6l1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M17 8h1M17 12h1M17 16h1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  save: '<path d="M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m11.5 11.5 9 9M16 16l3-3M18.5 18.5l3-3"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5M7 10.5h7"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 9M4 4v6h6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
};

function icon(name, extraClass = '') {
  const filled = name === 'starFill';
  const path = filled ? ICON_PATHS.star : (ICON_PATHS[name] || '');
  return `<svg class="icon icon-${name} ${extraClass}" viewBox="0 0 24 24" ${filled ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true" focusable="false">${path}</svg>`;
}

/* ---------- 呈现反馈：只作用于用户触发的局部，不追踪照片网格 ---------- */

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const supportsViewTransition = typeof document.startViewTransition === 'function';
const uiAnimations = new WeakMap();
let launchFinished = false;
const LAUNCH_START = performance.now();
const LAUNCH_MIN_MS = 730;
let activeViewTransition = null;

const STYLE_KEY = 'cull-style';
const MOTION_KEY = 'cull-motion';
const DENSITY_KEY = 'cull-density';
const GLASS_KEY = 'cull-glass';
const WALLPAPER_KEY = 'cull-wallpaper';
const AGENT_PERMS_KEY = 'cull-agent-perms';
const CLOSE_MODE_KEY = 'cull-close-mode';
let motionMode = localStorage.getItem(MOTION_KEY) || 'system';
let closeMode = localStorage.getItem(CLOSE_MODE_KEY) === 'background' ? 'background' : 'quit';
const savedStyle = localStorage.getItem(STYLE_KEY);
let styleMode = ['standard', 'liquid'].includes(savedStyle) ? savedStyle : 'liquid';
let densityMode = localStorage.getItem(DENSITY_KEY) || 'comfortable';
let glassPrefs = { opacity: 100, blur: 12, saturate: 110, radius: 14, tint: '#0a1018' };
let wallpaperPrefs = { url: '', name: '', fit: 'cover', blur: 0, dim: 18, kind: 'image', media_url: '', scene_url: '', preview_url: '' };
let agentPermissions = { read: true, write: true, web: true, browser: true };
try {
  const savedGlass = JSON.parse(localStorage.getItem(GLASS_KEY) || 'null');
  if (savedGlass && typeof savedGlass === 'object') glassPrefs = { ...glassPrefs, ...savedGlass };
  const savedWallpaper = JSON.parse(localStorage.getItem(WALLPAPER_KEY) || 'null');
  if (savedWallpaper && typeof savedWallpaper === 'object') wallpaperPrefs = { ...wallpaperPrefs, ...savedWallpaper };
  const savedPerms = JSON.parse(localStorage.getItem(AGENT_PERMS_KEY) || 'null');
  if (savedPerms && typeof savedPerms === 'object') agentPermissions = { ...agentPermissions, ...savedPerms };
} catch (_) {}

function applyGlassPrefs() {
  const root = document.documentElement;
  if (styleMode !== 'liquid') {
    ['--panel-background', '--panel-backdrop', '--control-background', '--tile-background',
      '--field-background', '--r-card', '--r-control', '--button-radius']
      .forEach((name) => root.style.removeProperty(name));
    return;
  }
  const radius = Math.max(0, Math.min(32, Number(glassPrefs.radius) || 14));
  root.style.setProperty('--r-card', `${radius}px`);
  root.style.setProperty('--r-control', `${Math.max(4, radius - 2)}px`);
  root.style.setProperty('--button-radius', `${Math.max(4, radius - 2)}px`);
  const opacity = Math.max(0, Math.min(100, Number(glassPrefs.opacity) || 82));
  const alpha = Math.round((100 - opacity) * 0.55 + 5);
  const alphaSoft = Math.max(2, Math.round(alpha * .55));
  const noTint = String(glassPrefs.tint || '') === 'none';
  const tint = noTint ? '#ffffff' : String(glassPrefs.tint || '#0a1018');
  // Solid tint: a gradient background can be repainted a frame after the blur layer.
  const panelBackground = noTint ? 'transparent' : `color-mix(in srgb, ${tint} ${alpha}%, transparent)`;
  const controlBackground = noTint ? 'transparent' : `color-mix(in srgb, ${tint} ${Math.min(90, alpha + 8)}%, transparent)`;
  const tileBackground = noTint ? 'transparent' : `color-mix(in srgb, ${tint} ${alpha}%, transparent)`;
  root.style.setProperty('--panel-background', panelBackground);
  root.style.setProperty('--control-background', controlBackground);
  root.style.setProperty('--tile-background', tileBackground);
  root.style.setProperty('--field-background', noTint ? 'rgb(255 255 255 / .04)' : `color-mix(in srgb, ${tint} ${Math.min(35, alpha + 4)}%, transparent)`);
  root.style.setProperty('--panel-backdrop',
    `blur(${Math.max(0, Number(glassPrefs.blur) || 0)}px) saturate(${Math.max(80, Number(glassPrefs.saturate) || 110)}%)`);
}

function normalizeSceneUrl(value) {
  if (!value || !String(value).includes('type=scene')) return value || '';
  try {
    const url = new URL(String(value), location.origin);
    url.searchParams.delete('src');
    return url.pathname + url.search;
  } catch (_) {
    return String(value).replace(/[?&]src=[^&]*/g, '');
  }
}

function applyWallpaperPrefs() {
  const root = document.documentElement;
  if (wallpaperPrefs.kind === 'scene') wallpaperPrefs.scene_url = normalizeSceneUrl(wallpaperPrefs.scene_url);
  const layer = document.querySelector('#wallpaper-layer');
  const video = document.querySelector('#wallpaper-video');
  if (!layer) return;
  const hasVideo = !!(wallpaperPrefs.url && wallpaperPrefs.kind === 'video' && wallpaperPrefs.media_url);
  const hasScene = !!(wallpaperPrefs.url && wallpaperPrefs.kind === 'scene' && wallpaperPrefs.scene_url);
  const scene = document.querySelector('#wallpaper-scene');
  if (wallpaperPrefs.url) {
    root.dataset.customWallpaper = '1';
    layer.classList.toggle('has-video', hasVideo);
    layer.classList.toggle('has-scene', hasScene);
    if (hasScene && scene) {
      layer.style.backgroundImage = 'none';
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
      if (scene.getAttribute('src') !== wallpaperPrefs.scene_url) scene.src = wallpaperPrefs.scene_url;
    } else if (hasVideo && video) {
      if (scene) scene.removeAttribute('src');
      layer.style.backgroundImage = 'none';
      if (video.getAttribute('src') !== wallpaperPrefs.media_url) video.src = wallpaperPrefs.media_url;
      video.muted = true;
      video.loop = true;
      video.play().catch(() => {});
    } else {
      if (scene) scene.removeAttribute('src');
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
      layer.style.backgroundImage = `url("${wallpaperPrefs.preview_url || wallpaperPrefs.url}")`;
    }
    layer.style.backgroundSize = wallpaperPrefs.fit === 'contain' ? 'contain' : 'cover';
    layer.style.filter = wallpaperPrefs.blur ? `blur(${wallpaperPrefs.blur}px) saturate(108%)` : 'none';
    layer.style.transform = wallpaperPrefs.blur ? `scale(${Math.min(1.12, 1 + Number(wallpaperPrefs.blur) / 180)})` : 'none';
    layer.style.setProperty('--wallpaper-dim', String(Math.max(0, Math.min(80, Number(wallpaperPrefs.dim) || 0)) / 100));
  } else {
    delete root.dataset.customWallpaper;
    layer.classList.remove('has-video');
    layer.classList.remove('has-scene');
    const scene = document.querySelector('#wallpaper-scene');
    if (scene) scene.removeAttribute('src');
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    layer.style.backgroundImage = 'none';
    layer.style.filter = 'none';
    layer.style.transform = 'none';
    layer.style.setProperty('--wallpaper-dim', '0');
  }
}

function applyAgentPermissions() {
  localStorage.setItem(AGENT_PERMS_KEY, JSON.stringify(agentPermissions));
  persistUiPrefs();
}

function saveGlassPrefs() {
  localStorage.setItem(GLASS_KEY, JSON.stringify(glassPrefs));
  applyGlassPrefs();
  persistUiPrefs();
}

function saveWallpaperPrefs() {
  localStorage.setItem(WALLPAPER_KEY, JSON.stringify(wallpaperPrefs));
  applyWallpaperPrefs();
  persistUiPrefs();
}

function syncCloseModeToDesktop() {
  try {
    if (window.pywebview?.api?.window_action) {
      window.pywebview.api.window_action('set_close_mode', closeMode).catch(() => {});
    }
  } catch (_) {}
}

function applyCloseMode(mode, notify = false) {
  closeMode = mode === 'background' ? 'background' : 'quit';
  localStorage.setItem(CLOSE_MODE_KEY, closeMode);
  persistUiPrefs();
  syncCloseModeToDesktop();
  document.querySelectorAll('[data-close-choice]').forEach((node) => {
    const active = node.dataset.closeChoice === closeMode;
    node.classList.toggle('active', active);
    node.setAttribute('aria-pressed', String(active));
  });
  if (notify) toast(closeMode === 'background' ? '关闭窗口后将留在托盘后台' : '关闭窗口将完全退出程序', 'ok');
}


const UI_PREF_KEYS = ['cull-style', 'cull-theme', 'cull-density', 'cull-motion',
  'cull-glass', 'cull-wallpaper', 'cull-agent-perms', 'cull-shortcuts', 'cull-close-mode'];
let uiPrefsPersistTimer = 0;

function collectUiPrefs() {
  const out = {};
  for (const key of UI_PREF_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

function persistUiPrefs() {
  clearTimeout(uiPrefsPersistTimer);
  uiPrefsPersistTimer = setTimeout(() => {
    try {
      fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: collectUiPrefs() }),
      }).catch(() => {});
    } catch (_) {}
  }, 240);
}

function flushUiPrefs() {
  clearTimeout(uiPrefsPersistTimer);
  try {
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: collectUiPrefs() }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {}
}


const SHORTCUT_KEY = 'cull-shortcuts';
const SHORTCUT_DEFS = [
  ['export', '一键导出当前分类', 'Ctrl+E'],
  ['delete', '一键删除当前分类', 'Delete'],
  ['compare', '对比模式', 'C'],
  ['multi', '多选模式', 'M'],
  ['detail', '展开 / 收起详情', 'D'],
];
const DEFAULT_SHORTCUTS = Object.fromEntries(SHORTCUT_DEFS.map(([key, , value]) => [key, value]));
function normalizeShortcut(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
  const modifiers = [];
  let key = '';
  parts.forEach((part) => {
    const lower = part.toLowerCase();
    if (['ctrl', 'control'].includes(lower)) { if (!modifiers.includes('Ctrl')) modifiers.push('Ctrl'); }
    else if (['alt', 'option'].includes(lower)) { if (!modifiers.includes('Alt')) modifiers.push('Alt'); }
    else if (lower === 'shift') { if (!modifiers.includes('Shift')) modifiers.push('Shift'); }
    else if (['meta', 'cmd', 'win'].includes(lower)) { if (!modifiers.includes('Meta')) modifiers.push('Meta'); }
    else key = part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  });
  return [...modifiers, key].filter(Boolean).join('+');
}
function loadShortcuts() {
  try {
    const stored = JSON.parse(localStorage.getItem(SHORTCUT_KEY) || 'null');
    return { ...DEFAULT_SHORTCUTS, ...(stored && typeof stored === 'object' ? stored : {}) };
  } catch (_) { return { ...DEFAULT_SHORTCUTS }; }
}
let userShortcuts = loadShortcuts();
function saveShortcuts(next) {
  userShortcuts = { ...userShortcuts, ...next };
  localStorage.setItem(SHORTCUT_KEY, JSON.stringify(userShortcuts));
  persistUiPrefs();
  updateShortcutAlert();
}
function shortcutParts(value) {
  const parts = normalizeShortcut(value).split('+');
  const key = parts.pop() || '';
  return { key: key.toLowerCase(), ctrl: parts.includes('Ctrl'), alt: parts.includes('Alt'), shift: parts.includes('Shift'), meta: parts.includes('Meta') };
}
function eventMatchesShortcut(event, action) {
  const target = shortcutParts(userShortcuts[action]);
  if (!target.key) return false;
  const ctrl = event.ctrlKey || event.metaKey;
  return ctrl === target.ctrl && event.altKey === target.alt && event.shiftKey === target.shift
    && String(event.key).toLowerCase() === target.key;
}
function eventToShortcut(event) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return '';
  const mods = [];
  if (event.ctrlKey || event.metaKey) mods.push('Ctrl');
  if (event.altKey) mods.push('Alt');
  if (event.shiftKey) mods.push('Shift');
  let key = event.key;
  if (key === ' ') key = 'Space';
  if (key === 'Escape') key = 'Esc';
  if (key.length === 1) key = key.toUpperCase();
  return normalizeShortcut([...mods, key].join('+'));
}
function shortcutConflicts() {
  const seen = new Map();
  const conflicts = [];
  SHORTCUT_DEFS.forEach(([key, label]) => {
    const value = normalizeShortcut(userShortcuts[key]);
    if (!value) return;
    if (seen.has(value)) conflicts.push([seen.get(value), key]);
    else seen.set(value, key);
  });
  return conflicts;
}
function updateShortcutAlert() {
  const conflicts = shortcutConflicts();
  let dot = document.querySelector('#shortcut-alert');
  if (!conflicts.length) { if (dot) dot.remove(); return; }
  if (!dot) {
    dot = document.createElement('button');
    dot.id = 'shortcut-alert';
    dot.className = 'shortcut-alert';
    dot.type = 'button';
    dot.title = '快捷键有重复';
    dot.setAttribute('aria-label', '快捷键有重复，点击前往设置');
    dot.addEventListener('click', () => navigate('#/settings'));
    document.body.appendChild(dot);
  }
  dot.title = `快捷键重复：${conflicts.map(([a, b]) => {
    const label = (key) => SHORTCUT_DEFS.find(([k]) => k === key)?.[1] || key;
    return `${label(a)} / ${label(b)}`;
  }).join('；')}`;
}

async function restoreUiPrefs() {
  try {
    const data = await api('/api/preferences');
    const prefs = data && data.preferences ? data.preferences : {};
    for (const key of UI_PREF_KEYS) {
      if (typeof prefs[key] === 'string') localStorage.setItem(key, prefs[key]);
    }
    try {
      const glass = JSON.parse(localStorage.getItem(GLASS_KEY) || 'null');
      if (glass && typeof glass === 'object') glassPrefs = { ...glassPrefs, ...glass };
      const wallpaper = JSON.parse(localStorage.getItem(WALLPAPER_KEY) || 'null');
      if (wallpaper && typeof wallpaper === 'object') wallpaperPrefs = { ...wallpaperPrefs, ...wallpaper };
      const perms = JSON.parse(localStorage.getItem(AGENT_PERMS_KEY) || 'null');
      if (perms && typeof perms === 'object') agentPermissions = { ...agentPermissions, ...perms };
      userShortcuts = loadShortcuts();
      closeMode = localStorage.getItem(CLOSE_MODE_KEY) === 'background' ? 'background' : 'quit';
    } catch (_) {} updateShortcutAlert();
  } catch (_) {}
}

window.addEventListener('pagehide', flushUiPrefs);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushUiPrefs();
});

function motionAllowed() {
  if (motionMode === 'on') return true;
  if (motionMode === 'off') return false;
  return !motionPreference.matches;
}

function applyMotionMode(mode) {
  motionMode = ['on', 'off', 'system'].includes(mode) ? mode : 'system';
  localStorage.setItem(MOTION_KEY, motionMode);
  persistUiPrefs();
  document.documentElement.dataset.motion = motionAllowed() ? 'on' : 'off';
  document.documentElement.dataset.motionPref = motionMode;
  document.querySelectorAll('[data-motion-choice]').forEach((node) => {
    const active = node.dataset.motionChoice === motionMode;
    node.classList.toggle('active', active);
    node.setAttribute('aria-pressed', String(active));
  });
  if (!motionAllowed()) {
    finishLaunch();
    app.querySelectorAll('.choice-slider').forEach(node => uiAnimations.get(node)?.cancel());
  }
  initScrollPop();
}

function applyStyle(style, origin = null) {
  const nextStyle = ['standard', 'liquid'].includes(style) ? style : 'liquid';
  styleMode = nextStyle;
  localStorage.setItem(STYLE_KEY, styleMode);
  persistUiPrefs();
  const update = () => {
    document.documentElement.dataset.style = nextStyle;
    applyGlassPrefs();
    applyWallpaperPrefs();
    document.querySelectorAll('[data-style-choice]').forEach((node) => {
      const active = node.dataset.styleChoice === nextStyle;
      node.classList.toggle('active', active);
      node.setAttribute('aria-pressed', String(active));
      const badge = node.querySelector('.style-active-badge');
      if (badge) badge.hidden = !active;
    });
    initLiquidButtons();
    initChoiceSliders();
  };
  // 主题材质必须立即落到 DOM，再用轻量淡入收尾。
  // 之前把 update() 放进 View Transition 回调，玻璃的 backdrop-filter 会晚一帧才出现。
  update();
}

function applyDensity(density) {
  densityMode = ['comfortable', 'compact', 'large'].includes(density) ? density : 'comfortable';
  localStorage.setItem(DENSITY_KEY, densityMode);
  persistUiPrefs();
  document.documentElement.dataset.density = densityMode;
  document.querySelectorAll('[data-density-choice]').forEach((node) => {
    const active = node.dataset.densityChoice === densityMode;
    node.classList.toggle('active', active);
    node.setAttribute('aria-pressed', String(active));
  });
}

function initPreferences() {
  motionMode = localStorage.getItem(MOTION_KEY) || 'system';
  const savedStyle = localStorage.getItem(STYLE_KEY);
  styleMode = ['standard', 'liquid'].includes(savedStyle) ? savedStyle : 'standard';
  densityMode = localStorage.getItem(DENSITY_KEY) || 'comfortable';
  document.documentElement.dataset.motion = motionAllowed() ? 'on' : 'off';
  document.documentElement.dataset.motionPref = motionMode;
  document.documentElement.dataset.style = styleMode;
  document.documentElement.dataset.density = densityMode;
  applyGlassPrefs();
  applyWallpaperPrefs();
  motionPreference.addEventListener?.('change', () => {
    if (motionMode === 'system') applyMotionMode('system');
  });
}


/* ---------- 液态玻璃按钮：MIT liquid-glass 的 SVG 位移折射 ---------- */
// Only the liquid theme owns optical refraction. Photo pixels and text never pass through it.
const liquidBackdropSupported = CSS.supports('backdrop-filter', 'url(#glass-probe)');
const liquidControls = new Map();
let liquidSeq = 0;
let liquidFrame = 0;
let pointerFrame = 0;
let pointerControl = null;
const materialControlSelector = 'button:not(.style-card):not(.menu-item):not(.choice):not(.ghost):not(.danger):not(.filter-rail-btn)';
const liquidResize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => initLiquidButtons()) : null;

function ensureLiquidFilterHost() {
  let host = document.querySelector('#lg-filter-defs');
  if (!host) {
    host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.id = 'lg-filter-defs';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    document.body.appendChild(host);
  }
  return host;
}

function releaseLiquid(button, entry) {
  liquidResize?.unobserve(button);
  document.getElementById(entry.id)?.remove();
  button.style.removeProperty('--liquid-lens');
  button.style.removeProperty('backdrop-filter');
  button.style.removeProperty('-webkit-backdrop-filter');
  delete button.dataset.liquidGlass;
  liquidControls.delete(button);
}

function attachLiquidButton(button, box = null) {
  if (styleMode !== 'liquid' || !liquidBackdropSupported || !button.isConnected ||
      document.documentElement.dataset.gpu === 'software' || document.documentElement.dataset.perf === 'low') return;
  // Lens size belongs to layout, not the current hover/press transform.
  const rect = box || { width: button.offsetWidth, height: button.offsetHeight };
  const width = Math.round(rect.width), height = Math.round(rect.height);
  if (!width || !height) return;
  const radius = Math.min(parseFloat(getComputedStyle(button).borderRadius) || 12, height / 2);
  const key = `${width}/${height}/${Math.round(radius)}`;
  const previous = liquidControls.get(button);
  if (previous?.key === key) return;
  if (previous) releaseLiquid(button, previous);
  const id = `glass-lens-${++liquidSeq}`;
  // Neutral center and curved edge normals: one optical pass, no RGB split or rainbow texture.
  const map = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="x"><stop stop-color="#608080"/><stop offset=".5" stop-color="#808080"/><stop offset="1" stop-color="#a08080"/></linearGradient><linearGradient id="y" x2="0" y2="1"><stop stop-color="#806080"/><stop offset=".5" stop-color="#808080"/><stop offset="1" stop-color="#80a080"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#x)"/><rect width="100%" height="100%" fill="url(#y)" opacity=".55"/><rect x="5" y="5" width="${Math.max(1,width-10)}" height="${Math.max(1,height-10)}" rx="${Math.max(1,radius-5)}" fill="#808080"/></svg>`;
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.id = id;
  filter.setAttribute('x','-10%'); filter.setAttribute('y','-10%');
  filter.setAttribute('width','120%'); filter.setAttribute('height','120%');
  filter.setAttribute('color-interpolation-filters','sRGB');
  filter.innerHTML = `<feImage href="data:image/svg+xml,${encodeURIComponent(map)}" x="0" y="0" width="${width}" height="${height}" result="edge"/><feDisplacementMap in="SourceGraphic" in2="edge" scale="12" xChannelSelector="R" yChannelSelector="G"/>`;
  ensureLiquidFilterHost().appendChild(filter);
  button.dataset.liquidGlass = '1';
  button.style.setProperty('--liquid-lens', `blur(2px) url(#${id})`);
  liquidControls.set(button,{id,key});
  liquidResize?.observe(button);
}

function initLiquidButtons() {
  if (liquidFrame) return;
  liquidFrame = requestAnimationFrame(() => {
    liquidFrame = 0;
    for (const [button,entry] of liquidControls) {
      if (!button.isConnected || styleMode !== 'liquid' ||
          document.documentElement.dataset.perf === 'low' ||
          (button !== pointerControl && button !== document.activeElement)) releaseLiquid(button,entry);
    }
    if (styleMode !== 'liquid' || !liquidBackdropSupported) return;
    // Refraction only runs on the control being used, not every off-screen button.
    const buttons = [...new Set([pointerControl, document.activeElement])]
      .filter(button => button?.matches(materialControlSelector));
    const boxes = buttons.map(button=>({ width: button.offsetWidth, height: button.offsetHeight }));
    buttons.forEach((button,i)=>attachLiquidButton(button,boxes[i]));
  });
}

function resetMaterialPointer() {
  if (pointerFrame) cancelAnimationFrame(pointerFrame);
  pointerFrame = 0;
  if (pointerControl) {
    delete pointerControl.dataset.materialTracking;
    ['--tilt-x','--tilt-y','--light-x','--light-y'].forEach(key=>pointerControl.style.removeProperty(key));
    pointerControl = null;
    initLiquidButtons();
  }
}

function initMaterialControls() {
  const refresh = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
      node.nodeType === 1 && (node.matches('button') || node.querySelector('button'))))) initLiquidButtons();
  });
  // The SVG host is outside these two roots, so creating a lens cannot schedule another lens.
  refresh.observe(app,{childList:true,subtree:true});
  refresh.observe(modalRoot,{childList:true,subtree:true});
  document.addEventListener('pointermove',event=>{
    if (event.pointerType === 'touch' || !motionAllowed()) { resetMaterialPointer(); return; }
    const button = event.target.closest(materialControlSelector);
    if (!button || button.disabled) { resetMaterialPointer(); return; }
    if (button !== pointerControl) { resetMaterialPointer(); pointerControl = button; attachLiquidButton(button); }
    const x = event.clientX, y = event.clientY;
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(()=>{
      pointerFrame = 0;
      if (!button.isConnected || pointerControl !== button) return;
      const box = button.getBoundingClientRect();
      const px = Math.max(0,Math.min(1,(x-box.left)/box.width));
      const py = Math.max(0,Math.min(1,(y-box.top)/box.height));
      const tilt = styleMode === 'standard' ? .65 : 2.4;
      button.dataset.materialTracking = '1';
      button.style.setProperty('--tilt-x',`${(0.5-py)*tilt}deg`);
      button.style.setProperty('--tilt-y',`${(px-0.5)*tilt}deg`);
      button.style.setProperty('--light-x',`${px*100}%`);
      button.style.setProperty('--light-y',`${py*70}%`);
    });
  },{passive:true});
  document.documentElement.addEventListener('pointerleave',resetMaterialPointer);
  document.addEventListener('focusin', initLiquidButtons);
  document.addEventListener('focusout', initLiquidButtons);
  document.addEventListener('visibilitychange',()=>{if(document.hidden) resetMaterialPointer();});
  initLiquidButtons();
}

function animateUi(node, frames, duration = 180, options = {}) {
  if (!node || !motionAllowed() || typeof node.animate !== 'function') return null;
  uiAnimations.get(node)?.cancel();
  const animation = node.animate(frames, {
    duration,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    ...options,
  });
  uiAnimations.set(node, animation);
  const release = () => {
    if (uiAnimations.get(node) === animation) uiAnimations.delete(node);
    animation.cancel(); // Finished fill effects must not override the next interaction.
  };
  animation.finished.then(release, release);
  return animation;
}

const SPRING_EASE = 'cubic-bezier(.2,.85,.25,1.12)';

const waveSeen = new WeakSet();
let pageWaveObserver;
function waveCards(nodes) {
  // Batch geometry reads before writes. Only currently visible surfaces get layers.
  const entries = nodes.filter(node => !waveSeen.has(node)).map(node => ({node, rect:node.getBoundingClientRect()}))
    .filter(({rect}) => rect.width && rect.height && rect.bottom > 0 && rect.top < innerHeight);
  for (const {node, rect} of entries) {
    waveSeen.add(node);
    node.classList.add('wave-card', 'in-view');
    if (!motionAllowed()) continue;
    const delay = Math.round(Math.min(150, Math.max(0, rect.left) / innerWidth * 65 + Math.max(0, rect.top) / innerHeight * 95));
    const frames = [{translate:'0 16px', scale:'.985'}, {translate:'0 -1px', scale:'1.002', offset:.72}, {translate:'0 0', scale:'1'}];
    if (styleMode !== 'liquid') { frames[0].opacity = .3; frames[1].opacity = 1; frames[2].opacity = 1; }
    animateUi(node, frames, 380, {delay, fill:'backwards', easing:'cubic-bezier(.2,.75,.25,1)'});
  }
}

function animatePageWave() {
  const candidates = [...app.querySelectorAll('.page-head, .roll, .section:not(.appearance-section), [data-reveal], .style-card, .pref-grid > .field, .settings-jump')];
  // Avoid animating a glass surface and its descendants together.
  const nodes = candidates.filter(node => !candidates.some(parent => parent !== node && parent.contains(node)));
  pageWaveObserver?.disconnect();
  nodes.forEach(node => node.classList.add('wave-card', 'in-view'));
  waveCards(nodes);
  if (!motionAllowed()) return;
  pageWaveObserver = new IntersectionObserver(entries => {
    waveCards(entries.filter(entry => entry.isIntersecting).map(entry => entry.target));
    entries.filter(entry => entry.isIntersecting).forEach(entry => pageWaveObserver?.unobserve(entry.target));
  }, {threshold:.04});
  nodes.filter(node => !waveSeen.has(node)).forEach(node => pageWaveObserver.observe(node));
}

const choiceSliders = new WeakMap();
let choiceResizeObserver;
function positionChoiceSlider(row, animate = false) {
  const state = choiceSliders.get(row);
  const active = row.querySelector('.choice.active');
  if (!state || !active || !row.isConnected) return;
  const host = row.getBoundingClientRect();
  const old = state.indicator.getBoundingClientRect();
  const x = active.offsetLeft, y = active.offsetTop;
  const w = active.offsetWidth, h = active.offsetHeight;
  if (!w || !h) return;
  const signature = `${x},${y},${w},${h}`;
  const changed = state.active && state.active !== active;
  state.active = active;
  if (state.signature === signature) return;
  const initialized = Boolean(state.signature);
  state.signature = signature;
  uiAnimations.get(state.indicator)?.cancel();
  Object.assign(state.indicator.style, {left:`${x}px`, top:`${y}px`, width:`${w}px`, height:`${h}px`});
  if ((animate || changed) && initialized && old.width && host.width && motionAllowed()) {
    // Start at the currently painted position, including an interrupted spring.
    // offset geometry is unaffected by the pressed button's scale animation.
    const dx = old.left - host.left - row.clientLeft - x + (old.width - w) / 2;
    const dy = old.top - host.top - row.clientTop - y + (old.height - h) / 2;
    const kick = -Math.sign(dx) * Math.min(7, Math.abs(dx) * .045);
    animateUi(state.indicator, [
      {transform:`translate(${dx}px,${dy}px) scale(${old.width / w},${old.height / h})`, offset:0, easing:'cubic-bezier(.18,.75,.25,1)'},
      {transform:`translate(${kick}px,0) scale(1.035,.94)`, offset:.55, easing:'ease-in-out'},
      {transform:`translate(${-kick * .3}px,0) scale(.99,1.02)`, offset:.79, easing:'ease-out'},
      {transform:'translate(0,0) scale(1,1)', offset:1}
    ], 360, {easing:'linear'});
  }
}

function initChoiceSliders() {
  choiceResizeObserver?.disconnect();
  choiceResizeObserver = new ResizeObserver(entries => entries.forEach(({target}) => positionChoiceSlider(target)));
  const choiceRows = [...app.querySelectorAll('.choice-row'), ...modalRoot.querySelectorAll('.choice-row')];
  choiceRows.forEach(row => {
    if (!row.querySelector('[data-density-choice], [data-motion-choice], [data-theme-choice], [data-close-choice], [data-category-pick]')) return;
    if (!choiceSliders.has(row)) {
      // Copy the current selected surface once: material and colors stay exactly as configured.
      const selected = row.querySelector('.choice.active');
      if (!selected) return;
      const indicator = document.createElement('span');
      indicator.className = 'choice-slider'; indicator.setAttribute('aria-hidden', 'true');
      row.append(indicator); row.classList.add('has-choice-slider');
      choiceSliders.set(row, {indicator});
      row.addEventListener('click', () => requestAnimationFrame(() => positionChoiceSlider(row, true)));
    }
    // Read the complete existing selected appearance without sampling a CSS
    // transition from transparent. Do not invent a second glass material.
    row.classList.add('choice-slider-measure');
    row.classList.remove('has-choice-slider');
    const surface = getComputedStyle(row.querySelector('.choice.active'));
    Object.assign(choiceSliders.get(row).indicator.style, {background:surface.background, boxShadow:surface.boxShadow, borderRadius:surface.borderRadius, border:surface.border});
    row.classList.add('has-choice-slider');
    row.classList.remove('choice-slider-measure');
    positionChoiceSlider(row);
    choiceResizeObserver.observe(row);
  });
}

function flyPhoto(src, from, to, closing = false) {
  if (!motionAllowed() || !from.width || !to.width || !from.height || !to.height) return null;
  const large = closing ? from : to;
  const small = closing ? to : from;
  const scale = Math.max(small.width / large.width, small.height / large.height);
  const dx = small.left + small.width / 2 - large.left - large.width / 2;
  const dy = small.top + small.height / 2 - large.top - large.height / 2;
  const insetX = Math.max(0, (large.width - small.width / scale) / 2);
  const insetY = Math.max(0, (large.height - small.height / scale) / 2);
  const clone = document.createElement('img');
  clone.className = 'photo-flight'; clone.src = src; clone.alt = ''; clone.setAttribute('aria-hidden', 'true');
  Object.assign(clone.style, {left:`${large.left}px`, top:`${large.top}px`, width:`${large.width}px`, height:`${large.height}px`});
  document.body.append(clone);
  const compact = {transform:`translate(${dx}px,${dy}px) scale(${scale})`, clipPath:`inset(${insetY}px ${insetX}px round 8px)`};
  const expanded = {transform:'translate(0,0) scale(1)', clipPath:'inset(0px 0px round 0px)'};
  const animation = animateUi(clone, closing ? [expanded,compact] : [compact,expanded], closing ? 300 : 420,
    {easing:closing ? 'cubic-bezier(.3,0,.25,1)' : 'cubic-bezier(.2,.8,.2,1)', fill:'both'});
  if (!animation) { clone.remove(); return null; }
  animation.finished.then(() => clone.remove(), () => clone.remove());
  return animation;
}

function openInspectFlight(node, photoId) {
  const source = app.querySelector(`.frame[data-id="${photoId}"] img.frame-thumb`);
  if (!source?.naturalWidth || !motionAllowed()) { delete node.dataset.openingPhoto; return; }
  const stage = node.querySelector('.pi-image').getBoundingClientRect();
  const ratio = source.naturalWidth / source.naturalHeight;
  const photo = state.photos.items.find(item => item.id === photoId);
  // The inspector does not upscale small originals. Match its natural-size cap
  // so the flying preview cannot snap smaller when the full image takes over.
  const width = Math.min(stage.width, stage.height * ratio, photo?.width || Infinity), height = width / ratio;
  const target = {left:stage.left + (stage.width-width)/2, top:stage.top + (stage.height-height)/2, width, height};
  const img = node.querySelector('#pi-image');
  const flight = flyPhoto(source.currentSrc || source.src, source.getBoundingClientRect(), target);
  if (!flight) return;
  node._flight = flight;
  img.style.visibility = 'hidden';
  const release = () => { if (node._flight === flight) { img.style.visibility = ''; node._flight = null; delete node.dataset.openingPhoto; } };
  flight.finished.then(release, release);
}

function animateReviewLayout(update) {
  const page = app.querySelector('.review-page');
  if (!page || !motionAllowed()) { update(); return; }
  const viewport = page.querySelector('.review-grid-col').getBoundingClientRect();
  const first = [...page.querySelectorAll('.source-group.open .frame')]
    .map(node => ({ node, rect: node.getBoundingClientRect() }))
    .filter(({rect}) => rect.width && rect.bottom > viewport.top && rect.top < Math.min(viewport.bottom, innerHeight))
    .slice(0, 24);
  update();
  // Read the final layout once, before writing any animation styles.
  const moves = first.map(({node, rect}) => ({node, from:rect, to:node.getBoundingClientRect()}));
  moves.forEach(({node, from, to}) => {
    if (!to.width || !to.height) return;
    const x = from.left - to.left, y = from.top - to.top;
    const sx = from.width / to.width, sy = from.height / to.height;
    if (Math.abs(x) + Math.abs(y) < 1 && Math.abs(sx - 1) < .01) return;
    node.dataset.rmFlipping = '1';
    clearTimeout(node._rmFlipTimer);
    node._rmFlipTimer = setTimeout(() => { delete node.dataset.rmFlipping; }, 400);
    animateUi(node, [
      { transformOrigin:'0 0', transform:`translate(${x}px,${y}px) scale(${sx},${sy})` },
      { transformOrigin:'0 0', transform:'none' },
    ], 340, { easing: SPRING_EASE });
  });
}

/**
 * 页面/主题/照片的连续性交给 View Transitions；不支持或减少动态时直接更新。
 * kind: 'page' | 'photo' | 'theme'，对应 CSS 中的整页动画开关。
 */
function runViewTransition(update, kind) {
  if (!supportsViewTransition || !motionAllowed()) {
    return Promise.resolve().then(update);
  }
  if (activeViewTransition) {
    try { activeViewTransition.skipTransition(); } catch (_) { /* 旧转场已结束 */ }
  }
  const root = document.documentElement;
  if (kind) root.dataset.vt = kind;
  const transition = document.startViewTransition(update);
  transition.ready.catch(() => {});
  transition.updateCallbackDone.catch(() => {});
  activeViewTransition = transition;
  return transition.finished.catch(() => {}).finally(() => {
    if (activeViewTransition === transition) activeViewTransition = null;
    if (kind && activeViewTransition === null) delete root.dataset.vt;
  });
}

let pageVeilToken = 0;

function pageVeilNode() {
  let veil = document.querySelector('#rm-page-veil');
  if (!veil) {
    veil = document.createElement('div');
    veil.id = 'rm-page-veil';
    veil.className = 'rm-page-veil';
    veil.setAttribute('aria-hidden', 'true');
    document.body.appendChild(veil);
  }
  return veil;
}

async function pageSwapWithVeil(update) {
  const token = ++pageVeilToken;
  const veil = pageVeilNode();
  veil.classList.add('show');
  // Begin loading in this event turn. The existing veil can paint while the
  // request is pending; an animation must never delay the user's navigation.
  try {
    await update();
  } finally {
    requestAnimationFrame(() => {
      if (token === pageVeilToken) veil.classList.remove('show');
    });
  }
}

function finishLaunch() {
  if (launchFinished) return;
  const elapsed = performance.now() - LAUNCH_START;
  if (motionAllowed() && elapsed < LAUNCH_MIN_MS) {
    if (!finishLaunch.waiting) {
      finishLaunch.waiting = true;
      setTimeout(() => { finishLaunch.waiting = false; finishLaunch(); }, LAUNCH_MIN_MS - elapsed);
    }
    return;
  }
  launchFinished = true;
  if (!finishLaunch.setupScheduled) {
    finishLaunch.setupScheduled = true;
    setTimeout(maybeShowFirstRunSetup, 650);
  }
  const screen = document.querySelector('#launch-screen');
  if (!screen) return;
  const mark = screen.querySelector('.launch-mark');
  const destination = document.querySelector('.brand-mark');
  if (motionAllowed() && mark && destination && !document.hidden) {
    const start = mark.getBoundingClientRect();
    const end = destination.getBoundingClientRect();
    const flight = mark.cloneNode(true);
    flight.setAttribute('class', 'brand-flight');
    flight.style.cssText = `left:${start.left}px;top:${start.top}px;width:${start.width}px;height:${start.height}px;color:${getComputedStyle(mark).color}`;
    document.body.appendChild(flight);
    mark.style.opacity = '0';
    destination.style.opacity = '0';
    const landing = flight.animate([
      { transform: 'translate(0,0) scale(1)' },
      { transform: `translate(${end.left-start.left}px,${end.top-start.top}px) scale(${end.width/start.width})`, color: getComputedStyle(destination).color },
    ], { duration: 420, easing: 'cubic-bezier(.22,.8,.2,1)', fill: 'forwards' });
    const cleanup = () => { flight.remove(); destination.style.removeProperty('opacity'); };
    landing.finished.then(cleanup, cleanup);
    // Also clean up when a minimized WebView pauses its animation timeline.
    setTimeout(cleanup, 650);
  }
  screen.classList.add('is-leaving');
  screen.setAttribute('aria-hidden', 'true');
  if (!motionAllowed()) screen.remove();
  else setTimeout(() => screen.remove(), 240);
}


let firstRunSetupChecked = false;

async function maybeShowFirstRunSetup() {
  if (firstRunSetupChecked) return;
  firstRunSetupChecked = true;
  let settings;
  try { settings = await api('/api/settings'); } catch (_) { return; }
  if (settings.api_key_set || localStorage.getItem('cull-api-configured') === '1') return;
  const firstRunDialog = showModal(modalFrame('欢迎使用拾影', `
    <div class="first-run">
      <p class="first-run-lead">第一次使用，先配置 DeepSeek API Key。配置只保存在这台电脑上，之后不会再弹出这个窗口。</p>
      <label class="field"><span>DeepSeek API Key</span>
        <input id="first-run-key" type="password" autocomplete="off" placeholder="sk-..." autofocus>
      </label>
      <p class="hint">Key 会使用 Windows DPAPI 加密保存，不会写入日志或报告。可以去
        <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener">DeepSeek 开放平台</a> 获取。</p>
      <p class="hint">如果暂时不配置，可以点“稍后设置”，之后在设置页填写；下次启动仍会提醒一次。</p>
    </div>`,
  `<button data-close="1">稍后设置</button><button class="primary" id="btn-first-run-save">${icon('check')}保存并开始</button>`),
  (rootNode) => {
    bindModalClose(rootNode);
    const input = rootNode.querySelector('#first-run-key');
    const save = async () => {
      const key = input.value.trim();
      if (!key) { toast('请填写 API Key', 'error'); input.focus(); return; }
      const button = rootNode.querySelector('#btn-first-run-save');
      button.disabled = true;
      try {
        await api('/api/settings', { method: 'PUT', body: JSON.stringify({ api_key: key }) });
        localStorage.setItem('cull-api-configured', '1');
        closeModal();
        toast('API Key 已保存，可以开始使用', 'ok');
      } catch (error) {
        button.disabled = false;
        toast(error.message, 'error');
      }
    };
    rootNode.querySelector('#btn-first-run-save').addEventListener('click', save);
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } });
    setTimeout(() => input.focus(), 60);
  });
  firstRunDialog?.classList.add('first-run-modal');
  firstRunDialog?.parentElement?.classList.add('first-run-mask');
}

function markFeedback(card, kind = 'verdict') {
  if (!card) return;
  const mark = card.querySelector(kind === 'important' ? '.frame-star' : '.frame-tags [class*="verdict-"]') || card;
  animateUi(mark, [
    { opacity: 0.45, transform: 'scale(0.94)' },
    { opacity: 1, transform: 'scale(1)' },
  ], 200);
}

/* ---------- 主题 ---------- */

const THEME_KEY = 'cull-theme';

function applyTheme(theme, origin = null) {
  const root = document.documentElement;
  const update = () => {
    root.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    persistUiPrefs();
    const button = document.querySelector('#theme-toggle');
    if (button) {
      const dark = theme === 'dark';
      button.innerHTML = icon(dark ? 'sun' : 'moon');
      button.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
      button.title = button.getAttribute('aria-label');
    document.querySelectorAll('[data-theme-choice]').forEach((node) => {
      const active = node.dataset.themeChoice === theme;
      node.classList.toggle('active', active);
      node.setAttribute('aria-pressed', String(active));
    });
    }
  };
  if (origin && supportsViewTransition && motionAllowed()) {
    const x = origin.clientX ?? (origin.currentTarget?.getBoundingClientRect?.().left ?? 0);
    const y = origin.clientY ?? (origin.currentTarget?.getBoundingClientRect?.().top ?? 0);
    root.style.setProperty('--vt-x', `${x}px`);
    root.style.setProperty('--vt-y', `${y}px`);
    runViewTransition(() => { update(); initChoiceSliders(); }, 'theme');
  } else if (origin && motionAllowed()) {
    update();
    initChoiceSliders();
    animateUi(document.body, [{ opacity: .82 }, { opacity: 1 }], 240);
  } else {
    update();
    initChoiceSliders();
  }
  requestAnimationFrame(() => {
    const glyph = document.querySelector('#theme-toggle .icon');
    animateUi(glyph, [
      { opacity: 0, transform: 'rotate(-40deg) scale(.72)' },
      { opacity: 1, transform: 'rotate(0) scale(1)' },
    ], 260, { easing: 'cubic-bezier(.22, 1, .36, 1)' });
  });
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'dark' ? 'dark' : 'light');
  document.querySelector('#theme-toggle')?.addEventListener('click', (event) => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', event);
  });
}

/**
 * 极简折叠导航：默认只露出主标识与展开箭头。
 * 指针靠近主标识（或键盘聚焦）时，其余导航丝滑展开；点击箭头可钉住。
 */
function initNav() {
  const lead = document.querySelector('#topbar-lead');
  const trigger = document.querySelector('#nav-trigger');
  const nav = document.querySelector('#topnav');
  if (!lead || !trigger || !nav) return;
  let closeTimer = null;
  let pinned = false;
  const setOpen = (open) => {
    lead.classList.toggle('nav-open', open);
    trigger.setAttribute('aria-expanded', String(open));
    trigger.setAttribute('aria-label', open ? '收起导航' : '展开导航');
    nav.inert = !open;
  };
  const open = () => {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    setOpen(true);
  };
  const scheduleClose = () => {
    if (pinned) return;
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (!lead.matches(':hover') && !lead.contains(document.activeElement)) setOpen(false);
    }, 240);
  };
  lead.addEventListener('pointerenter', open);
  lead.addEventListener('pointerleave', scheduleClose);
  lead.addEventListener('focusin', open);
  lead.addEventListener('focusout', (event) => {
    if (!lead.contains(event.relatedTarget)) scheduleClose();
  });
  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    pinned = !pinned;
    setOpen(pinned || lead.matches(':hover'));
  });
  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => { pinned = false; setOpen(false); });
  });
  const beginWindowDrag = async (event) => {
    if (event.button !== 0 || event.isPrimary === false || !window.pywebview?.api?.window_action) return;
    if (event.target.closest('button, a, input, select, textarea, [role="button"]')) return;
    event.preventDefault();
    event.stopPropagation();
    try { await window.pywebview.api.window_action('drag'); } catch (_) {}
  };
  // The strip is inside the topbar: one delegated listener owns the gesture.
  document.querySelector('.topbar')?.addEventListener('pointerdown', beginWindowDrag);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && lead.classList.contains('nav-open')) {
      pinned = false;
      setOpen(false);
    }
  });
  setOpen(false);
}

let routeDepth = 0;
let modalReturnFocus = null;
let modalCloseToken = 0;
let closeMoreMenuHandler = null;
let inspectReturnFocus = null;
let overlayReturnFocus = null;

const state = {
  view: '',
  activity: null,
  labels: [],
  photos: { items: [], total: 0, offset: 0, loading: false, category: 'all', sourceId: '', q: '' },
  selectedId: null,
  multi: false,
  picked: new Set(),
  compareMode: false,
  compareA: null,
  overlayOpen: false,
  jobTimer: null,
  importTimer: null,
  importRefreshPaused: false,
  analysisTimer: null,
  dedupeTimer: null,
  exportTimer: null,
  observer: null,
  lastHash: '',
  hasRendered: false,
  gridReady: false,
  gridEnterTimer: null,
  animateGrid: false,
  activityMotionObserver: null,
  reviewGroups: new Map(),
  reviewGroupBase: new Map(),
};

/* ---------- 基础工具 ---------- */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function fmtBytes(size) {
  if (!size) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function toast(message, type = '') {
  if (!toastRoot) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.setAttribute('role', 'status');
  node.textContent = message;
  // Keep the newest three; remove the oldest without a layout jump.
  const existing = [...toastRoot.querySelectorAll('.toast')];
  // Hard cap three visible toasts; remove the oldest immediately so a burst
  // of validation errors can never cover the page.
  if (existing.length >= 3) existing.slice(0, existing.length - 2).forEach((old) => old.remove());
  toastRoot.appendChild(node);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(node._rmToastTimer);
    node.classList.add('rm-toast-leaving');
    node.getAnimations().forEach((animation) => animation.cancel());
    const exit = animateUi(node, [
      { opacity: 1, transform: 'translateY(0) scale(1)' },
      { opacity: 0, transform: 'translateY(7px) scale(.975)' },
    ], 180, { easing: 'cubic-bezier(.4, 0, .2, 1)' });
    if (exit) exit.finished.then(() => node.remove(), () => node.remove());
    else node.remove();
  };
  node.addEventListener('click', close, { once: true });
  node._rmToastTimer = setTimeout(close, 4200);
}

async function api(path, options = {}) {
  const init = { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } };
  document.dispatchEvent(new CustomEvent('cull:request-start'));
  try {
    const response = await fetch(path, init);
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const data = await response.json();
        if (typeof data.detail === 'string') message = data.detail;
        else if (data.detail) message = JSON.stringify(data.detail);
      } catch (_) { /* 保持默认信息 */ }
      throw new Error(message);
    }
    const type = response.headers.get('content-type') || '';
    return type.includes('application/json') ? response.json() : response.text();
  } finally {
    document.dispatchEvent(new CustomEvent('cull:request-end'));
  }
}

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function closeModal(immediate = false) {
  const mask = modalRoot.querySelector('.modal-mask');
  if (!mask || mask.dataset.leaving) return;
  const closeToken = modalCloseToken;
  if (immediate || !motionAllowed()) {
    mask.remove();
    const returnTo = modalReturnFocus;
    modalReturnFocus = null;
    if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    return;
  }
  mask.dataset.leaving = 'true';
  mask.classList.add('rm-leaving');
  mask.style.pointerEvents = 'none';
  mask.setAttribute('aria-hidden', 'true');
  const dialog = mask.querySelector('.modal');
  const inner = mask.querySelector('.modal-inner');
  const scrim = mask.querySelector('.modal-scrim');
  const finish = () => {
    if (mask.isConnected) mask.remove();
    if (closeToken !== modalCloseToken) return;
    const returnTo = modalReturnFocus;
    modalReturnFocus = null;
    if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
  };
  if (!motionAllowed() || (!inner && !scrim)) {
    finish();
    return;
  }
  // The scrim + glass shell are class-animated in CSS (one compositing group).
  // Do not fade .modal-inner inside the backdrop-filter parent: Chromium turns
  // the text into a blurred raster block when that child opacity animates.
  setTimeout(finish, 280);
}

function showGlassConfirm(message, cancelLabel = '继续编辑', confirmLabel = '确认关闭') {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'rm-confirm-mask';
    mask.innerHTML = `
      <div class="rm-confirm-scrim"></div>
      <div class="rm-confirm-card" role="alertdialog" aria-modal="true" aria-label="确认关闭">
        <div class="rm-confirm-kicker">未保存的更改</div>
        <h3>确定要关闭吗？</h3>
        <p>${esc(message)}</p>
        <div class="rm-confirm-actions">
          <button type="button" class="rm-confirm-cancel">${esc(cancelLabel)}</button>
          <button type="button" class="rm-confirm-ok">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      mask.classList.remove('open');
      setTimeout(() => mask.remove(), 180);
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    };
    mask.querySelector('.rm-confirm-cancel').addEventListener('click', () => finish(false));
    mask.querySelector('.rm-confirm-ok').addEventListener('click', () => finish(true));
    mask.querySelector('.rm-confirm-scrim').addEventListener('click', () => finish(false));
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => {
      mask.classList.add('open');
      mask.querySelector('.rm-confirm-cancel').focus();
    });
  });
}


function showModal(html, onMount, options = {}) {
  modalCloseToken += 1;
  if (!modalRoot.children.length && document.activeElement instanceof HTMLElement) modalReturnFocus = document.activeElement;
  const firstRun = Boolean(options.firstRun) || html.includes('first-run');
  const scrim = firstRun ? '' : '<div class="modal-scrim" aria-hidden="true"></div>';
  modalRoot.innerHTML = `<div class="modal-mask">${scrim}<div class="modal ${options.wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="modal-inner">${html}</div></div></div>`;
  const mask = modalRoot.querySelector('.modal-mask');
  const dialog = mask.querySelector('.modal');
  const inner = mask.querySelector('.modal-inner');
  const scrimNode = mask.querySelector('.modal-scrim');
  const title = dialog.querySelector('.m-head h2');
  if (title) { title.id = 'active-modal-title'; dialog.setAttribute('aria-labelledby', title.id); }
  if (!firstRun && motionAllowed()) {
    dialog.classList.add('rm-entering');
    animateUi(inner, [
      { transform: 'translateY(18px) scale(.965)' },
      { transform: 'translateY(-1px) scale(1.006)', offset: .72 },
      { transform: 'translateY(0) scale(1)' },
    ], 460, { easing: SPRING_EASE, fill: 'both' });
    if (scrimNode) requestAnimationFrame(() => mask.classList.add('rm-ready'));
    setTimeout(() => dialog.classList.remove('rm-entering'), 720);
  } else {
    inner.style.opacity = '1';
    if (scrimNode) scrimNode.style.opacity = '1';
  }
  mask.addEventListener('click', (event) => {
    if (event.target !== mask && !event.target.classList.contains('modal-scrim')) return;
    if (options.closeGuard && options.closeGuard()) {
      showGlassConfirm(options.closeConfirmMessage || '还有未保存的内容，确定关闭？')
        .then((ok) => { if (ok) closeModal(); });
      return;
    }
    closeModal();
  });
  if (!firstRun) {
    requestAnimationFrame(() => {
      if (!mask.isConnected || mask.dataset.leaving) return;
      const preferred = dialog.querySelector('input:not([type="hidden"]), select, textarea, button.primary, button:not(.ghost)');
      if (preferred && !dialog.contains(document.activeElement)) preferred.focus({ preventScroll: true });
    });
    mask.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusables = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((node) => !node.disabled && node.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  if (onMount) onMount(dialog);
  return dialog;
}

function modalFrame(title, body, foot) {
  return `<div class="m-head"><h2>${esc(title)}</h2>
    <button class="ghost" data-close="1" aria-label="关闭">${icon('x')}</button></div>
    <div class="m-body">${body}</div>${foot ? `<div class="m-foot">${foot}</div>` : ''}`;
}

function bindModalClose(root) {
  root.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => closeModal());
  });
}

function closeOverlay(immediate = false) {
  const nodes = [...document.querySelectorAll('.overlay')];
  state.overlayOpen = false;
  if (!nodes.length) return;
  if (immediate || !motionAllowed()) {
    nodes.forEach((node) => node.remove());
    return;
  }
  nodes.forEach((node) => {
    if (node.dataset.leaving) return;
    node.dataset.leaving = 'true';
    node.classList.add('rm-overlay-closing');
    const restoreFocus = () => {
      const returnTo = overlayReturnFocus;
      overlayReturnFocus = null;
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
    const exit = animateUi(node, [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(.992)' },
    ], 200, { easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'both' });
    if (exit) exit.finished.then(() => { node.remove(); restoreFocus(); }, () => { node.remove(); restoreFocus(); });
    else { node.remove(); restoreFocus(); }
  });
}

/* ---------- 路由 ---------- */

async function route() {
  if (state.jobTimer) { clearInterval(state.jobTimer); state.jobTimer = null; }
  if (state.importTimer) { clearInterval(state.importTimer); state.importTimer = null; }
  if (state.analysisTimer) { clearInterval(state.analysisTimer); state.analysisTimer = null; }
  if (state.dedupeTimer) { clearInterval(state.dedupeTimer); state.dedupeTimer = null; }
  if (state.exportTimer) { clearInterval(state.exportTimer); state.exportTimer = null; }
  if (state.gridEnterTimer) { clearTimeout(state.gridEnterTimer); state.gridEnterTimer = null; }
  if (state.activityMotionObserver) { state.activityMotionObserver.disconnect(); state.activityMotionObserver = null; }
  if (state.observer) { state.observer.disconnect(); state.observer = null; }

  hideBatchBar();
  closeOverlay(true);
  closeModal(true);

  const hash = location.hash || '#/activities';
  const parts = hash.replace(/^#\//, '').split('/');
  const nav = parts[0] === 'settings' ? 'settings' : 'activities';
  const depth = parts[0] === 'settings' ? 1 : (parts[0] === 'activity' ? (parts[2] ? 3 : 2) : 0);
  const forward = !state.hasRendered || depth >= routeDepth;
  routeDepth = depth;
  document.documentElement.style.setProperty('--rm-page-y', forward ? '10px' : '-10px');
  document.documentElement.style.setProperty('--rm-page-out-y', forward ? '-4px' : '4px');
  if (state.lastHash !== hash) window.scrollTo({top:0, left:0, behavior:'instant'});
  state.lastHash = hash;

  const update = async () => {
    document.body.dataset.view = (parts[0] === 'activity' && parts[2] === 'review') ? 'review' : 'page';
    document.querySelectorAll('.topnav a').forEach((link) => {
      link.classList.toggle('active', link.dataset.nav === nav);
    });
    document.querySelector('#btn-settings')?.classList.toggle('active', nav === 'settings');
    try {
      if (parts[0] === 'activities' || parts[0] === '') return await viewActivities();
      if (parts[0] === 'activity' && parts[1] && !parts[2]) return await viewActivity(parts[1]);
      if (parts[0] === 'activity' && parts[2] === 'review') return await viewReview(parts[1]);
      if (parts[0] === 'activity' && parts[2] === 'checklist') return await viewChecklist(parts[1]);
      if (parts[0] === 'activity' && parts[2] === 'export') return await viewExport(parts[1]);
      if (parts[0] === 'settings') return await viewSettings();
      await viewActivities();
    } catch (error) {
      if (location.hash === hash) app.innerHTML = `<div class="empty">加载失败：${esc(error.message)}</div>`;
    }
  };

  const animatePage = state.hasRendered && motionAllowed();
  if (animatePage) {
    await pageSwapWithVeil(update);
  } else {
    await update();
    animatePageWave();
  }
  if (location.hash !== hash) return;
  initChoiceSliders();
  state.hasRendered = true;
  finishLaunch();
  initLiquidButtons();
}

/* ---------- 活动列表 ---------- */

function activityRoll(activity) {
  const counts = activity.counts || {};
  const review = counts.review || {};
  const stageIndex = Math.max(0, STAGE_ORDER.indexOf(activity.stage));
  const steps = STAGE_ORDER.map((stage, index) => (
    `<span class="roll-step ${index < stageIndex ? 'done' : ''} ${index === stageIndex ? 'current' : ''}"></span>`
  )).join('');
  const cover = counts.cover_photo_id
    ? `<img loading="lazy" src="/api/photos/${counts.cover_photo_id}/file?kind=review" alt="">`
    : icon('camera');
  const created = (activity.created_at || '').slice(0, 10);
  return `<article class="roll" data-id="${activity.id}" tabindex="0" role="button" aria-label="打开 ${esc(activity.name)}">
    <div class="roll-cover">
      ${cover}
      <div class="roll-admin">
        <button class="roll-admin-btn" type="button" data-rename="${activity.id}" title="重命名活动" aria-label="重命名活动">${icon('pencil')}</button>
        <button class="roll-admin-btn roll-delete" type="button" data-delete="${activity.id}" title="删除活动" aria-label="删除活动">${icon('trash')}</button>
      </div>
      <span class="roll-kind">${esc(KIND_NAMES[activity.kind] || activity.kind)}</span>
    </div>
    <div class="roll-body">
      <div class="roll-head">
        <h3 class="roll-title">${esc(activity.name)}</h3>
        <span class="roll-stage">${esc(STEP_LABELS[activity.stage] || activity.stage)}</span>
      </div>
      <div class="roll-meta">
        <span class="mono">${esc(created)}</span>
        <span>${counts.objects ?? 0} 张照片</span>
        <span>${counts.files ?? 0} 个文件</span>
        ${counts.unreadable ? `<span class="warn">读取失败 ${counts.unreadable}</span>` : ''}
      </div>
      <div class="roll-progress">
        <div class="roll-steps">${steps}</div>
        <div class="roll-state">
          <span>${review.keep_count ?? 0} 保留 · ${review.undecided ?? 0} 待处理</span>
          <span class="mono">${counts.pairs ?? 0} 组配对</span>
        </div>
      </div>
      <div class="roll-actions">
        <button class="small roll-report" data-report="${activity.id}">${icon('file')}报告</button>
        <button class="small primary" data-open="${activity.id}">
          ${icon(counts.files ? 'play' : 'folder')}${counts.files ? '继续选片' : '开始导入'}
        </button>
        <span class="roll-chevron">${icon('chevronRight')}</span>
      </div>
    </div>
  </article>`;
}


function openRenameActivity(activity) {
  const root = showModal(modalFrame('重命名活动', `
    <label class="field"><span>活动名称</span><input id="rename-input" type="text" value="${esc(activity.name)}" autofocus></label>
    <p class="hint">只改显示名称，照片和筛选结果不受影响。</p>`,
  `<button data-close="1">取消</button><button class="primary" id="btn-rename-save">${icon('check')}保存名称</button>`),
  (rootNode) => {
    bindModalClose(rootNode);
    const input = rootNode.querySelector('#rename-input');
    const save = async () => {
      const name = input.value.trim();
      if (!name) { toast('名称不能为空', 'error'); return; }
      if (name === activity.name) { closeModal(); return; }
      rootNode.querySelector('#btn-rename-save').disabled = true;
      try {
        await api(`/api/activities/${activity.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
        closeModal();
        toast('已重命名', 'ok');
        await viewActivities();
      } catch (error) {
        rootNode.querySelector('#btn-rename-save').disabled = false;
        toast(error.message, 'error');
      }
    };
    rootNode.querySelector('#btn-rename-save').addEventListener('click', save);
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } });
    input.focus(); input.select();
  });
}

function openDeleteActivity(activity) {
  showModal(modalFrame('删除活动', `
    <p>确定删除「<b>${esc(activity.name)}</b>」吗？</p>
    <p class="hint">会删除这个项目的索引、筛选结果和缩略图缓存；<b>不会删除原始照片文件</b>。此操作不能撤销。</p>`,
  `<button data-close="1">取消</button><button class="danger" id="btn-delete-confirm">${icon('trash')}确认删除</button>`),
  (rootNode) => {
    bindModalClose(rootNode);
    rootNode.querySelector('#btn-delete-confirm').addEventListener('click', async () => {
      const button = rootNode.querySelector('#btn-delete-confirm');
      button.disabled = true;
      try {
        await api(`/api/activities/${activity.id}`, { method: 'DELETE' });
        closeModal();
        toast('项目已删除', 'ok');
        await viewActivities();
      } catch (error) {
        button.disabled = false;
        toast(error.message, 'error');
      }
    });
  });
}

async function viewActivities() {
  const viewHash = location.hash;
  state.view = 'activities';
  const list = await api('/api/activities');
  if (location.hash !== viewHash) return;
  const totals = list.reduce((acc, item) => {
    const counts = item.counts || {};
    acc.files += counts.files || 0;
    acc.kept += (counts.review || {}).keep_count || 0;
    return acc;
  }, { files: 0, kept: 0 });
  const summary = list.length
    ? `${list.length} 场活动 · ${totals.files} 个文件 · 已保留 ${totals.kept}`
    : '每场活动是一卷底片，随时可以接着看。';
  app.innerHTML = `<div class="page-head">
      <h1>活动</h1><span class="sub">${esc(summary)}</span>
      <span class="spacer"></span>
      <div class="actions"><button class="primary" id="btn-create">${icon('plus')}新建活动</button></div>
    </div>
    ${list.length
      ? `<div class="roll-list">${list.map(activityRoll).join('')}</div>`
      : `<div class="empty">${icon('camera', 'empty-icon')}<h2>还没有活动</h2>
           <p>新建一场活动，导入照片后开始初筛。</p>
           <button class="primary" id="btn-create-empty">${icon('plus')}新建活动</button></div>`}`;

  const openRoll = (activity, goReview) => {
    const aiDone = Number((((activity.counts || {}).review || {}).ai_done) || 0);
    // 只有完成过 AI 粗筛的项目才直接进复核；新建/刚导入的项目先回活动页做粗筛。
    navigate(goReview && activity.counts.files && aiDone > 0 ? `#/activity/${activity.id}/review` : `#/activity/${activity.id}`);
  };
  const rollList = app.querySelector('.roll-list');
  if (rollList) {
    rollList.addEventListener('click', (event) => {
      const roll = event.target.closest('.roll');
      if (!roll) return;
      const activity = list.find((item) => item.id === roll.dataset.id);
      if (!activity) return;
      const button = event.target.closest('button');
      if (button && button.dataset.report) {
        window.open(`/api/activities/${button.dataset.report}/report`, '_blank');
        return;
      }
      if (button && button.dataset.rename) {
        event.stopPropagation();
        openRenameActivity(activity);
        return;
      }
      if (button && button.dataset.delete) {
        event.stopPropagation();
        openDeleteActivity(activity);
        return;
      }
      if (button && button.dataset.open) { openRoll(activity, true); return; }
      navigate(`#/activity/${activity.id}`);
    });
    rollList.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const roll = event.target.closest('.roll');
      if (!roll) return;
      event.preventDefault();
      navigate(`#/activity/${roll.dataset.id}`);
    });
  }
  app.querySelector('#btn-create')?.addEventListener('click', openCreateModal);
  app.querySelector('#btn-create-empty')?.addEventListener('click', openCreateModal);
}


function isImagePath(path) {
  return /\.(jpe?g|png|webp|tiff?|heic|heif|avif|arw|cr2|cr3|nef|dng|raf|rw2|orf|pef|srw)$/i.test(path || '');
}
function sourceDisplayName(path) {
  return String(path || '').split(/[\\/]/).filter(Boolean).pop() || path;
}
function sourceIcon(path) {
  return isImagePath(path) ? icon('image') : icon('folder');
}

function openCreateModal(draft = {}) {
  const chosen = [...(draft.chosen || [])];
  const root = showModal(modalFrame('新建活动', `
    <label class="field"><span>活动名称</span><input id="f-name" type="text" value="${esc(draft.name || "")}" placeholder="例如：2026 开学典礼" autofocus></label>
    <label class="field"><span>活动类型</span>
      <select id="f-kind">
        <option value="ceremony" ${draft.kind === "ceremony" ? "selected" : ""}>典礼</option><option value="performance" ${draft.kind === "performance" ? "selected" : ""}>演出</option>
        <option value="sports" ${draft.kind === "sports" ? "selected" : ""}>体育</option><option value="custom" ${(!draft.kind || draft.kind === "custom") ? "selected" : ""}>自定义</option>
      </select></label>
    <label class="field"><span>本场预算上限（元，可留空）</span><input id="f-budget" type="number" min="0" step="1" value="${draft.budget != null ? esc(String(draft.budget)) : ""}" placeholder="例如：20"></label>
    <div class="field"><span>照片来源（可选）</span>
      <div id="create-source-list" class="source-pick-list"></div>
      <div class="row" style="margin-top:8px">
        <button type="button" class="small" id="btn-create-folder">${icon('folderOpen')}选择文件夹…</button>
        <button type="button" class="small" id="btn-create-files">${icon('image')}添加照片文件…</button>
      </div>
      <p class="hint">可以一次选择多个文件或多个文件夹；创建后会直接开始导入，也可以稍后在活动页继续导入。</p>
    </div>
    <div id="import-progress" style="margin-top:12px"></div>`,
  `<button data-close="1">取消</button><button id="f-submit">${icon('plus')}创建项目</button>`),
  (rootNode) => {
    bindModalClose(rootNode);
    const listNode = rootNode.querySelector('#create-source-list');
    const submit = rootNode.querySelector('#f-submit');
    const refresh = () => {
      listNode.innerHTML = chosen.length
        ? chosen.map((path, index) => `<div class="list-item"><span class="grow" title="${esc(path)}">${sourceIcon(path)}${esc(path)}</span>
            <button class="small ghost" type="button" data-remove="${index}">${icon('x')}移除</button></div>`).join('')
        : '<div class="muted small">还没有选择文件。不选也可以先创建项目，稍后导入。</div>';
      listNode.querySelectorAll('[data-remove]').forEach((button) => {
        button.addEventListener('click', () => { chosen.splice(Number(button.dataset.remove), 1); refresh(); });
      });
      submit.innerHTML = `${icon('plus')}${chosen.length ? '创建并导入' : '创建项目'}`;
    };
    const snapshot = () => ({
      name: rootNode.querySelector('#f-name').value,
      kind: rootNode.querySelector('#f-kind').value,
      budget: rootNode.querySelector('#f-budget').value,
      chosen: [...chosen],
    });
    const addPaths = (paths) => {
      const seen = new Set(chosen.map((item) => item.toLowerCase()));
      (paths || []).forEach((path) => { if (path && !seen.has(path.toLowerCase())) { seen.add(path.toLowerCase()); chosen.push(path); } });
      refresh();
    };
    refresh();
    rootNode.querySelector('#btn-create-folder').addEventListener('click', () => {
      const draft = snapshot();
      openFolderPicker('', (path) => { addPaths([path]); openCreateModal({ ...draft, chosen: [...draft.chosen, path] }); });
    });
    rootNode.querySelector('#btn-create-files').addEventListener('click', () => {
      const draft = snapshot();
      openFilePicker('', (paths) => { openCreateModal({ ...draft, chosen: [...draft.chosen, ...paths] }); });
    });
    submit.addEventListener('click', async () => {
      const name = rootNode.querySelector('#f-name').value.trim();
      const kind = rootNode.querySelector('#f-kind').value;
      const budgetRaw = rootNode.querySelector('#f-budget').value.trim();
      if (!name) { toast('请填写活动名称', 'error'); return; }
      if (submit.disabled) return;
      submit.disabled = true;
      try {
        const activity = await api('/api/activities', {
          method: 'POST',
          body: JSON.stringify({ name, kind, budget_limit_cny: budgetRaw ? Number(budgetRaw) : null }),
        });
        if (chosen.length) {
          let jobId = null;
          try {
            jobId = await createImportJob(activity, chosen);
          } catch (importError) {
            toast(`活动已创建，但导入启动失败：${importError.message}`, 'error');
          }
          closeModal();
          navigate(`#/activity/${activity.id}`);
          // hashchange 触发的 route() 会清理旧的导入定时器，必须等路由落定后再挂。
          if (jobId) setTimeout(() => trackBackgroundImport(activity.id, jobId), 120);
        } else {
          closeModal();
          navigate(`#/activity/${activity.id}`);
        }
      } catch (error) {
        submit.disabled = false;
        toast(error.message, 'error');
      }
    });
  }, {
    closeGuard: () => {
      const name = document.querySelector('#f-name')?.value.trim() || '';
      return Boolean(name || chosen.length);
    },
    closeConfirmMessage: '活动还没创建，当前填写的内容和已选照片会丢失。确定关闭吗？',
  });
}

/* ---------- 活动详情 ---------- */

async function viewActivity(activityId) {
  const viewHash = location.hash;
  state.view = 'activity';
  const [activity, analysisStatus] = await Promise.all([
    api(`/api/activities/${activityId}`),
    api(`/api/activities/${activityId}/analysis/status`),
  ]);
  if (location.hash !== viewHash) return;
  state.activity = activity;
  const counts = activity.counts || {};
  const review = counts.review || {};
  const aiDone = Number(review.ai_done || 0);
  const latestJob = analysisStatus.job;
  const analysisFinished = !latestJob || latestJob.status === 'done';
  // 用户要求：只有全部粗筛结束，才显示人工复筛界面；暂停/运行中都不提前露出。
  const aiReady = analysisFinished && aiDone > 0;
  const stageIndex = Math.max(0, STAGE_ORDER.indexOf(activity.stage));
  const coverId = counts.cover_photo_id || counts.cover_id || null;
  const created = (activity.created_at || '').slice(0, 10);
  const nextStage = STAGE_ORDER[Math.min(STAGE_ORDER.length - 1, stageIndex + 1)];
  const reviewLabel = (review.keep_count || review.reject_count || review.uncertain_count) ? '继续复核' : '开始复核';
  const metrics = [
    ['实际文件', counts.files ?? 0, ''],
    ['已保留', review.keep_count ?? 0, ''],
    ['待处理', review.undecided ?? 0, ''],
    ['读取失败', counts.unreadable ?? 0, counts.unreadable ? 'warn' : ''],
  ];

  app.innerHTML = `<div class="crumb">
      <a href="#/activities">活动</a><span class="crumb-sep">/</span><span>${esc(activity.name)}</span>
    </div>
    <section class="activity-hero" data-reveal style="--reveal-i:0">
      <div class="activity-identity">
        <div class="activity-cover">${coverId
          ? `<img src="/api/photos/${coverId}/file?kind=grid" alt="" onerror="this.remove()">`
          : icon('camera')}</div>
        <div class="activity-title">
          <div class="eyebrow">${esc(KIND_NAMES[activity.kind] || activity.kind)} · <span class="mono">${esc(created)}</span></div>
          <h1>${esc(activity.name)}</h1>
          <div class="hero-metrics">
            ${metrics.map(([label, value, cls]) => `<span class="metric ${cls}"><b data-count="${value}">${value}</b> ${label}</span>`).join('<span class="metric-dot">·</span>')}
          </div>
        </div>
      </div>
      <div class="hero-actions">
        <button id="btn-quick-export" class="ink" ${counts.files ? '' : 'disabled'}>${icon('download')}一键导出原片</button>
        <button id="btn-import-hero" class="small ghost" type="button">${icon('upload')}导入照片</button>
        <div class="more-wrap">
          <button id="btn-more" class="icon ghost" type="button" aria-label="更多操作" aria-haspopup="true" aria-expanded="false">${icon('more')}</button>
          <div id="more-menu" class="more-menu" role="menu" hidden>
            <button id="btn-import" class="menu-item" role="menuitem">${icon('upload')}导入照片</button>
            <button id="btn-checklist" class="menu-item" role="menuitem">${icon('checklist')}必备画面</button>
            <button id="btn-export" class="menu-item" role="menuitem">${icon('download')}导出选项</button>
          </div>
        </div>
      </div>
    </section>

    <div class="stage-line" data-reveal style="--reveal-i:1" aria-label="选片流程">
      <span class="stage-track"><span class="stage-fill" style="width:${((stageIndex + 1) / STAGE_ORDER.length) * 100}%"></span></span>
      ${STAGE_ORDER.map((stage, index) => `
        <div class="stage-item ${index < stageIndex ? 'done' : ''} ${index === stageIndex ? 'current' : ''}">
          <span class="stage-dot">${icon(STEP_ICONS[stage])}</span>
          <span class="stage-name">${STEP_LABELS[stage]}</span>
        </div>`).join('')}
    </div>

    <section class="review-launch-card ${aiReady ? 'ready' : 'locked'}" id="review-launch-card" data-reveal style="--reveal-i:2">
      <div class="review-launch-copy">
        <span class="eyebrow">复核工作台</span>
        <h2>${aiReady ? '照片复核' : (latestJob && ['queued','running','pausing','paused'].includes(latestJob.status) ? 'AI 粗筛进行中' : '等待 AI 粗筛')}</h2>
        <p>${aiReady
          ? `AI 已给出 ${aiDone} 张照片的初筛建议。展开抽屉后可按来源卡分组复核、批量选择和导出。`
          : (latestJob && ['queued','running','pausing','paused'].includes(latestJob.status)
            ? '粗筛全部结束后，这里才会出现人工复筛界面。'
            : '完成 AI 粗筛后，这里会变成可展开的复核抽屉。')}</p>
      </div>
      <div class="review-launch-action">
        <span>${aiDone} / ${counts.files || 0} 张已粗审</span>
        <button class="${aiReady ? 'primary' : 'ghost'}" id="btn-open-review-drawer" ${aiReady ? '' : 'disabled'}>
          ${icon(aiReady ? 'eye' : 'lock')}${aiReady ? '展开复核' : 'AI 粗审后可用'}
        </button>
      </div>
    </section>

    <div class="activity-layout">
      <div class="activity-main">
        <section class="section" id="ai-panel" data-reveal style="--reveal-i:2">
          <div class="section-head"><h2>AI 初筛</h2><span class="hint">五类问题的建议，最终由你决定</span></div>
          <div id="ai-panel-body" class="hint">加载中…</div>
        </section>
        <section class="section" id="dedupe-panel" data-reveal style="--reveal-i:3">
          <div class="section-head">
            <h2>连拍精简</h2>
            <span class="hint">自动找出同一场景的连拍/近似照片，每组只保留 1 张最好的，其余标记为“疑似废片”；可一键撤销。RAW+JPG 按一对算。</span>
          </div>
          <div id="dedupe-body" class="hint">加载中…</div>
        </section>
      </div>
      <aside class="activity-side">
        <section class="section" data-reveal style="--reveal-i:4">
          <div class="section-head">
            <h2>来源文件夹</h2>
            <span class="hint">${activity.sources.length} 个来源${counts.unreadable ? ' · 失败文件会单独标记' : ''}</span>
          </div>
          <div class="hair-list">
            ${activity.sources.length ? activity.sources.map((source) => `
              <div class="hair-row">
                <span class="grow">${esc(source.label)}<span class="source-path" style="margin-left:10px">${esc(source.root_path)}</span></span>
                <span class="source-count">${source.photo_count} 个文件</span>
              </div>`).join('')
              : '<div class="hair-row"><span class="grow muted">还没有导入任何文件夹。</span></div>'}
          </div>
        </section>
        <section class="section" data-reveal style="--reveal-i:5">
          <div class="section-head"><h2>其他</h2></div>
          <div class="side-actions">
            <button id="btn-activity-report" class="small ghost">${icon('file')}预览处理报告</button>
            <button id="btn-open-folder" class="small ghost">${icon('folderOpen')}打开数据文件夹</button>
          </div>
          <p class="hint side-hint">下一步：${STEP_LABELS[nextStage] || '完成'}。所有处理只在本机目录进行。</p>
        </section>
      </aside>
    </div>
    <div class="review-drawer" id="activity-review-drawer" hidden aria-hidden="true">
      <div class="review-drawer-head">
        <div><span class="eyebrow">复核工作台</span><b>${esc(activity.name)}</b></div>
        <button class="small ghost" id="btn-close-review-drawer" type="button">${icon('x')}关闭</button>
      </div>
      <div class="review-drawer-host" id="review-drawer-host"></div>
    </div>`;

  // 把活动详情主体做成可收起抽屉；粗审完成后，复核界面直接放在抽屉下方。
  const inlineReview = document.createElement('section');
  inlineReview.className = 'activity-inline-review';
  inlineReview.id = 'activity-inline-review';
  inlineReview.hidden = true;
  app.querySelector('#review-launch-card')?.remove();
  app.querySelector('#activity-review-drawer')?.remove();
  const crumb = app.querySelector('.crumb');
  const overview = document.createElement('section');
  overview.className = 'activity-overview-drawer' + (aiReady ? ' collapsed' : '');
  overview.id = 'activity-overview-drawer';
  overview.innerHTML = `<div class="activity-overview-head">
      <span class="overview-identity"><span class="eyebrow">活动概览</span><b>${esc(activity.name)}</b><span>${counts.files || 0} 个文件 · ${review.keep_count || 0} 张保留</span></span>
      <div class="overview-actions">
        <button class="overview-toggle overview-export" id="btn-overview-report" type="button" title="预览处理报告">${icon('file')}报告</button>
        <button class="overview-toggle" id="btn-toggle-overview" type="button" aria-expanded="${aiReady ? 'false' : 'true'}" aria-label="展开或收起粗筛"><span class="overview-toggle-label">粗筛</span>${icon('chevronDown')}</button>
      </div>
    </div>
    <div class="activity-overview-body"><div class="activity-overview-inner"></div></div>`;
  const overviewInner = overview.querySelector('.activity-overview-inner');
  [...app.children].forEach((node) => {
    if (node === crumb || node === inlineReview || node === overview || node.id === 'activity-review-drawer') return;
    overviewInner.appendChild(node);
  });
  app.insertBefore(overview, app.firstChild?.nextSibling || null);
  app.appendChild(inlineReview);
  const toggleOverview = () => {
    overview.classList.toggle('collapsed');
    const expanded = !overview.classList.contains('collapsed');
    const toggle = overview.querySelector('#btn-toggle-overview');
    toggle?.setAttribute('aria-expanded', String(expanded));
    if (expanded) replayRevealAnimations(overviewInner);
  };
  overview.querySelector('#btn-toggle-overview')?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleOverview();
  });
  overview.querySelector('#btn-overview-report')?.addEventListener('click', (event) => {
    event.stopPropagation();
    window.open(`/api/activities/${activity.id}/report`, '_blank');
  });
  overview.querySelector('.activity-overview-head')?.addEventListener('click', (event) => {
    if (!event.target.closest('#btn-toggle-overview, #btn-overview-report')) toggleOverview();
  });

  app.querySelector('#btn-import').addEventListener('click', () => openImportModal(activity, []));
  app.querySelector('#btn-import-hero')?.addEventListener('click', () => openImportModal(activity, []));
  const reviewDrawer = app.querySelector('#activity-review-drawer');
  const closeReviewDrawer = () => {
    if (!reviewDrawer || reviewDrawer.hidden || reviewDrawer.classList.contains('closing')) return;
    reviewDrawer.classList.remove('open');
    reviewDrawer.classList.add('closing');
    document.body.classList.remove('review-drawer-open');
    state.observer?.disconnect();
    setTimeout(async () => {
      reviewDrawer.hidden = true;
      reviewDrawer.classList.remove('closing');
      await viewActivity(activity.id);
    }, 380);
  };
  app.querySelector('#btn-open-review-drawer')?.addEventListener('click', async () => {
    if (!aiReady || !reviewDrawer) return;
    reviewDrawer.hidden = false;
    requestAnimationFrame(() => reviewDrawer.classList.add('open'));
    document.body.classList.add('review-drawer-open');
    await viewReview(activity.id, { host: app.querySelector('#review-drawer-host'), embedded: true, onClose: closeReviewDrawer });
  });
  app.querySelector('#btn-close-review-drawer')?.addEventListener('click', closeReviewDrawer);
  app.querySelector('#btn-checklist').addEventListener('click', () => navigate(`#/activity/${activity.id}/checklist`));
  app.querySelector('#btn-export').addEventListener('click', () => navigate(`#/activity/${activity.id}/export`));
  app.querySelector('#btn-quick-export')?.addEventListener('click', () => navigate(`#/activity/${activity.id}/export`));
  app.querySelector('#btn-activity-report').addEventListener('click', () => {
    window.open(`/api/activities/${activity.id}/report`, '_blank');
  });
  app.querySelector('#btn-open-folder').addEventListener('click', async () => {
    try { await api('/api/fs/open', { method: 'POST', body: JSON.stringify({ path: (await api('/api/settings')).data_dir }) }); }
    catch (error) { toast(error.message, 'error'); }
  });

  const moreButton = app.querySelector('#btn-more');
  const moreMenu = app.querySelector('#more-menu');
  let moreClosing = false;
  let moreToken = 0;
  const closeMore = () => {
    if (!moreMenu || moreMenu.hidden) return;
    const token = ++moreToken;
    moreButton.setAttribute('aria-expanded', 'false');
    moreButton.classList.remove('active');
    if (!motionAllowed()) {
      moreMenu.hidden = true;
      moreClosing = false;
      moreButton.closest('.activity-hero')?.classList.remove('more-open');
      return;
    }
    moreClosing = true;
    moreMenu.classList.add('rm-menu-leaving');
    Promise.resolve(animateMenuClose(moreMenu, 'top right')).then(() => {
      if (token !== moreToken) return;
      moreMenu.hidden = true;
      moreMenu.classList.remove('rm-menu-leaving');
      moreClosing = false;
      moreButton.closest('.activity-hero')?.classList.remove('more-open');
    });
  };
  closeMoreMenuHandler = closeMore;
  moreButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (moreClosing) {
      // Reverse from the current close frame instead of dropping the click.
      moreToken += 1;
      moreClosing = false;
      uiAnimations.get(moreMenu)?.cancel();
      moreMenu.classList.remove('rm-menu-leaving');
      moreMenu.hidden = false;
      moreButton.setAttribute('aria-expanded', 'true');
      moreButton.classList.add('active');
      moreButton.closest('.activity-hero')?.classList.add('more-open');
      animateMenuOpen(moreMenu, 'top right');
      return;
    }
    const open = moreMenu.hidden;
    if (!open) { closeMore(); return; }
    moreMenu.hidden = false;
    moreButton.setAttribute('aria-expanded', 'true');
    moreButton.classList.add('active');
    moreButton.closest('.activity-hero')?.classList.add('more-open');
    animateMenuOpen(moreMenu, 'top right');
  });
  app.addEventListener('click', (event) => {
    if (!event.target.closest('.more-wrap')) closeMore();
  });
  moreMenu.querySelectorAll('button').forEach((button) => button.addEventListener('click', closeMore));

  initActivityMotion();
  await Promise.all([renderAiPanel(activity), renderDedupePanel(activity)]);
  if (location.hash !== viewHash) return;
  if (aiReady) {
    inlineReview.hidden = false;
    try { await viewReview(activity.id, { host: inlineReview, embedded: true }); }
    catch (error) { inlineReview.hidden = true; toast(error.message, 'error'); }
  }
}

function countUp(node, target) {
  if (target <= 0) { node.textContent = '0'; return; }
  const start = performance.now();
  const duration = 620;
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = String(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(tick);
    else node.textContent = String(target);
  };
  node.textContent = '0';
  requestAnimationFrame(tick);
}

function replayRevealAnimations(container) {
  if (!container || !motionAllowed()) return;
  const visible = node => {
    const r = node.getBoundingClientRect();
    return r.width && r.height && r.bottom > 0 && r.top < innerHeight;
  };
  const sections = [...container.querySelectorAll('[data-reveal]')].filter(visible).slice(0, 8);
  const cards = [...container.querySelectorAll('.ai-rule, .ai-summary-item, .dedupe-group, .check-list label, .stat, .metric')].filter(visible).slice(0, 16);
  sections.forEach((node, index) => {
    node.getAnimations().forEach((animation) => animation.cancel());
    node.classList.add('in-view');
    animateUi(node, [
      { opacity: 0, transform: 'translateY(16px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], 340, {
      delay: Math.min(index, 4) * 20,
      easing: SPRING_EASE,
      fill: 'backwards',
    });
  });
  cards.forEach((node, index) => {
    node.getAnimations().forEach((animation) => animation.cancel());
    node.classList.add('reveal-visible');
    animateUi(node, [
      { opacity: .15, transform: 'translateY(24px) scale(.975)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], 340, {
      delay: Math.min(index, 5) * 12,
      easing: SPRING_EASE,
      fill: 'backwards',
    });
  });
}

function initActivityMotion() {
  const nodes = [...app.querySelectorAll('[data-reveal]')];
  if (!nodes.length) return;
  if (!motionAllowed()) {
    nodes.forEach((node) => node.classList.add('in-view'));
    return;
  }
  state.activityMotionObserver?.disconnect();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in-view');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -7% 0px', threshold: 0.06 });
  nodes.forEach((node) => observer.observe(node));
  state.activityMotionObserver = observer;
  app.querySelectorAll('.metric b[data-count]').forEach((node) => {
    const target = Number(node.dataset.count) || 0;
    if (target > 0) countUp(node, target);
  });
}
/* ---------- AI 初筛面板 ---------- */

async function renderAiPanel(activity) {
  const panel = document.querySelector('#ai-panel-body');
  if (!panel) return;
  let settings; let estimate; let status;
  try {
    [settings, estimate, status] = await Promise.all([
      api('/api/settings'),
      api(`/api/activities/${activity.id}/analysis/estimate`),
      api(`/api/activities/${activity.id}/analysis/status`),
    ]);
  } catch (error) {
    panel.innerHTML = `<p style="color:var(--red)">${esc(error.message)}</p>`;
    return;
  }
  if (!panel.isConnected) return;
  panel.addEventListener('pointerdown', () => { state.importRefreshPaused = true; }, { once: true });
  const job = status.job;
  const running = job && ['queued', 'running', 'pausing'].includes(job.status);
  const paused = job && job.status === 'paused';
  const modes = (activity.rule && activity.rule.checks) || {};

  const ruleRows = Object.keys(CHECK_NAMES).map((key) => `
    <label class="ai-rule"><span>${esc(CHECK_NAMES[key])}</span>
      <select data-mode="${key}" ${running ? 'disabled' : ''}>
        ${Object.entries(MODE_OPTIONS).map(([value, label]) =>
          `<option value="${value}" ${((modes[key] || {}).mode || 'remind') === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    </label>`).join('');

  const jobLine = job ? `<p class="hint" style="margin-top:10px">最近任务：${esc(JOB_STATUS[job.status] || job.status)} ·
      完成 ${job.done_count} / ${job.total}${job.failed_count ? ` · 失败 ${job.failed_count}` : ''}
      ${job.result && job.result.reason === 'budget' ? ' · 因预算暂停' : ''}
      ${job.error ? ` · ${esc(job.error)}` : ''}</p>` : '';

  panel.innerHTML = `
    ${settings.screening_key_set ? '' : '<p class="hint" style="color:var(--safelight)">还没有设置 API Key，请先到 <a href="#/settings">设置</a> 填写。</p>'}
    <div class="ai-rules">${ruleRows}</div>
    <div class="row" style="margin-top:10px">
      <button id="btn-ai-decisive" class="small ghost" ${running ? 'disabled' : ''}>${icon('check')}明确筛选</button>
      <span class="hint">轻微瑕疵可保留；明显主体问题建议排除；关键证据不足才待确认。</span>
    </div>
    <p class="hint">本地先做连拍精选：每组只保留 1 张，组内其余照片立即标记为连拍重复；精选照片 + 非连拍照片一次性送 API 精筛。</p>
    <p class="hint">不再有第一轮快速粗筛，也没有两轮 API。所有照片筛完后才会出现人工复筛界面。</p>
    <p class="hint" style="margin-top:10px">启用项：${estimate.enabled_checks.map((key) => esc(CHECK_NAMES[key])).join('、') || '（全部不检查）'}
      · 模型 <span class="mono">${esc(estimate.model)}</span></p>
    <div class="ai-summary">
      <div class="ai-summary-item"><span class="ai-summary-value">${estimate.pending_photos}</span><span class="ai-summary-label">待分析照片</span></div>
      <div class="ai-summary-item"><span class="ai-summary-value">¥${estimate.per_photo_cost}</span><span class="ai-summary-label">每张预估</span></div>
      <div class="ai-summary-item"><span class="ai-summary-value">¥${estimate.estimated_cost}</span><span class="ai-summary-label">全部预估</span></div>
      <div class="ai-summary-item"><span class="ai-summary-value">¥${estimate.used_cost}</span><span class="ai-summary-label">已用${estimate.budget_limit_cny != null ? ` / 预算 ¥${estimate.budget_limit_cny}` : ''}</span></div>
    </div>
    <div class="row">
      <button id="btn-ai-all" class="primary" ${(!settings.screening_key_set || estimate.pending_photos === 0 || running || !estimate.can_afford) ? 'disabled' : ''}>
        ${icon('layers')}开始粗筛</button>
      ${running ? `<button id="btn-ai-pause">${icon('pause')}暂停</button>` : ''}
      ${paused ? `<button id="btn-ai-continue" class="primary">${icon('play')}继续分析</button>` : ''}
      ${estimate.can_afford ? '' : '<span style="color:var(--red)">预计超出本场预算，请缩小范围或调整预算/检查项。</span>'}
    </div>
    <div id="ai-progress"></div>
    ${jobLine}`;

  panel.querySelectorAll('[data-mode]').forEach((select) => {
    select.addEventListener('change', async () => {
      const key = select.dataset.mode;
      try {
        await api(`/api/activities/${activity.id}`, {
          method: 'PATCH', body: JSON.stringify({ rule: { checks: { [key]: { mode: select.value } } } }),
        });
        const updated = await api(`/api/activities/${activity.id}`);
        await renderAiPanel(updated);
      } catch (error) { toast(error.message, 'error'); }
    });
  });

  panel.querySelector('#btn-ai-decisive').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      const checks = Object.fromEntries(Object.keys(CHECK_NAMES).map(key => [key, {mode:key === 'composition' ? 'remind' : 'strict'}]));
      await api(`/api/activities/${activity.id}`, {method:'PATCH', body:JSON.stringify({rule:{checks}})});
      await renderAiPanel(await api(`/api/activities/${activity.id}`));
      toast('已应用明确筛选，下次分析使用；已有结果不自动重跑', 'ok');
    } catch (error) { toast(error.message, 'error'); button.disabled = false; }
  });
  const all = panel.querySelector('#btn-ai-all');
  if (all) all.addEventListener('click', () => startAnalysis(activity, 0));
  const pause = panel.querySelector('#btn-ai-pause');
  if (pause) pause.addEventListener('click', async () => {
    try { await api(`/api/activities/${activity.id}/analysis/pause`, { method: 'POST' }); toast('正在暂停，已发送的照片完成后停止'); await renderAiPanel(activity); }
    catch (error) { toast(error.message, 'error'); }
  });
  const cont = panel.querySelector('#btn-ai-continue');
  if (cont) cont.addEventListener('click', () => startAnalysis(activity, 0));

  if (running) {
    const progress = panel.querySelector('#ai-progress');
    progress.innerHTML = screeningProgress(job);
    clearInterval(state.analysisTimer);
    let polling = false;
    state.analysisTimer = setInterval(async () => {
      if (polling || !panel.isConnected) return;
      polling = true;
      try {
        const photoState = state.photos;
        const revision = state.reviewRevision || 0;
        const snapshot = new Map(photoState.items.map(item => [item.id, item.verdict]));
        const ids = [...app.querySelectorAll('.source-group.open .frame')].filter(node => {
          const r = node.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight;
        }).slice(0, 298).map(node => node.dataset.id);
        if (state.selectedId) ids.push(state.selectedId);
        if (inspectCurrentId) ids.push(inspectCurrentId);
        const latest = await api(`/api/activities/${activity.id}/analysis/status?photo_ids=${ids.join(',')}`);
        if (!panel.isConnected) return;
        const current = latest.job;
        if (current && !['queued','running','pausing'].includes(current.status)) {
          // Final synchronization also updates closed drawers and offscreen cards,
          // without rebuilding the grid or moving the user's current selection.
          const loaded = photoState.items.map(item => item.id);
          const updates = [];
          for (let offset = 0; offset < loaded.length; offset += 300) {
            const final = await api(`/api/activities/${activity.id}/analysis/status?photo_ids=${loaded.slice(offset,offset+300).join(',')}`);
            updates.push(...final.updates);
          }
          if (!panel.isConnected) return;
          latest.updates = updates;
        }
        const changedDetails = new Set();
        if (photoState === state.photos && revision === (state.reviewRevision || 0)) for (const update of latest.updates || []) {
          const item = photoState.items.find(item => item.id === update.id);
          // A click made while this request was in flight wins over the snapshot.
          if (!item || item.verdict !== snapshot.get(item.id)) continue;
          if (item.ai_stage !== update.ai_stage && (item.id === state.selectedId || item.id === inspectCurrentId)) changedDetails.add(item.id);
          Object.assign(item, update);
          const card = app.querySelector(`.frame[data-id="${item.id}"]`);
          if (!card) continue;
          const ai = card.querySelector('[data-ai-badge]');
          if (ai) { ai.textContent = screeningLabel(item); ai.className = `pill ai-${item.ai_suggestion || 'uncertain'}`; }
          const verdict = card.querySelector('[class*="verdict-"]');
          if (verdict) { verdict.textContent = VERDICT_NAMES[item.verdict]; verdict.className = `pill verdict-${item.verdict}`; }
          card.classList.remove('keep','reject','uncertain','undecided','ai-keep','ai-reject','ai-uncertain');
          card.classList.add(item.verdict);
          if (item.ai_suggestion) card.classList.add(`ai-${item.ai_suggestion}`);
        }
        for (const id of changedDetails) {
          const photo = await api(`/api/photos/${id}`);
          if (!panel.isConnected) return;
          if (state.selectedId === id) {
            const detail = app.querySelector('[data-ai-detail]');
            if (detail) detail.outerHTML = aiPanelHtml(photo);
          }
          if (inspectCurrentId === id && document.querySelector('#pi-ai')) document.querySelector('#pi-ai').innerHTML = inspectAi(photo);
        }
        if (latest.counts && state.activity?.id === activity.id) {
          updateReviewCounts(latest.counts);
        }
        if ((current?.result?.quick_done || current?.done_count) && app.querySelector('#activity-inline-review')?.hidden) {
          const host = app.querySelector('#activity-inline-review');
          host.hidden = false;
          await viewReview(activity.id, {host, embedded:true});
        }
        if (!current || !['queued', 'running', 'pausing'].includes(current.status)) {
          clearInterval(state.analysisTimer);
          state.analysisTimer = null;
          const message = current?.status === 'done'
            ? `AI 初筛完成${current.result?.dedupe ? '，连拍精简已完成' : ''}`
            : current?.status === 'paused' ? 'AI 初筛已暂停，可以继续处理剩余照片'
            : current?.status === 'failed' ? `AI 初筛失败：${current.error || '请检查接口设置后重试'}`
            : 'AI 初筛已停止';
          toast(message, current?.status === 'failed' ? 'error' : 'ok');
          // 分析结束后会批量改变 verdict / burst_duplicate；必须重新加载当前栏目，
          // 否则卡片会继续留在旧的“保留”分类里。
          if (state.view === 'review') {
            await viewReview(activity.id, {});
          } else if (state.view === 'activity') {
            await viewActivity(activity.id);
          } else {
            await renderAiPanel(await api(`/api/activities/${activity.id}`));
          }
          return;
        }
        progress.innerHTML = screeningProgress(current);
      } catch (error) {
        clearInterval(state.analysisTimer);
        state.analysisTimer = null;
      } finally {
        polling = false;
      }
    }, 1200);
  }
}

function screeningProgress(job) {
  const result = job.result || {};
  const count = result.refine_done || 0;
  const total = result.refine_total || 0;
  const info = [
    result.burst_groups ? `本地连拍 ${result.burst_groups} 组` : '',
    result.burst_skipped ? `组内重复 ${result.burst_skipped} 张` : '',
    result.kept != null ? `保留 ${result.kept}` : '',
    result.uncertain ? `待确认 ${result.uncertain}` : '',
    result.rejected ? `排除 ${result.rejected}` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="progress"><div style="width:${total ? Math.round(count / total * 100) : 0}%"></div></div>
    <div class="progress-label">API 精筛 ${count || 0} / ${total || 0}${info ? ` · ${info}` : ''}${job.failed_count ? ` · ${job.failed_count} 张失败` : ''}</div>`;
}

function screeningLabel(photo) {
  return ({burst_duplicate:'连拍重复 · 待处理', refine_failed:'精筛失败 · 可重试', refined:'AI 精筛'})[photo.ai_stage] || (photo.ai_suggestion ? `AI ${SUGGESTION_SHORT[photo.ai_suggestion] || ''}` : '待分析');
}

function screeningDetailHint(photo) {
  if (photo.ai_stage === 'quick_reject') return '首轮已发现明确问题，未进行精筛；需要详细依据可检查本张。';
  if (photo.ai_stage === 'quick_refine') return '首轮未打上保留标签，直接保留为待确认，不进入精筛。';
  if (photo.ai_stage?.startsWith('quick_')) return '首轮已保留，详细检查尚未完成。';
  return '尚未分析';
}

function updateReviewCounts(counts) {
  if (!state.activity?.counts) return;
  state.activity.counts.review = counts;
  const countKeys = {keep:'keep_count',reject:'reject_count',uncertain:'uncertain_count',
    undecided:'undecided',burst_best:'burst_best_count',dedupe_duplicates:'burst_duplicate_count'};
  for (const node of app.querySelectorAll('[data-cat] .filter-count')) {
    const key = node.parentElement.dataset.cat;
    const count = counts[countKeys[key] || key];
    if (count != null) node.textContent = count;
  }
}

function hideActivityReview() {
  const inline = document.querySelector('#activity-inline-review');
  if (inline) {
    inline.hidden = true;
    inline.innerHTML = '';
  }
  const drawer = document.querySelector('#activity-review-drawer');
  if (drawer) {
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
  }
}

async function startAnalysis(activity, limit) {
  try {
    const result = await api(`/api/activities/${activity.id}/analysis/start`, {
      method: 'POST', body: JSON.stringify({ limit, auto_dedupe: limit === 0 }),
    });
    toast(`已开始分析 ${result.count} 张，预估 ¥${result.estimated_cost}${''}`, 'ok');
    watchGroupingProgress(activity);
    // 只收起人工复筛，不重载整页；连拍分组结束也不再刷新屏幕。
    hideActivityReview();
    await renderAiPanel(activity);
  } catch (error) { toast(error.message, 'error'); }
}

/* ---------- 连拍精简 ---------- */

function groupingProgressMarkup(job) {
  const result = job.result || {};
  const done = Number(result.grouping_done || 0);
  const total = Number(result.grouping_total || 0);
  const percent = total ? Math.round(done / total * 100) : 5;
  return `
    <div class="progress"><div style="width:${percent}%"></div></div>
    <div class="progress-label">连拍精筛：正在分析画面/人物相似度 ${done} / ${total || '…'}（本地向量，不调用 API）</div>`;
}

function watchGroupingProgress(activity) {
  if (state.dedupeTimer) { clearInterval(state.dedupeTimer); state.dedupeTimer = null; }
  const tick = async () => {
    const panel = document.querySelector('#dedupe-body');
    if (!panel) {
      clearInterval(state.dedupeTimer); state.dedupeTimer = null; return;
    }
    try {
      const status = await api(`/api/activities/${activity.id}/analysis/status`);
      const job = status.job;
      if (!job || !['queued', 'running', 'pausing'].includes(job.status)) {
        clearInterval(state.dedupeTimer); state.dedupeTimer = null; return;
      }
      const result = job.result || {};
      if (result.stage === 'grouping') {
        panel.innerHTML = groupingProgressMarkup(job);
      } else if (result.stage && result.stage !== 'grouping') {
        clearInterval(state.dedupeTimer); state.dedupeTimer = null;
        panel.innerHTML = `
          <div class="progress"><div style="width:100%"></div></div>
          <div class="progress-label">连拍精筛完成：已分组 ${result.burst_groups || 0} 组，已实时标记重复照片，进入 AI 初筛</div>`;
      }
    } catch (error) {
      clearInterval(state.dedupeTimer); state.dedupeTimer = null;
    }
  };
  state.dedupeTimer = setInterval(tick, 900);
  tick();
}

async function renderDedupePanel(activity) {
  const panel = document.querySelector('#dedupe-body');
  if (!panel) return;
  try {
    const [status, analysisStatus] = await Promise.all([
      api(`/api/activities/${activity.id}/dedupe/status`),
      api(`/api/activities/${activity.id}/analysis/status`),
    ]);
    if (!panel.isConnected) return;
    const activeAnalysis = analysisStatus.job;
    if (activeAnalysis && ['queued', 'running', 'pausing'].includes(activeAnalysis.status)
        && (activeAnalysis.result || {}).stage === 'grouping') {
      panel.innerHTML = groupingProgressMarkup(activeAnalysis);
      watchGroupingProgress(activity);
      return;
    }
    if (status.applied) {
      const run = status.run;
      const options = run.options || {};
      panel.innerHTML = `
        <div class="row" style="gap:12px;margin-bottom:10px">
          <span class="pill verdict-keep">已精简 ${run.groups} 组连拍</span>
          <span class="hint">自动保留 ${options.kept_objects ?? '—'} 对，标记 ${options.rejected_objects ?? '—'} 对重复；人工已决定的照片未被覆盖。</span>
        </div>
        <div class="row">
          <button id="btn-dedupe-review" class="small primary">${icon('image')}去复核精简结果</button>
          <button id="btn-dedupe-rescan" class="small">${icon('scan')}重新扫描</button>
          <button id="btn-dedupe-undo" class="small ghost">${icon('undo')}撤销精简</button>
        </div>`;
      panel.querySelector('#btn-dedupe-review').addEventListener('click', () => {
        state.reviewPreset = 'burst_best';
        navigate(`#/activity/${activity.id}/review`);
      });
      panel.querySelector('#btn-dedupe-rescan').addEventListener('click', () => runDedupeScan(activity));
      panel.querySelector('#btn-dedupe-undo').addEventListener('click', async () => {
        try {
          const result = await api(`/api/activities/${activity.id}/dedupe/undo`, { method: 'POST' });
          toast(`已撤销连拍精简，恢复 ${result.restored} 张照片的结论`, 'ok');
          await viewActivity(activity.id);
        } catch (error) { toast(error.message, 'error'); }
      });
      return;
    }
    panel.innerHTML = `
      <p class="hint">每次导入完成、以及 AI 全量分析完成后，都会自动精简连拍：按拍摄时间 + 画面相似分组，每组只保留 1 张最好的，其余标为疑似废片。只改尚未人工决定的照片。</p>
      <p class="hint">本次暂未发现可精简的连拍组（同一场景至少 2 个相似对象才会成组），或照片尚未导入。</p>
      <div class="row"><button id="btn-dedupe-scan" class="small ghost">${icon('scan')}手动扫描一次</button></div>`;
    panel.querySelector('#btn-dedupe-scan').addEventListener('click', () => runDedupeScan(activity));
  } catch (error) {
    panel.innerHTML = `<p style="color:var(--red)">${esc(error.message)}</p>`;
  }
}

async function runDedupeScan(activity) {
  const panel = document.querySelector('#dedupe-body');
  if (!panel) return;
  panel.innerHTML = '<div class="progress"><div style="width:35%"></div></div><div class="progress-label">正在计算本地画面/人物向量…</div>';
  try {
    const preview = await api(`/api/activities/${activity.id}/dedupe/preview`);
    if (!preview.group_count) {
      panel.innerHTML = `
        <p class="hint">没有发现明显的连拍组（同一场景至少 2 个相似对象才会成组）。<br>
        可能这场的照片间隔较大，或已经精简过了。</p>
        <div class="row"><button id="btn-dedupe-rescan" class="small">${icon('scan')}重新扫描</button></div>`;
      panel.querySelector('#btn-dedupe-rescan').addEventListener('click', () => runDedupeScan(activity));
      return;
    }
    const groupsHtml = preview.groups.slice(0, 8).map((group) => `
      <div class="dedupe-group">
        <div class="dedupe-group-thumbs">
          ${group.kept.map((item) => `<img class="dedupe-thumb" src="${esc(item.thumb)}" title="${esc(item.file_name)}" alt="">`).join('')}
        </div>
        <div class="grow small">
          <div><b>${group.count} 张连拍</b> · 保留：${group.kept.map((item) => esc(item.file_name)).join('、')}</div>
          <div class="muted">${group.rejected_count ? `其余 ${group.rejected_count} 张标记为疑似废片` : '没有需要标记的重复照片'}</div>
        </div>
      </div>`).join('');
    panel.innerHTML = `
      <div class="ai-summary">
        <div class="ai-summary-item"><span class="ai-summary-value">${preview.group_count}</span><span class="ai-summary-label">连拍组</span></div>
        <div class="ai-summary-item"><span class="ai-summary-value">${preview.object_count}</span><span class="ai-summary-label">涉及照片</span></div>
        <div class="ai-summary-item"><span class="ai-summary-value">${preview.kept_objects}</span><span class="ai-summary-label">保留（每组 1 张）</span></div>
        <div class="ai-summary-item"><span class="ai-summary-value">${preview.rejected_objects}</span><span class="ai-summary-label">标为重复</span></div>
      </div>
      <p class="hint">判定依据：CLIP 场景向量 + 人脸一致性聚类（时间仅排序，不作硬门槛）；优先保留清晰、AI 无问题、已标重要的照片。</p>
      <div class="dedupe-groups">${groupsHtml}</div>
      ${preview.group_count > 8 ? `<p class="hint">…另有 ${preview.group_count - 8} 组，应用后可在“连拍重复”筛选中查看。</p>` : ''}
      <div class="row" style="margin-top:14px">
        <button id="btn-dedupe-apply" class="primary">${icon('check')}应用：每组保留 ${preview.keep_per_group} 张</button>
        <button id="btn-dedupe-cancel" class="ghost">取消</button>
      </div>`;
    panel.querySelector('#btn-dedupe-cancel').addEventListener('click', () => renderDedupePanel(activity));
    panel.querySelector('#btn-dedupe-apply').addEventListener('click', async () => {
      const button = panel.querySelector('#btn-dedupe-apply');
      button.disabled = true;
      button.textContent = '正在应用…';
      try {
        const result = await api(`/api/activities/${activity.id}/dedupe/apply`, {
          method: 'POST', body: JSON.stringify({ keep_per_group: preview.keep_per_group }),
        });
        toast(`已精简 ${result.groups} 组：保留 ${result.kept_photos} 张，标记 ${result.rejected_photos} 张重复`, 'ok');
        state.reviewPreset = 'burst_best';
        navigate(`#/activity/${activity.id}/review`);
      } catch (error) {
        button.disabled = false;
        button.textContent = `应用：每组保留 ${preview.keep_per_group} 张`;
        toast(error.message, 'error');
      }
    });
  } catch (error) {
    panel.innerHTML = `<p style="color:var(--red)">${esc(error.message)}</p>
      <div class="row"><button id="btn-dedupe-rescan" class="small">${icon('scan')}重新扫描</button></div>`;
    panel.querySelector('#btn-dedupe-rescan').addEventListener('click', () => runDedupeScan(activity));
  }
}

/* ---------- 一键导出原片 ---------- */

async function openQuickExport(activityId) {
  try {
    const activity = await api(`/api/activities/${activityId}`);
    const keep = activity.counts?.review?.keep_count || 0;
    if (!keep) {
      toast('还没有标记“保留”的照片，先去复核里标记保留再导出', 'error');
      return;
    }
    openFolderPicker('', (path) => startQuickExport(activityId, path));
  } catch (error) { toast(error.message, 'error'); }
}

async function startQuickExport(activityId, destRoot) {
  const modal = showModal(modalFrame('正在导出原片', `
    <p class="hint">目标文件夹：<span class="mono">${esc(destRoot)}</span></p>
    <p class="hint">正在复制人工标记“保留”的源文件（RAW/JPG），不复制预览图。</p>
    <div class="progress"><div id="quick-bar" style="width:0%"></div></div>
    <div class="progress-label" id="quick-label">正在规划文件…</div>`,
  '<button class="ghost" data-close="1">后台运行</button>'), (root) => bindModalClose(root));

  try {
    const started = await api(`/api/activities/${activityId}/exports/quick`, {
      method: 'POST',
      body: JSON.stringify({ dest_root: destRoot, pair_mode: 'both', keep_source_subdir: true }),
    });
    const exportId = started.export.id;
    const total = started.files;
    const bar = modal.querySelector('#quick-bar');
    const label = modal.querySelector('#quick-label');
    label.textContent = `共 ${total} 个文件 · ${fmtBytes(started.bytes)}，正在复制…`;
    const timer = setInterval(async () => {
      try {
        const data = await api(`/api/exports/${exportId}`);
        const counts = data.item_counts || {};
        const done = counts.done || 0;
        const failed = counts.failed || 0;
        const processed = done + failed;
        bar.style.width = `${total ? Math.round(processed / total * 100) : 100}%`;
        label.textContent = `已复制 ${done} / ${total} 个文件${failed ? `，失败 ${failed}` : ''}`;
        if (!['running'].includes(data.status)) {
          clearInterval(timer);
          const ok = data.status === 'done';
          const body = modal.querySelector('.m-body');
          body.innerHTML = `
            <p class="hint">${ok ? '导出完成' : '导出完成，但有文件复制失败'}</p>
            <div class="ai-summary">
              <div class="ai-summary-item"><span class="ai-summary-value">${done}</span><span class="ai-summary-label">已复制原片</span></div>
              <div class="ai-summary-item"><span class="ai-summary-value">${failed}</span><span class="ai-summary-label">失败</span></div>
            </div>
            <p class="hint">目标文件夹：<span class="mono">${esc(started.dest_root)}</span></p>
            <p class="hint">原文件仍在原位置，没有移动或删除。</p>`;
          const foot = modal.querySelector('.m-foot');
          foot.innerHTML = `<button class="ghost" data-close="1">关闭</button>
            <button class="primary" id="btn-open-export-dest">${icon('folder')}打开目标文件夹</button>`;
          bindModalClose(modal);
          foot.querySelector('#btn-open-export-dest').addEventListener('click', async () => {
            try { await api('/api/fs/open', { method: 'POST', body: JSON.stringify({ path: started.dest_root }) }); }
            catch (error) { toast(error.message, 'error'); }
          });
          if (!document.body.contains(modal)) toast(ok ? `导出完成：${done} 个原片` : `导出完成，${failed} 个文件失败`, ok ? 'ok' : 'error');
        }
      } catch (error) {
        clearInterval(timer);
        label.textContent = `导出状态读取失败：${error.message}`;
      }
    }, 700);
  } catch (error) {
    closeModal();
    toast(error.message, 'error');
  }
}

/* ---------- 导入 ---------- */

function openImportModal(activity, paths) {
  const chosen = [];
  const seen = new Set();
  const addPaths = (items) => {
    (items || []).forEach((path) => {
      if (!path || seen.has(path.toLowerCase())) return;
      seen.add(path.toLowerCase()); chosen.push(path);
    });
  };
  addPaths(paths);
  const folderRows = () => chosen.length
    ? chosen.map((path, index) => `<div class="list-item"><span class="grow" title="${esc(path)}">${sourceIcon(path)}${esc(path)}</span>
        <button class="small ghost" data-remove="${index}">${icon('x')}移除</button></div>`).join('')
    : '<div class="muted small">还没有选择照片。可以一次添加多个文件，或添加多个摄影同学的文件夹。</div>';

  const root = showModal(modalFrame('导入照片', `
    <div class="list" id="folder-list">${folderRows()}</div>
    <div class="row" style="margin-top:12px">
      <button id="btn-add-files">${icon('image')}进入文件夹选择照片…</button>
      <button id="btn-add-folder">${icon('folderOpen')}选择文件夹…</button>
    </div>
    <p class="hint">支持一次选择多个 .ARW/.JPG 等文件；同一目录下的同名 RAW+JPG 会自动配对。导入后每张照片可单独预览，也能在复核页整体浏览。</p>
    <div id="import-progress" style="margin-top:16px"></div>`,
  `<button data-close="1">关闭</button><button class="primary" id="btn-start-import" ${chosen.length ? '' : 'disabled'}>${icon('upload')}开始导入</button>`),
  (rootNode) => {
    bindModalClose(rootNode);
    const refresh = () => {
      rootNode.querySelector('#folder-list').innerHTML = folderRows();
      rootNode.querySelectorAll('[data-remove]').forEach((button) => {
        button.addEventListener('click', () => { chosen.splice(Number(button.dataset.remove), 1); refresh(); });
      });
      rootNode.querySelector('#btn-start-import').disabled = chosen.length === 0;
    };
    refresh();
    rootNode.querySelector('#btn-add-files').addEventListener('click', () => {
      const start = activity?.sources?.[0]?.root_path || '';
      openFilePicker(start, (picked) => { addPaths(picked); openImportModal(activity, chosen); });
    });
    rootNode.querySelector('#btn-add-folder').addEventListener('click', () => {
      openFolderPicker('', (path) => { addPaths([path]); openImportModal(activity, chosen); });
    });
    rootNode.querySelector('#btn-start-import').addEventListener('click', async () => {
      try {
        const jobId = await createImportJob(activity, chosen);
        closeModal();
        setTimeout(() => trackBackgroundImport(activity.id, jobId), 120);
        toast('正在后台导入，已生成预览的照片可以先开始粗筛', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }, {
    closeGuard: () => chosen.length > 0,
    closeConfirmMessage: '还有已选照片没有导入，确定关闭吗？',
  });
}

async function createImportJob(activity, paths) {
  const { job_id: jobId } = await api(`/api/activities/${activity.id}/import`, {
    method: 'POST', body: JSON.stringify({ paths, auto_dedupe: true }),
  });
  return jobId;
}

function importProgressPanel() {
  let panel = document.querySelector('#rm-import-progress');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'rm-import-progress';
    panel.className = 'rm-import-progress';
    panel.innerHTML = `
      <div class="rm-import-head"><span>正在导入照片</span><b id="rm-import-percent">0%</b></div>
      <div class="rm-import-track"><i id="rm-import-bar"></i></div>
      <p id="rm-import-label">正在扫描文件…</p>`;
    document.body.appendChild(panel);
    requestAnimationFrame(() => panel.classList.add('open'));
  }
  return panel;
}

function setImportProgress(percent, label, state = 'running') {
  const panel = importProgressPanel();
  panel.dataset.state = state;
  panel.querySelector('#rm-import-percent').textContent = state === 'scanning'
    ? '扫描中'
    : `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
  panel.querySelector('#rm-import-bar').style.width = `${Math.max(2, Math.min(100, percent))}%`;
  panel.querySelector('#rm-import-label').textContent = label;
}

function hideImportProgress(delay = 1800) {
  const panel = document.querySelector('#rm-import-progress');
  if (!panel) return;
  setTimeout(() => {
    panel.classList.remove('open');
    panel.classList.add('leaving');
    setTimeout(() => panel.remove(), 240);
  }, delay);
}

function trackBackgroundImport(activityId, jobId) {
  if (state.importTimer) { clearInterval(state.importTimer); state.importTimer = null; }
  setImportProgress(0, '正在扫描文件…');
  state.importRefreshPaused = false;
  const tick = async () => {
    try {
      const job = await api(`/api/jobs/${jobId}`);
      const total = Number(job.total || 0);
      const finished = Number(job.done_count || 0) + Number(job.failed_count || 0);
      const percent = total ? Math.round(finished / total * 100) : 0;
      if (job.status === 'failed') {
        setImportProgress(100, `导入失败：${job.error || '未知错误'}`, 'error');
      } else if (job.status === 'done' || job.status === 'cancelled') {
        setImportProgress(100, job.status === 'cancelled' ? '导入已取消' : `导入完成：${finished} / ${total}`, 'done');
      } else if (!total) {
        setImportProgress(0, '正在扫描文件夹/读取照片…', 'scanning');
      } else {
        setImportProgress(percent, `生成预览 ${finished} / ${total}`, 'running');
      }
      if (['done', 'failed', 'cancelled'].includes(job.status)) {
        clearInterval(state.importTimer); state.importTimer = null;
        if (job.status === 'failed') {
          toast(`导入失败：${job.error || '未知错误'}`, 'error');
          setImportProgress(100, `导入失败：${job.error || '未知错误'}`, 'error');
        } else {
          toast('照片导入完成', 'ok');
          hideImportProgress(1600);
          if (location.hash === `#/activity/${activityId}` && !modalRoot.children.length) {
            await viewActivity(activityId);
          }
        }
      }
    } catch (error) {
      clearInterval(state.importTimer); state.importTimer = null;
      toast(error.message, 'error');
    }
  };
  state.importTimer = setInterval(tick, 900);
  tick();
}

async function startImport(activity, paths, rootNode) {
  const progress = rootNode.querySelector('#import-progress');
  progress.innerHTML = '<div class="progress"><div style="width:0%"></div></div><div class="progress-label">正在扫描文件夹…</div>';
  try {
    const jobId = await createImportJob(activity, paths);
    const startButton = rootNode.querySelector('#btn-start-import');
    if (startButton) startButton.disabled = true;
    state.jobTimer = setInterval(async () => {
      try {
        const job = await api(`/api/jobs/${jobId}`);
        const percent = job.total ? Math.round((job.done_count + job.failed_count) / job.total * 100) : 0;
        const stage = job.result && job.result.stage;
        progress.innerHTML = `<div class="progress"><div style="width:${percent}%"></div></div>
          <div class="progress-label">${stage === 'scanning' ? '扫描文件…' : `生成预览 ${job.done_count + job.failed_count} / ${job.total}（失败 ${job.failed_count}）`}</div>`;
        if (['done', 'failed', 'cancelled'].includes(job.status)) {
          clearInterval(state.jobTimer); state.jobTimer = null;
          if (job.status === 'failed') {
            progress.innerHTML += `<p style="color:var(--red)">导入失败：${esc(job.error || '未知错误')}</p>`;
            return;
          }
          const result = job.result || {};
          const sources = result.sources || [];
          const added = sources.reduce((sum, item) => sum + (item.added || 0), 0);
          const skipped = sources.reduce((sum, item) => sum + (item.skipped || 0), 0);
          const paired = sources.reduce((sum, item) => sum + (item.paired || 0), 0);
          const errors = sources.flatMap((item) => item.errors || []);
          const dedupe = result.dedupe;
          const dedupeLine = dedupe
            ? `<p class="hint">已自动精简连拍：${dedupe.groups} 组，保留 ${dedupe.kept_photos} 张，标记 ${dedupe.rejected_photos} 张重复。</p>`
            : '';
          progress.innerHTML = `<p>完成：新增 ${added} 个文件，跳过重复 ${skipped} 个，配对 ${paired} 组，预览失败 ${job.failed_count} 个。</p>
            ${dedupeLine}
            ${errors.length ? `<p class="hint">${errors.slice(0, 5).map(esc).join('<br>')}</p>` : ''}
            <div class="row"><button class="primary" id="btn-goto-review">${icon('scan')}开始 AI 粗筛</button><button id="btn-close-import">关闭</button></div>`;
          progress.querySelector('#btn-close-import').addEventListener('click', () => { closeModal(); navigate(`#/activity/${activity.id}`); });
          progress.querySelector('#btn-goto-review').addEventListener('click', () => {
            closeModal();
            navigate(`#/activity/${activity.id}`);
          });
        }
      } catch (error) {
        clearInterval(state.jobTimer); state.jobTimer = null;
        progress.innerHTML = `<p style="color:var(--red)">${esc(error.message)}</p>`;
      }
    }, 900);
  } catch (error) {
    progress.innerHTML = `<p style="color:var(--red)">${esc(error.message)}</p>`;
  }
}

/* ---------- 文件夹选择 ---------- */

async function openFolderPicker(startPath, onPick, allowFiles = false) {
  let current = startPath || '';
  let before = 0;
  const dialog = showModal(modalFrame('选择文件夹', `
    <div class="folder-bar">
      <button class="small" id="folder-up">${icon('arrowLeft')}上一级</button>
      <span class="path mono" id="folder-path">此电脑</span>
    </div>
    <div class="folder-new-row" id="folder-new-row" hidden>
      <input id="folder-new-name" type="text" placeholder="新文件夹名称" autocomplete="off">
      <button class="small" id="folder-new-ok" type="button">创建</button>
      <button class="small ghost" id="folder-new-cancel" type="button">取消</button>
    </div>
    <div class="folder-list" id="folder-list"></div>`,
  `<button class="ghost" id="folder-new" type="button" disabled>${icon('plus')}新建文件夹</button>
   <button data-close="1">取消</button><button id="folder-pick" disabled>${icon('check')}选择此文件夹</button>`),
  (root) => bindModalClose(root));
  const listNode = dialog.querySelector('#folder-list');
  const pathNode = dialog.querySelector('#folder-path');
  const upButton = dialog.querySelector('#folder-up');
  const pickButton = dialog.querySelector('#folder-pick');
  const newButton = dialog.querySelector('#folder-new');
  const newRow = dialog.querySelector('#folder-new-row');
  const newName = dialog.querySelector('#folder-new-name');
  const newOk = dialog.querySelector('#folder-new-ok');
  const newCancel = dialog.querySelector('#folder-new-cancel');
  let dataState = null;
  let requestSeq = 0;

  const hideNewRow = () => {
    newRow.hidden = true;
    newName.value = '';
  };
  const createFolder = async () => {
    if (!current) { toast('请先进入一个磁盘或文件夹', 'error'); return; }
    const name = newName.value.trim();
    if (!name) { toast('请填写文件夹名称', 'error'); newName.focus(); return; }
    newOk.disabled = true;
    try {
      const result = await api('/api/fs/mkdir', { method: 'POST', body: JSON.stringify({ parent: current, name }) });
      hideNewRow();
      current = result.path;
      await render();
      toast(`已创建文件夹：${name}`, 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      newOk.disabled = false;
    }
  };
  newButton.addEventListener('click', () => {
    if (!current) return;
    newRow.hidden = false;
    newName.focus();
  });
  newCancel.addEventListener('click', hideNewRow);
  newOk.addEventListener('click', createFolder);
  newName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); createFolder(); }
    if (event.key === 'Escape') { event.preventDefault(); hideNewRow(); }
  });

  const render = async () => {
    const seq = ++requestSeq;
    dataState = null;
    pickButton.disabled = true;
    upButton.disabled = true;
    let data;
    try {
      data = await api(`/api/fs/list${current ? `?path=${encodeURIComponent(current)}` : ''}`);
    } catch (error) {
      if (seq === requestSeq) toast(error.message, 'error');
      return;
    }
    if (seq !== requestSeq) return; // an older folder request finished late
    dataState = data;
    before = current;
    newButton.disabled = !data.path;
    hideNewRow();
    const entries = data.entries || [];
    pathNode.textContent = data.path || '此电脑';
    upButton.disabled = data.parent == null;
    listNode.innerHTML = entries.length
      ? entries.map((entry) => `<div class="folder-item" data-path="${esc(entry.path)}">${icon('folder')}${esc(entry.name)}</div>`).join('')
      : '<div class="empty">这个文件夹里没有子文件夹</div>';
    const parent = data.parent;
    upButton.onclick = () => {
      if (parent == null) return;
      current = parent;
      render();
    };
    pickButton.disabled = !data.path;
    pickButton.onclick = () => {
      if (!current || !dataState?.path) return;
      const chosen = dataState.path;
      closeModal();
      onPick(chosen);
    };
    listNode.querySelectorAll('.folder-item').forEach((item) => {
      item.addEventListener('click', () => {
        current = item.dataset.path;
        render();
      });
    });
  };
  await render();
}


async function openFilePicker(startPath, onPick) {
  let current = startPath || '';
  const selected = new Set();
  let viewMode = 'grid';
  let thumbSize = 120;
  let anchorIndex = -1;
  let files = [];
  let data = null;
  const maxSize = 999;

  const dialog = showModal(modalFrame('选择要导入的照片', `
    <div class="picker-shell">
      <div class="picker-toolbar">
        <button class="small" id="picker-up">${icon('arrowLeft')}上一级</button>
        <span class="picker-path mono" id="picker-path">此电脑</span>
        <div class="picker-view-group" role="group" aria-label="浏览方式">
          <button type="button" data-picker-view="grid" class="active" title="缩略图网格">${icon('image')}网格</button>
          <button type="button" data-picker-view="list" title="列表">${icon('checklist')}列表</button>
        </div>
        <div class="picker-size-group" role="group" aria-label="缩略图大小">
          <button type="button" data-picker-size="84" title="小图标">小</button>
          <button type="button" data-picker-size="120" class="active" title="中图标">中</button>
          <button type="button" data-picker-size="168" title="大图标">大</button>
          <button type="button" data-picker-size="224" title="特大图标">特大</button>
        </div>
      </div>
      <div class="picker-body">
        <div class="picker-browser" id="picker-browser"><div class="picker-empty">正在读取文件夹…</div></div>
        <aside class="picker-preview" aria-label="照片预览">
          <div class="picker-preview-stage" id="picker-preview-stage"><span class="picker-preview-empty">单击照片即可预览；Ctrl / Shift 可多选</span></div>
          <div class="picker-preview-meta" id="picker-preview-meta">选择照片后按确定加入导入列表</div>
        </aside>
      </div>
    </div>`,
  `<span class="picker-footer-count" id="picker-footer-count">已选 0 张</span>
   <button class="ghost" id="picker-select-folder" type="button">${icon('check')}全选本文件夹</button>
   <button data-close="1">取消</button>
   <button class="primary" id="picker-confirm" type="button">${icon('plus')}添加所选照片</button>`),
  (root) => bindModalClose(root), {wide: true});
  dialog.classList.add('picker-wide');

  const browser = dialog.querySelector('#picker-browser');
  const pathLabel = dialog.querySelector('#picker-path');
  const previewStage = dialog.querySelector('#picker-preview-stage');
  const previewMeta = dialog.querySelector('#picker-preview-meta');
  const footerCount = dialog.querySelector('#picker-footer-count');
  const confirmButton = dialog.querySelector('#picker-confirm');

  const updateFooter = () => {
    footerCount.textContent = `已选 ${selected.size} 张`;
    confirmButton.disabled = selected.size === 0;
    confirmButton.innerHTML = `${icon('plus')}添加所选照片${selected.size ? `（${selected.size}）` : ''}`;
  };

  const showPreview = (entry) => {
    if (!entry) {
      previewStage.innerHTML = '<span class="picker-preview-empty">单击照片即可预览；Ctrl / Shift 可多选</span>';
      previewMeta.textContent = '选择照片后按确定加入导入列表';
      return;
    }
    previewStage.innerHTML = `<img src="/api/fs/thumb?size=1200&path=${encodeURIComponent(entry.path)}" alt="">`;
    previewMeta.innerHTML = `<b>${esc(entry.name)}</b>${esc((entry.name.split('.').pop() || '').toUpperCase())} · ${fmtBytes(entry.size || 0)}<br>${selected.has(entry.path) ? '已加入导入列表' : 'Ctrl 单击追加 / Shift 连续选择'}`;
  };

  const paintSelection = () => {
    dialog.querySelectorAll('[data-picker-index]').forEach((node) => {
      const entry = files[Number(node.dataset.pickerIndex)];
      node.classList.toggle('selected', Boolean(entry && selected.has(entry.path)));
      const badge = node.querySelector('.picker-badge');
      if (badge) badge.textContent = entry && selected.has(entry.path) ? '✓' : '';
    });
    updateFooter();
  };

  const selectRange = (from, to, additive) => {
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    if (!additive) selected.clear();
    for (let i = start; i <= end; i += 1) if (files[i]) selected.add(files[i].path);
  };

  const render = async () => {
    try {
      data = await api(`/api/fs/list?files=1${current ? `&path=${encodeURIComponent(current)}` : ''}`);
    } catch (error) { toast(error.message, 'error'); return; }
    files = (data.entries || []).filter((entry) => entry.type === 'file');
    const dirs = (data.entries || []).filter((entry) => entry.type !== 'file');
    pathLabel.textContent = data.path || '此电脑';
    dialog.querySelector('#picker-up').disabled = data.parent == null;
    const dirMarkup = dirs.map((entry) => `<button type="button" class="picker-dir" data-picker-dir="${esc(entry.path)}">${icon('folder')}${esc(entry.name)}</button>`).join('');
    const fileMarkup = files.map((entry, index) => `<button type="button" class="picker-item${selected.has(entry.path) ? ' selected' : ''}" data-picker-index="${index}" title="${esc(entry.name)}">
        <span class="picker-thumb">${viewMode === 'grid' ? `<img loading="lazy" src="/api/fs/thumb?size=${Math.round(thumbSize * 1.5)}&path=${encodeURIComponent(entry.path)}" alt="" onerror="this.remove()">` : ''}<i class="picker-badge" aria-hidden="true"></i></span>
        <span class="picker-name">${esc(entry.name)}</span>
        ${viewMode === 'list' ? `<span class="picker-size">${fmtBytes(entry.size || 0)}</span>` : ''}
      </button>`).join('');
    browser.innerHTML = `<div class="picker-dirs">${dirMarkup || '<span class="picker-empty">没有子文件夹</span>'}</div>
      <div class="picker-${viewMode}" id="picker-file-list" style="--picker-thumb:${thumbSize}px">${fileMarkup || '<div class="picker-empty">这个文件夹里没有可导入的照片</div>'}</div>`;
    updateFooter();
    const selectedEntry = [...selected].map((path) => files.find((entry) => entry.path === path)).find(Boolean);
    showPreview(selectedEntry || null);
  };

  dialog.querySelector('#picker-up').addEventListener('click', () => { if (data?.parent == null) return; current = data.parent; render(); });
  dialog.querySelectorAll('[data-picker-view]').forEach((button) => button.addEventListener('click', () => {
    viewMode = button.dataset.pickerView;
    dialog.querySelectorAll('[data-picker-view]').forEach((node) => node.classList.toggle('active', node === button));
    render();
  }));
  dialog.querySelectorAll('[data-picker-size]').forEach((button) => button.addEventListener('click', () => {
    thumbSize = Number(button.dataset.pickerSize) || 120;
    viewMode = 'grid';
    dialog.querySelectorAll('[data-picker-size]').forEach((node) => node.classList.toggle('active', node === button));
    dialog.querySelectorAll('[data-picker-view]').forEach((node) => node.classList.toggle('active', node.dataset.pickerView === 'grid'));
    render();
  }));
  browser.addEventListener('click', (event) => {
    const dir = event.target.closest('[data-picker-dir]');
    if (dir) { current = dir.dataset.pickerDir; anchorIndex = -1; render(); return; }
    const item = event.target.closest('[data-picker-index]');
    if (!item) return;
    const index = Number(item.dataset.pickerIndex);
    const entry = files[index];
    if (!entry) return;
    if (event.shiftKey && anchorIndex >= 0) {
      selectRange(anchorIndex, index, event.ctrlKey || event.metaKey);
    } else if (event.ctrlKey || event.metaKey) {
      if (selected.has(entry.path)) selected.delete(entry.path); else selected.add(entry.path);
      anchorIndex = index;
    } else {
      selected.clear();
      selected.add(entry.path);
      anchorIndex = index;
    }
    paintSelection();
    showPreview(entry);
  });
  browser.addEventListener('dblclick', (event) => {
    const item = event.target.closest('[data-picker-index]');
    if (!item) return;
    const index = Number(item.dataset.pickerIndex);
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      selected.clear();
      if (files[index]) selected.add(files[index].path);
      paintSelection();
      showPreview(files[index]);
    }
  });
  dialog.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      files.forEach((entry) => selected.add(entry.path));
      paintSelection();
    }
  });
  dialog.querySelector('#picker-select-folder').addEventListener('click', () => {
    files.forEach((entry) => selected.add(entry.path));
    paintSelection();
  });
  dialog.querySelector('#picker-confirm').addEventListener('click', () => {
    if (!selected.size) return;
    const paths = [...selected];
    closeModal();
    onPick(paths);
  });
  await render();
}


/* ---------- 复合操作：一键导出/删除、右键、批量 ---------- */

const REVIEW_CATEGORIES = [
  ['all', '全部'], ['undecided', '待处理'], ['keep', '保留'],
  ['uncertain', '待确认'], ['reject', '疑似废片'],
  ['burst_best', '连拍精选'], ['dedupe_duplicates', '连拍重复'],
];

function reviewCategoryLabel(category) {
  return (REVIEW_CATEGORIES.find(([key]) => key === category) || [category, '全部'])[1];
}

function reviewCategoryCount(category) {
  const reviewCounts = state.activity?.counts?.review || {};
  const mapping = {
    all: state.activity?.counts?.files, keep: 'keep_count', reject: 'reject_count',
    uncertain: 'uncertain_count', undecided: 'undecided',
    burst_best: 'burst_best_count', dedupe_duplicates: 'burst_duplicate_count',
  };
  const key = mapping[category];
  if (typeof key === 'string' && reviewCounts[key] != null) return Number(reviewCounts[key]) || 0;
  if (typeof key === 'number') return key;
  if (state.photos.category === category) return state.photos.total || 0;
  return 0;
}

function currentReviewCategory() {
  return state.photos.category || 'all';
}

function openCategoryPicker(title, hintText, actionLabel, onConfirm) {
  closePhotoContextMenu();
  const options = REVIEW_CATEGORIES.filter(([key]) => reviewCategoryCount(key) > 0);
  if (!options.length) { toast('当前没有可操作的照片', 'error'); return; }
  const selected = options.some(([key]) => key === currentReviewCategory()) ? currentReviewCategory() : options[0][0];
  showModal(modalFrame(title, `
    <p class="hint" style="margin-bottom:12px">${esc(hintText)}</p>
    <div class="choice-row" id="category-pick-row">
      ${options.map(([key, label]) => `<button class="choice ${key === selected ? 'active' : ''}" data-category-pick="${key}" type="button">${label}<small>${reviewCategoryCount(key)}</small></button>`).join('')}
    </div>`, `
    <button data-close="1">取消</button>
    <button class="primary" id="btn-category-confirm" type="button">${esc(actionLabel)}</button>`),
  (root) => {
    bindModalClose(root);
    let chosen = selected;
    root.querySelectorAll('[data-category-pick]').forEach((button) => {
      button.addEventListener('click', () => {
        chosen = button.dataset.categoryPick;
        root.querySelectorAll('[data-category-pick]').forEach((node) => node.classList.toggle('active', node === button));
      });
    });
    initChoiceSliders();
    root.querySelector('#btn-category-confirm').addEventListener('click', () => {
      closeModal();
      onConfirm(chosen);
    });
  });
}

function openDeleteModeDialog(label, count, onChoose) {
  const name = label || `${count} 张照片`;
  showModal(modalFrame(`删除 ${name}`, `
    <p class="hint">请选择删除方式。彻底删除会直接删除源目录中的原片，无法恢复；仅从软件删除会保留源文件。</p>
    <div class="delete-mode-list">
      <button class="delete-mode-option" type="button" data-delete-mode="app">
        <span class="delete-mode-icon">${icon('eye')}</span>
        <span><b>仅从软件中删除</b><small>移除索引、缩略图和选片记录，源目录里的原片保持不动。</small></span>
      </button>
      <button class="delete-mode-option danger" type="button" data-delete-mode="disk">
        <span class="delete-mode-icon">${icon('trash')}</span>
        <span><b>彻底删除源文件</b><small>同时删除源目录中的原片和软件中的记录，操作不可恢复。</small></span>
      </button>
    </div>`, '<button data-close="1">取消</button>'), (root) => {
    bindModalClose(root);
    root.querySelectorAll('[data-delete-mode]').forEach((button) => {
      const dangerous = button.dataset.deleteMode === 'disk';
      const style = button.style;
      const baseBorder = dangerous
        ? 'color-mix(in srgb, var(--red) 42%, var(--panel-stroke))'
        : 'var(--panel-stroke)';
      const hoverBorder = dangerous ? 'var(--red)' : 'var(--accent)';
      style.setProperty('background-color', 'color-mix(in srgb, var(--canvas) 70%, transparent)', 'important');
      style.setProperty('background-image', 'linear-gradient(135deg, rgba(255,255,255,.11), rgba(255,255,255,.025) 46%, rgba(0,0,0,.14))', 'important');
      style.setProperty('border', `1px solid ${baseBorder}`, 'important');
      style.setProperty('box-shadow', 'var(--panel-shadow)', 'important');
      style.setProperty('transform', 'none', 'important');
      style.setProperty('transition', 'transform 180ms cubic-bezier(.22,1,.36,1), border-color 160ms ease, box-shadow 180ms ease', 'important');
      style.setProperty('backdrop-filter', 'var(--panel-backdrop)', 'important');
      style.setProperty('-webkit-backdrop-filter', 'var(--panel-backdrop)', 'important');
      button.addEventListener('pointerenter', () => {
        style.setProperty('transform', 'translateY(-1px)', 'important');
        style.setProperty('border-color', hoverBorder, 'important');
        style.setProperty('box-shadow', 'var(--floating-shadow)', 'important');
      });
      button.addEventListener('pointerleave', () => {
        style.setProperty('transform', 'none', 'important');
        style.setProperty('border-color', baseBorder, 'important');
        style.setProperty('box-shadow', 'var(--panel-shadow)', 'important');
      });
      button.addEventListener('pointerdown', () => style.setProperty('transform', 'translateY(0) scale(.996)', 'important'));
      button.addEventListener('click', () => {
        closeModal();
        onChoose(button.dataset.deleteMode);
      });
    });
  });
}

async function chooseExportFolder(options = {}) {
  return new Promise((resolve) => {
    openFolderPicker('', (path) => resolve(path));
  });
}

async function runBatchExport({ title, photoIds = [], category = null, sourceId = null, label = '所选照片' }) {
  let dest = '';
  try {
    dest = await chooseExportFolder();
  } catch (_) { return; }
  if (!dest) return;
  const modal = showModal(modalFrame('正在导出', `
    <p class="hint">${esc(label)} → <span class="mono">${esc(dest)}</span></p>
    <div class="progress"><div id="batch-export-bar" style="width:22%"></div></div>
    <div class="progress-label" id="batch-export-label">正在复制原片…</div>`, '<button class="ghost" data-close="1">后台运行</button>'),
  (root) => bindModalClose(root));
  try {
    const result = await api(`/api/activities/${state.activity.id}/photos/export-batch`, {
      method: 'POST',
      body: JSON.stringify({ dest_root: dest, photo_ids: photoIds, category, source_id: sourceId }),
    });
    modal.querySelector('#batch-export-bar').style.width = '100%';
    modal.querySelector('#batch-export-label').textContent = `完成：${result.copied} 张${result.failed ? `，${result.failed} 张失败` : ''}`;
    const foot = modal.querySelector('.m-foot');
    foot.innerHTML = `<button class="ghost" data-close="1">关闭</button><button class="primary" id="btn-batch-open-dest">${icon('folder')}打开目标文件夹</button>`;
    bindModalClose(modal);
    foot.querySelector('#btn-batch-open-dest').addEventListener('click', () => api('/api/fs/open', { method: 'POST', body: JSON.stringify({ path: dest }) }).catch((error) => toast(error.message, 'error')));
    toast(result.failed ? `导出完成，${result.failed} 张失败` : `已导出 ${result.copied} 张原片`, result.failed ? 'error' : 'ok');
  } catch (error) {
    closeModal();
    toast(error.message, 'error');
  }
}

async function runBatchDelete({ photoIds = [], category = null, sourceId = null, label = '所选照片', count = 0 }) {
  openDeleteModeDialog(label, count, async (mode) => {
    try {
      const result = await api(`/api/activities/${state.activity.id}/photos/delete-batch`, {
        method: 'POST',
        body: JSON.stringify({ mode, photo_ids: photoIds, category, source_id: sourceId }),
      });
      state.picked.clear();
      state.selectedId = null;
      state.selectedPhoto = null;
      toast(`已删除 ${result.deleted} 张${mode === 'disk' ? `，源文件 ${result.deleted_files} 个` : '（源文件保留）'}`, 'ok');
      await loadPhotos(true);
      renderBatchActions();
      const detail = app.querySelector('#detail');
      if (detail) detail.innerHTML = '<div class="detail-empty">选择一张照片开始复核</div>';
    } catch (error) { toast(error.message, 'error'); }
  });
}

function exportReviewCategory() {
  if (!state.activity) return;
  openCategoryPicker('一键导出', '选择要导出的分类栏，随后选择目标文件夹。', '选择文件夹', async (category) => {
    const count = reviewCategoryCount(category);
    if (!count) { toast('该分类没有照片', 'error'); return; }
    await runBatchExport({ category, sourceId: state.photos.sourceId || null, label: `${reviewCategoryLabel(category)} · ${count} 张` });
  });
}

function deleteReviewCategory() {
  if (!state.activity) return;
  openCategoryPicker('一键删除', '选择要删除的分类栏，再决定是彻底删除源文件还是只从软件中移除。', '选择删除方式', (category) => {
    const count = reviewCategoryCount(category);
    if (!count) { toast('该分类没有照片', 'error'); return; }
    runBatchDelete({ category, sourceId: state.photos.sourceId || null, label: `${reviewCategoryLabel(category)} · ${count} 张`, count });
  });
}

function exportSelectedPhotos() {
  if (!state.picked.size) return;
  runBatchExport({ photoIds: [...state.picked], label: `${state.picked.size} 张所选照片` });
}

function deleteSelectedPhotos() {
  if (!state.picked.size) return;
  runBatchDelete({ photoIds: [...state.picked], label: `${state.picked.size} 张所选照片`, count: state.picked.size });
}

function deleteSinglePhoto(photoId, label, mode) {
  const disk = mode === 'disk';
  showModal(modalFrame(`删除 ${label}`, `
    <p class="hint">${disk ? '将删除源目录中的原片，并从软件中移除，操作不可恢复。' : '只从软件中移除记录和缩略图，源目录里的原片保留。'}</p>
    <p class="hint" style="margin-top:8px;color:${disk ? 'var(--red)' : 'var(--muted)'}">${disk ? '彻底删除源文件' : '仅从软件中删除'}</p>`,
    `<button data-close="1">取消</button><button class="${disk ? 'danger' : 'primary'}" id="btn-confirm-single-delete">${icon('trash')}确认删除</button>`),
  (root) => {
    bindModalClose(root);
    root.querySelector('#btn-confirm-single-delete').addEventListener('click', async () => {
      closeModal();
      try {
        await api(`/api/photos/${photoId}/delete`, { method: 'POST', body: JSON.stringify({ mode }) });
        toast(disk ? '已彻底删除这张照片' : '已从软件中删除这张照片（源文件保留）', 'ok');
        if (state.selectedId === photoId) {
          state.selectedId = null; state.selectedPhoto = null;
          const detail = app.querySelector('#detail');
          if (detail) detail.innerHTML = '<div class="detail-empty">选择一张照片开始复核</div>';
        }
        await loadPhotos(true);
      } catch (error) { toast(error.message, 'error'); }
    });
  });
}

function exportSinglePhoto(photoId, label) {
  openFolderPicker('', async (dest) => {
    try {
      const result = await api(`/api/photos/${photoId}/export`, { method: 'POST', body: JSON.stringify({ dest_root: dest }) });
      if (result.copied) {
        toast(`已导出 ${label} → ${dest}`, 'ok');
      } else {
        toast(`导出失败：源文件可能已移动或磁盘离线（失败 ${result.failed || 0} 个）`, 'error');
      }
    } catch (error) { toast(error.message, 'error'); }
  });
}

function closePhotoContextMenu(immediate = false) {
  const menu = document.querySelector('#photo-context-menu');
  if (!menu || menu.dataset.leaving) return;
  menu.dataset.leaving = 'true';
  if (immediate || !motionAllowed()) { menu.remove(); return; }
  menu.style.pointerEvents = 'none';
  menu.classList.add('rm-menu-leaving');
  Promise.resolve(animateMenuClose(menu, 'top left')).then(() => menu.remove());
}

function openPhotoContextMenu(photoId, x, y) {
  closePhotoContextMenu(true);
  const photo = state.photos.items.find((item) => item.id === photoId);
  if (!photo) return;
  const menu = document.createElement('div');
  menu.id = 'photo-context-menu';
  menu.className = 'photo-context-menu';
  menu.innerHTML = `<div class="cm-title">${esc(photo.file_name)}</div>
    <div class="cm-title" style="border:0;padding-top:2px;color:var(--faint)">分类到</div>
    <button type="button" data-cm="keep"><span class="cm-icon">${icon('check')}</span>保留</button>
    <button type="button" data-cm="reject"><span class="cm-icon">${icon('x')}</span>排除</button>
    <button type="button" data-cm="uncertain"><span class="cm-icon">${icon('help')}</span>待确认</button>
    <button type="button" data-cm="important"><span class="cm-icon">${icon('star')}</span>${photo.important ? '取消重要' : '标记重要'}</button>
    <div class="cm-divider"></div>
    <button type="button" data-cm="export"><span class="cm-icon">${icon('download')}</span>导出这张照片…</button>
    <button type="button" data-cm="delete-app" class="danger"><span class="cm-icon">${icon('eye')}</span>仅从软件中删除</button>
    <button type="button" data-cm="delete-disk" class="danger"><span class="cm-icon">${icon('trash')}</span>彻底删除源文件</button>`;
  document.body.appendChild(menu);
  animateMenuOpen(menu, 'top left');
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  menu.style.left = `${Math.min(x, innerWidth - width - 10)}px`;
  menu.style.top = `${Math.min(y, innerHeight - height - 10)}px`;
  menu.querySelectorAll('[data-cm]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const action = button.dataset.cm;
      closePhotoContextMenu();
      try {
        if (['keep', 'reject', 'uncertain'].includes(action)) {
          await api(`/api/photos/${photoId}/decision`, { method: 'POST', body: JSON.stringify({ verdict: action }) });
          await applyDecision(photoId, action);
        } else if (action === 'important') {
          const next = !photo.important;
          await api(`/api/photos/${photoId}/decision`, { method: 'POST', body: JSON.stringify({ important: next }) });
          await selectPhoto(photoId);
          updateCardBadge(photoId, { important: next });
        } else if (action === 'export') {
          exportSinglePhoto(photoId, photo.file_name);
        } else if (action === 'delete-app') {
          deleteSinglePhoto(photoId, photo.file_name, 'app');
        } else if (action === 'delete-disk') {
          deleteSinglePhoto(photoId, photo.file_name, 'disk');
        }
      } catch (error) { toast(error.message, 'error'); }
    });
  });
  setTimeout(() => {
    const dismiss = (event) => {
      if (event.target.closest?.('#photo-context-menu')) return;
      closePhotoContextMenu();
      document.removeEventListener('pointerdown', dismiss, true);
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('scroll', closePhotoContextMenu, { once: true, capture: true });
  }, 0);
}

/* ---------- 复核工作台 ---------- */

function filterSidebar(activity) {
  const counts = activity.counts || {};
  const review = counts.review || {};
  const categoryIcons = {
    all: 'image', undecided: 'clock', burst_best: 'layers', keep: 'check', reject: 'x',
    dedupe_duplicates: 'compare', uncertain: 'help', important: 'star', ai_reject: 'scan',
    ai_uncertain: 'scan', unreadable: 'alert', refine: 'scan',
  };
  const categories = [
    ['all', '全部', counts.files || 0],
    ['undecided', '待处理', review.undecided || 0],
    ['keep', '保留', review.keep_count || 0],
    ['uncertain', '待确认', review.uncertain_count || 0],
    ['reject', '疑似废片', review.reject_count || 0],
    ['burst_best', '连拍精选', review.burst_best_count || 0],
    ['dedupe_duplicates', '连拍重复', review.burst_duplicate_count || 0],
  ];
  return `<aside class="review-filters">
    <div class="filter-rail-head">
      <span class="filter-rail-title">筛选</span>
      <button type="button" class="filter-rail-btn" id="btn-filter-collapse" title="收起筛选栏" aria-label="收起筛选栏">${icon('chevronLeft')}</button>
      <button type="button" class="filter-rail-btn filter-rail-expand" id="btn-filter-expand" title="展开筛选栏" aria-label="展开筛选栏">${icon('chevronRight')}</button>
    </div>
    ${categories.map(([key, name, count]) => `
      <div class="filter-item ${state.photos.category === key ? 'active' : ''}" data-cat="${key}" role="button" tabindex="0" title="${name}">
        <span class="filter-label">${icon(categoryIcons[key])}<span>${name}</span></span><span class="filter-count">${count}</span>
      </div>`).join('')}
    <div class="filter-sep">来源</div>
    <select id="source-filter" style="width:100%">
      <option value="">全部来源</option>
      ${activity.sources.map((source) => `<option value="${source.id}">${esc(source.label)}（${source.photo_count}）</option>`).join('')}
    </select>
  </aside>`;
}



async function viewReview(activityId, options = {}) {
  const viewHash = location.hash;
  const embedded = Boolean(options.host);
  if (!embedded) {
    try {
      const status = await api(`/api/activities/${activityId}/analysis/status`);
      const job = status.job;
      if (job && job.status !== 'done') {
        toast('粗筛还没结束，全部完成后再进入人工复筛', 'info');
        navigate(`#/activity/${activityId}`);
        return;
      }
    } catch (_) { /* 状态接口失败时不阻塞旧数据复核 */ }
  }
  const host = options.host || app;
  if (!embedded) state.view = 'review';
  const activity = await api(`/api/activities/${activityId}`);
  if (location.hash !== viewHash) return;
  if (!host.isConnected) return;
  const aiDone = Number((((activity.counts || {}).review || {}).ai_done) || 0);
  if (!embedded && aiDone <= 0) {
    navigate(`#/activity/${activity.id}`);
    return;
  }
  state.activity = activity;
  state.labels = activity.labels;
  state.photos = { items: [], total: 0, offset: 0, loading: false,
    category: state.reviewPreset || 'all', sourceId: '', q: '' };
  state.reviewPreset = null;
  state.selectedId = null;
  reviewRangeAnchor = null;
  state.gridReady = false;
  state.multi = false;
  state.picked = new Set();
  state.compareMode = false;
  state.compareA = null;
  state.collapsedSources = new Set();
  state.activeSource = null;
  const filtersCollapsed = window.innerWidth > 980 && localStorage.getItem('cull-filters-collapsed') === '1';
  const detailCollapsed = localStorage.getItem('cull-detail-collapsed') === '1';

  host.innerHTML = `<div class="review-page ${filtersCollapsed ? 'filters-collapsed' : ''} ${embedded ? 'review-embedded' : ''}">
    <div class="review-head">
      <button class="ghost small" id="btn-back">${icon('arrowLeft')}活动</button>
      <h1>${esc(activity.name)}</h1>
      <span class="hint" id="workbench-hint"></span>
      <span class="spacer"></span>
      <button class="small ink" id="btn-review-export">${icon('download')}一键导出</button>
      <button class="small review-danger-button" id="btn-review-delete">${icon('trash')}一键删除</button>
      <button class="small" id="btn-compare">${icon('compare')}对比</button>
      <button class="small" id="btn-multi">${icon('check')}多选</button>
      <button class="small" id="btn-detail-toggle">${icon('panel')}详情</button>
      <button class="small" id="btn-shortcuts">${icon('keyboard')}快捷键</button>
    </div>
    <div class="review-body ${detailCollapsed ? 'detail-collapsed' : ''}">
      ${filterSidebar(activity)}
      <div class="review-grid-col">
        <div class="grid-toolbar">
          <input id="photo-search" type="text" placeholder="搜索文件名">
          <span class="grid-count" id="photo-count"></span>
          <span class="spacer"></span>
        </div>
        <div class="contact-grid" id="photo-grid"></div>
        <div id="grid-sentinel" style="height:36px"></div>
      </div>
      <aside class="review-detail" id="detail"><div class="detail-empty">选择一张照片开始复核</div></aside>
    </div>
  </div>`;

  app.querySelector('#btn-back').addEventListener('click', () => {
    if (embedded) options.onClose?.();
    else navigate(`#/activity/${activity.id}`);
  });
  const detailToggle = app.querySelector('#btn-detail-toggle');
  const syncDetailToggle = () => {
    const collapsed = app.querySelector('.review-body')?.classList.contains('detail-collapsed');
    detailToggle?.classList.toggle('primary', !collapsed);
    detailToggle?.setAttribute('aria-expanded', String(!collapsed));
  };
  detailToggle?.addEventListener('click', () => {
    const body = app.querySelector('.review-body');
    animateReviewLayout(() => body?.classList.toggle('detail-collapsed'));
    if (!body?.classList.contains('detail-collapsed')) revealDetailContent(app.querySelector('#detail'));
    localStorage.setItem('cull-detail-collapsed', body?.classList.contains('detail-collapsed') ? '1' : '0');
    syncDetailToggle();
  });
  syncDetailToggle();
  app.querySelector('#btn-review-export')?.addEventListener('click', () => { if (state.activity) navigate(`#/activity/${state.activity.id}/export`); });
  app.querySelector('#btn-review-delete').addEventListener('click', deleteReviewCategory);
  app.querySelector('#btn-multi').addEventListener('click', () => {
    state.multi = !state.multi;
    state.picked.clear();
    app.querySelector('#btn-multi').classList.toggle('primary', state.multi);
    renderBatchActions();
    renderGrid();
  });
  app.querySelector('#btn-compare').addEventListener('click', () => {
    state.compareMode = !state.compareMode;
    app.querySelector('#btn-compare').classList.toggle('primary', state.compareMode);
    state.compareA = null;
    updateWorkbenchHint();
  });
  app.querySelector('#btn-shortcuts').addEventListener('click', showShortcuts);
  const setFiltersCollapsed = (collapsed) => {
    const page = app.querySelector('.review-page');
    if (!page) return;
    animateReviewLayout(() => page.classList.toggle('filters-collapsed', collapsed));
    localStorage.setItem('cull-filters-collapsed', collapsed ? '1' : '0');
    if (!collapsed) animateUi(page.querySelector('.filter-head'), [
      { transform: 'translateX(-8px)', opacity: .6 },
      { transform: 'none', opacity: 1 },
    ], 280, { easing: SPRING_EASE });
  };
  app.querySelector('#btn-filter-collapse')?.addEventListener('click', () => setFiltersCollapsed(true));
  app.querySelector('#btn-filter-expand')?.addEventListener('click', () => setFiltersCollapsed(false));

  app.querySelectorAll('.filter-item').forEach((node) => {
    node.addEventListener('click', () => {
      state.photos.category = node.dataset.cat;
      app.querySelectorAll('.filter-item').forEach((item) => item.classList.toggle('active', item === node));
      loadPhotos(true);
    });
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      node.click();
    });
  });
  app.querySelector('#source-filter').addEventListener('change', (event) => {
    state.photos.sourceId = event.target.value;
    loadPhotos(true);
  });
  let searchTimer = null;
  app.querySelector('#photo-search').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.photos.q = event.target.value.trim(); loadPhotos(true); }, 300);
  });

  app.querySelector('#photo-grid').addEventListener('click', async (event) => {
    const sourceToggle = event.target.closest('[data-source-toggle]');
    if (sourceToggle) {
      const sourceId = sourceToggle.dataset.sourceToggle;
      setActiveSource(state.activeSource === sourceId ? null : sourceId);
      return;
    }
    const card = event.target.closest('.frame');
    if (!card) return;
    const photoId = card.dataset.id;
    const now = performance.now();
    if (lastPhotoCardClick.id === photoId && now - lastPhotoCardClick.at < 420) {
      lastPhotoCardClick = { id: null, at: 0 };
      event.preventDefault();
      openPhotoInspect(photoId);
      return;
    }
    lastPhotoCardClick = { id: photoId, at: now };
    if (event.detail >= 2) {
      event.preventDefault();
      openPhotoInspect(photoId);
      return;
    }
    if (event.shiftKey && reviewRangeAnchor) {
      const ids = state.photos.items.map((item) => item.id);
      const anchor = ids.indexOf(reviewRangeAnchor);
      const target = ids.indexOf(photoId);
      if (anchor >= 0 && target >= 0) {
        state.multi = true;
        app.querySelector('#btn-multi')?.classList.add('primary');
        const start = Math.min(anchor, target);
        const end = Math.max(anchor, target);
        for (let index = start; index <= end; index += 1) state.picked.add(ids[index]);
        event.preventDefault();
        reviewRangeAnchor = photoId;
        renderGrid();
        renderBatchActions();
        return;
      }
    }
    if (state.compareMode) {
      if (!state.compareA) { state.compareA = photoId; updateWorkbenchHint(); return; }
      if (state.compareA !== photoId) { openCompare(state.compareA, photoId); state.compareMode = false; state.compareA = null;
        app.querySelector('#btn-compare').classList.remove('primary'); updateWorkbenchHint(); }
      return;
    }
    if (state.multi) {
      if (state.picked.has(photoId)) state.picked.delete(photoId); else state.picked.add(photoId);
      card.classList.toggle('picked', state.picked.has(photoId));
      reviewRangeAnchor = photoId;
      renderBatchActions();
      return;
    }
    reviewRangeAnchor = photoId;
    await selectPhoto(photoId, { morph: true });
  });
  app.querySelector('#photo-grid').addEventListener('contextmenu', (event) => {
    const card = event.target.closest('.frame');
    if (!card) return;
    event.preventDefault();
    openPhotoContextMenu(card.dataset.id, event.clientX, event.clientY);
  });
  app.querySelector('#photo-grid').addEventListener('dblclick', (event) => {
    const card = event.target.closest('.frame');
    if (!card) return;
    event.preventDefault();
    openPhotoInspect(card.dataset.id);
  });
  app.querySelector('#photo-grid').addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.frame');
    if (!card) return;
    event.preventDefault();
    await selectPhoto(card.dataset.id);
  });

  app.querySelector('#detail').addEventListener('click', async (event) => {
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const action = target.dataset.act;
    const photoId = state.selectedId;
    if (!photoId) return;
    try {
      if (action === 'keep' || action === 'reject' || action === 'uncertain') {
        await api(`/api/photos/${photoId}/decision`, { method: 'POST', body: JSON.stringify({ verdict: action }) });
        await applyDecision(photoId, action);
      } else if (action === 'important') {
        const meta = target.dataset.value === '1';
        await api(`/api/photos/${photoId}/decision`, { method: 'POST', body: JSON.stringify({ important: meta }) });
        await selectPhoto(photoId);
        updateCardBadge(photoId, { important: meta });
      } else if (action === 'undo') {
        const result = await api(`/api/photos/${photoId}/undo`, { method: 'POST' });
        await applyDecision(photoId, result.decision.verdict);
        toast('已撤销上一步');
      } else if (action === 'open') {
        await api(`/api/photos/${photoId}/open`, { method: 'POST' });
      } else if (action === 'zoom') {
        openLightbox(photoId);
      } else if (action === 'analyze') {
        toast('正在分析这张照片…');
        try {
          const result = await api(`/api/photos/${photoId}/analyze`, { method: 'POST' });
          toast(`分析完成，本次约 ¥${result.cost}`, 'ok');
          await loadPhotos(true);
          await selectPhoto(photoId);
        } catch (error) { toast(error.message, 'error'); }
      }
    } catch (error) { toast(error.message, 'error'); }
  });

  app.querySelector('#detail').addEventListener('change', async (event) => {
    if (event.target.name !== 'label') return;
    const photoId = state.selectedId;
    if (!photoId) return;
    const chosen = [...app.querySelectorAll('#detail input[name=label]:checked')].map((input) => input.value);
    try { await api(`/api/photos/${photoId}/labels`, { method: 'PUT', body: JSON.stringify({ label_ids: chosen }) }); }
    catch (error) { toast(error.message, 'error'); }
  });

  state.observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadPhotos(false);
  }, { rootMargin: '400px' });
  state.observer.observe(app.querySelector('#grid-sentinel'));

  await loadPhotos(true);
  updateWorkbenchHint();
  updateShortcutAlert();
  // Native scrolling: only the photo drawer contains wheel chaining. Chrome,
  // filters and detail boundaries can bubble to the surrounding activity page.
}

function updateWorkbenchHint() {
  const hint = app.querySelector('#workbench-hint');
  if (!hint) return;
  hint.textContent = state.compareMode
    ? (state.compareA ? '已选第一张，再点一张进行对比' : '对比模式：选择第一张照片')
    : `P 保留 · X 排除 · U 待确认 · I 重要 · ←→ 切换 · 空格 放大 · ${userShortcuts.export} 导出`;
}

function animateCardsOut(cards) {
  const nodes = (cards || []).filter((node) => node && node.isConnected);
  if (!nodes.length || !motionAllowed()) return Promise.resolve();
  const animations = nodes.map((node) => node.animate([
    { opacity: 1, transform: 'scale(1)' },
    { opacity: 0, transform: 'scale(.82)' },
  ], { duration: 180, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'both' }));
  return Promise.all(animations.map((animation) => animation.finished.catch(() => {}))).then(() => {});
}

async function loadPhotos(reset) {
  if (state.photos.loading) return;
  const photoState = state.photos;
  const gridHost = app.querySelector('#photo-grid');
  if (reset) {
    state.photos.items = [];
    state.photos.offset = 0;
    state.photos.total = 0;
  }
  if (!reset && state.photos.items.length >= state.photos.total && state.photos.total > 0) return;
  state.photos.loading = true;
  try {
    const params = new URLSearchParams({
      category: state.photos.category, source_id: state.photos.sourceId,
      q: state.photos.q, offset: state.photos.offset, limit: 180,
    });
    const data = await api(`/api/activities/${state.activity.id}/photos?${params}`);
    if (state.photos !== photoState || !gridHost?.isConnected) return;
    state.photos.total = data.total;
    state.photos.items.push(...data.items);
    state.photos.offset += data.items.length;
    state.animateGrid = Boolean(reset && state.gridReady);
    renderGrid(reset);
    state.gridReady = true;
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    photoState.loading = false;

  }
}


function formatCaptureTime(value) {
  if (!value) return '未知';
  return String(value).replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
}

function cameraSummary(photo) {
  const make = (photo.camera_make || '').trim();
  const model = (photo.camera_model || '').trim();
  if (!make && !model) return '未读取到相机信息';
  if (make && model && !model.toLowerCase().includes(make.toLowerCase())) return `${make} ${model}`;
  return model || make;
}

function inspectCameraRows(photo) {
  const rows = [
    ['相机', cameraSummary(photo)],
    ['镜头', photo.lens_model || '未知'],
    ['光圈', photo.aperture || '未知'],
    ['快门', photo.shutter || '未知'],
    ['ISO', photo.iso ? String(photo.iso) : '未知'],
    ['焦距', photo.focal_length || '未知'],
    ['曝光补偿', photo.exposure_bias || '—'],
    ['拍摄时间', formatCaptureTime(photo.capture_time)],
    ['尺寸', photo.width && photo.height ? `${photo.width} × ${photo.height}` : '未知'],
    ['文件', `${(photo.ext || '').toUpperCase()} · ${fmtBytes(photo.size_bytes)}`],
  ];
  return rows.map(([label, value]) => `<div class="pi-kv"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('');
}

function inspectAi(photo) {
  const checks = photo.checks || {};
  const keys = Object.keys(checks);
  const suggestion = photo.ai_suggestion ? screeningLabel(photo) : '';
  const statusClass = photo.ai_suggestion === 'reject' ? 'bad' : photo.ai_suggestion === 'keep' ? 'good' : 'warn';
  const checkRows = keys.length ? keys.map((key) => {
    const item = checks[key] || {};
    const status = item.status || 'not_checked';
    const result = item.result || '';
    const label = item.name || CHECK_NAMES[key] || key;
    const cls = result === 'ok' ? 'good' : result === 'suspect' ? 'bad' : 'warn';
    return `<div class="pi-check ${cls}">
      <span class="pi-check-name">${esc(label)}</span>
      <span class="pi-check-result">${status === 'failed' ? '分析失败' : status === 'not_checked' ? '未检查' : esc(RESULT_NAMES[result] || '待确认')}</span>
      ${item.reason ? `<small>${esc(item.reason)}${evidenceHint(item)}</small>` : ''}
    </div>`;
  }).join('') : `<p class="hint">${screeningDetailHint(photo)}</p>`;
  return `
    ${suggestion ? `<div class="pi-ai-summary ${statusClass}"><span>AI 建议</span><b>${esc(suggestion)}</b></div>` : ''}
    <div class="pi-checks">${checkRows}</div>
    <p class="hint">AI 结果仅供参考，最终结论由你决定。</p>`;
}

let lastPhotoCardClick = { id: null, at: 0 };
let reviewRangeAnchor = null;
let inspectPhotos = [];
let inspectCurrentId = null;
let inspectScale = 1;
let inspectOffsetX = 0;
let inspectOffsetY = 0;
let inspectDragging = false;
let inspectDragStart = null;

function clampInspectView(node) {
  const img = node.querySelector('#pi-image');
  const stage = node.querySelector('.pi-image');
  if (!img || !stage) return;
  const baseW = img.clientWidth || 1;
  const baseH = img.clientHeight || 1;
  const maxX = Math.max(0, (baseW * inspectScale - stage.clientWidth) / 2 + 4);
  const maxY = Math.max(0, (baseH * inspectScale - stage.clientHeight) / 2 + 4);
  inspectOffsetX = Math.max(-maxX, Math.min(maxX, inspectOffsetX));
  inspectOffsetY = Math.max(-maxY, Math.min(maxY, inspectOffsetY));
}

function updateInspectView(node) {
  if (!node || !node.isConnected) return;
  clampInspectView(node);
  const img = node.querySelector('#pi-image');
  const stage = node.querySelector('.pi-image');
  const zoomLabel = node.querySelector('#pi-zoom');
  const minimap = node.querySelector('#pi-minimap');
  const viewport = node.querySelector('#pi-minimap-view');
  const baseW = img.clientWidth || 1;
  const baseH = img.clientHeight || 1;
  // Read geometry before changing the image, label or minimap classes.
  const stageW = stage.clientWidth;
  const stageH = stage.clientHeight;
  img.style.transformOrigin = 'center center';
  img.style.transform = `translate(${inspectOffsetX}px, ${inspectOffsetY}px) scale(${inspectScale})`;
  const label = `${Math.round(inspectScale * 100)}%`;
  if (zoomLabel.textContent !== label) zoomLabel.textContent = label;
  const zoomed = inspectScale > 1.01;
  node.classList.toggle('is-zoomed', zoomed);
  minimap.classList.toggle('show', zoomed);
  if (!zoomed) return;
  const scaledW = baseW * inspectScale;
  const scaledH = baseH * inspectScale;
  const left = (stageW - scaledW) / 2 + inspectOffsetX;
  const top = (stageH - scaledH) / 2 + inspectOffsetY;
  const x0 = Math.max(0, Math.min(1, -left / scaledW));
  const x1 = Math.max(0, Math.min(1, (stageW - left) / scaledW));
  const y0 = Math.max(0, Math.min(1, -top / scaledH));
  const y1 = Math.max(0, Math.min(1, (stageH - top) / scaledH));
  viewport.style.left = `${x0 * 100}%`;
  viewport.style.top = `${y0 * 100}%`;
  viewport.style.width = `${Math.max(2, (x1 - x0) * 100)}%`;
  viewport.style.height = `${Math.max(2, (y1 - y0) * 100)}%`;
}

function resetInspectView(node) {
  inspectScale = 1;
  inspectOffsetX = 0;
  inspectOffsetY = 0;
  inspectDragging = false;
  inspectDragStart = null;
  updateInspectView(node);
}

function zoomInspectAt(node, factor, clientX, clientY) {
  const stage = node.querySelector('.pi-image');
  const rect = stage.getBoundingClientRect();
  const nextScale = Math.max(1, Math.min(6, inspectScale * factor));
  const cx = clientX - rect.left - rect.width / 2;
  const cy = clientY - rect.top - rect.height / 2;
  const localX = (cx - inspectOffsetX) / inspectScale;
  const localY = (cy - inspectOffsetY) / inspectScale;
  inspectOffsetX = cx - localX * nextScale;
  inspectOffsetY = cy - localY * nextScale;
  inspectScale = nextScale;
  if (inspectScale <= 1.01) {
    inspectScale = 1;
    inspectOffsetX = 0;
    inspectOffsetY = 0;
  }
  updateInspectView(node);
}

function setInspectPhoto(photoId) {
  const node = document.querySelector('#photo-inspect');
  if (!node) return;
  const item = state.photos.items.find((photo) => photo.id === photoId) || {};
  inspectCurrentId = photoId;
  resetInspectView(node);
  node.querySelector('#pi-filename').textContent = item.file_name || '照片详情';
  const img = node.querySelector('#pi-image');
  const previousFlight = node._flight;
  node._flight = null;
  previousFlight?.cancel();
  img.style.visibility = '';
  const source = app.querySelector(`.frame[data-id="${photoId}"] img.frame-thumb`);
  const fullUrl = `/api/photos/${encodeURIComponent(photoId)}/file?kind=review`;
  img.src = source?.currentSrc || fullUrl;
  img.alt = item.file_name || '';
  img.onload = () => {
    if (!node.isConnected || inspectCurrentId !== photoId) return;
    updateInspectView(node);
  };
  const full = new Image();
  full.onload = () => {
    if (!node.isConnected || inspectCurrentId !== photoId || node.dataset.closing) return;
    img.src = fullUrl;
    node.querySelector('#pi-minimap-image').src = fullUrl;
  };
  full.src = fullUrl;
  const thumb = node.querySelector('#pi-minimap-image');
  thumb.src = img.src;
  thumb.alt = '';
  node.querySelector('#pi-camera').innerHTML = '<p class="hint">正在读取 EXIF…</p>';
  node.querySelector('#pi-ai').innerHTML = '<p class="hint">正在读取 AI 结果…</p>';
  const count = inspectPhotos.length;
  const current = Math.max(0, inspectPhotos.indexOf(photoId));
  node.querySelector('[data-pi-prev]').hidden = count <= 1;
  node.querySelector('[data-pi-next]').hidden = count <= 1;
  node.querySelector('#pi-position').textContent = count > 1 ? `${current + 1} / ${count}` : '';
  api(`/api/photos/${photoId}`).then((photo) => {
    if (!node.isConnected || inspectCurrentId !== photoId) return;
    node.querySelector('#pi-camera').innerHTML = inspectCameraRows(photo);
    node.querySelector('#pi-ai').innerHTML = inspectAi(photo);
  }).catch((error) => {
    if (!node.isConnected || inspectCurrentId !== photoId) return;
    node.querySelector('#pi-camera').innerHTML = `<p class="hint">读取失败：${esc(error.message)}</p>`;
    node.querySelector('#pi-ai').innerHTML = '';
  });
}

function stepInspect(step) {
  if (inspectPhotos.length < 2) return;
  const current = Math.max(0, inspectPhotos.indexOf(inspectCurrentId));
  const next = (current + step + inspectPhotos.length) % inspectPhotos.length;
  setInspectPhoto(inspectPhotos[next]);
}

function openPhotoInspect(photoId) {
  if (document.querySelector('#photo-inspect')) return;
  inspectReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  inspectPhotos = state.photos.items.map((photo) => photo.id);
  if (!inspectPhotos.includes(photoId)) inspectPhotos.unshift(photoId);
  inspectScale = 1;
  inspectOffsetX = 0;
  inspectOffsetY = 0;
  const node = document.createElement('div');
  node.id = 'photo-inspect';
  node.className = 'photo-inspect';
  node.innerHTML = `
    <div class="pi-top">
      <div><span class="pi-eyebrow">照片详情</span><b id="pi-filename"></b><span class="pi-position" id="pi-position"></span></div>
      <span class="pi-scroll-cue" aria-hidden="true">↓ 更多</span>
      <button class="pi-close" type="button" data-pi-close aria-label="关闭">${icon('x')}</button>
    </div>
    <div class="pi-body">
      <div class="pi-image">
        <img id="pi-image" alt="" draggable="false">
        <button class="pi-nav prev" type="button" data-pi-prev title="上一张" aria-label="上一张">${icon('chevronLeft')}</button>
        <button class="pi-nav next" type="button" data-pi-next title="下一张" aria-label="下一张">${icon('chevronRight')}</button>
        <span class="pi-zoom" id="pi-zoom">100%</span>
        <div class="pi-minimap" id="pi-minimap" aria-hidden="true">
          <img id="pi-minimap-image" alt="">
          <span class="pi-minimap-view" id="pi-minimap-view"></span>
        </div>
      </div>
      <aside class="pi-side">
        <section class="pi-card"><div class="pi-card-head"><h3>拍摄信息</h3><span class="hint">相机 / 镜头 / 参数</span></div><div id="pi-camera" class="pi-kv-list"><p class="hint">正在读取 EXIF…</p></div></section>
        <section class="pi-card pi-ai-card"><div class="pi-card-head"><h3>AI 检查</h3><span class="hint">五类问题与建议</span></div><div id="pi-ai"><p class="hint">正在读取 AI 结果…</p></div></section>
      </aside>
    </div>`;
  document.body.appendChild(node);
  document.body.classList.add('inspect-open');
  void node.offsetWidth; // commit the closed state so the open transition really runs
  node.classList.add('open');
  animateUi(node.querySelector('.pi-side'), [{translate:'18px 0', opacity:0}, {translate:'0 0', opacity:1}], 300);
  node.dataset.openingPhoto = photoId;
  const side = node.querySelector('.pi-side');
  const cue = node.querySelector('.pi-scroll-cue');
  const syncCue = () => {
    if (!side || !cue) return;
    const atEnd = side.scrollTop + side.clientHeight >= side.scrollHeight - 12;
    cue.classList.toggle('is-hidden', atEnd);
  };
  side?.addEventListener('scroll', syncCue, { passive: true });
  requestAnimationFrame(syncCue);
  // EXIF / AI panel content loads after open; recalculate the cue when it grows.
  let cueResize = null;
  if (window.ResizeObserver && side) {
    cueResize = new ResizeObserver(() => syncCue());
    cueResize.observe(side);
  }
  const cueTimer = setTimeout(syncCue, 420);
  node._rmCueCleanup = () => { clearTimeout(cueTimer); cueResize?.disconnect(); };
  const stage = node.querySelector('.pi-image');
  const image = node.querySelector('#pi-image');
  let panFrame = 0;
  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomInspectAt(node, event.deltaY < 0 ? 1.22 : 1 / 1.22, event.clientX, event.clientY);
  }, { passive: false });
  image.addEventListener('pointerdown', (event) => {
    if (inspectScale <= 1.01 || event.button !== 0) return;
    event.preventDefault();
    inspectDragging = true;
    inspectDragStart = { x: event.clientX, y: event.clientY, ox: inspectOffsetX, oy: inspectOffsetY };
    image.setPointerCapture?.(event.pointerId);
    node.classList.add('is-panning');
  });
  image.addEventListener('pointermove', (event) => {
    if (!inspectDragging || !inspectDragStart) return;
    inspectOffsetX = inspectDragStart.ox + (event.clientX - inspectDragStart.x);
    inspectOffsetY = inspectDragStart.oy + (event.clientY - inspectDragStart.y);
    if (!panFrame) panFrame = requestAnimationFrame(() => {
      panFrame = 0;
      updateInspectView(node);
    });
  });
  const endPan = () => {
    if (panFrame) {
      cancelAnimationFrame(panFrame);
      panFrame = 0;
      updateInspectView(node);
    }
    inspectDragging = false;
    inspectDragStart = null;
    node.classList.remove('is-panning');
  };
  image.addEventListener('pointerup', endPan);
  image.addEventListener('pointercancel', endPan);
  image.addEventListener('dblclick', () => {
    if (inspectScale > 1) resetInspectView(node);
    else zoomInspectAt(node, 2, stage.getBoundingClientRect().left + stage.clientWidth / 2, stage.getBoundingClientRect().top + stage.clientHeight / 2);
  });
  node.querySelector('[data-pi-close]').addEventListener('click', closePhotoInspect);
  node.querySelector('[data-pi-prev]').addEventListener('click', (event) => { event.stopPropagation(); stepInspect(-1); });
  node.querySelector('[data-pi-next]').addEventListener('click', (event) => { event.stopPropagation(); stepInspect(1); });
  node.addEventListener('click', (event) => { if (event.target === node) closePhotoInspect(); });
  requestAnimationFrame(() => node.querySelector('[data-pi-close]')?.focus({ preventScroll: true }));
  setInspectPhoto(photoId);
  openInspectFlight(node, photoId);
}

function closePhotoInspect() {
  const node = document.querySelector('#photo-inspect');
  if (!node) return;
  if (node.dataset.closing) return;
  node.dataset.closing = 'true';
  const openingFlight = node._flight;
  node._flight = null;
  openingFlight?.cancel();
  const thumb = app.querySelector(`.frame[data-id="${inspectCurrentId}"] img.frame-thumb`);
  const image = node.querySelector('#pi-image');
  const from = image.getBoundingClientRect();
  const to = thumb?.getBoundingClientRect();
  const flight = motionAllowed() && inspectScale === 1 && to && to.bottom > 0 && to.top < innerHeight
    ? flyPhoto(image.currentSrc || image.src, from, to, true) : null;
  if (flight) image.style.visibility = 'hidden';
  inspectCurrentId = null;
  document.body.classList.remove('inspect-open');
  node.classList.remove('open');
  node.classList.add('closing');
  const finish = () => {
    node._rmCueCleanup?.();
    node.remove();
    const returnTo = inspectReturnFocus;
    inspectReturnFocus = null;
    if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
  };
  if (flight) flight.finished.then(finish, finish);
  else if (motionAllowed()) setTimeout(finish, 240);
  else finish();
}

function photoCard(item, photoIndex) {
  const classes = ['frame', item.verdict];
  if (item.id === state.selectedId) classes.push('selected');
  if (state.picked.has(item.id)) classes.push('picked');
  if (item.preview_state === 'failed') classes.push('failed');
  if (item.ai_suggestion) classes.push(`ai-${item.ai_suggestion}`);
  const index = photoIndex + 1;
  const flags = (item.issues || []).slice(0, 2)
    .map((issue) => `<span class="flag ${issue.result}" title="${esc(issue.name)}"></span>`)
    .join('');
  const aiPill = `<span class="pill ai-${item.ai_suggestion || 'uncertain'}" data-ai-badge>${esc(screeningLabel(item))}</span>`;
  const failedPill = item.preview_state === 'failed' ? '<span class="pill failed">读取失败</span>' : '';
  const burstPill = item.burst_rank
    ? (item.burst_rank === 1
      ? '<span class="pill burst-keep" title="连拍组最佳">连拍精选</span>'
      : '<span class="pill burst-dup" title="同组已有更优照片">连拍重复</span>')
    : '';
  const verdictPill = `<span class="pill verdict-${item.verdict}">${esc(VERDICT_NAMES[item.verdict] || '待处理')}</span>`;
  return `<div class="${classes.join(' ')}" data-id="${item.id}" role="button" tabindex="0" style="--reveal-delay:${Math.min(photoIndex || 0, 6) * 6}ms" aria-label="${esc(item.file_name)}">
    <div class="frame-pic">
      ${item.preview_state === 'failed'
        ? `<span class="frame-thumb frame-thumb-empty">${icon('image')}</span>`
        : `<img class="frame-thumb" loading="lazy" src="/api/photos/${item.id}/file?kind=grid" alt="" onerror="this.style.opacity=.1">`}
      ${item.preview_state === 'failed' ? '<span class="frame-failed">预览不可用</span>' : ''}
      ${item.important ? `<span class="frame-star">${icon('starFill')}</span>` : ''}
      ${item.paired ? '<span class="frame-pair">RAW+JPG</span>' : ''}
    </div>
    <div class="frame-meta">
      <div class="frame-line">
        <span class="frame-index">${String(index).padStart(3, '0')}</span>
        <span class="frame-name" title="${esc(item.file_name)}">${esc(item.file_name)}</span>
      </div>
      <div class="frame-tags">
        ${failedPill}
        ${burstPill}
        ${aiPill}
        ${verdictPill}
        <span class="frame-flags">${flags}</span>
      </div>
    </div>
  </div>`;
}

function setActiveSource(sourceId) {
  const headers = motionAllowed() ? [...app.querySelectorAll('[data-source-toggle]')]
    .map(node => ({node, top:node.getBoundingClientRect().top})) : [];
  state.activeSource = sourceId;
  app.querySelectorAll('#photo-grid .source-group').forEach((section) => {
    const active = section.dataset.sourceGroup === sourceId;
    const wasActive = section.classList.contains('open');
    if (!active && !wasActive) return;
    const body = section.querySelector('.source-group-body');
    if (active && body && !body.querySelector('.frame')) {
      const group = state.reviewGroups.get(sourceId);
      const base = state.reviewGroupBase.get(sourceId) || 0;
      const inner = body.querySelector('.source-group-inner');
      if (group && inner) inner.innerHTML = `<div class="contact-grid source-photo-grid">${group.items.map((item, index) => photoCard(item, base + index)).join('')}</div>`;
    }
    const header = section.querySelector('[data-source-toggle]');
    section.classList.toggle('open', active);
    section.classList.toggle('collapsed', !active);
    if (body) body.style.display = active ? 'block' : 'none';
    header?.setAttribute('aria-expanded', String(active));
    // Re-arm each drawer's cards; only cards entering its visible scrollport animate.
    section.querySelectorAll('.frame').forEach(card => {
      uiAnimations.get(card)?.cancel();
      card.classList.remove('reveal-visible');
      reviewRevealObserver?.unobserve(card);
      reviewRevealExitObserver?.unobserve(card);
      reviewRevealTargets.delete(card);
    });
  });
  initScrollPop();
  const moves = headers.map(({node, top}) => ({node, dy:top - node.getBoundingClientRect().top}));
  moves.forEach(({node, dy}) => {
    if (Math.abs(dy) < 1) return;
    animateUi(node, [{translate:`0 ${dy}px`}, {translate:'0 0'}], 300, {easing:SPRING_EASE});
  });
}

function sourceGroupHtml(sourceId, label, items, baseIndex) {
  const open = state.activeSource === sourceId;
  return `<section class="source-group ${open ? 'open' : 'collapsed'}" data-source-group="${esc(sourceId)}">
    <button class="source-group-head" type="button" data-source-toggle="${esc(sourceId)}" aria-expanded="${open ? 'true' : 'false'}">
      ${icon('folder')}
      <b>${esc(label)}</b>
      <span>${items.length} 张</span>
      <span class="source-group-chevron">${icon('chevronDown')}</span>
    </button>
    <div class="source-group-body" ${open ? '' : 'style="display:none"'}><div class="source-group-inner">
      ${open ? `<div class="contact-grid source-photo-grid">${items.map((item, index) => photoCard(item, baseIndex + index)).join('')}</div>` : ''}
    </div></div>
  </section>`;
}

function groupReviewItems(items) {
  const groups = new Map();
  items.forEach((item) => {
    const key = item.source_id || 'unknown';
    if (!groups.has(key)) groups.set(key, { label: item.source_label || '未知来源', items: [] });
    groups.get(key).items.push(item);
  });
  return groups;
}

function renderGrid(reset = true) {
  const grid = app.querySelector('#photo-grid');
  if (!grid) return;
  state.animateGrid = false;
  grid.classList.add('source-grouped');
  const rendered = reset ? 0 : Number(grid.dataset.rendered || 0);
  if (reset) grid.replaceChildren();
  const items = state.photos.items;
  if (!items.length) {
    const offlineSources = (state.activity?.sources || []).filter((source) => source.available === false);
    grid.innerHTML = offlineSources.length
      ? `<div class="empty" style="grid-column:1/-1">${icon('alert', 'empty-icon')}
          <h2>来源磁盘未连接</h2>
          <p>${offlineSources.map((source) => `${esc(source.label)} · ${esc(source.root_path)}`).join('<br>')}<br>请重新连接存储卡或移动硬盘后再刷新。</p></div>`
      : `<div class="empty" style="grid-column:1/-1">${icon('image', 'empty-icon')}
        <h2>没有符合条件的照片</h2><p>换个分类或来源试试。</p></div>`;
  } else {
    const groups = groupReviewItems(items);
    state.reviewGroups = groups;
    state.reviewGroupBase = new Map();
    let baseCursor = 0;
    for (const [sourceId, group] of groups) {
      state.reviewGroupBase.set(sourceId, baseCursor);
      baseCursor += group.items.length;
    }
    if (reset) {
      const keys = [...groups.keys()];
      if (!state.activeSource || !keys.includes(state.activeSource)) state.activeSource = keys[0] || null;
      let index = 0;
      const parts = [];
      for (const [sourceId, group] of groups) {
        parts.push(sourceGroupHtml(sourceId, group.label, group.items, state.reviewGroupBase.get(sourceId) || index));
        index += group.items.length;
      }
      grid.innerHTML = parts.join('');
    } else {
      const newItems = items.slice(rendered);
      const newGroups = groupReviewItems(newItems);
      let cursor = rendered;
      for (const [sourceId, group] of newGroups) {
        let section = grid.querySelector(`[data-source-group="${CSS.escape(sourceId)}"]`);
        if (!section) {
          grid.insertAdjacentHTML('beforeend', sourceGroupHtml(sourceId, group.label, group.items, cursor));
        } else {
          section.querySelector('.source-photo-grid')?.insertAdjacentHTML('beforeend',
            group.items.map((item, i) => photoCard(item, cursor + i)).join(''));
          const count = section.querySelector('.source-group-head span');
          const fullGroup = state.reviewGroups.get(sourceId);
          if (count) count.textContent = `${fullGroup ? fullGroup.items.length : section.querySelectorAll('.frame').length} 张`;
        }
        cursor += group.items.length;
      }
    }
  }
  grid.dataset.rendered = String(items.length);
  const count = app.querySelector('#photo-count');
  if (count) count.textContent = `共 ${state.photos.total} 张`;
  const detail = app.querySelector('#detail');
  if (detail && !state.selectedId) detail.innerHTML = '<div class="detail-empty">选择一张照片开始复核</div>';
}

function updateCardBadge(photoId, patch) {
  state.reviewRevision = (state.reviewRevision || 0) + 1;
  const card = app.querySelector(`.frame[data-id="${photoId}"]`);
  if (!card) return;
  if (patch.important !== undefined) {
    let star = card.querySelector('.frame-star');
    const host = card.querySelector('.frame-pic') || card;
    if (patch.important && !star) {
      host.insertAdjacentHTML('afterbegin', `<span class="frame-star">${icon('starFill')}</span>`);
    }
    if (!patch.important && star) star.remove();
  }
  markFeedback(card, patch.important ? 'important' : 'verdict');
}

async function applyDecision(photoId, verdict) {
  state.reviewRevision = (state.reviewRevision || 0) + 1;
  const item = state.photos.items.find((photo) => photo.id === photoId);
  if (item) item.verdict = verdict;
  const card = app.querySelector(`.frame[data-id="${photoId}"]`);
  if (card) {
    card.classList.remove('keep', 'reject', 'uncertain');
    if (verdict !== 'undecided') card.classList.add(verdict);
    const badge = card.querySelector('[class*="verdict-"]');
    if (badge) { badge.textContent = VERDICT_NAMES[verdict]; badge.className = `pill verdict-${verdict}`; }
    markFeedback(card);
  }
  if (state.photos.category !== 'all' && state.photos.category !== 'important') {
    await animateCardsOut([card]);
    await loadPhotos(true);
  }
  await selectPhoto(photoId);
  const activityId = state.activity?.id;
  const revision = state.reviewRevision;
  if (activityId) {
    const latest = await api(`/api/activities/${activityId}/analysis/status`).catch(() => null);
    if (latest?.counts && state.activity?.id === activityId && state.reviewRevision === revision) updateReviewCounts(latest.counts);
  }
}

function revealDetailContent(detail) {
  if (!detail || !motionAllowed()) return;
  const image = detail.querySelector('.detail-image');
  animateUi(image, [
    { opacity: 0.55, transform: 'scale(1.006)' },
    { opacity: 1, transform: 'scale(1)' },
  ], 300, { easing: 'cubic-bezier(.22, 1, .36, 1)' });
  const parts = [
    detail.querySelector('.detail-empty'),
    detail.querySelector('.detail-title'),
    detail.querySelector('.detail-info'),
    detail.querySelector('.segmented'),
    detail.querySelector('.detail-actions'),
    ...detail.querySelectorAll('.detail-section'),
  ].filter(Boolean);
  parts.forEach((node, index) => {
    animateUi(node, [
      { opacity: 0, transform: 'translateY(6px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], 260, {
      easing: SPRING_EASE,
      delay: Math.min(index, 5) * 16,
      fill: 'backwards',
    });
  });
}

let photoSelectionRequest = 0;
async function selectPhoto(photoId, options = {}) {
  const request = ++photoSelectionRequest;
  const detailHost = app.querySelector("#detail");
  const changedPhoto = state.selectedId !== photoId;
  const commit = async () => {
    state.selectedId = photoId;
    app.querySelectorAll('.frame').forEach((card) => card.classList.toggle('selected', card.dataset.id === photoId));
    const photo = await api(`/api/photos/${photoId}`);
    if (request !== photoSelectionRequest || state.selectedId !== photoId || !detailHost?.isConnected) return;
    state.selectedPhoto = photo;
    const detail = detailHost;
    if (!detail) return;
    const imageUrl = `/api/photos/${photoId}/file?kind=review`;
    const importantButton = photo.important
      ? `${icon('starFill')}取消重要`
      : `${icon('star')}标记重要`;
    const detailImage = photo.preview_state === 'failed'
      ? `<div class="detail-image failed detail-image-empty">${icon('image')}<span>预览不可用</span></div>`
      : `<img class="detail-image" src="${imageUrl}"
        alt="" data-act="zoom" onerror="this.style.opacity=.12">`;
    detail.innerHTML = `${detailImage}
      <div class="detail-title">${esc(photo.file_name)}</div>
      <div class="detail-info">
        ${esc(photo.source_label)} · ${fmtBytes(photo.size_bytes)}
        ${photo.width ? ` · ${photo.width}×${photo.height}` : ''}
        ${photo.capture_time ? ` · ${esc(photo.capture_time)}` : ''}
      </div>
      ${photo.preview_error ? `<p class="hint" style="color:var(--red)">预览问题：${esc(photo.preview_error)}</p>` : ''}
      <div class="segmented">
        <button data-act="keep" class="${photo.verdict === 'keep' ? 'on keep' : ''}">${icon('check')}保留 <span class="mono">P</span></button>
        <button data-act="reject" class="${photo.verdict === 'reject' ? 'on reject' : ''}">${icon('x')}排除 <span class="mono">X</span></button>
        <button data-act="uncertain" class="${photo.verdict === 'uncertain' ? 'on uncertain' : ''}">${icon('help')}待确认 <span class="mono">U</span></button>
      </div>
      <div class="detail-actions">
        <button class="small" data-act="important" data-value="${photo.important ? '0' : '1'}">${importantButton}</button>
        <button class="small ghost" data-act="undo">${icon('undo')}撤销</button>
        <button class="small ghost" data-act="open">${icon('external')}查看原片</button>
      </div>
      ${aiPanelHtml(photo)}
      <div class="detail-section">
        <h3>必备画面</h3>
        <div class="check-list">
          ${state.labels.length ? state.labels.map((label) => `<label><input type="checkbox" name="label" value="${label.id}"
            ${photo.labels.includes(label.id) ? 'checked' : ''}> ${esc(label.name)}</label>`).join('')
            : '<p class="hint">还没有标签，可在“必备画面”中添加。</p>'}
        </div>
      </div>`;
    if (changedPhoto) revealDetailContent(detail);
  };

  await commit();
}

function evidenceHint(item) {
  const evidence = item.evidence || {};
  if (!evidence.confidence || item.result === 'ok') return '';
  const severity = {severe:'严重', minor:'轻微', none:'尚不明确'}[evidence.severity] || '尚不明确';
  const confidence = {high:'清楚', medium:'有限', low:'不足'}[evidence.confidence] || '不足';
  return `<span class="hint"> · 影响${severity} · 证据${confidence}</span>`;
}

function aiPanelHtml(photo) {
  const entries = Object.entries(photo.checks || {});
  const lines = entries.length ? entries.map(([key, item]) => {
    const stateName = item.status === 'failed' ? 'failed' : (item.result || '');
    const label = item.status === 'failed' ? '分析失败' : (RESULT_NAMES[item.result] || '未检查');
    return `<div class="ai-line">
      <span class="ai-dot ${stateName}"></span>
      <span><span class="ai-name">${esc(item.name || CHECK_NAMES[key] || key)}</span>
      <span class="ai-result">${esc(label)}</span></span>
      ${item.reason ? `<div class="ai-reason">${esc(item.reason)}${item.region && item.region !== '无' ? `（${esc(item.region)}）` : ''}${evidenceHint(item)}</div>` : ''}
      ${item.error ? `<div class="ai-reason">${esc(item.error)}</div>` : ''}
    </div>`;
  }).join('') : `<p class="hint">${screeningDetailHint(photo)}</p>`;
  const suggestion = photo.ai_suggestion
    ? `<p class="hint"><b>${esc(screeningLabel(photo))}</b>${photo.ai_quick?.issue && photo.ai_quick.issue !== 'none' && photo.ai_stage === 'quick_reject' ? ` · ${esc(CHECK_NAMES[photo.ai_quick.issue] || '')}` : ''}</p>`
    : '';
  return `<div class="detail-section" data-ai-detail>
    <h3>AI 检查</h3>
    ${suggestion}
    ${lines}
    <button class="small ghost" data-act="analyze" style="margin-top:8px">${icon('scan')}AI 检查本张</button>
  </div>`;
}

function batchHost() {
  let node = document.querySelector('#batch-actions');
  if (!node) {
    node = document.createElement('div');
    node.id = 'batch-actions';
    node.className = 'row';
    document.body.appendChild(node);
  }
  return node;
}

function hideBatchBar() {
  document.documentElement.classList.remove('rm-has-batch');
  const node = document.querySelector('#batch-actions');
  if (!node) return;
  node.innerHTML = '';
  node.dataset.rmVisible = '0';
  node.classList.remove('rm-batch-enter', 'rm-batch-leaving');
}

function renderBatchActions() {
  const node = batchHost();
  if (!node) return;
  document.documentElement.classList.toggle('rm-has-batch', Boolean(state.multi));
  const batchToken = (node._rmBatchToken || 0) + 1;
  node._rmBatchToken = batchToken;
  if (!state.multi) {
    if (!node.children.length) { node.innerHTML = ''; return; }
    node.classList.add('rm-batch-leaving');
    const clear = () => {
      if (node._rmBatchToken !== batchToken) return;
      node.innerHTML = '';
      node.dataset.rmVisible = '0';
      node.classList.remove('rm-batch-leaving');
    };
    const exit = animateUi(node, [
      { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(1)' },
      { opacity: 0, transform: 'translateX(-50%) translateY(10px) scale(.98)' },
    ], 180, { easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'both' });
    if (exit) exit.finished.then(clear, clear);
    else clear();
    return;
  }
  node.classList.remove('rm-batch-leaving');
  uiAnimations.get(node)?.cancel();
  node.innerHTML = `<span class="hint">已选 ${state.picked.size} 张</span>
    <button class="small" data-batch="keep" ${state.picked.size ? '' : 'disabled'}>${icon('check')}批量保留</button>
    <button class="small" data-batch="reject" ${state.picked.size ? '' : 'disabled'}>${icon('x')}批量排除</button>
    <button class="small" data-batch="uncertain" ${state.picked.size ? '' : 'disabled'}>${icon('help')}批量待确认</button>
    <button class="small" id="btn-batch-export" ${state.picked.size ? '' : 'disabled'}>${icon('download')}导出所选</button>
    <button class="small danger" id="btn-batch-delete" ${state.picked.size ? '' : 'disabled'}>${icon('trash')}删除所选</button>`;
  if (node.dataset.rmVisible !== '1') {
    // First render of this bar: play the entrance here; the release-motion observer
    // may attach one frame later than the first innerHTML write.
    node.dataset.rmVisible = '1';
    node.classList.remove('rm-batch-enter');
    void node.offsetWidth;
    node.classList.add('rm-batch-enter');
    clearTimeout(node._rmBatchTimer);
    node._rmBatchTimer = setTimeout(() => node.classList.remove('rm-batch-enter'), 560);
  }
  node.querySelector('#btn-batch-export')?.addEventListener('click', exportSelectedPhotos);
  node.querySelector('#btn-batch-delete')?.addEventListener('click', deleteSelectedPhotos);
  node.querySelectorAll('[data-batch]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const result = await api(`/api/activities/${state.activity.id}/decisions/batch`, {
          method: 'POST', body: JSON.stringify({ photo_ids: [...state.picked], verdict: button.dataset.batch }),
        });
        toast(`已处理 ${result.applied} 张${result.skipped ? `，跳过 ${result.skipped} 张（重要照片）` : ''}`, 'ok');
        await animateCardsOut([...state.picked].map((id) => app.querySelector(`.frame[data-id="${id}"]`)));
        state.picked.clear();
        await loadPhotos(true);
        renderBatchActions();
        try {
          const latest = await api(`/api/activities/${state.activity.id}/analysis/status`);
          if (latest?.counts) updateReviewCounts(latest.counts);
        } catch (_) { /* 计数刷新失败不影响选片 */ }
      } catch (error) { toast(error.message, 'error'); }
    });
  });
}

function showShortcuts() {
  showModal(modalFrame('快捷键', `
    <table style="width:100%;font-size:13px;line-height:2">
      <tr><td><span class="kbd">P</span></td><td>保留</td><td><span class="kbd">X</span></td><td>排除（疑似废片）</td></tr>
      <tr><td><span class="kbd">U</span></td><td>待确认</td><td><span class="kbd">I</span></td><td>标记/取消重要</td></tr>
      <tr><td><span class="kbd">←</span><span class="kbd">→</span></td><td>上一张 / 下一张</td><td><span class="kbd">空格</span></td><td>放大查看</td></tr>
      <tr><td><span class="kbd">Ctrl</span>+<span class="kbd">Z</span></td><td>撤销当前照片的最近一次操作</td><td><span class="kbd">Esc</span></td><td>关闭弹层</td></tr>
      <tr><td><span class="kbd">${esc(userShortcuts.export)}</span></td><td>一键导出当前分类</td><td><span class="kbd">${esc(userShortcuts.delete)}</span></td><td>一键删除当前分类</td></tr>
      <tr><td><span class="kbd">${esc(userShortcuts.compare)}</span></td><td>对比模式</td><td><span class="kbd">${esc(userShortcuts.multi)}</span></td><td>多选模式</td></tr>
      <tr><td><span class="kbd">${esc(userShortcuts.detail)}</span></td><td>展开 / 收起详情</td><td></td><td></td></tr>
    </table>
    <p class="hint">输入文字时不会触发选片快捷键；可在设置 → 快捷键中修改。</p>`,
  '<button data-close="1">知道了</button>'), (root) => bindModalClose(root));
}

/* ---------- 放大查看 ---------- */

function openLightbox(photoId) {
  const photo = state.selectedPhoto;
  if (!photo) return;
  openViewer(`/api/photos/${photoId}/file?kind=review`, photo.file_name);
}

function openViewer(url, title) {
  overlayReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  closeOverlay(true);
  const node = document.createElement('div');
  node.className = 'overlay';
  node.innerHTML = `<div class="o-bar">
      <span class="name">${esc(title)}</span>
      <button id="v-out" aria-label="缩小">${icon('zoomOut')}</button><span id="v-label" class="hint">100%</span><button id="v-in" aria-label="放大">${icon('zoom')}</button>
      <button id="v-reset">${icon('reset')}复位</button><button id="v-close">${icon('x')}关闭 Esc</button>
    </div>
    <div class="o-stage" id="v-stage"><img id="v-img" src="${url}" alt=""></div>`;
  document.body.appendChild(node);
  animateUi(node, [{ opacity: 0 }, { opacity: 1 }], 180);
  state.overlayOpen = true;

  let scale = 1; let tx = 0; let ty = 0;
  let dragging = false; let startX = 0; let startY = 0; let baseX = 0; let baseY = 0;
  const img = node.querySelector('#v-img');
  const stage = node.querySelector('#v-stage');
  const label = node.querySelector('#v-label');

  const apply = () => {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    label.textContent = `${Math.round(scale * 100)}%`;
  };
  node.querySelector('#v-close').addEventListener('click', () => closeOverlay());
  requestAnimationFrame(() => node.querySelector('#v-close')?.focus({ preventScroll: true }));
  node.querySelector('#v-in').addEventListener('click', () => { scale = Math.min(8, scale * 1.25); apply(); });
  node.querySelector('#v-out').addEventListener('click', () => { scale = Math.max(0.2, scale / 1.25); apply(); });
  node.querySelector('#v-reset').addEventListener('click', () => { scale = 1; tx = 0; ty = 0; apply(); });
  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    scale = Math.max(0.2, Math.min(8, scale * (event.deltaY < 0 ? 1.12 : 0.89)));
    apply();
  }, { passive: false });
  stage.addEventListener('pointerdown', (event) => {
    dragging = true; startX = event.clientX; startY = event.clientY; baseX = tx; baseY = ty;
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    tx = baseX + (event.clientX - startX);
    ty = baseY + (event.clientY - startY);
    apply();
  });
  stage.addEventListener('pointerup', () => { dragging = false; });
  stage.addEventListener('dblclick', () => { scale = scale === 1 ? 2 : 1; tx = 0; ty = 0; apply(); });
  apply();
}

/* ---------- 两图对比 ---------- */

function openCompare(photoIdA, photoIdB) {
  overlayReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const itemA = state.photos.items.find((item) => item.id === photoIdA);
  const itemB = state.photos.items.find((item) => item.id === photoIdB);
  closeOverlay(true);
  const node = document.createElement('div');
  node.className = 'overlay';
  node.innerHTML = `<div class="o-bar">
      <span class="name">并排对比 · 滚轮缩放、拖拽平移（两边同步）</span>
      <button id="c-reset">${icon('reset')}复位</button><button id="c-close">${icon('x')}关闭 Esc</button>
    </div>
    <div class="compare-stage" id="c-stage">
      <div class="compare-pane"><span class="tag">${esc(itemA ? itemA.file_name : 'A')}</span>
        <img id="c-a" src="/api/photos/${photoIdA}/file?kind=review" alt=""></div>
      <div class="compare-pane"><span class="tag">${esc(itemB ? itemB.file_name : 'B')}</span>
        <img id="c-b" src="/api/photos/${photoIdB}/file?kind=review" alt=""></div>
    </div>`;
  document.body.appendChild(node);
  animateUi(node, [{ opacity: 0 }, { opacity: 1 }], 180);
  state.overlayOpen = true;

  let scale = 1; let tx = 0; let ty = 0;
  let dragging = false; let startX = 0; let startY = 0; let baseX = 0; let baseY = 0;
  const imgA = node.querySelector('#c-a');
  const imgB = node.querySelector('#c-b');
  const stage = node.querySelector('#c-stage');
  const apply = () => {
    const transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    imgA.style.transform = transform;
    imgB.style.transform = transform;
  };
  node.querySelector('#c-close').addEventListener('click', () => closeOverlay());
  requestAnimationFrame(() => node.querySelector('#c-close')?.focus({ preventScroll: true }));
  node.querySelector('#c-reset').addEventListener('click', () => { scale = 1; tx = 0; ty = 0; apply(); });
  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    scale = Math.max(0.2, Math.min(8, scale * (event.deltaY < 0 ? 1.12 : 0.89)));
    apply();
  }, { passive: false });
  stage.addEventListener('pointerdown', (event) => {
    dragging = true; startX = event.clientX; startY = event.clientY; baseX = tx; baseY = ty;
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    tx = baseX + (event.clientX - startX);
    ty = baseY + (event.clientY - startY);
    apply();
  });
  stage.addEventListener('pointerup', () => { dragging = false; });
  apply();
}

/* ---------- 快捷键 ---------- */

function currentList() { return state.photos.items; }

async function undoCurrent() {
  if (!state.selectedId) return;
  try {
    const result = await api(`/api/photos/${state.selectedId}/undo`, { method: 'POST' });
    await applyDecision(state.selectedId, result.decision.verdict);
    toast('已撤销上一步');
  } catch (error) { toast(error.message, 'error'); }
}

async function moveSelection(delta) {
  const list = currentList();
  if (!list.length) return;
  let index = list.findIndex((item) => item.id === state.selectedId);
  if (index < 0) index = 0;
  else index = Math.max(0, Math.min(list.length - 1, index + delta));
  const target = list[index];
  await selectPhoto(target.id);
  const card = app.querySelector(`.frame[data-id="${target.id}"]`);
  if (card) card.scrollIntoView({ block: 'nearest' });
}

async function toggleImportant() {
  if (!state.selectedPhoto) return;
  const next = !state.selectedPhoto.important;
  try {
    await api(`/api/photos/${state.selectedId}/decision`, { method: 'POST', body: JSON.stringify({ important: next }) });
    updateCardBadge(state.selectedId, { important: next });
    await selectPhoto(state.selectedId);
  } catch (error) { toast(error.message, 'error'); }
}

function dismissTransientMenus() {
  const more = document.querySelector('#more-menu');
  document.querySelector('.activity-hero.more-open')?.classList.remove('more-open');
  if (more && !more.hidden) {
    if (closeMoreMenuHandler) {
      closeMoreMenuHandler();
    } else {
      more.hidden = true;
    }
  }
  closePhotoContextMenu();
}

function onKeyDown(event) {
  if (event.key === 'Escape') {
    if (state.overlayOpen) { closeOverlay(); return; }
    if (modalRoot.children.length) { closeModal(); return; }
    if (document.querySelector('#photo-context-menu') ||
        (document.querySelector('#more-menu') && !document.querySelector('#more-menu').hidden)) {
      dismissTransientMenus();
      return;
    }
  }
  if (state.overlayOpen || modalRoot.children.length) return;
  const tag = (event.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || event.target.isContentEditable) return;
  const reviewBounds = app.querySelector('.review-page')?.getBoundingClientRect();
  if (state.view !== 'review' && !(reviewBounds && reviewBounds.bottom > 0 && reviewBounds.top < innerHeight)) return;

  if (eventMatchesShortcut(event, 'export')) { event.preventDefault(); if (state.activity) navigate(`#/activity/${state.activity.id}/export`); return; }
  if (eventMatchesShortcut(event, 'delete')) { event.preventDefault(); deleteReviewCategory(); return; }
  if (eventMatchesShortcut(event, 'multi')) {
    event.preventDefault();
    app.querySelector('#btn-multi')?.click();
    return;
  }
  if (eventMatchesShortcut(event, 'detail')) {
    event.preventDefault();
    app.querySelector('#btn-detail-toggle')?.click();
    return;
  }
  if (eventMatchesShortcut(event, 'compare')) {
    event.preventDefault();
    app.querySelector('#btn-compare')?.click();
    return;
  }

  if (event.ctrlKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undoCurrent();
    return;
  }
  if (!state.selectedId) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') moveSelection(0);
    return;
  }
  const key = event.key.toLowerCase();
  if (key === 'p') { event.preventDefault(); decide('keep'); }
  else if (key === 'x') { event.preventDefault(); decide('reject'); }
  else if (key === 'u') { event.preventDefault(); decide('uncertain'); }
  else if (key === 'i') { event.preventDefault(); toggleImportant(); }
  else if (event.key === 'ArrowRight') { event.preventDefault(); moveSelection(1); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); moveSelection(-1); }
  else if (event.key === ' ') { event.preventDefault(); openLightbox(state.selectedId); }
}

async function decide(verdict) {
  const photoId = state.selectedId;
  if (!photoId) return;
  try {
    await api(`/api/photos/${photoId}/decision`, { method: 'POST', body: JSON.stringify({ verdict }) });
    await applyDecision(photoId, verdict);
  } catch (error) { toast(error.message, 'error'); }
}

/* ---------- 必备画面 ---------- */

async function viewChecklist(activityId) {
  const viewHash = location.hash;
  state.view = 'checklist';
  const activity = await api(`/api/activities/${activityId}`);
  if (location.hash !== viewHash) return;
  state.activity = activity;
  app.innerHTML = `<div class="crumb">
      <a href="#/activity/${activityId}">${esc(activity.name)}</a><span class="crumb-sep">/</span><span>必备画面</span>
    </div>
    <div class="page-head" style="margin-top:8px">
      <h1>必备画面</h1>
      <span class="sub">按“已确认保留”的照片统计</span>
      <span class="spacer"></span>
      <div class="actions">
        <button id="btn-review" class="ghost">${icon('image')}去复核</button>
        <button class="primary" id="btn-export">${icon('download')}去导出</button>
      </div>
    </div>
    <div class="section">
      <div class="section-head">
        <h2>本场需要覆盖的画面</h2>
        <span class="hint">某类为 0 表示尚未确认有对应照片，不代表整场没拍到；可标记“本场不适用”并填写原因。</span>
      </div>
      <div id="label-list"></div>
      <div class="row" style="margin-top:16px">
        <input id="new-label" type="text" placeholder="新增画面，如：颁奖环节">
        <button id="btn-add-label">${icon('plus')}添加</button>
      </div>
    </div>`;

  const render = (labels) => {
    const list = app.querySelector('#label-list');
    list.innerHTML = labels.length ? labels.map((label) => `
      <div class="check-item ${label.kept_count === 0 && !label.na_reason ? 'missing' : ''}">
        <input type="text" value="${esc(label.name)}" data-label-name="${label.id}">
        <span class="count">${label.kept_count}</span>
        <input type="text" class="small" style="flex:1;min-width:160px" placeholder="本场不适用原因（可空）"
          value="${esc(label.na_reason || '')}" data-label-na="${label.id}">
        <button class="small danger" data-label-del="${label.id}">${icon('trash')}删除</button>
      </div>`).join('') : '<div class="muted small">还没有必备画面。</div>';

    list.querySelectorAll('[data-label-name]').forEach((input) => {
      input.addEventListener('change', async () => {
        try { await api(`/api/labels/${input.dataset.labelName}`, { method: 'PATCH', body: JSON.stringify({ name: input.value }) }); toast('已保存', 'ok'); }
        catch (error) { toast(error.message, 'error'); }
      });
    });
    list.querySelectorAll('[data-label-na]').forEach((input) => {
      input.addEventListener('change', async () => {
        try { await api(`/api/labels/${input.dataset.labelNa}`, { method: 'PATCH', body: JSON.stringify({ na_reason: input.value || null }) }); }
        catch (error) { toast(error.message, 'error'); }
      });
    });
    list.querySelectorAll('[data-label-del]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!confirm('删除这个必备画面？已打的标签也会移除。')) return;
        try { await api(`/api/labels/${button.dataset.labelDel}`, { method: 'DELETE' }); await reload(); }
        catch (error) { toast(error.message, 'error'); }
      });
    });
  };
  const reload = async () => { const labels = await api(`/api/activities/${activityId}/labels`); render(labels); };

  app.querySelector('#btn-delete-originals')?.addEventListener('click', () => {
    const sourceSelect = app.querySelector('#delete-source');
    const scopeSelect = app.querySelector('#delete-scope');
    if (!sourceSelect || !sourceSelect.value) { toast('没有可删除的来源卡', 'error'); return; }
    showModal(modalFrame('确认删除原片', `
      <p style="color:var(--red);font-weight:600">此操作会永久删除源目录中的文件，无法从回收站恢复。</p>
      <p>来源卡：<b>${esc(sourceSelect.options[sourceSelect.selectedIndex].textContent)}</b></p>
      <p>删除范围：<b>${esc(scopeSelect.options[scopeSelect.selectedIndex].textContent)}</b></p>
      <p class="hint">只删除该来源卡范围内的原片；已经导出到其他位置的副本会保留。照片记录也会从当前项目中移除。</p>
      <label class="row" style="font-size:13px;margin-top:12px"><input type="checkbox" id="confirm-delete-originals"> 我确认删除，并知道无法恢复</label>`,
      '<button data-close="1">取消</button><button class="danger" id="btn-confirm-delete-originals" disabled>永久删除</button>'),
      (root) => {
        bindModalClose(root);
        const check = root.querySelector('#confirm-delete-originals');
        const button = root.querySelector('#btn-confirm-delete-originals');
        check.addEventListener('change', () => { button.disabled = !check.checked; });
        button.addEventListener('click', async () => {
          if (!check.checked) return;
          button.disabled = true;
          try {
            const result = await api(`/api/activities/${activityId}/originals/delete`, {
              method: 'POST',
              body: JSON.stringify({ source_id: sourceSelect.value, scope: scopeSelect.value }),
            });
            closeModal();
            toast(`已删除 ${result.deleted} 个原片${result.failed ? `，${result.failed} 个失败` : ''}`, result.failed ? 'error' : 'ok');
            await viewExport(activityId);
          } catch (error) {
            button.disabled = false;
            toast(error.message, 'error');
          }
        });
      });
  });

  app.querySelector('#btn-back')?.addEventListener('click', () => navigate(`#/activity/${activityId}`));
  app.querySelector('#btn-review').addEventListener('click', () => navigate(`#/activity/${activityId}/review`));
  app.querySelector('#btn-export').addEventListener('click', () => navigate(`#/activity/${activityId}/export`));
  app.querySelector('#btn-add-label').addEventListener('click', async () => {
    const input = app.querySelector('#new-label');
    const name = input.value.trim();
    if (!name) return;
    try { await api(`/api/activities/${activityId}/labels`, { method: 'POST', body: JSON.stringify({ name }) }); input.value = ''; await reload(); }
    catch (error) { toast(error.message, 'error'); }
  });
  await reload();
}

/* ---------- 导出 ---------- */

async function viewExport(activityId) {
  const viewHash = location.hash;
  state.view = 'export';
  const activity = await api(`/api/activities/${activityId}`);
  if (location.hash !== viewHash) return;
  app.innerHTML = `<div class="crumb">
      <a href="#/activity/${activityId}">${esc(activity.name)}</a><span class="crumb-sep">/</span><span>导出</span>
    </div>
    <div class="page-head" style="margin-top:8px">
      <h1>导出</h1>
      <span class="sub">可选择要导出的照片范围，并生成清单与报告</span>
      <span class="spacer"></span>
      <div class="actions">
        <button id="btn-review" class="ghost">${icon('image')}去复核</button>
        <button id="btn-checklist" class="ghost">${icon('checklist')}必备画面</button>
      </div>
    </div>
    <div class="section">
      <div class="section-head"><h2>导出设置</h2><span class="hint">按选择范围复制原片，不复制预览图。</span></div>
      <div class="form-col">
        <label class="field"><span>目标文件夹</span>
          <div class="row"><input id="dest-path" type="text" style="flex:1" placeholder="例如：D:\\选片结果">
          <button id="btn-pick-dest">${icon('folder')}选择文件夹</button></div>
        </label>
        <div class="row" style="align-items:flex-end">
          <label class="field" style="min-width:210px"><span>导出照片范围</span>
            <select id="export-scope">
              <option value="keep">保留的照片</option>
              <option value="undecided">待处理的照片</option>
              <option value="uncertain">待确认的照片</option>
              <option value="reject">疑似废片</option>
              <option value="all">全部照片</option>
            </select>
          </label>
          <label class="field" style="min-width:220px"><span>RAW / JPG 配对导出</span>
            <select id="pair-mode">
              <option value="both">两者都导出（默认）</option>
              <option value="raw">只导出 RAW</option>
              <option value="jpg">只导出 JPG</option>
            </select>
          </label>
          <label class="row" style="margin-bottom:16px;font-size:13px;color:var(--muted)">
            <input id="keep-subdir" type="checkbox" checked> 保留摄影来源子目录
          </label>
        </div>
        <div class="row">
          <button id="btn-plan">${icon('checklist')}预检</button>
          <button class="primary" id="btn-export">${icon('download')}开始导出</button>
        </div>
      </div>
    </div>
    <div class="section" id="export-result"><p class="hint">先预检确认数量和缺失画面，再开始导出。</p></div>
    <div class="section" id="originals-cleanup">
      <div class="section-head"><h2>删除源卡原片</h2><span class="hint">永久删除源目录中的原片；已导出到其他位置的副本不受影响。</span></div>
      <div class="row" style="align-items:flex-end">
        <label class="field" style="min-width:240px"><span>来源卡</span>
          <select id="delete-source">${(activity.sources || []).map((src) => `<option value="${esc(src.id)}">${esc(src.label)} · ${esc(src.root_path)}</option>`).join('')}</select>
        </label>
        <label class="field" style="min-width:190px"><span>删除范围</span>
          <select id="delete-scope">
            <option value="keep">保留的照片</option>
            <option value="undecided">待处理的照片</option>
            <option value="uncertain">待确认的照片</option>
            <option value="reject">疑似废片</option>
            <option value="all">全部照片</option>
          </select>
        </label>
        <button class="danger" id="btn-delete-originals" type="button">${icon('trash')}删除原片</button>
      </div>
      <p class="hint" style="margin-top:8px">删除后照片会从软件中移除；未导出的文件无法恢复，操作前请确认目标文件夹。</p>
    </div>`;

  const opts = () => ({
    dest_root: app.querySelector('#dest-path').value.trim(),
    pair_mode: app.querySelector('#pair-mode').value,
    keep_source_subdir: app.querySelector('#keep-subdir').checked,
    scope: app.querySelector('#export-scope')?.value || 'keep',
  });
  const renderPlan = (plan) => {
    const missing = (plan.labels || []).filter((label) => label.kept_count === 0 && !label.na_reason);
    app.querySelector('#export-result').innerHTML = `
      <h2>预检结果</h2>
      <div class="stats">
        <div class="stat"><div class="num">${plan.objects}</div><div class="lbl">导出照片对象</div></div>
        <div class="stat"><div class="num">${plan.files}</div><div class="lbl">将复制文件</div></div>
        <div class="stat"><div class="num">${fmtBytes(plan.bytes)}</div><div class="lbl">预计占用</div></div>
        <div class="stat"><div class="num">${plan.renamed}</div><div class="lbl">重名自动改名</div></div>
      </div>
      ${missing.length ? `<p style="color:var(--orange)">缺少必备画面：${missing.map((label) => esc(label.name)).join('、')}。可以回复核补选，或在“必备画面”标记不适用后继续。</p>` : '<p class="muted small">必备画面均有保留照片，或已标记不适用。</p>'}
      ${plan.missing ? `<p style="color:var(--red)">有 ${plan.missing} 个原片文件已不存在。</p>` : ''}
      <p class="hint">目标：${esc(plan.dest_root)}</p>`;
  };
  const renderExport = (data) => {
    const counts = data.item_counts || {};
    const failed = counts.failed || 0;
    app.querySelector('#export-result').innerHTML = `
      <h2>导出${data.status === 'done' ? '完成' : '结果'}</h2>
      <p>成功 ${counts.done || 0} 个文件${failed ? `，失败 <span style="color:var(--red)">${failed}</span> 个` : ''}。</p>
      <p class="hint">目标：${esc(data.dest_root)}</p>
      <div class="row">
        <button id="btn-open-dest">${icon('folderOpen')}打开目标文件夹</button>
        ${data.manifest_path ? `<button id="btn-manifest">${icon('download')}下载选片清单</button>` : ''}
        ${data.report_path ? `<button id="btn-report">${icon('file')}查看处理报告</button>` : ''}
        ${failed ? `<button id="btn-retry">${icon('refresh')}重试失败项</button>` : ''}
      </div>
      ${(data.failed_items || []).length ? `<p class="hint">${data.failed_items.map((item) => `${esc(item.source_path)}：${esc(item.error)}`).join('<br>')}</p>` : ''}`;
    app.querySelector('#btn-open-dest').addEventListener('click', async () => {
      try { await api('/api/fs/open', { method: 'POST', body: JSON.stringify({ path: data.dest_root }) }); }
      catch (error) { toast(error.message, 'error'); }
    });
    const manifest = app.querySelector('#btn-manifest');
    if (manifest) manifest.addEventListener('click', () => window.open(`/api/exports/${data.id}/manifest`, '_blank'));
    const reportButton = app.querySelector('#btn-report');
    if (reportButton) reportButton.addEventListener('click', () => window.open(`/api/exports/${data.id}/report`, '_blank'));
    const retry = app.querySelector('#btn-retry');
    if (retry) retry.addEventListener('click', async () => {
      try {
        const result = await api(`/api/exports/${data.id}/retry`, { method: 'POST' });
        toast(`重试 ${result.retried} 项，剩余失败 ${result.remaining_failed} 项`, 'ok');
        renderExport(await api(`/api/exports/${data.id}`));
      } catch (error) { toast(error.message, 'error'); }
    });
  };

  app.querySelector('#btn-back')?.addEventListener('click', () => navigate(`#/activity/${activityId}`));
  app.querySelector('#btn-review').addEventListener('click', () => navigate(`#/activity/${activityId}/review`));
  app.querySelector('#btn-checklist').addEventListener('click', () => navigate(`#/activity/${activityId}/checklist`));
  app.querySelector('#btn-pick-dest').addEventListener('click', () => {
    openFolderPicker('', (path) => { app.querySelector('#dest-path').value = path; });
  });
  app.querySelector('#btn-plan').addEventListener('click', async () => {
    const values = opts();
    if (!values.dest_root) { toast('请先选择目标文件夹', 'error'); return; }
    try {
      const plan = await api(`/api/activities/${activityId}/exports/plan`, { method: 'POST', body: JSON.stringify(values) });
      renderPlan(plan);
      if (plan.files === 0) toast('该范围内没有可导出的照片', 'error');
    } catch (error) { toast(error.message, 'error'); }
  });
  app.querySelector('#btn-export').addEventListener('click', async () => {
    const values = opts();
    if (!values.dest_root) { toast('请先选择目标文件夹', 'error'); return; }
    const button = app.querySelector('#btn-export');
    button.disabled = true;
    const resultNode = app.querySelector('#export-result');
    resultNode.innerHTML = `
      <div class="progress"><div id="export-progress-bar" style="width:0%"></div></div>
      <div class="progress-label" id="export-progress-label">正在规划文件…</div>`;
    try {
      const started = await api(`/api/activities/${activityId}/exports/quick`, {
        method: 'POST', body: JSON.stringify(values),
      });
      const exportId = started.export?.id;
      if (!exportId) throw new Error('导出任务创建失败');
      let lastDone = -1;
      const paint = (data) => {
        const counts = data.item_counts || {};
        const done = (counts.done || 0) + (counts.failed || 0);
        const total = Number(data.total_items || started.files || 0);
        const percent = total ? Math.min(100, Math.round(done / total * 100)) : 0;
        const bar = app.querySelector('#export-progress-bar');
        const label = app.querySelector('#export-progress-label');
        if (!bar || !label) return;
        bar.style.width = `${percent}%`;
        label.textContent = `正在复制原片 ${done} / ${total} · ${fmtBytes(data.bytes_done || 0)} / ${fmtBytes(data.bytes_total || started.bytes || 0)}${counts.failed ? ` · 失败 ${counts.failed}` : ''}`;
        lastDone = done;
      };
      const poll = async () => {
        try {
          const data = await api(`/api/exports/${exportId}`);
          paint(data);
          if (['done', 'done_with_errors'].includes(data.status)) {
            clearInterval(state.exportTimer); state.exportTimer = null;
            renderExport(data);
            toast(data.status === 'done' ? '导出完成' : '导出完成，但有文件失败', data.status === 'done' ? 'ok' : 'error');
            button.disabled = false;
          }
        } catch (error) {
          clearInterval(state.exportTimer); state.exportTimer = null;
          button.disabled = false;
          const label = app.querySelector('#export-progress-label');
          if (label) label.textContent = `导出进度读取失败：${error.message}`;
        }
      };
      if (state.exportTimer) clearInterval(state.exportTimer);
      state.exportTimer = setInterval(poll, 500);
      await poll();
    } catch (error) {
      resultNode.innerHTML = `<p style="color:var(--red)">导出失败：${esc(error.message)}</p>`;
      button.disabled = false;
    }
  });
}

/* ---------- 设置 ---------- */


let cachedGpuInfo = null;
function gpuRendererInfo() {
  if (cachedGpuInfo) return cachedGpuInfo;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      document.documentElement.dataset.gpu = 'software';
      return { label: '软件渲染', detail: '当前 WebView 没有可用的 WebGL 上下文' };
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    const software = /swiftshader|software|llvmpipe|mesa offscreen/i.test(renderer);
    document.documentElement.dataset.gpu = software ? 'software' : 'hardware';
    cachedGpuInfo = {
      label: software ? '软件渲染' : 'GPU 硬件加速',
      detail: renderer,
    };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return cachedGpuInfo;
  } catch (_) {
    return { label: '未知', detail: '' };
  }
}

function refreshGpuStatus() {
  const node = document.querySelector('#gpu-renderer');
  if (!node) return;
  const info = gpuRendererInfo();
  node.textContent = info.label;
  node.title = info.detail;
}


function bindShortcutSettings(root) {
  const inputs = [...root.querySelectorAll('[data-shortcut]')];
  const hint = root.querySelector('#shortcut-conflict-hint');
  const refresh = () => {
    const seen = new Map();
    const conflicts = new Set();
    inputs.forEach((input) => {
      const value = normalizeShortcut(input.value);
      if (value && seen.has(value)) { conflicts.add(input); conflicts.add(seen.get(value)); }
      else if (value) seen.set(value, input);
      input.classList.toggle('conflict', conflicts.has(input));
    });
    if (hint) {
      hint.hidden = conflicts.size === 0;
      hint.textContent = conflicts.size ? '有快捷键重复，请修改标红的项后再使用。' : '';
    }
    updateShortcutAlert();
  };
  inputs.forEach((input) => {
    input.addEventListener('keydown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Backspace' || event.key === 'Delete') {
        input.value = '';
        saveShortcuts({ [input.dataset.shortcut]: '' });
        refresh();
        return;
      }
      if (event.key === 'Escape') { input.blur(); return; }
      const value = eventToShortcut(event);
      if (!value) return;
      input.value = value;
      saveShortcuts({ [input.dataset.shortcut]: value });
      refresh();
    });
    input.addEventListener('blur', () => {
      const value = normalizeShortcut(input.value);
      input.value = value;
      saveShortcuts({ [input.dataset.shortcut]: value });
      refresh();
    });
  });
  root.querySelector('#btn-reset-shortcuts')?.addEventListener('click', () => {
    inputs.forEach((input) => {
      input.value = DEFAULT_SHORTCUTS[input.dataset.shortcut] || '';
    });
    saveShortcuts({ ...DEFAULT_SHORTCUTS });
    refresh();
  });
  refresh();
}

async function viewSettings() {
  const viewHash = location.hash;
  state.view = 'settings';
  const settings = await api('/api/settings');
  if (location.hash !== viewHash) return;
  const styles = [
    ['standard', '极简', '中性留白，轻触感按钮，专注照片'],
    ['liquid', '液态玻璃', '蓝色海浪壁纸，清透玻璃与轻雾质感'],
  ];
  const currentTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  app.innerHTML = `<div class="page-head">
      <h1>设置</h1><span class="sub">外观、动效与 AI 参数只保存在这台电脑上。</span>
    </div>
    <nav class="settings-jump" id="settings-jump" aria-label="设置分区">
      <button type="button" data-settings-target="settings-appearance" class="active">外观</button>
      <button type="button" data-settings-target="settings-glass">液态玻璃</button>
      <button type="button" data-settings-target="settings-wallpaper">壁纸</button>
      <button type="button" data-settings-target="settings-shortcuts">快捷键</button>
      <button type="button" data-settings-target="settings-ai">AI 接口</button>
      <button type="button" data-settings-target="settings-screening">筛图加速</button>
      <button type="button" data-settings-target="settings-open-source">开源组件</button>
      <button type="button" data-settings-target="settings-agent">Agent 权限</button>
      <button type="button" data-settings-target="settings-about">关于</button>
    </nav>
    <div class="section appearance-section settings-section" id="settings-appearance">
      <div class="section-head">
        <h2>外观与风格</h2>
        <span class="hint">两种材质，两种手感。选择后即时应用，自动记住你的偏好。</span>
      </div>
      <div class="style-grid">
        ${styles.map(([key, name, desc]) => `
          <button class="style-card ${styleMode === key ? 'active' : ''}" data-style-choice="${key}" aria-pressed="${styleMode === key}">
            <span class="style-active-badge" ${styleMode === key ? '' : 'hidden'}>使用中</span>
            <span class="style-preview style-preview-${key}">
              <i class="sp-top"></i><i class="sp-side"></i><i class="sp-tile"></i><i class="sp-tile"></i><i class="sp-tile"></i>
            </span>
            <span class="style-card-text"><b>${name}</b><small>${desc}</small></span>
          </button>`).join('')}
      </div>
      <div class="pref-grid">
        <div class="field">
          <span>界面动效</span>
          <div class="choice-row">
            ${[['system', '跟随系统'], ['on', '始终开启'], ['off', '关闭']].map(([key, label]) => `
              <button class="choice ${motionMode === key ? 'active' : ''}" data-motion-choice="${key}" aria-pressed="${motionMode === key}">${label}</button>`).join('')}
          </div>
          <small class="hint pref-hint">${motionMode === 'system' && motionPreference.matches ? 'Windows 已关闭动画，选择“始终开启”可保留拾影的动效。' : '控制页面淡化、照片上台、主题揭示和导航展开的节奏。'}</small>
        </div>
        <div class="field"><span>缩略图密度</span>
          <div class="choice-row">
            ${[['comfortable', '标准'], ['compact', '紧凑'], ['large', '宽松']].map(([key, label]) => `
              <button class="choice ${densityMode === key ? 'active' : ''}" data-density-choice="${key}" aria-pressed="${densityMode === key}">${label}</button>`).join('')}
          </div>
        </div>
        <div class="field"><span>明暗主题</span>
          <div class="choice-row">
            ${[['light', '浅色'], ['dark', '深色']].map(([key, label]) => `
              <button class="choice ${currentTheme === key ? 'active' : ''}" data-theme-choice="${key}" aria-pressed="${currentTheme === key}">${label}</button>`).join('')}
          </div>
        </div>
        <div class="field"><span>关闭窗口时</span>
          <div class="choice-row">
            ${[['background', '留在后台'], ['quit', '完全关闭']].map(([key, label]) => `
              <button class="choice ${closeMode === key ? 'active' : ''}" data-close-choice="${key}" aria-pressed="${closeMode === key}">${label}</button>`).join('')}
          </div>
          <small class="hint pref-hint">留在后台可从系统托盘重新打开；完全关闭会退出程序。</small>
        </div>
      </div>
      <div class="row" style="margin-top:var(--s4)">
        <button id="btn-reset-prefs" class="small ghost">${icon('refresh')}恢复默认外观</button>
      </div>
    </div>
    <div class="section settings-section" id="settings-glass">
      <div class="section-head">
        <h2>液态玻璃材质</h2>
        <span class="hint">只影响液态玻璃主题；拖动滑条即时生效。</span>
      </div>
      <div class="settings-controls">
        <label class="settings-control"><span>玻璃透明度</span>
          <div class="row"><input id="glass-opacity" type="range" min="0" max="100" step="1" value="${glassPrefs.opacity}"><output id="glass-opacity-value">${Math.round(glassPrefs.opacity)}%</output></div>
          <small>越高越通透，越低越接近实色。</small>
        </label>
        <label class="settings-control"><span>磨砂程度</span>
          <div class="row"><input id="glass-blur" type="range" min="0" max="24" step="0.5" value="${glassPrefs.blur}"><output id="glass-blur-value">${Number(glassPrefs.blur).toFixed(1)} px</output></div>
          <small>背景模糊半径，越低越清透。</small>
        </label>
        <label class="settings-control"><span>色彩饱和</span>
          <div class="row"><input id="glass-saturate" type="range" min="80" max="220" step="1" value="${glassPrefs.saturate}"><output id="glass-saturate-value">${Math.round(glassPrefs.saturate)}%</output></div>
          <small>让玻璃后的壁纸颜色更浓或更淡。</small>
        </label>
        <label class="settings-control"><span>卡片圆角</span>
          <div class="row"><input id="glass-radius" type="range" min="0" max="32" step="1" value="${glassPrefs.radius}"><output id="glass-radius-value">${Math.round(glassPrefs.radius)} px</output></div>
          <small>同时作用于卡片的控制圆角。</small>
        </label>
        <label class="settings-control"><span>玻璃底色</span>
          <div class="row"><input id="glass-tint" class="settings-color" type="color" value="${glassPrefs.tint === 'none' ? '#0a1018' : esc(glassPrefs.tint)}" ${glassPrefs.tint === 'none' ? 'disabled' : ''}><button type="button" id="glass-tint-none" class="choice ${glassPrefs.tint === 'none' ? 'active' : ''}">无</button><output id="glass-tint-value">${glassPrefs.tint === 'none' ? '无' : esc(glassPrefs.tint)}</output></div>
          <small>面板的透明染色；选“无”则完全不加底色。</small>
        </label>
      </div>
      <div class="row" style="margin-top:var(--s4)">
        <button id="btn-glass-reset" class="small ghost">恢复默认玻璃</button>
      </div>
    </div>
    <div class="section settings-section" id="settings-wallpaper">
      <div class="section-head">
        <h2>壁纸</h2>
        <span class="hint">支持本地上传、Windows 当前壁纸和 Wallpaper Engine 预览图。壁纸在所有主题生效。</span>
      </div>
      <div class="settings-wallpaper-preview" id="wp-preview" style="${wallpaperPrefs.url ? `background-image:url('${esc(wallpaperPrefs.url)}')` : ''}">${wallpaperPrefs.url ? '' : '当前使用主题默认壁纸'}</div>
      <div class="settings-wallpaper-actions">
        <button id="btn-wp-upload" class="small">${icon('upload')}上传本地图片</button>
        <input id="wp-file" type="file" accept="image/*" hidden>
        <button id="btn-wp-system" class="small">${icon('monitor')}使用 Windows 当前壁纸</button>
        <button id="btn-wp-we" class="small">${icon('image')}扫描 Wallpaper Engine</button>
        <button id="btn-wp-reset" class="small ghost">恢复主题壁纸</button>
      </div>
      <p class="hint" id="wp-status" style="margin-top:8px">${wallpaperPrefs.name ? `当前：${esc(wallpaperPrefs.name)}` : '当前：主题默认壁纸'}</p>
      <div class="settings-controls" style="margin-top:14px">
        <label class="settings-control"><span>壁纸调暗</span>
          <div class="row"><input id="wp-dim" type="range" min="0" max="80" step="1" value="${wallpaperPrefs.dim}"><output id="wp-dim-value">${Math.round(wallpaperPrefs.dim)}%</output></div>
          <small>提高文字对比度，不改变壁纸本身。</small>
        </label>
        <label class="settings-control"><span>壁纸模糊</span>
          <div class="row"><input id="wp-blur" type="range" min="0" max="24" step="1" value="${wallpaperPrefs.blur}"><output id="wp-blur-value">${Math.round(wallpaperPrefs.blur)} px</output></div>
          <small>只模糊壁纸，不影响照片与文字。</small>
        </label>
        <label class="settings-control"><span>壁纸填充</span>
          <div class="row"><select id="wp-fit"><option value="cover" ${wallpaperPrefs.fit === 'cover' ? 'selected' : ''}>铺满裁切</option><option value="contain" ${wallpaperPrefs.fit === 'contain' ? 'selected' : ''}>完整显示</option></select></div>
          <small>选择完整显示时，留白会使用主题底色。</small>
        </label>
      </div>
      <div class="settings-we-grid" id="wp-we-grid" hidden></div>
    </div>
    <div class="section settings-section" id="settings-shortcuts">
      <div class="section-head">
        <h2>快捷键</h2>
        <span class="hint">点击输入框后直接按下组合键。重复的快捷键会显示红点提醒。</span>
      </div>
      <div class="shortcut-list" id="shortcut-list">
        ${SHORTCUT_DEFS.map(([key, label]) => `<label class="shortcut-row">
          <span>${esc(label)}</span>
          <input class="shortcut-input" data-shortcut="${key}" value="${esc(userShortcuts[key] || '')}" readonly aria-label="${esc(label)}快捷键">
          <span class="hint">${key === 'export' || key === 'delete' ? '作用于当前分类栏' : (key === 'detail' ? '切换右侧详情栏' : '复核界面内生效')}</span>
        </label>`).join('')}
      </div>
      <p class="hint" id="shortcut-conflict-hint" hidden style="color:var(--red);margin-top:10px"></p>
      <div class="row" style="margin-top:var(--s4)">
        <button id="btn-reset-shortcuts" class="small ghost" type="button">${icon('refresh')}恢复默认快捷键</button>
      </div>
    </div>
    <div class="section settings-section" id="settings-agent">
      <div class="section-head">
        <h2>Agent 权限</h2>
        <span class="hint">硬边界：永远不能修改软件源码、安装目录或程序文件。</span>
      </div>
      <div class="settings-perms">
        <label class="settings-perm"><span>读取活动与照片</span><input id="agent-perm-read" type="checkbox" ${agentPermissions.read ? 'checked' : ''}></label>
        <label class="settings-perm"><span>修改选片结论 / 复制照片</span><input id="agent-perm-write" type="checkbox" ${agentPermissions.write ? 'checked' : ''}></label>
        <label class="settings-perm"><span>读取网页内容</span><input id="agent-perm-web" type="checkbox" ${agentPermissions.web ? 'checked' : ''}></label>
        <label class="settings-perm"><span>调用系统浏览器</span><input id="agent-perm-browser" type="checkbox" ${agentPermissions.browser ? 'checked' : ''}></label>
      </div>
      <p class="hint">参考图找人和复制照片会消耗 DeepSeek 视觉调用；单次最多比较 12 张。删除原片、导出原片和全量分析仍需你在界面确认。</p>
    </div>
    <div class="settings-columns">
    <div class="section settings-section" id="settings-api">
      <div class="section-head">
        <h2>DeepSeek API Key</h2>
        <span class="hint">Windows 本机加密保存（DPAPI），不会写入报告或日志；换电脑需重新填写。</span>
      </div>
      <div class="form-col">
        <p class="hint" style="margin-bottom:var(--s4)">
          <span class="status-dot ${settings.api_key_set ? 'done' : 'failed'}"></span>
          当前状态：${settings.api_key_set ? '已保存' : '未设置'}
        </p>
        <label class="field"><span>API Key</span>
          <div class="row"><input id="api-key" type="password" style="flex:1" placeholder="sk-…（只写不读）">
          <button id="btn-save-key" class="primary">${icon('save')}保存</button>
          <button id="btn-clear-key" class="danger">${icon('trash')}清除</button></div>
        </label>
      </div>
    </div>
    <div class="section settings-section" id="settings-screening">
      <div class="section-head"><h2>筛图加速</h2><span class="hint">专用 Key 池</span></div>
      <p class="hint">主 Key 与下方 Key 共同分担筛图，其他 AI 功能仍使用主 Key。所有 Key 使用上方同一服务商接口与模型。</p>
      <div id="screening-keys" class="form-col"></div>
      <label class="field"><span>添加筛图专用 Key</span><div class="row">
        <input id="screening-key" type="password" autocomplete="new-password" placeholder="sk-…（加密保存，只显示尾号）" style="flex:1">
        <button id="btn-add-screening-key" type="button">${icon('plus')}添加</button>
      </div></label>
      <label class="field"><span>同时筛图上限</span><div class="row">
        <select id="screening-concurrency">${[1,2,3,4,6,8,12].map(n => `<option value="${n}" ${Number(settings.screening_concurrency) === n ? 'selected' : ''}>${n} 张</option>`).join('')}</select>
        <button id="btn-save-screening" type="button">保存上限</button>
      </div></label>
      <p class="hint" id="screening-key-status" role="status"></p>
      <p class="hint">默认 3 张，每个 Key 最多同时处理 3 张。同账号的 Key 可能共享限流额度；限流时自动退避。设置从下一次任务生效。</p>
    </div>
    <div class="section settings-section" id="settings-ai">
      <div class="section-head">
        <h2>AI 接口与计价</h2>
        <span class="hint">模型 deepseek-flash 支持图片输入；单价按“元/百万 tokens”填写。</span>
      </div>
      <p class="hint">默认值取 DeepSeek 高峰时段、缓存未命中的偏高价格（输入 2 元、输出 8 元），空闲时段约减半，最终费用以服务端账单为准。</p>
      <div class="form-col">
      <div class="row">
        <label class="field" style="flex:1;min-width:240px"><span>精筛模型</span><input id="model" type="text" value="${esc(settings.model)}"></label>
        <label class="field" style="flex:1;min-width:200px"><span>快筛模型（留空=同上）</span><input id="quick-model" type="text" value="${esc(settings.quick_model || '')}" placeholder="留空则用精筛模型"></label>
        <label class="field" style="flex:2;min-width:280px"><span>接口地址</span><input id="base-url" type="text" value="${esc(settings.base_url)}"></label>
      </div>
      <div class="row">
        <label class="field" style="flex:1"><span>输入单价（元/百万 tokens）</span>
          <input id="price-in" type="number" min="0" step="0.01" value="${settings.price_input_cny_per_m}"></label>
        <label class="field" style="flex:1"><span>输出单价（元/百万 tokens）</span>
          <input id="price-out" type="number" min="0" step="0.01" value="${settings.price_output_cny_per_m}"></label>
      </div>
      <div class="row">
        <label class="field" style="flex:1"><span>每张图片预估 token</span>
          <input id="est-image" type="number" min="1" value="${settings.estimate_image_tokens}"></label>
        <label class="field" style="flex:1"><span>提示词预估 token</span>
          <input id="est-prompt" type="number" min="1" value="${settings.estimate_prompt_tokens}"></label>
        <label class="field" style="flex:1"><span>最大输出 token（含推理）</span>
          <input id="max-output" type="number" min="800" step="100" value="${settings.max_output_tokens}"></label>
      </div>
      <p class="hint">按当前设置，每张照片预估 ¥${settings.per_photo_cost}。推理内容也计入输出上限，建议保持 1600；过低会导致 JSON 被截断。</p>
      <button id="btn-save-ai" class="primary">${icon('save')}保存接口参数</button>
      </div>
    </div>
    <div class="section settings-section" id="settings-open-source">
      <div class="section-head">
        <h2>本地模型与开源组件</h2>
        <span class="hint">连拍分组的“场景向量 + 人脸向量”全部在本机运行，不上传照片。</span>
      </div>
      <div class="hair-list">
        <div class="hair-row"><span class="grow">CLIP ViT-B/32 场景向量</span><span class="hint">OpenAI CLIP（MIT）· Xenova ONNX 导出 · float32 原模型</span></div>
        <div class="hair-row"><span class="grow">ONNX Runtime</span><span class="hint">Microsoft（MIT）· 本地 CPU 推理</span></div>
        <div class="hair-row"><span class="grow">YuNet / SFace 人脸模型</span><span class="hint">OpenCV Zoo（Apache-2.0）· 仅本地人脸/人物相似度</span></div>
        <div class="hair-row"><span class="grow">实现方式</span><span class="hint">使用上述开源模型和库，未直接复制第三方应用代码</span></div>
      </div>
      <p class="hint" style="margin-top:10px">模型文件随安装包离线提供，不联网、不上传照片。各模型/库的完整许可和来源以对应上游仓库为准；如果你要二次分发，请保留对应许可声明。</p>
    </div>
    <div class="section settings-section" id="settings-about">
      <div class="section-head"><h2>关于</h2></div>
      <div class="hair-list">
        <div class="hair-row"><span class="grow">版本</span><span class="mono">v${esc(settings.version)}</span></div>
        <div class="hair-row"><span class="grow">升级方式</span><span class="mono">双击升级包覆盖安装，项目/照片/Key 保留</span></div>
        <div class="hair-row"><span class="grow">数据目录</span><span class="mono">${esc(settings.data_dir)}</span></div>
        <div class="hair-row"><span class="grow">图形渲染</span><span class="mono" id="gpu-renderer">检测中…</span></div>
        <div class="hair-row"><span class="grow">当前帧率</span><span class="mono" id="fps-renderer">—</span></div>
      </div>
      <div class="row" style="margin-top:var(--s4)">
        <button id="btn-open-data" class="small ghost">${icon('folder')}打开数据文件夹</button>
      </div>
    </div>
    </div>`;

  app.querySelector('#btn-save-key').addEventListener('click', async () => {
    const key = app.querySelector('#api-key').value.trim();
    if (!key) { toast('请填写 API Key', 'error'); return; }
    try { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ api_key: key }) }); toast('已加密保存', 'ok'); await viewSettings(); }
    catch (error) { toast(error.message, 'error'); }
  });
  app.querySelector('#btn-clear-key').addEventListener('click', async () => {
    if (!confirm('确定清除已保存的 API Key？')) return;
    try { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ clear_api_key: true }) }); toast('已清除', 'ok'); await viewSettings(); }
    catch (error) { toast(error.message, 'error'); }
  });
  const keyList = app.querySelector('#screening-keys');
  const renderKeys = items => {
    keyList.innerHTML = items.length ? items.map((item, index) => `<div class="row"><span class="hint">筛图 Key ${index + 1} · ${esc(item.mask)}</span><button type="button" class="small ghost" data-remove-key="${esc(item.id)}">移除</button></div>`).join('') : '<p class="hint">尚未添加专用 Key；默认使用主 Key。</p>';
    app.querySelector('#screening-key-status').textContent = `已保存 ${items.length} 个专用 Key${settings.api_key_set ? '，另有 1 个主 Key' : ''}。`;
  };
  renderKeys(settings.screening_keys || []);
  keyList.addEventListener('click', async event => {
    const button = event.target.closest('[data-remove-key]');
    if (!button) return;
    button.disabled = true;
    try { const data = await api(`/api/settings/screening-keys/${encodeURIComponent(button.dataset.removeKey)}`, {method:'DELETE'}); renderKeys(data.items); }
    catch (error) { toast(error.message, 'error'); button.disabled = false; }
  });
  app.querySelector('#btn-add-screening-key').addEventListener('click', async event => {
    const button = event.currentTarget;
    const input = app.querySelector('#screening-key');
    if (!input.value.trim()) { input.focus(); return; }
    button.disabled = true;
    try {
      const data = await api('/api/settings/screening-keys', {method:'POST', body:JSON.stringify({key:input.value.trim()})});
      input.value = ''; renderKeys(data.items); toast('筛图 Key 已加密保存', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  app.querySelector('#btn-save-screening').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      await api('/api/settings', {method:'PUT', body:JSON.stringify({screening_concurrency:Number(app.querySelector('#screening-concurrency').value)})});
      toast('并发上限已保存，下次筛图生效', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  app.querySelector('#btn-save-ai').addEventListener('click', async () => {
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          model: app.querySelector('#model').value.trim(),
          quick_model: app.querySelector('#quick-model').value.trim(),
          base_url: app.querySelector('#base-url').value.trim(),
          price_input_cny_per_m: Number(app.querySelector('#price-in').value),
          price_output_cny_per_m: Number(app.querySelector('#price-out').value),
          estimate_image_tokens: Number(app.querySelector('#est-image').value),
          estimate_prompt_tokens: Number(app.querySelector('#est-prompt').value),
          max_output_tokens: Number(app.querySelector('#max-output').value),
        }),
      });
      toast('已保存', 'ok');
      await viewSettings();
    } catch (error) { toast(error.message, 'error'); }
  });
  app.querySelector('#btn-open-data').addEventListener('click', async () => {
    try { await api('/api/fs/open', { method: 'POST', body: JSON.stringify({ path: settings.data_dir }) }); }
    catch (error) { toast(error.message, 'error'); }
  });

  const styleNames = { standard: '极简', liquid: '液态玻璃' };
  app.querySelectorAll('[data-style-choice]').forEach((button) => {
    button.addEventListener('click', (event) => {
      applyStyle(button.dataset.styleChoice, event);
      toast(`已切换：${styleNames[button.dataset.styleChoice] || ''}`, 'ok');
      button.blur();
    });
  });
  app.querySelectorAll('[data-motion-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      applyMotionMode(button.dataset.motionChoice);
      const hint = app.querySelector('.pref-hint');
      if (hint) hint.textContent = button.dataset.motionChoice === 'system' && motionPreference.matches
        ? 'Windows 已关闭动画，选择“始终开启”可保留拾影的动效。'
        : '控制页面淡化、照片上台、主题揭示和导航展开的节奏。';
    });
  });
  app.querySelectorAll('[data-density-choice]').forEach((button) => {
    button.addEventListener('click', () => applyDensity(button.dataset.densityChoice));
  });
  app.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.addEventListener('click', (event) => applyTheme(button.dataset.themeChoice, event));
  });
  app.querySelectorAll('[data-close-choice]').forEach((button) => {
    button.addEventListener('click', () => applyCloseMode(button.dataset.closeChoice, true));
  });
  app.querySelector('#btn-reset-prefs').addEventListener('click', () => {
    applyStyle('liquid');
    applyDensity('comfortable');
    applyMotionMode('system');
    applyTheme('light');
    applyCloseMode('quit');
    initChoiceSliders();
    toast('已恢复默认外观', 'ok');
  });
  // 设置分区导航由 release-motion.js 统一绑定（含 active/指示器/减少动态）
  bindShortcutSettings(app);

  // 液态玻璃参数
  const bindGlassRange = (id, key, formatter) => {
    const input = app.querySelector('#' + id);
    const output = app.querySelector('#' + id + '-value');
    input?.addEventListener('input', () => {
      glassPrefs[key] = Number(input.value);
      if (output) output.textContent = formatter(Number(input.value));
      saveGlassPrefs();
    });
  };
  bindGlassRange('glass-opacity', 'opacity', (v) => `${Math.round(v)}%`);
  bindGlassRange('glass-blur', 'blur', (v) => `${v.toFixed(1)} px`);
  bindGlassRange('glass-saturate', 'saturate', (v) => `${Math.round(v)}%`);
  bindGlassRange('glass-radius', 'radius', (v) => `${Math.round(v)} px`);
  app.querySelector('#glass-tint')?.addEventListener('input', (event) => {
    glassPrefs.tint = event.target.value;
    const output = app.querySelector('#glass-tint-value');
    const noneButton = app.querySelector('#glass-tint-none');
    noneButton?.classList.remove('active');
    if (output) output.textContent = glassPrefs.tint;
    saveGlassPrefs();
  });
  app.querySelector('#glass-tint-none')?.addEventListener('click', () => {
    const noneButton = app.querySelector('#glass-tint-none');
    const colorInput = app.querySelector('#glass-tint');
    const output = app.querySelector('#glass-tint-value');
    if (glassPrefs.tint === 'none') {
      glassPrefs.tint = colorInput?.value || '#0a1018';
      noneButton?.classList.remove('active');
      if (colorInput) colorInput.disabled = false;
    } else {
      glassPrefs.tint = 'none';
      noneButton?.classList.add('active');
      if (colorInput) colorInput.disabled = true;
    }
    if (output) output.textContent = glassPrefs.tint === 'none' ? '无' : glassPrefs.tint;
    saveGlassPrefs();
  });
  app.querySelector('#btn-glass-reset')?.addEventListener('click', () => {
    glassPrefs = { opacity: 100, blur: 12, saturate: 110, radius: 14, tint: '#0a1018' };
    saveGlassPrefs();
    viewSettings();
    toast('已恢复默认玻璃参数', 'ok');
  });

  // 壁纸
  const wpStatus = (text) => { const node = app.querySelector('#wp-status'); if (node) node.textContent = text; };
  const applyWallpaperResult = (result) => {
    wallpaperPrefs.kind = result.kind || 'image';
    wallpaperPrefs.media_url = result.media_url || '';
    wallpaperPrefs.scene_url = result.scene_url || '';
    wallpaperPrefs.url = (result.kind === 'video' || result.kind === 'scene') ? (result.preview_url || result.url || '') : (result.url || '');
    wallpaperPrefs.preview_url = result.preview_url || result.url || '';
    wallpaperPrefs.name = result.name || result.original_name || (result.kind === 'video' ? '动态壁纸' : '自定义壁纸');
    saveWallpaperPrefs();
    const preview = app.querySelector('#wp-preview');
    if (preview) {
      preview.style.backgroundImage = wallpaperPrefs.preview_url ? `url('${wallpaperPrefs.preview_url}')` : '';
      preview.textContent = wallpaperPrefs.preview_url ? '' : '当前使用主题默认壁纸';
    }
    wpStatus(`当前：${wallpaperPrefs.name}`);
    toast(wallpaperPrefs.kind === 'video' ? '动态视频壁纸已应用' : (wallpaperPrefs.kind === 'scene' ? '场景实时壁纸已加载' : '壁纸已应用'), 'ok');
  };
  app.querySelector('#btn-wp-upload')?.addEventListener('click', () => app.querySelector('#wp-file')?.click());
  app.querySelector('#wp-file')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { toast('壁纸不能超过 20MB', 'error'); return; }
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
      });
      const result = await api('/api/wallpapers/upload', { method: 'POST', body: JSON.stringify({ name: file.name, data }) });
      applyWallpaperResult(result);
    } catch (error) { toast(error.message || '壁纸上传失败', 'error'); }
  });
  app.querySelector('#btn-wp-system')?.addEventListener('click', async () => {
    wpStatus('正在读取 Windows 壁纸…');
    try { applyWallpaperResult(await api('/api/wallpapers/system', { method: 'POST' })); }
    catch (error) { wpStatus('读取失败'); toast(error.message || '读取 Windows 壁纸失败', 'error'); }
  });
  app.querySelector('#btn-wp-we')?.addEventListener('click', async () => {
    const grid = app.querySelector('#wp-we-grid');
    if (!grid) return;
    wpStatus('正在扫描 Wallpaper Engine 壁纸…');
    grid.hidden = true;
    try {
      const data = await api('/api/wallpapers/wallpaper-engine');
      if (!data.count) {
        wpStatus(data.available ? '没有找到 Wallpaper Engine 壁纸预览' : '没有找到 Wallpaper Engine，请确认 Steam 已安装并至少有一张壁纸');
        return;
      }
      grid.innerHTML = data.items.map((item) => `<button type="button" class="settings-we-item" data-we-id="${esc(item.id)}"><img src="${esc(item.thumb_url)}" alt="" loading="lazy"><span>${esc(item.title)} · ${item.kind === 'video' ? '动态视频' : '场景静态预览'}</span></button>`).join('');
      grid.hidden = false;
      wpStatus(`找到 ${data.count} 张 Wallpaper Engine 壁纸，点击应用`);
      grid.querySelectorAll('.settings-we-item').forEach((button) => {
        button.addEventListener('click', async () => {
          try {
            const result = await api('/api/wallpapers/wallpaper-engine/apply', { method: 'POST', body: JSON.stringify({ id: button.dataset.weId }) });
            applyWallpaperResult(result);
          } catch (error) { toast(error.message || '应用壁纸失败', 'error'); }
        });
      });
    } catch (error) { wpStatus('扫描失败'); toast(error.message || '扫描 Wallpaper Engine 失败', 'error'); }
  });
  app.querySelector('#btn-wp-reset')?.addEventListener('click', () => {
    wallpaperPrefs = { ...wallpaperPrefs, url: '', name: '', kind: 'image', media_url: '', scene_url: '', preview_url: '' };
    saveWallpaperPrefs();
    viewSettings();
    toast('已恢复主题壁纸', 'ok');
  });
  const bindWallpaperRange = (id, key, formatter) => {
    const input = app.querySelector('#' + id);
    const output = app.querySelector('#' + id + '-value');
    input?.addEventListener('input', () => {
      wallpaperPrefs[key] = Number(input.value);
      if (output) output.textContent = formatter(Number(input.value));
      saveWallpaperPrefs();
    });
  };
  bindWallpaperRange('wp-dim', 'dim', (v) => `${Math.round(v)}%`);
  bindWallpaperRange('wp-blur', 'blur', (v) => `${Math.round(v)} px`);
  app.querySelector('#wp-fit')?.addEventListener('change', (event) => {
    wallpaperPrefs.fit = event.target.value;
    saveWallpaperPrefs();
  });

  // Agent 权限
  const bindAgentPerm = (id, key) => {
    app.querySelector('#' + id)?.addEventListener('change', (event) => {
      agentPermissions[key] = !!event.target.checked;
      applyAgentPermissions();
    });
  };
  bindAgentPerm('agent-perm-read', 'read');
  bindAgentPerm('agent-perm-write', 'write');
  bindAgentPerm('agent-perm-web', 'web');
  bindAgentPerm('agent-perm-browser', 'browser');

  initChoiceSliders();
  animatePageWave();
  refreshGpuStatus();
  monitorFrameBudget();
  const fpsNode = document.querySelector('#fps-renderer');
  if (fpsNode && document.documentElement.dataset.fps) fpsNode.textContent = `${document.documentElement.dataset.fps} FPS`;
}

/* ---------- 启动 ---------- */


let frameBudgetFrame = 0;
function monitorFrameBudget() {
  if (frameBudgetFrame || document.hidden) return;
  let last = 0;
  let started = 0;
  const samples = [];
  const tick = (now) => {
    frameBudgetFrame = 0;
    if (document.hidden) return;
    if (!started) started = now;
    if (last) samples.push(now - last); // Include long frames instead of dropping stalls.
    last = now;
    if (samples.length < 90 && now - started < 5000) {
      frameBudgetFrame = requestAnimationFrame(tick);
      return;
    }
    const result = evaluateFrameBudget(samples);
    if (!result) return;
    document.documentElement.dataset.fps = String(result.fps);
    document.documentElement.dataset.perf = result.perf;
    const node = document.querySelector('#fps-renderer');
    if (node) node.textContent = `${result.fps} FPS`;
    initLiquidButtons();
  };
  frameBudgetFrame = requestAnimationFrame(tick);
}


function initClickMotion() {
  const selector = 'button, a, [role="button"], .roll, .frame, .choice, .folder-item, .file-row, .stage-item';
  const presses = new Map();
  const finish = (id, rebound = true) => {
    const press = presses.get(id);
    if (!press) return;
    presses.delete(id);
    const scale = getComputedStyle(press.target).scale;
    press.animation?.cancel();
    if (!press.target.isConnected) return;
    animateUi(press.target, [
      { scale: scale === 'none' ? '.98' : scale },
      { scale: '1' },
    ], rebound ? 260 : 120, { easing: rebound ? SPRING_EASE : 'ease-out' });
  };
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !motionAllowed()) return;
    const target = event.target.closest(selector);
    if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true' || target.closest('[data-no-tap]')) return;
    finish(event.pointerId, false);
    const scale = getComputedStyle(target).scale;
    uiAnimations.get(target)?.cancel();
    const animation = target.animate([
      { scale: scale === 'none' ? '1' : scale }, { scale: '.98' },
    ], { duration: 100, easing: 'ease-out', fill: 'forwards' });
    presses.set(event.pointerId, { target, animation });
    const rect = target.getBoundingClientRect();
    const size = Math.max(44, Math.min(120, Math.max(rect.width, rect.height) * .7));
    const ripple = document.createElement('span');
    ripple.className = 'tap-ripple';
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX}px;top:${event.clientY}px`;
    document.body.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    setTimeout(() => ripple.remove(), 600);
  }, { passive: true });
  document.addEventListener('pointerup', event => finish(event.pointerId), { passive: true });
  document.addEventListener('pointercancel', event => finish(event.pointerId, false), { passive: true });
  window.addEventListener('blur', () => [...presses.keys()].forEach(id => finish(id, false)));
  document.addEventListener('click', event => {
    if (event.detail || !motionAllowed()) return;
    const target = event.target.closest(selector);
    if (target && !target.disabled) animateUi(target, [
      { scale: '1' }, { scale: '.98', offset: .25 }, { scale: '1.012', offset: .65 }, { scale: '1' },
    ], 300);
  });
}


function initPageScrollbar() {
  if (document.querySelector('#page-scrollbar')) return;
  const bar = document.createElement('div');
  bar.id = 'page-scrollbar';
  bar.className = 'page-scrollbar';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = '<div class="page-scrollbar-track"></div><div class="page-scrollbar-thumb"></div>';
  document.body.appendChild(bar);
  const track = bar.querySelector('.page-scrollbar-track');
  const thumb = bar.querySelector('.page-scrollbar-thumb');
  let frame = 0;

  const update = () => {
    frame = 0;
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const show = max > 4;
    bar.classList.toggle('show', show);
    if (!show) return;
    const trackH = bar.clientHeight;
    const thumbH = Math.max(34, Math.round(trackH * window.innerHeight / doc.scrollHeight));
    thumb.style.height = `${thumbH}px`;
    const top = (window.scrollY / max) * (trackH - thumbH);
    thumb.style.transform = `translateY(${top}px)`;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const drag = (startY) => {
    const startScroll = window.scrollY;
    const trackH = bar.clientHeight;
    const thumbH = thumb.offsetHeight;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const move = (event) => {
      const ratio = (event.clientY - startY) / Math.max(1, trackH - thumbH);
      window.scrollTo(0, Math.max(0, Math.min(max, startScroll + ratio * max)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };
  thumb.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    drag(event.clientY);
  });
  track.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const rect = track.getBoundingClientRect();
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    window.scrollTo(0, ratio * max);
  });
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('hashchange', () => setTimeout(schedule, 120));
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(document.body);
  setTimeout(update, 350);
  setTimeout(update, 1200);
}

function initWindowChrome() {
  const controls = document.querySelector('#window-controls');
  if (!controls) return;
  const syncNativeBorder = () => {
    if (!window.pywebview?.api?.window_action) return;
    const topbar = document.querySelector('.topbar');
    const body = getComputedStyle(document.body).backgroundColor;
    let color = topbar ? getComputedStyle(topbar).backgroundColor : body;
    if (!color || color === 'rgba(0, 0, 0, 0)' || color === 'transparent') color = body;
    if (document.documentElement.dataset.style === 'liquid') color = 'none';
    try { window.pywebview.api.window_action('set_border', color); } catch (_) {}
  };
  let chromeReady = false;
  const reveal = () => {
    if (chromeReady) return;
    if (window.pywebview && typeof window.pywebview.api?.window_action === 'function') {
      chromeReady = true;
      controls.hidden = false;
      document.documentElement.dataset.desktop = '1';
      syncCloseModeToDesktop();
      syncNativeBorder();
      new MutationObserver(syncNativeBorder).observe(document.documentElement, {
        attributes: true, attributeFilter: ['data-theme', 'data-style'],
      });
    }
  };
  window.addEventListener('pywebviewready', reveal);
  setTimeout(reveal, 450);
  setTimeout(reveal, 1600);
  controls.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-window]');
    if (!button || !window.pywebview?.api) return;
    const action = button.dataset.window;
    try {
      if (action === 'minimize') await window.pywebview.api.window_action('minimize');
      else if (action === 'maximize') {
        const state = await window.pywebview.api.window_action('toggle_maximize');
        button.title = state?.maximized ? '还原' : '最大化';
      } else if (action === 'close') await window.pywebview.api.window_action('close');
    } catch (error) { console.error(error); }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.querySelector('#photo-inspect')) { closePhotoInspect(); }
    if (document.querySelector('#photo-inspect') && event.key === 'ArrowLeft') { event.preventDefault(); stepInspect(-1); }
    if (document.querySelector('#photo-inspect') && event.key === 'ArrowRight') { event.preventDefault(); stepInspect(1); }
  });
}


let reviewRevealObserver = null;
let reviewRevealExitObserver = null;
let reviewRevealMutation = null;
let reviewRevealFrame = 0;
const reviewRevealTargets = new Set();

function initScrollPop() {
  if (!reviewRevealMutation) {
    reviewRevealMutation = new MutationObserver(records => {
      if (reviewRevealFrame || !records.some(record =>
        [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 &&
          (node.matches('.frame,#photo-grid') || node.querySelector('.frame,#photo-grid'))))) return;
      reviewRevealFrame = requestAnimationFrame(() => {
        reviewRevealFrame = 0;
        initScrollPop();
      });
    });
    reviewRevealMutation.observe(app, { childList: true, subtree: true });
  }
  // Replaced grids and routes must not leave thousands of detached cards observed.
  for (const node of reviewRevealTargets) {
    if (!node.isConnected || !motionAllowed() || node.closest('.source-group.collapsed')) {
      reviewRevealObserver?.unobserve(node);
      reviewRevealExitObserver?.unobserve(node);
      uiAnimations.get(node)?.cancel();
      node.classList.remove('review-reveal', 'reveal-visible');
      reviewRevealTargets.delete(node);
    }
  }
  if (!motionAllowed()) return;
  if (!reviewRevealObserver) {
    reviewRevealObserver = new IntersectionObserver((entries) => {
      let order = 0;
      entries.forEach((entry) => {
        const card = entry.target;
        if (!entry.isIntersecting || card.closest('.source-group.collapsed') || card.classList.contains('reveal-visible')) return;
        if (card.dataset.rmFlipping === '1') return;
        card.classList.add('reveal-visible');
        animateUi(card, [
          { opacity: .45, transform: 'translateY(14px) scale(.985)' },
          { opacity: 1, transform: 'none' },
        ], 320, { easing: SPRING_EASE, delay: Math.min(order++, 4) * 12, fill: 'backwards' });
      });
    }, { threshold: 0.01 });
    reviewRevealExitObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) entry.target.classList.remove('reveal-visible');
      });
    }, { threshold: 0, rootMargin: '240px 0px 240px 0px' });
  }
  document.querySelectorAll('#photo-grid .source-group.open .frame').forEach((node) => {
    if (reviewRevealTargets.has(node)) return;
    reviewRevealTargets.add(node);
    node.classList.add('review-reveal');
    reviewRevealObserver.observe(node);
    reviewRevealExitObserver.observe(node);
  });
}


/* ================= 拾影 Agent：右侧折叠对话 ================= */
const AGENT_STORE = 'cull-agent-chat-v1';
const agentState = { open: false, messages: [], loading: false, status: null, reference: null, results: [], resultsOpen: false, uploading: false };

const AGENT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></svg>';
const AGENT_SEND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
const AGENT_ATTACH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 11.5-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.3-8.3"/></svg>';
const AGENT_CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
const AGENT_RESULTS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><path d="m4 17 5-5 4 4 3-3 4 4"/></svg>';
const AGENT_TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg>';

function agentEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function agentFormat(text) {
  let html = agentEsc(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  return html;
}

function agentToolLabel(tool) {
  const name = tool?.name || '';
  const result = tool?.result || {};
  if (name === 'list_activities') return `读取活动列表 · ${(result.activities || []).length} 个`;
  if (name === 'get_activity_summary') return `读取活动统计 · ${result.name || ''}`;
  if (name === 'search_photos') return `搜索照片 · ${result.total ?? 0} 张${result.category_name ? `（${result.category_name}）` : ''}`;
  if (name === 'get_photo') return `读取照片 · ${result.photo?.file || ''}`;
  if (name === 'set_photo_verdict') return `修改选片结论 · ${result.applied ?? 0} 张${result.verdict ? `为${({keep:'保留',reject:'排除',uncertain:'待确认',undecided:'待处理'})[result.verdict] || result.verdict}` : ''}`;
  if (name === 'navigate_to') return `打开页面 · ${result.navigation || ''}`;
  if (name === 'set_review_filter') return `切换筛选 · ${result.filter || ''}`;
  if (name === 'find_person_photos') return `按参考图找人 · 检查 ${result.checked ?? 0} 张${result.matches?.length ? `，命中 ${result.matches.length} 张` : ''}`;
  if (name === 'copy_photos_to_folder') return `复制照片 · ${result.copied ?? 0} 张`;
  if (name === 'web_fetch') return `读取网页 · ${result.url || ''}`;
  if (name === 'open_url') return `打开浏览器 · ${result.opened || ''}`;
  return name || '操作';
}

function agentRenderResults() {
  const panel = document.querySelector('#agent-results');
  const toggle = document.querySelector('#agent-results-toggle');
  if (!panel || !toggle) return;
  const items = agentState.results || [];
  toggle.hidden = !items.length;
  toggle.classList.toggle('active', agentState.resultsOpen);
  toggle.setAttribute('aria-expanded', String(agentState.resultsOpen));
  panel.classList.toggle('open', agentState.resultsOpen && !!items.length);
  panel.setAttribute('aria-hidden', String(!(agentState.resultsOpen && items.length)));
  if (!items.length) return;
  const grid = panel.querySelector('#agent-results-grid');
  const count = panel.querySelector('#agent-results-count');
  if (count) count.textContent = `${items.length} 张`;
  if (grid) {
    grid.innerHTML = items.map((item) => `
      <button class="agent-result-card" type="button" data-agent-photo="${esc(item.id)}" data-agent-file="${esc(item.file || '')}" title="${esc(item.file || '')}">
        <span class="agent-result-thumb"><img src="/api/photos/${esc(item.id)}/file?kind=grid" alt="" loading="lazy" onerror="this.remove()"></span>
        <span class="agent-result-name">${esc(item.file || '照片')}</span>
        ${item.confidence != null ? `<span class="agent-result-conf">${Math.round(Number(item.confidence) * 100)}%</span>` : ''}
      </button>`).join('');
  }
}

function agentSetResults(items) {
  agentState.results = Array.isArray(items) ? items : [];
  if (agentState.results.length) agentState.resultsOpen = true;
  agentRenderResults();
}

function agentToggleResults(force) {
  if (!agentState.results.length) return;
  agentState.resultsOpen = typeof force === 'boolean' ? force : !agentState.resultsOpen;
  agentRenderResults();
}

function agentRender() {
  const root = document.querySelector('#agent-root');
  if (!root) return;
  const list = root.querySelector('#agent-messages');
  if (!list) return;
  const nodes = [];
  if (!agentState.messages.length) {
    nodes.push(`<div class="agent-welcome">
      <h3>今天想怎么处理照片？</h3>
      <p>我可以读取活动进度、找照片、切换筛选，也能在你说清楚目标后帮你改选片结论。修改前请把活动名或照片范围说清楚。</p>
      <div class="agent-welcome-tags"><span>查看活动进度</span><span>搜索照片</span><span>修改选片结论</span><span>切换界面</span></div>
    </div>`);
  }
  agentState.messages.forEach((msg) => {
    const role = msg.role === 'user' ? 'user' : (msg.error ? 'assistant error' : 'assistant');
    const toolHtml = msg.tools?.length ? `<div class="agent-tools"><details><summary>执行了 ${msg.tools.length} 个操作</summary>${msg.tools.map((tool) => `<div class="agent-tool-row"><span class="${tool.ok ? 'ok' : 'bad'}">${tool.ok ? '✓' : '!'}</span><span>${agentEsc(agentToolLabel(tool))}</span></div>`).join('')}</details></div>` : '';
    nodes.push(`<div class="agent-msg ${role}"><div class="agent-msg-bubble">${agentFormat(msg.content)}</div>${toolHtml}</div>`);
  });
  if (agentState.loading) {
    nodes.push('<div class="agent-msg assistant"><div class="agent-msg-bubble"><span class="agent-typing"><i></i><i></i><i></i></span></div></div>');
  }
  list.innerHTML = nodes.join('');
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  const input = root.querySelector('#agent-input');
  const send = root.querySelector('#agent-send');
  if (send) send.disabled = agentState.loading;
  if (input) input.disabled = agentState.loading;
}

function agentSave() {
  try {
    const safe = agentState.messages.slice(-40).map((msg) => ({
      role: msg.role, content: msg.content, error: !!msg.error, tools: msg.tools || [],
    }));
    localStorage.setItem(AGENT_STORE, JSON.stringify(safe));
  } catch (_) {}
}

function agentLoad() {
  try {
    const saved = JSON.parse(localStorage.getItem(AGENT_STORE) || '[]');
    agentState.messages = Array.isArray(saved) ? saved.filter((msg) => msg && ['user', 'assistant'].includes(msg.role) && typeof msg.content === 'string').slice(-40) : [];
  } catch (_) { agentState.messages = []; }
}

function agentContext() {
  const activity = state?.activity;
  const isActivity = state?.view === 'activity' || state?.view === 'review' || String(location.hash).startsWith('#/activity/');
  const parts = [];
  if (isActivity && activity) parts.push(activity.name || '当前活动');
  else if (String(location.hash).startsWith('#/settings')) parts.push('设置');
  else parts.push('活动列表');
  if (activity?.counts?.files) parts.push(`${activity.counts.files} 张`);
  return parts.join(' · ');
}

function agentUpdateContext() {
  const node = document.querySelector('#agent-context');
  if (!node) return;
  const activity = state?.activity;
  const active = state?.view === 'activity' || state?.view === 'review' || String(location.hash).startsWith('#/activity/');
  node.innerHTML = `<b>${agentEsc(active && activity ? activity.name : (String(location.hash).startsWith('#/settings') ? '设置页' : '活动列表'))}</b>`;
}

function agentStatusText(text, kind = '') {
  const label = document.querySelector('#agent-status');
  const dot = document.querySelector('#agent-status-dot');
  if (label) label.textContent = text;
  if (dot) dot.className = `agent-status-dot ${kind}`.trim();
}

async function agentLoadStatus(force = false) {
  if (agentState.status && !force) return agentState.status;
  try {
    const data = await api('/api/agent/status');
    agentState.status = data;
    agentStatusText(`DeepSeek · ${data.model || '未配置'}`, data.api_key_set ? '' : 'off');
    const notice = document.querySelector('#agent-notice');
    if (notice) {
      notice.hidden = !!data.api_key_set;
      notice.innerHTML = data.api_key_set ? '' : '还没有配置 API Key。<a href="#/settings">去设置</a>后就可以对话。';
    }
    return data;
  } catch (error) {
    agentStatusText('Agent 未连接', 'off');
    return null;
  }
}

function agentRenderAttachment() {
  const node = document.querySelector('#agent-attachment');
  if (!node) return;
  const ref = agentState.reference;
  node.hidden = !ref;
  node.innerHTML = ref ? `<span>参考图</span><b>${agentEsc(ref.name || 'reference.jpg')}</b><button type="button" id="agent-attachment-remove" aria-label="移除参考图">×</button>` : '';
  node.querySelector('#agent-attachment-remove')?.addEventListener('click', () => {
    agentState.reference = null;
    agentRenderAttachment();
  });
}

async function agentImageDataUrl(file) {
  // Downscale before upload: reliable for large phone photos, and much faster
  // for the vision model to decode.
  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 1600;
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.88);
  } catch (_) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取参考图失败'));
      reader.readAsDataURL(file);
    });
  }
}

async function agentAttachReference(file) {
  if (!file || agentState.uploading) return;
  if (file.size > 40 * 1024 * 1024) { toast('参考图不能超过 40MB', 'error'); return; }
  agentState.uploading = true;
  const input = document.querySelector('#agent-input');
  const attach = document.querySelector('#agent-attach');
  const send = document.querySelector('#agent-send');
  if (input) { input.placeholder = '正在处理参考图…'; input.disabled = true; }
  if (attach) attach.disabled = true;
  if (send) send.disabled = true;
  try {
    const dataUrl = await agentImageDataUrl(file);
    const result = await api('/api/agent/reference', { method: 'POST', body: JSON.stringify({ name: file.name, data: dataUrl }) });
    agentState.reference = { path: result.path, name: result.name };
    agentRenderAttachment();
    toast('参考图已附加，可以对 Agent 说“用这张图找同一个人”', 'ok');
  } catch (error) {
    toast(error.message || '参考图上传失败', 'error');
  } finally {
    agentState.uploading = false;
    if (input) { input.placeholder = '告诉 Agent 你想做什么…'; input.disabled = false; }
    if (attach) attach.disabled = false;
    if (send) send.disabled = agentState.loading;
    agentRenderAttachment();
  }
}

function agentSetOpen(open) {
  const root = document.querySelector('#agent-root');
  if (!root) return;
  agentState.open = !!open;
  root.classList.toggle('open', agentState.open);
  const panel = root.querySelector('#agent-panel');
  const fab = root.querySelector('#agent-fab');
  panel?.setAttribute('aria-hidden', String(!agentState.open));
  fab?.setAttribute('aria-expanded', String(agentState.open));
  if (agentState.open) {
    panel.inert = false;
    agentUpdateContext();
    agentLoadStatus(true);
    setTimeout(() => root.querySelector('#agent-input')?.focus(), 180);
  } else {
    setTimeout(() => {
      if (agentState.open) return;
      panel.inert = true;
      fab?.focus({ preventScroll: true });
    }, 520);
  }
}

async function agentRunActions(actions) {
  for (const action of actions || []) {
    if (action.type === 'navigate' && action.hash) {
      if (location.hash !== action.hash) location.hash = action.hash;
    } else if (action.type === 'review_filter' && action.activity_id) {
      if (state?.activity?.id === action.activity_id) {
        state.photos.category = action.category || 'all';
        app.querySelectorAll('.review-filters .filter-item').forEach((item) => {
          item.classList.toggle('active', item.dataset.cat === state.photos.category);
        });
        const input = app.querySelector('#photo-search');
        if (input) input.value = action.keyword || '';
        await loadPhotos(true);
      } else {
        location.hash = `#/activity/${action.activity_id}`;
      }
    } else if (action.type === 'refresh' && state?.activity?.id) {
      await loadPhotos(true);
    }
  }
}

async function agentSend(text) {
  const content = String(text || '').trim();
  if (!content || agentState.loading) return;
  agentState.messages.push({ role: 'user', content });
  agentState.loading = true;
  agentStatusText('正在思考…', 'busy');
  agentRender();
  agentSave();
  const input = document.querySelector('#agent-input');
  if (input) { input.value = ''; input.style.height = ''; }
  const history = agentState.messages
    .filter((msg) => !msg.error && ['user', 'assistant'].includes(msg.role))
    .slice(-20)
    .map((msg) => ({ role: msg.role, content: msg.content }));
  const context = {
    view: state?.view || '',
    activity_id: state?.activity?.id || null,
    activity_name: state?.activity?.name || null,
    photo_id: state?.selectedId || null,
    category: state?.photos?.category || null,
    reference_image: agentState.reference?.path || null,
    reference_name: agentState.reference?.name || null,
    permissions: agentPermissions,
  };
  try {
    const data = await api('/api/agent/chat', { method: 'POST', body: JSON.stringify({ messages: history, context }) });
    agentState.messages.push({
      role: 'assistant', content: data.reply || '已完成。',
      tools: data.tools || [],
    });
    const personResult = (data.tools || []).find((tool) => tool.name === 'find_person_photos' && tool.ok);
    if (personResult?.result?.matches) agentSetResults(personResult.result.matches);
    agentSave();
    agentRender();
    await agentRunActions(data.actions || []);
    agentStatusText(`DeepSeek · ${data.model || agentState.status?.model || '在线'}`, '');
  } catch (error) {
    agentState.messages.push({ role: 'assistant', content: error.message || 'Agent 请求失败，请稍后重试。', error: true });
    agentRender();
    agentStatusText('请求失败', 'off');
  } finally {
    agentState.loading = false;
    agentRender();
    const inputNode = document.querySelector('#agent-input');
    if (inputNode) inputNode.focus();
  }
}

function initAgent() {
  const root = document.querySelector('#agent-root');
  if (!root) return;
  agentLoad();
  root.innerHTML = `
    <div class="agent-scrim" data-agent-close></div>
    <button class="agent-fab" id="agent-fab" type="button" aria-controls="agent-panel" aria-expanded="false" title="打开拾影 Agent">
      <span class="agent-spark">${AGENT_ICON}</span><span class="agent-fab-label">拾影 Agent</span>
    </button>
    <aside class="agent-results" id="agent-results" aria-label="Agent 匹配照片" aria-hidden="true">
      <div class="agent-results-head">
        <div><strong>匹配照片</strong><small id="agent-results-count"></small></div>
        <button class="agent-icon-btn" id="agent-results-close" type="button" title="收起匹配照片" aria-label="收起匹配照片">${AGENT_CLOSE_ICON}</button>
      </div>
      <div class="agent-results-grid" id="agent-results-grid"></div>
    </aside>
    <aside class="agent-panel" id="agent-panel" aria-label="拾影 Agent" aria-hidden="true">
      <header class="agent-head">
        <div class="agent-brand">
          <span class="agent-avatar">${AGENT_ICON}</span>
          <div class="agent-brand-text"><strong>拾影 Agent</strong><small><span class="agent-status-dot" id="agent-status-dot"></span><span id="agent-status">正在连接…</span></small></div>
        </div>
        <div class="agent-head-actions">
          <button class="agent-icon-btn" id="agent-results-toggle" type="button" title="查看匹配照片" aria-label="查看匹配照片" aria-expanded="false" hidden>${AGENT_RESULTS_ICON}</button>
          <button class="agent-icon-btn" id="agent-clear" type="button" title="清空对话" aria-label="清空对话">${AGENT_TRASH_ICON}</button>
          <button class="agent-icon-btn" id="agent-close" type="button" title="收起 Agent" aria-label="收起 Agent">${AGENT_CLOSE_ICON}</button>
        </div>
      </header>
      <div class="agent-context" id="agent-context"></div>
      <div class="agent-notice" id="agent-notice" hidden></div>
      <div class="agent-messages" id="agent-messages"></div>
      <div class="agent-attachment" id="agent-attachment" hidden></div>
      <div class="agent-suggestions" id="agent-suggestions"></div>
      <form class="agent-composer" id="agent-form">
        <button class="agent-attach" id="agent-attach" type="button" title="附加参考图" aria-label="附加参考图">${AGENT_ATTACH_ICON}</button>
        <input type="file" id="agent-file" accept="image/*" hidden>
        <textarea class="agent-input" id="agent-input" rows="1" maxlength="4000" placeholder="告诉 Agent 你想做什么…"></textarea>
        <button class="agent-send" id="agent-send" type="submit" title="发送" aria-label="发送">${AGENT_SEND_ICON}</button>
      </form>
      <div class="agent-hint">Enter 发送 · Shift + Enter 换行 · Esc 收起</div>
    </aside>`;
  const input = root.querySelector('#agent-input');
  const fileInput = root.querySelector('#agent-file');
  const form = root.querySelector('#agent-form');
  const suggestions = root.querySelector('#agent-suggestions');
  const defaultSuggestions = ['总结当前活动', '找 AI 建议排除', '标记第 1 张保留', '打开设置'];
  const renderSuggestions = (items) => {
    suggestions.innerHTML = (items || defaultSuggestions).slice(0, 4).map((item) => `<button class="agent-suggestion" type="button">${agentEsc(item)}</button>`).join('');
    suggestions.querySelectorAll('.agent-suggestion').forEach((button) => {
      button.addEventListener('click', () => agentSend(button.textContent));
    });
  };
  renderSuggestions(defaultSuggestions);
  agentRender();
  agentRenderResults();
  agentRenderAttachment();
  root.querySelector('#agent-attach')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    agentAttachReference(fileInput.files?.[0]);
    fileInput.value = '';
  });
  root.querySelector('#agent-fab')?.addEventListener('click', () => agentSetOpen(true));
  root.querySelector('#agent-close')?.addEventListener('click', () => agentSetOpen(false));
  root.querySelector('#agent-results-toggle')?.addEventListener('click', () => agentToggleResults());
  root.querySelector('#agent-results-close')?.addEventListener('click', () => agentToggleResults(false));
  root.querySelector('#agent-results-grid')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-agent-photo]');
    if (!card) return;
    const label = card.dataset.agentFile || '匹配照片';
    openViewer(`/api/photos/${card.dataset.agentPhoto}/file?kind=review`, label);
  });
  root.querySelector('[data-agent-close]')?.addEventListener('click', () => agentSetOpen(false));
  root.querySelector('#agent-clear')?.addEventListener('click', () => {
    agentState.messages = [];
    agentSave();
    agentRender();
    input?.focus();
  });
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    agentSend(input?.value || '');
  });
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      agentSend(input.value);
    }
  });
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(132, input.scrollHeight)}px`;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && agentState.open) agentSetOpen(false);
  });
  window.addEventListener('hashchange', () => { agentUpdateContext(); });
  setInterval(() => { if (agentState.open) agentUpdateContext(); }, 1200);
  agentUpdateContext();
  agentLoadStatus(true);
  const welcomeTimer = setTimeout(() => renderSuggestions(agentState.status?.suggestions || defaultSuggestions), 900);
  window.addEventListener('beforeunload', () => clearTimeout(welcomeTimer));
}

async function init() {
  await restoreUiPrefs();
  initPreferences();
  initTheme();
  initNav();
  try {
    const health = await api('/api/health');
    document.querySelector('#app-version').textContent = `v${health.version}`;
  } catch (_) { /* 服务未就绪时忽略 */ }
  try { gpuRendererInfo(); } catch (_) {}
  setTimeout(monitorFrameBudget, 2200);
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', onKeyDown);
  initMaterialControls();
  initClickMotion();
  initReleaseMotion();
  initWindowChrome();
  initPageScrollbar();
  initAgent();
  initScrollPop();
  document.addEventListener('dblclick', (event) => {
    const card = event.target.closest('#photo-grid .frame');
    if (!card) return;
    event.preventDefault();
    openPhotoInspect(card.dataset.id);
  }, true);
  if (!location.hash) {
    location.hash = '#/activities';
    return;
  }
  await route();
  requestAnimationFrame(initScrollPop);
}

init();























