/**
 * 外挂下载器（Round 5 #30）——纯逻辑层。
 *
 * 两条外发通道，可行性结论不同，故分开建模：
 *
 *  1. aria2c：JSON-RPC over HTTP。扩展只需 fetch 本地端点，不需要安装 Native Host，
 *     是三类工具里唯一"零本机改造"的通道。注意 aria2 1.35+ 默认校验 Origin，
 *     扩展发起的请求 Origin 是 chrome-extension://<id>，用户必须显式
 *     `--rpc-origin-whitelist-required=false`（或把扩展源加白）才会放行，
 *     否则 403。这一约束写进设置项提示，避免用户以为扩展坏了。
 *  2. m3u8DL-RE / ffmpeg：需要在本机执行进程，只能走 Native Messaging（扩展已声明
 *     nativeMessaging 权限并已有 companion/host.ps1）。命令必须用 argv 数组下发，
 *     host 侧逐个转义后交给 CreateProcess，绝不拼 shell 字符串——URL 来自网页，
 *     拼字符串等于把命令注入送到用户桌面上。转义规则见 isSafeNativeArg。
 *
 * 本模块不做任何 IO，只负责构造请求、解析应答与参数消毒，便于在 node 环境下单测。
 */

/** 可扩展的外部工具标识 */
export type ExternalTool = 'aria2' | 'm3u8dl' | 'ffmpeg';

/** 外挂工具配置（与 sidepanel/services/settings.ts 的 externalTools 字段同形） */
export interface ExternalToolConfig {
  /** 总开关：关闭时全部走内置链路 */
  enabled: boolean;
  /** aria2 JSON-RPC 端点，例：http://127.0.0.1:6800/jsonrpc */
  aria2Rpc: string;
  /** aria2 RPC 密钥（token），空表示未设置 */
  aria2Secret: string;
  /** 本机工具（Native Host 侧执行）：off 表示不使用 */
  nativeTool: 'off' | 'm3u8dl' | 'ffmpeg';
  /** 分段流（HLS/DASH）是否优先交给外挂工具 */
  preferForStreams: boolean;
}

export const DEFAULT_EXTERNAL_TOOLS: ExternalToolConfig = {
  enabled: false,
  aria2Rpc: 'http://127.0.0.1:6800/jsonrpc',
  aria2Secret: '',
  nativeTool: 'off',
  preferForStreams: false
};

/** 派发下载时需要携带的上下文 */
export interface ExternalJob {
  /** 资源地址（必须是 http/https） */
  url: string;
  /** 落盘文件名（不含路径） */
  fileName?: string;
  /** Referer：多数站点校验来源，缺了会 403 */
  referer?: string;
  /** User-Agent：同上 */
  userAgent?: string;
}

/** 通用应答形态 */
export interface ExternalOutcome<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * 只接受 http(s) 绝对地址：外挂工具在本机执行，不能让 file:/blob: 混进来。
 * 控制字符与双引号一并拒绝——URL 里的换行/制表符会被 URL 解析器静默吃掉，
 * 但原样拼进命令行就可能变成参数注入；双引号则见 isSafeNativeArg 的说明。
 */
