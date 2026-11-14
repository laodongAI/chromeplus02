/**
 * 录屏页面画笔覆盖层（Screenity 式）：
 *  - 工具：画笔 / 荧光笔 / 橡皮擦 / 文字 / 矩形 / 直线 / 箭头
 *  - 颜色 5 种；粗细 1-12px；白板背景（透明 / 白 / 黑）；撤销 / 清空
 *  - 画布 fixed 全屏，绘制内容会被 getDisplayMedia 录入视频
 *  - 键盘快捷键：H 隐藏/显示工具栏（录屏时不出现）；空格 切换「绘制 / 操作」模式
 *  - 默认处于绘制模式（接管指针），「操作模式」下放行页面点击
 */

import { createLogger } from '@/utils/logger';

/** 本模块 logger：记录覆盖层开关、模式/工具切换等里程碑（支持 debug/info/warn/error 级别） */
const log = createLogger('content/annotate');

// ── 类型定义 ────────────────────────────────────────────────────────────
/** 画布上的坐标点（CSS 像素，相对视口左上角） */
interface Point { x: number; y: number }

/** 单个绘制元素（一次落笔 = 一个 shape） */
interface Shape {
  /** 工具类型，决定渲染方式 */
  tool: 'rect' | 'line' | 'arrow' | 'pen' | 'highlighter' | 'eraser' | 'text';
  /** 线条/文字颜色（橡皮擦不使用该字段） */
  color: string;
  /** 线宽（橡皮擦与荧光笔会在此基础上做倍数放大） */
  width: number;
  /** 轨迹点：画笔/橡皮为完整轨迹，矩形/直线/箭头只取首尾两点 */
  points: Point[];
  /** 文字内容（仅 text 工具使用） */
  text?: string;
}

/** 画布背景模式：透明（覆盖网页）/ 白色白板 / 黑色黑板 */
type BgMode = 'none' | 'white' | 'black';

// ── 常量配置 ────────────────────────────────────────────────────────────
/** 可选颜色：红 / 橙 / 绿 / 蓝 / 白 */
const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff'];

/** 工具栏按钮清单（key 与 Shape.tool 对应） */
const TOOLS: { key: Shape['tool']; label: string; title: string }[] = [
  { key: 'pen', label: '✎ 画笔', title: '自由手写（默认）' },
  { key: 'highlighter', label: '🖍 荧光', title: '半透明荧光笔，适合划重点不遮字' },
  { key: 'eraser', label: '🧽 橡皮', title: '擦除笔迹（可局部擦）' },
  { key: 'text', label: 'T 文字', title: '点击画布输入文字，回车确认' },
  { key: 'rect', label: '▭ 矩形', title: '拖拽画矩形框' },
  { key: 'line', label: '╱ 直线', title: '拖拽画直线' },
  { key: 'arrow', label: '↗ 箭头', title: '拖拽画箭头，用于指向重点' }
];

// ── 模块级状态 ──────────────────────────────────────────────────────────
/** 覆盖层根节点（挂载在 documentElement 上） */
let root: HTMLDivElement | null = null;
/** 绘制画布（透明，铺满视口） */
let canvas: HTMLCanvasElement | null = null;
/** 工具栏容器 */
let toolbar: HTMLDivElement | null = null;
/** 已完成的绘制元素列表（撤销 = 弹出最后一个） */
let shapes: Shape[] = [];
/** 正在绘制的元素（鼠标按下到抬起之间） */
let current: Shape | null = null;
/** 当前工具 */
let tool: Shape['tool'] = 'pen';
/** 当前颜色 */
let color = COLORS[0];
/** 当前线宽 */
let lineWidth = 4;
/** 是否处于「操作模式」（true 时放行页面交互，禁止绘制）；默认开启，避免一打开就吞掉整页点击 */
let selectMode = true;
/** 是否显示工具栏（false 时录屏画面中不会出现工具栏） */
let toolbarVisible = true;
/** 当前背景模式 */
let bgMode: BgMode = 'none';
/** 「操作模式」按钮引用，便于同步高亮状态 */
let selectBtn: HTMLButtonElement | null = null;
/** 「背景」按钮引用，便于同步文案 */
let bgBtn: HTMLButtonElement | null = null;
/** 快捷键提示浮层计时器 */
let hintTimer: number | null = null;
/** 快捷键提示浮层节点 */
let hintEl: HTMLDivElement | null = null;
/** 键盘事件处理器引用，便于关闭时解绑 */
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

