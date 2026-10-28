/* 拾影 · 发布前动效层：全局交互反馈、滚动反馈、设置导航、滑块与轻量请求状态。
   不依赖任何第三方库；不改变业务数据。 */

const ROOT = document.documentElement;
const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const animated = new WeakMap();
let netCount = 0;
let netShownAt = 0;
let netHideTimer = 0;
let netShowTimer = 0;
let scrollFrame = 0;
let gridScrollFrame = 0;
let settingsJumpFrame = 0;
let settingsObserver = null;
let settingsSectionsSeen = new WeakSet();
let settingsMutation = null;
let rangeMutation = null;
let rangeBridge = null;
let rangePaintFrame = 0;
let settingsRefreshFrame = 0;
let settingsJumpCleanup = null;
let batchBindFrame = 0;
const structureSubscriptions = [];
let structureObserver = null;

// Text updates (counters, range values, streamed text) are not structural changes.
// One observer routes only relevant inserted/removed elements to each motion layer.
function watchStructure(selector, refresh) {
  structureSubscriptions.push({ selector, refresh });
  if (structureObserver) return;
  structureObserver = new MutationObserver(records => {
    const nodes = records.flatMap(record => [...record.addedNodes, ...record.removedNodes])
      .filter(node => node.nodeType === 1);
    if (!nodes.length) return;
    for (const subscription of structureSubscriptions) {
      if (nodes.some(node => node.matches(subscription.selector) || node.querySelector(subscription.selector))) {
        subscription.refresh();
      }
    }
  });
  structureObserver.observe(document.body, { childList: true, subtree: true });
}

function canAnimate() {
  // The app maps OS reduce + 'system' preference to data-motion=off.
  // If the user explicitly chose '始终开启', data-motion=on wins over the media query.
  return ROOT.dataset.motion === 'on';
}

function rmAnimate(node, keyframes, options = {}) {
  if (!node || !node.animate || !canAnimate()) return null;
  try {
    animated.get(node)?.cancel();
    const animation = node.animate(keyframes, {
      duration: 240,
      easing: 'cubic-bezier(.16, 1, .3, 1)',
      fill: 'both',
      ...options,
    });
    animated.set(node, animation);
    const release = () => {
      if (animated.get(node) === animation) animated.delete(node);
      animation.cancel();
    };
    animation.finished.then(release, release);
    return animation;
  } catch (_) {
    return null;
  }
}

function pulseClass(node, className, duration = 420) {
  if (!node || !canAnimate()) return;
  // Keep a running pulse continuous during a drag instead of forcing layout
  // and restarting it on every input event.
  if (node.classList.contains(className)) return;
  node.classList.add(className);
  clearTimeout(node._rmPulseTimer);
  node._rmPulseTimer = setTimeout(() => node.classList.remove(className), duration);
}

/* ---------- 按压反馈：与既有 WAAPI 缩放互补，不抢 transform ---------- */

function initPressFeedback() {
  let pressed = null;
  const clear = () => {
    if (!pressed) return;
    pressed.classList.remove('rm-pressed');
    pressed = null;
  };
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !canAnimate()) return;
    if (event.target.closest('[data-no-tap]')) return;
    const target = event.target?.closest?.('button, a, [role="button"], .choice, .filter-item, .style-card, .roll, .frame, .folder-item, .file-row, .settings-jump button');
    if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return;
    clear();
    pressed = target;
    target.classList.add('rm-pressed');
  }, { passive: true });
  document.addEventListener('pointerup', clear, { passive: true });
  document.addEventListener('pointercancel', clear, { passive: true });
  document.addEventListener('pointerleave', clear, { passive: true });
  window.addEventListener('blur', clear);

  // Keyboard activation gets the same visual confirmation as a pointer.
  document.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const target = document.activeElement?.closest?.('button, a, [role="button"], .filter-item, .settings-jump button');
    if (target) target.classList.add('rm-pressed');
  });
  document.addEventListener('keyup', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const target = document.activeElement?.closest?.('button, a, [role="button"], .filter-item, .settings-jump button');
    target?.classList.remove('rm-pressed');
  });
}

/* ---------- 局部状态反馈 ---------- */

