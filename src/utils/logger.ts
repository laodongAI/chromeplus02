/**
 * 全局分级日志工具（P1-8）。
 * 背景：
 *  - 此前全项目裸用 console.*，无级别开关；内容脚本的日志直接打在用户正在浏览的
 *    宿主页面控制台，既是噪音，也可能被页面脚本窥探（页面可重写 console 观察输出）。
 * 策略：
 *  - 四级：debug < info < warn < error，低于当前级别的输出直接丢弃；
 *  - 模块前缀：createLogger('downloads') 输出统一带 `[downloads]` 前缀，
 *    保留各模块既有 `[模块名]` 语义，不丢排查信息；
 *  - 默认级别按运行环境自动选择：
 *      · Service Worker（无 window）→ info（后台保留 info，便于装机诊断）
 *      · 扩展自身页面（chrome-extension: 协议，侧栏/编辑器）→ info
 *      · 内容脚本（宿主页面上下文）→ warn（debug/info 生产静默，降低噪音与窥探面）
 *  - 运行时可调：setLogLevel() 立即生效；同时异步读取 chrome.storage.local 的
 *    `chromeplus_log_level` 键（值 'debug'|'info'|'warn'|'error'），存在则覆盖默认级别，
 *    便于真机排查时在设置存储里改一个键即可放开，无需重新构建。
 * 注意：内容脚本与后台/侧栏是不同 JS 上下文，各自持有独立的级别状态，互不影响。
 */

/** 日志级别（按严重程度升序） */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 级别 → 数值序（用于过滤比较） */
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** 存储键：运行时日志级别覆盖（真机排查用，缺省不写则按环境默认） */
const LOG_LEVEL_STORAGE_KEY = 'chromeplus_log_level';

/**
 * 检测当前运行环境应使用的默认级别：
 * SW 无 window；扩展页面协议为 chrome-extension:；其余（内容脚本）默认 warn 静默。
 */
function detectDefaultLevel(): LogLevel {
  // Service Worker：无 window 对象
  if (typeof window === 'undefined') return 'info';
  try {
    // 侧栏 / 编辑器等扩展自身页面
    if (window.location.protocol.indexOf('chrome-extension:') === 0) return 'info';
  } catch { /* 取不到 location（极端沙箱）：按内容脚本保守处理 */ }
  // 内容脚本：宿主页面上下文，debug/info 静默
  return 'warn';
}

/** 当前生效级别（模块级单例状态；各上下文独立） */
let currentLevel: LogLevel = detectDefaultLevel();

/**
 * 设置全局日志级别（运行时可调）。
 * @param level 目标级别；非法值忽略并告警
 */
export function setLogLevel(level: LogLevel): void {
  if (typeof level !== 'string' || !(level in LEVEL_ORDER)) {
    console.warn(`[logger] 非法日志级别，已忽略: ${String(level)}`);
    return;
  }
  currentLevel = level;
}

/** 读取当前生效级别（诊断/测试用） */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

// 启动时尝试从 storage 读取运行时级别覆盖（fire-and-forget，失败静默用默认值）。
// 内容脚本/后台/侧栏三个上下文都会各自执行一次读取，互不干扰。
try {
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    chrome.storage.local.get(LOG_LEVEL_STORAGE_KEY, (res) => {
      const v = res?.[LOG_LEVEL_STORAGE_KEY];
      if (typeof v === 'string' && v in LEVEL_ORDER) {
        currentLevel = v as LogLevel;
      }
    });
  }
} catch { /* storage 不可用：保持环境默认级别 */ }

/** 分级 Logger 实例接口 */
export interface Logger {
  /** debug 级：开发细节（内容脚本默认被静默） */
  debug(...args: unknown[]): void;
  /** info 级：常规里程碑日志 */
  info(...args: unknown[]): void;
  /** warn 级：可恢复异常/降级路径 */
  warn(...args: unknown[]): void;
  /** error 级：失败与不可恢复异常 */
  error(...args: unknown[]): void;
}

/**
 * 创建带模块前缀的 logger。
 * @param module 模块名（如 'downloads' / 'content/router'），输出统一带 `[module]` 前缀，
 *               与各模块既有 `[模块名]` 前缀语义保持一致
 */
export function createLogger(module: string): Logger {
  const prefix = `[${module}]`;
  /** 级别过滤：低于当前级别的调用直接丢弃（不触碰 console，内容脚本上下文零输出） */
  const enabled = (level: LogLevel): boolean => LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
  return {
    debug(...args: unknown[]) { if (enabled('debug')) console.debug(prefix, ...args); },
    info(...args: unknown[]) { if (enabled('info')) console.info(prefix, ...args); },
    warn(...args: unknown[]) { if (enabled('warn')) console.warn(prefix, ...args); },
    error(...args: unknown[]) { if (enabled('error')) console.error(prefix, ...args); }
  };
}