// ── 基础工具函数 ────────────────────────────────────────────────────────
/**
 * 批量设置元素样式（简化样式赋值）。
 * @param el 目标元素
 * @param style 需要覆盖的样式集合
 */
function css(el: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, style);
}

/** 背景模式对应的填充色（透明模式返回 null） */
function bgColor(): string | null {
  if (bgMode === 'white') return '#ffffff';
  if (bgMode === 'black') return '#111111';
  return null;
}

/**
 * 绘制单个元素。
 * 说明：橡皮擦在透明背景下用 destination-out 真正抹除像素；
 *      在白/黑背景下则改用背景色描边，保证擦完露出的是背景色。
 * @param c 画布上下文
 * @param s 要绘制的元素
 */
function drawShape(c: CanvasRenderingContext2D, s: Shape): void {
  const base = bgColor(); // 当前背景色（透明背景为 null）

  // 文字：直接填充文本，字号由线宽决定（保证粗细滑块也能控制字号）
  if (s.tool === 'text') {
    if (!s.text) return;
    c.save();
    c.fillStyle = s.color;
    c.font = `bold ${s.width * 5 + 10}px sans-serif`;
    c.textBaseline = 'top';
    c.fillText(s.text, s.points[0].x, s.points[0].y);
    c.restore();
    return;
  }

  // 单点轨迹（除画笔/橡皮外）不构成有效图形，直接跳过
  if (s.points.length < 2 && s.tool !== 'pen' && s.tool !== 'highlighter' && s.tool !== 'eraser') return;

  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';

  // 荧光笔：加粗 + 半透明，模仿荧光标记笔
  const strokeWidth = s.tool === 'highlighter' ? s.width * 2.5 : s.tool === 'eraser' ? s.width * 2 : s.width;
  c.lineWidth = strokeWidth;

  if (s.tool === 'eraser') {
    // 透明背景 → 直接抹掉像素；有背景 → 用背景色覆盖
    if (base) c.strokeStyle = base;
    else c.globalCompositeOperation = 'destination-out';
  } else {
    c.strokeStyle = s.color;
    c.fillStyle = s.color;
    if (s.tool === 'highlighter') c.globalAlpha = 0.35;
  }

  const [a, b] = [s.points[0], s.points[s.points.length - 1]];

  if (s.tool === 'rect') {
    c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  } else if (s.tool === 'line') {
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  } else if (s.tool === 'arrow') {
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    // 箭头头部：按线段方向绘制一个实心三角
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const head = Math.max(10, s.width * 3.5);
    c.beginPath();
    c.moveTo(b.x, b.y);
    c.lineTo(b.x - head * Math.cos(ang - Math.PI / 6), b.y - head * Math.sin(ang - Math.PI / 6));
    c.lineTo(b.x - head * Math.cos(ang + Math.PI / 6), b.y - head * Math.sin(ang + Math.PI / 6));
    c.closePath();
    c.fill();
  } else {
    // 画笔 / 荧光笔 / 橡皮擦：沿轨迹逐点连线
    c.beginPath();
    c.moveTo(a.x, a.y);
    for (const p of s.points.slice(1)) c.lineTo(p.x, p.y);
    c.stroke();
  }
  c.restore();
}

/** 重绘整块画布：先铺背景，再按顺序回放所有元素（含正在绘制的元素） */
function redraw(): void {
  if (!canvas) return;
  const c = canvas.getContext('2d');
  if (!c) return;
  // 笔迹坐标是 CSS 像素，backing store 已按 dpr 放大，用变换对齐两者
  const dpr = window.devicePixelRatio || 1;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, window.innerWidth, window.innerHeight);

  // 白板/黑板模式：先铺满背景，遮住网页内容
  const base = bgColor();
  if (base) {
    c.fillStyle = base;
    c.fillRect(0, 0, window.innerWidth, window.innerHeight);
  }

  shapes.forEach(s => drawShape(c, s));
  if (current) drawShape(c, current);
}