function initLocalFeedback() {
  document.addEventListener('click', (event) => {
    const filter = event.target.closest?.('.filter-item');
    if (filter) {
      const count = filter.querySelector('.filter-count');
      pulseClass(count, 'rm-count-pulse', 460);
      pulseClass(filter, 'rm-state-pop', 380);
    }
    const jump = event.target.closest?.('.settings-jump [data-settings-target]');
    if (jump) pulseClass(jump, 'rm-state-pop', 340);
  }, { passive: true });

  // Batch toolbar appears/disappears as a unit, not as a content jump.
  let batchObserver = null;
  const bindBatch = () => {
    const target = document.querySelector('#batch-actions');
    if (!target || target.dataset.rmBound === '1') return;
    target.dataset.rmBound = '1';
    batchObserver?.disconnect();
    batchObserver = new MutationObserver(() => {
      if (!target.innerHTML.trim()) {
        target.dataset.rmVisible = '0';
        return;
      }
      // Selection changes re-render the same bar; do not replay the whole entrance.
      if (target.dataset.rmVisible === '1') {
        pulseClass(target.querySelector('.hint'), 'rm-count-pulse', 420);
        return;
      }
      target.dataset.rmVisible = '1';
      target.classList.add('rm-batch-enter');
      clearTimeout(target._rmBatchTimer);
      target._rmBatchTimer = setTimeout(() => target.classList.remove('rm-batch-enter'), 560);
    });
    batchObserver.observe(target, { childList: true });
    if (target.children.length) {
      // renderBatchActions() writes the first content before this observer exists.
      target.dataset.rmVisible = '1';
      target.classList.add('rm-batch-enter');
      clearTimeout(target._rmBatchTimer);
      target._rmBatchTimer = setTimeout(() => target.classList.remove('rm-batch-enter'), 560);
    }
  };
  bindBatch();
  watchStructure('#batch-actions', () => {
    if (batchBindFrame) return;
    batchBindFrame = requestAnimationFrame(() => { batchBindFrame = 0; bindBatch(); });
  });
}

/* ---------- 滚动进度、滚动边缘与顶栏状态 ---------- */

function initScrollFeedback() {
  if (document.querySelector('#rm-scroll-progress')) return;
  const bar = document.createElement('div');
  bar.id = 'rm-scroll-progress';
  bar.className = 'rm-scroll-progress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);

  const update = () => {
    scrollFrame = 0;
    const doc = ROOT;
    const max = Math.max(0, doc.scrollHeight - window.innerHeight);
    if (max < 8) {
      bar.classList.remove('show');
      document.body.classList.remove('rm-scrolled');
      return;
    }
    const ratio = Math.max(0, Math.min(1, window.scrollY / max));
    bar.classList.add('show');
    bar.style.transform = `scaleX(${ratio})`;
    document.body.classList.toggle('rm-scrolled', window.scrollY > 6);
  };
  const schedule = () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(update);
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('hashchange', () => setTimeout(schedule, 80));
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(document.body);
  schedule();

  // Review grid: soft bottom edge only while there is more content below.
  const updateGridEdge = () => {
    gridScrollFrame = 0;
    document.querySelectorAll('.review-grid-col').forEach((grid) => {
      const style = getComputedStyle(grid);
      const bottom = grid.scrollHeight - grid.scrollTop - grid.clientHeight;
      const top = grid.scrollTop;
      grid.style.setProperty('--rm-edge-bottom', bottom > 12 ? '1' : '0');
      grid.style.setProperty('--rm-edge-top', top > 12 ? '1' : '0');
      grid.classList.toggle('rm-scrollable', style.overflowY !== 'hidden');
    });
  };
  const scheduleGrid = () => {
    if (!gridScrollFrame) gridScrollFrame = requestAnimationFrame(updateGridEdge);
  };
  document.addEventListener('scroll', (event) => {
    if (event.target?.classList?.contains('review-grid-col') || event.target?.classList?.contains('review-detail')) scheduleGrid();
  }, { passive: true, capture: true });
  watchStructure('.review-grid-col, #photo-grid, .source-group, .frame', scheduleGrid);
  scheduleGrid();
}

/* ---------- 滑块：填充、拖动与数字反馈 ---------- */

function paintRange(input, feedback = false) {
  if (!input || input.type !== 'range') return;
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value || 0);
  const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const fill = `${Math.max(0, Math.min(100, progress))}%`;
  if (input.style.getPropertyValue('--rm-range-progress') === fill) return;
  input.style.setProperty('--rm-range-progress', fill);
  const output = input.parentElement?.querySelector?.('output') || input.closest('label')?.querySelector?.('output');
  if (output && feedback) pulseClass(output, 'rm-state-pop', 320);
}