export function isSafeRemoteUrl(url: string): boolean {
  // eslint-disable-next-line no-control-regex -- 这里就是要拦控制字符：它们是命令行注入面，不是笔误
  if (typeof url !== 'string' || /[\x00-\x1f\x7f"]/.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 单个 argv 是否能被本机两套命令行解析规则同时正确还原。
 *
 * host 用 CreateProcess 直接启动进程，但两个工具吃命令行的方式不同：
 * ffmpeg 是 MSVC CRT 规则，m3u8DL-RE(.NET) 是 shell32!CommandLineToArgvW 规则。
 * 实测二者对「引号内的 \\"」和「结尾反斜杠 + 结束引号」的解释相反，
 * 不存在一种转义能同时满足，所以这两类参数直接拒绝（调用方回退内置链路），
 * 而不是猜一种转义把用户的下载悄悄写坏。CRLF 在引号内两套都按字面保留，
 * ffmpeg 的 -headers 正好需要它，故放行。
 */
export function isSafeNativeArg(arg: string): boolean {
  if (typeof arg !== 'string') return false;
  if (arg.includes('"')) return false;
  if (/\s/.test(arg) && arg.endsWith('\\')) return false;
  return true;
}

/**
 * 文件名消毒：剥掉目录部分与非法字符。
 * 面板传来的名称可能带 `../` 或以 `/` 结尾，直接拼给本机工具会写到目标目录之外。
 */
export function sanitizeFileName(name?: string, fallback = 'media'): string {
  if (!name) return fallback;
  const base = name.split(/[\\/]/).filter(Boolean).pop() || '';
  // eslint-disable-next-line no-control-regex -- 控制字符在 Windows 文件名里非法，且可能被本机 shell 解释
  const cleaned = base.replace(/[<>:"|?*\x00-\x1f]/g, '').replace(/^\.+/, '').trim();
  return cleaned.slice(0, 180) || fallback;
}

/** 请求 id：aria2 用它关联应答，扩展侧无需额外状态 */
let rpcSeq = 0;
function nextRpcId(): string {
  rpcSeq = (rpcSeq + 1) % 1000000;
  return `mp${Date.now().toString(36)}${rpcSeq}`;
}

/** aria2 的 token 形如 `token:xxx`，作为 params 首项 */
export function buildAria2AddUriPayload(config: ExternalToolConfig, job: ExternalJob): Record<string, unknown> {
  const headers: string[] = [];
  if (job.referer) headers.push(`Referer: ${job.referer}`);
  if (job.userAgent) headers.push(`User-Agent: ${job.userAgent}`);
  const options: Record<string, unknown> = { out: sanitizeFileName(job.fileName) };
  if (headers.length) options.header = headers;
  const params: unknown[] = [];
  if (config.aria2Secret) params.push(`token:${config.aria2Secret}`);
  params.push([job.url], options);
  return { jsonrpc: '2.0', id: nextRpcId(), method: 'aria2.addUri', params };
}

export function buildAria2TellStatusPayload(config: ExternalToolConfig, gid: string): Record<string, unknown> {
  const params: unknown[] = [];
  if (config.aria2Secret) params.push(`token:${config.aria2Secret}`);
  params.push(gid, ['status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorMessage']);
  return { jsonrpc: '2.0', id: nextRpcId(), method: 'aria2.tellStatus', params };
}

/** aria2 状态轮询结果（字段已归一化为扩展内部形态） */
export interface Aria2Status {
  status: string;
  /** 0-1；totalLength 为 0（未知体积）时为 0 */
  progress: number;
  totalBytes: number;
  completedBytes: number;
  speedBps: number;
  error?: string;
}

/**
 * 解析 aria2 应答。
 * aria2 的数值字段一律是十进制字符串（不是 number），直接当数字用会得到 NaN，
 * 所以这里统一走数字转换并按 total 归一化进度。
 */
export function parseAria2Response(json: any): ExternalOutcome<Aria2Status | string> {
  if (!json || typeof json !== 'object') return { ok: false, error: '应答不是合法 JSON' };
  if (json.error) {
    const code = json.error.code;
    const msg = json.error.message || 'aria2 返回错误';
    // 403 的根因几乎都是 Origin 白名单，给出可执行的修复提示而不是原样抛错
    if (/forbidden|origin/i.test(String(msg))) {
      return { ok: false, error: `aria2 拒绝了跨源请求（${msg}）：请为 aria2c 加 --rpc-origin-whitelist-required=false，或把本扩展来源加入 --rpc-origin-whitelist` };
    }
    return { ok: false, error: code ? `aria2 错误(${code})：${msg}` : `aria2 错误：${msg}` };
  }
  if (typeof json.result === 'string') return { ok: true, data: json.result };
  if (json.result && typeof json.result === 'object') {
    const r = json.result as Record<string, unknown>;
    const total = Number(r.totalLength || 0);
    const done = Number(r.completedLength || 0);
    return {
      ok: true,
      data: {
        status: String(r.status || ''),
        progress: Number.isFinite(total) && total > 0 ? Math.min(1, done / total) : 0,
        totalBytes: Number.isFinite(total) ? total : 0,
        completedBytes: Number.isFinite(done) ? done : 0,
        speedBps: Number(r.downloadSpeed || 0),
        error: r.errorMessage ? String(r.errorMessage) : undefined
      }
    };
  }
  return { ok: false, error: 'aria2 应答结构不符合预期' };
}

/** Native Host 侧执行请求：argv 数组，host 不得再拼 shell 字符串 */
export interface NativeDownloadRequest {
  type: 'download_ext';
  tool: 'm3u8dl' | 'ffmpeg';
  reqId: number;
  url: string;
  fileName: string;
  args: string[];
}

/**
 * m3u8DL-RE 参数：`--input-url <url> --save-name <name> --auto-select`。
 * 输出目录由 host 侧统一决定（用户 Downloads\MediaPlus），扩展不传路径，
 * 避免扩展侧任意路径写入。
 */
export function buildM3u8DlArgs(job: ExternalJob): string[] {
  const args = ['--input-url', job.url, '--save-name', sanitizeFileName(job.fileName, 'video'), '--auto-select'];
  if (job.referer) args.push('--header', `Referer:${job.referer}`);
  if (job.userAgent) args.push('--header', `User-Agent:${job.userAgent}`);
  return args;
}

/**
 * ffmpeg 参数：`-headers <crlf-joined> -i <url> -c copy <out>`。
 * ffmpeg 的 header 选项要求 `\r\n` 结尾，写成 `\n` 会被静默忽略（表现为 403）。
 */
export function buildFfmpegArgs(job: ExternalJob): string[] {
  const out = sanitizeFileName(job.fileName, 'video.mp4');
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y'];
  const headers: string[] = [];
  if (job.referer) headers.push(`Referer: ${job.referer}\r\n`);
  if (job.userAgent) headers.push(`User-Agent: ${job.userAgent}\r\n`);
  if (headers.length) args.push('-headers', headers.join(''));
  args.push('-i', job.url, '-c', 'copy', out);
  return args;
}

/** 组装 Native Host 下载请求（URL 不合法时返回错误，调用方回退内置链路） */
export function buildNativeDownloadRequest(
  reqId: number,
  tool: 'm3u8dl' | 'ffmpeg',
  job: ExternalJob
): ExternalOutcome<NativeDownloadRequest> {
  if (!isSafeRemoteUrl(job.url)) return { ok: false, error: '外挂工具只接受 http/https 资源地址' };
  const args = tool === 'm3u8dl' ? buildM3u8DlArgs(job) : buildFfmpegArgs(job);
  const bad = args.find((a) => !isSafeNativeArg(a));
  if (bad !== undefined) return { ok: false, error: '参数含本机命令行无法安全表达的字符（双引号或结尾反斜杠），已改用内置下载' };
  return {
    ok: true,
    data: {
      type: 'download_ext',
      tool,
      reqId,
      url: job.url,
      fileName: sanitizeFileName(job.fileName, tool === 'm3u8dl' ? 'video' : 'video.mp4'),
      args
    }
  };
}

/**
 * 决定一个任务走哪条外挂通道。
 * 规则刻意保守：分段流只有在用户显式勾选"优先交给外挂"时才外发，
 * 因为内置 HLS 引擎已经处理加密清单与重试，外挂工具失败时反而更慢。
 */
export function pickExternalTool(
  config: ExternalToolConfig,
  kind: 'stream' | 'file'
): ExternalTool | null {
  if (!config.enabled) return null;
  if (kind === 'stream') return config.preferForStreams ? (config.nativeTool === 'off' ? 'aria2' : config.nativeTool) : null;
  return config.nativeTool === 'off' ? 'aria2' : config.nativeTool;
}