/** 视口尺寸变化时同步画布尺寸并重绘（笔迹按 CSS 像素保存，不会丢失） */
function resize(): void {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  redraw();
}

/**
 * 创建一个工具栏按钮。
 * @param label 按钮文案
 * @param onClick 点击回调
 * @param active 是否高亮（选中态）
 * @param title 悬浮提示
 */
function button(label: string, onClick: () => void, active = false, title = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title || label;
  css(b, {
    padding: '4px 8px', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px',
    background: active ? '#6366f1' : 'rgba(30,32,42,0.92)', color: '#fff',
    fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap'
  } as any);
  b.addEventListener('click', onClick);
  return b;
}

/** 同步工具按钮高亮状态（操作模式下全部不亮） */
function syncToolButtons(): void {
  if (!toolbar) return;
  toolbar.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => {
    b.style.background = (b.dataset.tool === tool && !selectMode) ? '#6366f1' : 'rgba(30,32,42,0.92)';
  });
  if (selectBtn) selectBtn.style.background = selectMode ? '#f59e0b' : 'rgba(30,32,42,0.92)';
}

/** 同步背景按钮文案 */
function syncBgButton(): void {
  if (!bgBtn) return;
  bgBtn.textContent = bgMode === 'none' ? '⬜ 背景:无' : bgMode === 'white' ? '⬜ 背景:白' : '⬛ 背景:黑';
  bgBtn.style.background = bgMode === 'none' ? 'rgba(30,32,42,0.92)' : '#6366f1';
}

/**
 * 显示一条短提示（1.2 秒后自动消失）。
 * 用于告知快捷键状态；提示本身如果正在录屏会被录进去，因此停留时间很短。
 * @param text 提示文案
 */
function showHint(text: string): void {
  if (!root) return;
  if (hintTimer != null) { window.clearTimeout(hintTimer); hintTimer = null; }
  if (!hintEl) {
    hintEl = document.createElement('div');
    css(hintEl, {
      position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)',
      padding: '6px 14px', borderRadius: '8px', background: 'rgba(20,22,29,0.92)',
      color: '#e2e8f0', fontSize: '13px', fontFamily: 'inherit', zIndex: '2147483647',
      pointerEvents: 'none', whiteSpace: 'nowrap', border: '1px solid rgba(255,255,255,0.15)'
    });
    root.appendChild(hintEl);
  }
  hintEl.textContent = text;
  hintEl.style.display = 'block';
  hintTimer = window.setTimeout(() => { if (hintEl) hintEl.style.display = 'none'; }, 1200);
}

/**
 * 切换工具栏显示/隐藏。
 * 隐藏后录屏画面里不会出现工具栏，但快捷键仍然可用。
 * @param force 可选，强制指定状态
 */
function toggleToolbar(force?: boolean): void {
  toolbarVisible = force ?? !toolbarVisible;
  if (toolbar) toolbar.style.display = toolbarVisible ? 'flex' : 'none';
  log.debug(`工具栏${toolbarVisible ? '已显示' : '已隐藏（录屏画面中不会出现）'}`);
  showHint(toolbarVisible ? '工具栏已显示（按 H 隐藏）' : '工具栏已隐藏，录屏中不会出现（按 H 恢复）');
}

/**
 * 切换「绘制 / 操作」模式。
 * 操作模式下画布不再接管指针，可以正常点击网页。
 * @param value 目标状态
 */
function setSelectMode(value: boolean): void {
  selectMode = value;
  applyPointerMode();
  syncToolButtons();
  log.info(`切换为${selectMode ? '操作' : '绘制'}模式（${selectMode ? '放行页面点击' : '画布接管指针'}）`);
  showHint(selectMode ? '操作模式：网页可正常点击；选一个画笔工具即可书写' : '绘制模式：在页面上书写（空格切回操作，H 隐藏工具栏）');
}

/** 根据模式设置画布指针事件与光标样式 */
function applyPointerMode(): void {
  if (!canvas) return;
  canvas.style.pointerEvents = selectMode ? 'none' : 'auto';
  canvas.style.cursor = selectMode ? 'default' : (tool === 'eraser' ? 'cell' : 'crosshair');
}