function initRanges() {
  if (!rangeBridge) {
    const pending = new Set();
    rangeBridge = (event) => {
      const input = event.target.closest?.('input[type="range"]');
      if (!input) return;
      pending.add(input);
      if (!rangePaintFrame) rangePaintFrame = requestAnimationFrame(() => {
        rangePaintFrame = 0;
        pending.forEach(node => { if (node.isConnected) paintRange(node, true); });
        pending.clear();
      });
      input.classList.add('rm-dragging');
      clearTimeout(input._rmDragTimer);
      input._rmDragTimer = setTimeout(() => input.classList.remove('rm-dragging'), 260);
    };
    document.addEventListener('input', rangeBridge, { passive: true });
    document.addEventListener('change', rangeBridge, { passive: true });
  }
  const refresh = () => document.querySelectorAll('input[type="range"]').forEach(input => paintRange(input));
  refresh();
  if (!rangeMutation) {
    rangeMutation = true;
    watchStructure('input[type="range"]', refresh);
  }
}

/* ---------- 设置页分区导航：active 滑块 + 滚动联动 ---------- */

function ensureSettingsIndicator(jump) {
  let indicator = jump.querySelector('.rm-jump-indicator');
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.className = 'rm-jump-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    jump.appendChild(indicator);
    jump.classList.add('has-rm-indicator');
  }
  return indicator;
}

function moveSettingsIndicator(jump, active, animate = true) {
  if (!jump || !active) return;
  const indicator = ensureSettingsIndicator(jump);
  const rect = active.getBoundingClientRect();
  const host = jump.getBoundingClientRect();
  const x = rect.left - host.left;
  const y = rect.top - host.top;
  const old = indicator.getBoundingClientRect();
  const initialized = Boolean(indicator.style.width);
  indicator.style.left = `${x}px`;
  indicator.style.top = `${y}px`;
  indicator.style.width = `${rect.width}px`;
  indicator.style.height = `${rect.height}px`;
  if (!animate || !initialized || !canAnimate()) return;
  const dx = old.left - rect.left;
  const dy = old.top - rect.top;
  rmAnimate(indicator, [
    { transform: `translate(${dx}px,${dy}px) scale(${old.width ? old.width / rect.width : 1},${old.height ? old.height / rect.height : 1})` },
    { transform: 'translate(0,0) scale(1)' },
  ], {
    duration: 340,
    easing: 'cubic-bezier(.2,.85,.25,1.12)',
  });
}

