/**
 * 点击/光标高亮覆盖层（Round 5 #32）——内容脚本侧实现。
 *
 * 与画笔覆盖层分开而不是塞进 annotate.ts：画笔是有状态的画布（笔迹要留存、
 * 要撤销、要切工具），高亮是无状态的瞬时动画，两者的生命周期与清理逻辑完全不同，
 * 混在一起会让「关画笔」顺手清掉高亮、或反之。
 *
 * 边界：覆盖层画在页面上，整屏录制与标签页录制都能录到；录其他应用窗口时录不到。
 * 所有节点 pointer-events:none + 监听走捕获阶段且 passive，绝不改变页面行为。
 */
import {
  HALO_BASE_PX,
  RIPPLE_DURATION_MS,
  haloGeometry,
  rippleGeometry,
  shouldSpawnRipple
} from '@/core/cursorHighlight';
import { createLogger } from '@/utils/logger';

const log = createLogger('content/cursorHighlight');

const STYLE_ID = 'mediaplus-cursor-highlight-style';
/** 比画笔覆盖层低一级：两者同开时笔迹压在光晕之上 */
const Z_INDEX = '2147483645';

const CSS = `
@keyframes mediaplus-ripple {
  0%   { transform: scale(0.35); opacity: 0.95; }
  70%  { opacity: 0.45; }
  100% { transform: scale(1.5); opacity: 0; }
}
.mediaplus-ripple {
  position: absolute;
  border-radius: 50%;
  border: 3px solid rgba(255, 196, 0, 0.95);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25), 0 0 12px rgba(255, 196, 0, 0.55);
  animation: mediaplus-ripple ${RIPPLE_DURATION_MS}ms ease-out forwards;
  pointer-events: none;
}
.mediaplus-halo {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255,196,0,0.30) 0%, rgba(255,196,0,0.12) 55%, rgba(255,196,0,0) 72%);
  pointer-events: none;
  will-change: transform;
}
`;

let root: HTMLDivElement | null = null;
let halo: HTMLDivElement | null = null;
let styleEl: HTMLStyleElement | null = null;
let liveRipples = 0;
let lastSpawn = 0;
let downHandler: ((e: PointerEvent) => void) | null = null;
let moveHandler: ((e: PointerEvent) => void) | null = null;

function spawnRipple(x: number, y: number): void {
  if (!root) return;
  const now = Date.now();
  if (!shouldSpawnRipple(now, lastSpawn, liveRipples)) return;
  lastSpawn = now;

  const g = rippleGeometry(x, y, window.innerWidth, window.innerHeight);
  const el = document.createElement('div');
  el.className = 'mediaplus-ripple';
  el.style.left = `${g.cx - g.size / 2}px`;
  el.style.top = `${g.cy - g.size / 2}px`;
  el.style.width = `${g.size}px`;
  el.style.height = `${g.size}px`;
  root.appendChild(el);
  liveRipples++;

  // animationend 可能因页面 CSS 覆盖 animation 而不触发；计数只增不减会永久堵死后续涟漪，
  // 所以补一个超时兜底，两条路径用 done 去重
  let done = false;
  const remove = (): void => {
    if (done) return;
    done = true;
    liveRipples = Math.max(0, liveRipples - 1);
    el.remove();
  };
  el.addEventListener('animationend', remove, { once: true });
  window.setTimeout(remove, RIPPLE_DURATION_MS + 250);
}

function moveHalo(x: number, y: number): void {
  if (!halo) return;
  const g = haloGeometry(x, y, window.innerWidth, window.innerHeight);
  halo.style.transform = `translate(${g.cx - g.size / 2}px, ${g.cy - g.size / 2}px)`;
  if (halo.style.display === 'none') halo.style.display = 'block';
}

/**
 * 开关高亮覆盖层。重复开启同一状态是幂等的（消息可能因多帧广播重复到达）。
 * @param active true=挂载并监听，false=彻底清理
 */
export function toggleCursorHighlight(active: boolean): void {
  if (!active) {
    if (downHandler) window.removeEventListener('pointerdown', downHandler, true);
    if (moveHandler) window.removeEventListener('pointermove', moveHandler, true);
    downHandler = null;
    moveHandler = null;
    root?.remove();
    styleEl?.remove();
    root = null;
    halo = null;
    styleEl = null;
    liveRipples = 0;
    lastSpawn = 0;
    return;
  }
  if (root) return;

  styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = CSS;
  document.documentElement.appendChild(styleEl);

  root = document.createElement('div');
  root.style.cssText = `position:fixed;inset:0;z-index:${Z_INDEX};pointer-events:none;overflow:hidden;`;
  document.documentElement.appendChild(root);

  halo = document.createElement('div');
  halo.className = 'mediaplus-halo';
  halo.style.width = `${HALO_BASE_PX}px`;
  halo.style.height = `${HALO_BASE_PX}px`;
  halo.style.display = 'none';
  root.appendChild(halo);

  downHandler = (e: PointerEvent) => spawnRipple(e.clientX, e.clientY);
  moveHandler = (e: PointerEvent) => moveHalo(e.clientX, e.clientY);
  // 捕获阶段 + passive：页面自己 stopPropagation 也拦不到我们，且永不阻塞滚动
  window.addEventListener('pointerdown', downHandler, { capture: true, passive: true });
  window.addEventListener('pointermove', moveHandler, { capture: true, passive: true });
  log.info('点击/光标高亮已开启');
}