/** 构建顶部工具栏 */
function buildToolbar(): HTMLDivElement {
  const bar = document.createElement('div');
  css(bar, {
    position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
    display: 'flex', gap: '6px', alignItems: 'center', padding: '6px 8px',
    background: 'rgba(20,22,29,0.96)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '10px', zIndex: '2147483647', pointerEvents: 'auto',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)', maxWidth: '96vw', flexWrap: 'wrap' as any
  } as any);

  // 工具按钮组
  for (const t of TOOLS) {
    const b = button(t.label, () => {
      tool = t.key;
      selectMode = false;          // 选工具时自动回到绘制模式
      applyPointerMode();
      syncToolButtons();
      log.debug(`当前工具切换为 ${t.key}`);
    }, tool === t.key, t.title);
    b.dataset.tool = t.key;
    bar.appendChild(b);
  }

  // 分隔线
  const sep = document.createElement('span');
  css(sep, { width: '1px', height: '18px', background: 'rgba(255,255,255,0.2)' });
  bar.appendChild(sep);

  // 颜色选择器
  for (const col of COLORS) {
    const sw = document.createElement('div');
    css(sw, {
      width: '18px', height: '18px', borderRadius: '50%', cursor: 'pointer',
      background: col, border: color === col ? '2px solid #fff' : '2px solid transparent'
    });
    sw.title = '颜色';
    sw.addEventListener('click', () => {
      color = col;
      bar.querySelectorAll<HTMLElement>('[data-color]').forEach(el => {
        el.style.border = el.dataset.color === col ? '2px solid #fff' : '2px solid transparent';
      });
    });
    sw.dataset.color = col;
    bar.appendChild(sw);
  }

  // 粗细滑块
  const widthLabel = document.createElement('span');
  widthLabel.textContent = '粗细';
  css(widthLabel, { color: '#cbd5e1', fontSize: '12px' });
  bar.appendChild(widthLabel);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '1';
  slider.max = '12';
  slider.value = String(lineWidth);
  css(slider, { width: '80px', accentColor: '#6366f1' } as any);
  slider.addEventListener('input', () => { lineWidth = Number(slider.value); });
  bar.appendChild(slider);

  // 背景切换：透明 → 白板 → 黑板 → 透明
  bgBtn = button('⬜ 背景:无', () => {
    bgMode = bgMode === 'none' ? 'white' : bgMode === 'white' ? 'black' : 'none';
    syncBgButton();
    redraw();
    log.info(`画布背景切换为 ${bgMode}（none=覆盖网页 / white=白板 / black=黑板）`);
    showHint(bgMode === 'none' ? '背景已关闭：笔迹覆盖在网页上' : bgMode === 'white' ? '白板模式：整屏白色画布' : '黑板模式：整屏黑色画布');
  }, false, '切换白板/黑板背景（遮住网页内容）');
  bar.appendChild(bgBtn);
  syncBgButton();

  // 操作模式开关
  selectBtn = button('🖱 操作模式', () => setSelectMode(!selectMode), false, '临时放行页面点击（快捷键 空格）');
  bar.appendChild(selectBtn);

  // 撤销 / 清空 / 关闭
  bar.appendChild(button('↩ 撤销', () => { shapes.pop(); redraw(); log.debug(`撤销一笔，剩余 ${shapes.length} 个元素`); }, false, '撤销最后一笔'));
  bar.appendChild(button('🗑 清空', () => { shapes = []; redraw(); log.info('已清空全部笔迹'); }, false, '清空全部笔迹'));
  bar.appendChild(button('✕ 关闭', () => { toggleAnnotate(false); }, false, '关闭画笔工具'));

  // 快捷键说明
  const tip = document.createElement('span');
  tip.textContent = 'H 隐藏工具栏 · 空格 切操作';
  css(tip, { color: '#94a3b8', fontSize: '11px', whiteSpace: 'nowrap' });
  bar.appendChild(tip);

  return bar;
}

/**
 * 打开/关闭画笔覆盖层。
 * @param on true 打开；false 关闭并清理
 */