function initSettingsJump() {
  const jump = document.querySelector('#settings-jump');
  if (!jump || jump.dataset.rmJumpBound === '1') return;
  jump.dataset.rmJumpBound = '1';
  const buttons = [...jump.querySelectorAll('[data-settings-target]')];
  if (!buttons.length) return;

  // A re-rendered settings page gets a new #settings-jump; clean the old listeners first.
  settingsJumpCleanup?.();
  if (settingsObserver) settingsObserver.disconnect();

  const sections = buttons
    .map((button) => document.getElementById(button.dataset.settingsTarget))
    .filter(Boolean)
    .sort((a, b) => a === b ? 0 : (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const activate = (button, animate = true) => {
    if (!button) return;
    buttons.forEach((item) => item.classList.toggle('active', item === button));
    moveSettingsIndicator(jump, button, animate);
  };
  const initial = buttons.find((button) => button.classList.contains('active')) || buttons[0];
  activate(initial, false);

  const currentSection = () => {
    if (!sections.length) return null;
    // The last section may never cross the threshold on a short page; bottom wins.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
      return sections[sections.length - 1];
    }
    const threshold = (parseFloat(getComputedStyle(ROOT).getPropertyValue('--header-h')) || 64) + 92;
    let current = sections[0];
    let bestTop = -Infinity;
    sections.forEach((section) => {
      const top = section.getBoundingClientRect().top;
      if (top <= threshold && top > bestTop) {
        bestTop = top;
        current = section;
      }
    });
    return current;
  };
  const refreshActive = () => {
    const section = currentSection();
    const button = buttons.find((item) => item.dataset.settingsTarget === section?.id);
    if (button && !button.classList.contains('active')) activate(button);
  };
  const onResize = () => refreshActive();
  window.addEventListener('resize', onResize, { passive: true });
  settingsObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting || settingsSectionsSeen.has(entry.target)) return;
      settingsSectionsSeen.add(entry.target);
      entry.target.classList.add('rm-section-visible');
      setTimeout(() => entry.target.classList.remove('rm-section-visible'), 520);
    });
  }, { threshold: 0.06 });

  const observeSections = () => {
    sections.forEach((section) => {
      if (!settingsSectionsSeen.has(section)) settingsObserver.observe(section);
    });
  };
  observeSections();

  const onScroll = () => {
    if (settingsJumpFrame) return;
    settingsJumpFrame = requestAnimationFrame(() => {
      settingsJumpFrame = 0;
      if (jump.isConnected) refreshActive();
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  buttons.forEach((button) => button.addEventListener('click', () => {
    activate(button);
    const section = document.getElementById(button.dataset.settingsTarget);
    if (!section) return;
    const top = section.getBoundingClientRect().top + window.scrollY -
      ((parseFloat(getComputedStyle(ROOT).getPropertyValue('--header-h')) || 64) + 78);
    window.scrollTo({ top: Math.max(0, top), behavior: canAnimate() ? 'smooth' : 'auto' });
  }));

  settingsJumpCleanup = () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    if (settingsObserver) settingsObserver.disconnect();
    cancelAnimationFrame(settingsJumpFrame);
    settingsJumpFrame = 0;
    settingsJumpCleanup = null;
  };
}

function refreshSettingsJump() {
  if (settingsMutation) return;
  settingsMutation = true;
  watchStructure('#settings-jump', () => {
    if (settingsRefreshFrame) return;
    settingsRefreshFrame = requestAnimationFrame(() => {
      settingsRefreshFrame = 0;
      if (!document.querySelector('#settings-jump')) { settingsJumpCleanup?.(); return; }
      initSettingsJump();
    });
  });
  initSettingsJump();
}

/* ---------- 轻量请求状态 ---------- */

function initNetworkIndicator() {
  let node = document.querySelector('#rm-net-indicator');
  if (!node) {
    node = document.createElement('div');
    node.id = 'rm-net-indicator';
    node.className = 'rm-net-indicator';
    node.setAttribute('aria-live', 'polite');
    node.innerHTML = '<i></i><span>正在处理</span>';
    document.body.appendChild(node);
  }
  const show = () => {
    node.classList.add('show');
    netShownAt = performance.now();
  };
  const hide = () => {
    const elapsed = performance.now() - netShownAt;
    netHideTimer = setTimeout(() => node.classList.remove('show'), Math.max(0, 260 - elapsed));
  };
  document.addEventListener('cull:request-start', () => {
    netCount += 1;
    clearTimeout(netShowTimer);
    clearTimeout(netHideTimer);
    netShowTimer = setTimeout(() => {
      if (netCount > 0) show();
    }, 240);
  });
  document.addEventListener('cull:request-end', () => {
    netCount = Math.max(0, netCount - 1);
    if (netCount === 0) {
      clearTimeout(netShowTimer);
      if (node.classList.contains('show')) hide();
    }
  });
}

/* ---------- 菜单开关辅助（由 app.js 调用，保证退出也可动画） ---------- */

export function animateMenuOpen(node, origin = 'top right') {
  if (!node || !canAnimate()) return;
  node.style.transformOrigin = origin;
  rmAnimate(node, [
    { opacity: 0, transform: 'translateY(-7px) scale(.965)' },
    { opacity: 1, transform: 'translateY(1px) scale(1.008)', offset: .68 },
    { opacity: 1, transform: 'none' },
  ], { duration: 260, easing: 'cubic-bezier(.2,1.12,.35,1)' });
}

export function animateMenuClose(node, origin = 'top right') {
  if (!node || !canAnimate()) return Promise.resolve();
  node.style.transformOrigin = origin;
  const current = getComputedStyle(node);
  const animation = rmAnimate(node, [
    {
      opacity: current.opacity,
      transform: current.transform === 'none' ? 'none' : current.transform,
    },
    { opacity: 0, transform: 'translateY(-4px) scale(.975)' },
  ], { duration: 150, easing: 'cubic-bezier(.4,0,.2,1)' });
  return animation?.finished?.catch(() => {}) || Promise.resolve();
}

export function pulseFeedback(node, className = 'rm-state-pop') {
  pulseClass(node, className, 420);
}

export function initReleaseMotion() {
  initPressFeedback();
  initLocalFeedback();
  initScrollFeedback();
  initRanges();
  refreshSettingsJump();
  initNetworkIndicator();
  settingsJumpFrame = 0;
}
