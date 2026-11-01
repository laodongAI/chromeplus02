/**
 * 录屏页面画笔覆盖层（Screenity 式）：
 *  - 工具：矩形 / 直线 / 箭头 / 画笔；颜色 5 种；粗细 1-12px；撤销 / 清空 / 选择模式
 *  - 画布 fixed 全屏；绘制内容随页面渲染被 tabCapture / getDisplayMedia 录入视频
 *  - 打开时默认处于绘制模式（接管指针），「选择模式」可临时放行页面交互
 */

interface Point { x: number; y: number }
interface Shape { tool: 'rect' | 'line' | 'arrow' | 'pen' | 'text'; color: string; width: number; points: Point[]; text?: string }

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff'];
const TOOLS: { key: Shape['tool']; label: string }[] = [
  { key: 'pen', label: '✎ 画笔' },
  { key: 'text', label: 'T 文字' },
  { key: 'rect', label: '▭ 矩形' },
  { key: 'line', label: '╱ 直线' },
  { key: 'arrow', label: '↗ 箭头' }
];

let root: HTMLDivElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let toolbar: HTMLDivElement | null = null;
let shapes: Shape[] = [];
let current: Shape | null = null;
let tool: Shape['tool'] = 'pen';
let color = COLORS[0];
let lineWidth = 4;
let selectMode = false;

function css(el: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, style);
}

function drawShape(c: CanvasRenderingContext2D, s: Shape): void {
  if (s.tool === 'text') {
    if (!s.text) return;
    c.fillStyle = s.color;
    c.font = `bold ${s.width * 5 + 10}px sans-serif`;
    c.textBaseline = 'top';
    c.fillText(s.text, s.points[0].x, s.points[0].y);
    return;
  }
  if (s.points.length < 2 && s.tool !== 'pen') return;
  c.strokeStyle = s.color;
  c.fillStyle = s.color;
  c.lineWidth = s.width;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const [a, b] = [s.points[0], s.points[s.points.length - 1]];
  c.beginPath();
  if (s.tool === 'rect') {
    c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  } else if (s.tool === 'line') {
    c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  } else if (s.tool === 'arrow') {
    c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const head = Math.max(10, s.width * 3.5);
    c.beginPath();
    c.moveTo(b.x, b.y);
    c.lineTo(b.x - head * Math.cos(ang - Math.PI / 6), b.y - head * Math.sin(ang - Math.PI / 6));
    c.lineTo(b.x - head * Math.cos(ang + Math.PI / 6), b.y - head * Math.sin(ang + Math.PI / 6));
    c.closePath();
    c.fill();
  } else {
    // pen
    c.moveTo(a.x, a.y);
    for (const p of s.points.slice(1)) c.lineTo(p.x, p.y);
    c.stroke();
  }
}

function redraw(): void {
  if (!canvas) return;
  const c = canvas.getContext('2d');
  if (!c) return;
  c.clearRect(0, 0, canvas.width, canvas.height);
  shapes.forEach(s => drawShape(c, s));
  if (current) drawShape(c, current);
}

function resize(): void {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  redraw();
}

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

function syncToolButtons(): void {
  if (!toolbar) return;
  toolbar.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => {
    b.style.background = (b.dataset.tool === tool && !selectMode) ? '#6366f1' : 'rgba(30,32,42,0.92)';
  });
}

function buildToolbar(): HTMLDivElement {
  const bar = document.createElement('div');
  css(bar, {
    position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
    display: 'flex', gap: '6px', alignItems: 'center', padding: '6px 8px',
    background: 'rgba(20,22,29,0.96)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '10px', zIndex: '2147483647', pointerEvents: 'auto',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)', maxWidth: '96vw', flexWrap: 'wrap' as any
  } as any);

  for (const t of TOOLS) {
    const b = button(t.label, () => { tool = t.key; selectMode = false; syncToolButtons(); }, tool === t.key);
    b.dataset.tool = t.key;
    bar.appendChild(b);
  }
  const sep = document.createElement('span');
  css(sep, { width: '1px', height: '18px', background: 'rgba(255,255,255,0.2)' });
  bar.appendChild(sep);
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
  const widthLabel = document.createElement('span');
  widthLabel.textContent = '粗细';
  css(widthLabel, { color: '#cbd5e1', fontSize: '12px' });
  bar.appendChild(widthLabel);
  const slider = document.createElement('input');
  (slider as HTMLInputElement).type = 'range';
  (slider as HTMLInputElement).min = '1';
  (slider as HTMLInputElement).max = '12';
  (slider as HTMLInputElement).value = String(lineWidth);
  css(slider, { width: '80px', accentColor: '#6366f1' } as any);
  slider.addEventListener('input', () => { lineWidth = Number((slider as HTMLInputElement).value); });
  bar.appendChild(slider);

  const selBtn = button('🖱 选择模式', () => {
    selectMode = !selectMode;
    applyPointerMode();
    selBtn.style.background = selectMode ? '#f59e0b' : 'rgba(30,32,42,0.92)';
    syncToolButtons();
  }, false, '临时放行页面点击');
  bar.appendChild(selBtn);

  bar.appendChild(button('↩ 撤销', () => { shapes.pop(); redraw(); }));
  bar.appendChild(button('🗑 清空', () => { shapes = []; redraw(); }));
  bar.appendChild(button('✕ 关闭', () => { toggleAnnotate(false); }, false, '关闭画笔工具'));
  return bar;
}

function applyPointerMode(): void {
  if (canvas) canvas.style.pointerEvents = selectMode ? 'none' : 'auto';
}

export function toggleAnnotate(on: boolean): void {
  if (!on) {
    root?.remove();
    root = null; canvas = null; toolbar = null;
    shapes = []; current = null; selectMode = false;
    window.removeEventListener('resize', resize);
    return;
  }
  if (root) return; // 已开启
  root = document.createElement('div');
  css(root, { position: 'fixed', inset: '0', zIndex: '2147483646', pointerEvents: 'none' });

  canvas = document.createElement('canvas');
  css(canvas, { position: 'absolute', inset: '0', pointerEvents: 'auto', cursor: 'crosshair', touchAction: 'none' });
  root.appendChild(canvas);

  toolbar = buildToolbar();
  root.appendChild(toolbar);
  document.documentElement.appendChild(root);

  const pt = (e: PointerEvent): Point => ({ x: e.clientX, y: e.clientY });
  canvas.addEventListener('pointerdown', (e) => {
    if (selectMode) return;
    if (tool === 'text') {
      openTextInput(pt(e));
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    current = { tool, color, width: lineWidth, points: [pt(e)] };
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    current.points.push(pt(e));
    redraw();
  });
  const finish = () => {
    if (!current) return;
    if (current.points.length > 1) shapes.push(current);
    current = null;
    redraw();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

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
    const commit = () => {
      const text = input.value.trim();
      if (text) {
        shapes.push({ tool: 'text', color, width: lineWidth, points: [anchor], text });
        redraw();
      }
      input.remove();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') commit();
      if (ev.key === 'Escape') input.remove();
      ev.stopPropagation();
    });
    input.addEventListener('blur', commit);
    root!.appendChild(input);
    setTimeout(() => input.focus(), 0);
  }

  window.addEventListener('resize', resize);
  resize();
  syncToolButtons();
}