export function toggleAnnotate(on: boolean): void {
  if (!on) {
    log.info('关闭画笔覆盖层：移除节点并解绑事件');
    // 关闭：移除节点、解绑事件、清空状态
    root?.remove();
    root = null; canvas = null; toolbar = null;
    shapes = []; current = null; selectMode = true;
    toolbarVisible = true; bgMode = 'none';
    selectBtn = null; bgBtn = null;
    if (hintTimer != null) { window.clearTimeout(hintTimer); hintTimer = null; }
    hintEl = null;
    window.removeEventListener('resize', resize);
    if (keyHandler) { window.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
    return;
  }
  if (root) return; // 已开启，避免重复挂载

  root = document.createElement('div');
  css(root, { position: 'fixed', inset: '0', zIndex: '2147483646', pointerEvents: 'none' });

  canvas = document.createElement('canvas');
  css(canvas, { position: 'absolute', inset: '0', pointerEvents: 'none', cursor: 'default', touchAction: 'none' });
  root.appendChild(canvas);

  toolbar = buildToolbar();
  root.appendChild(toolbar);
  document.documentElement.appendChild(root);

  /** 把指针事件坐标转换为画布坐标（视口坐标即可，画布铺满视口） */
  const pt = (e: PointerEvent): Point => ({ x: e.clientX, y: e.clientY });

  canvas.addEventListener('pointerdown', (e) => {
    if (selectMode) return; // 操作模式不绘制
    if (tool === 'text') { openTextInput(pt(e)); return; }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    current = { tool, color, width: lineWidth, points: [pt(e)] };
    redraw();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    current.points.push(pt(e));
    redraw();
  });

  /** 结束当前笔画：轨迹点数大于 1 才保存，避免单击留下噪点 */
  const finish = () => {
    if (!current) return;
    if (current.points.length > 1) shapes.push(current);
    current = null;
    redraw();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  /**
   * 在点击位置弹出文字输入框。
   * 回车确认写入画布；Esc 取消；失焦也视为确认。
   * @param anchor 文字左上角坐标
   */
  function openTextInput(anchor: Point): void {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '输入文字，回车确认';
    css(input, {
      position: 'fixed',
      left: `${anchor.x}px`,
      top: `${Math.max(4, anchor.y - 14)}px`,
      zIndex: '2147483647',
      pointerEvents: 'auto',
      background: 'rgba(20,22,29,0.95)',
      color: color,
      border: `1px solid ${color}`,
      borderRadius: '6px',
      padding: '4px 8px',
      fontSize: '14px',
      fontWeight: '600',
      outline: 'none',
      width: '240px'
    });
    /** 提交输入内容并移除输入框 */
    const commit = () => {
      const text = input.value.trim();
      if (text) {
        shapes.push({ tool: 'text', color, width: lineWidth, points: [anchor], text });
        redraw();
        log.debug(`新增文字标注（${text.length} 字）于 (${anchor.x}, ${anchor.y})`);
      }
      input.remove();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') commit();
      if (ev.key === 'Escape') input.remove();
      ev.stopPropagation(); // 避免触发全局快捷键
    });
    input.addEventListener('blur', commit);
    root!.appendChild(input);
    setTimeout(() => input.focus(), 0);
  }

  // 快捷键：H 隐藏工具栏、空格切换操作/绘制。
  // 仅在绘制模式或焦点落在覆盖层内时生效——操作模式下用户正在操作网页，
  // 空格是滚动/播放暂停、H 可能是站点自身快捷键，全局劫持会破坏页面交互。
  keyHandler = (e: KeyboardEvent) => {
    if (!root) return;
    const target = e.target as HTMLElement | null;
    // 文字输入场景内不拦截按键
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (selectMode && !root.contains(document.activeElement)) return;
    if (e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      e.stopPropagation();
      toggleToolbar();
    } else if (e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      setSelectMode(!selectMode);
    }
  };
  window.addEventListener('keydown', keyHandler, true);

  window.addEventListener('resize', resize);
  resize();
  applyPointerMode();
  syncToolButtons();
  log.info(`画笔覆盖层已开启（视口 ${window.innerWidth}x${window.innerHeight}，默认操作模式，工具 pen）`);
  showHint('画笔已开启：当前为操作模式，网页可正常点击；选一个画笔工具即可书写，H 隐藏工具栏');
}
