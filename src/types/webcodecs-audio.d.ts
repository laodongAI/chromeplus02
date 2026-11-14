/**
 * WebCodecs 音频侧类型补充（全局环境声明，无需 import）。
 *
 * 背景（包管理器双锁漂移修复轮）：
 *  - typescript ^5.3.0 在 npm（解析最高 5.9.3，lib.dom 已含音频侧）与
 *    pnpm（解析最低 5.3.2，lib.dom 只有视频侧）下装出不同版本，
 *    5.3.2 编译 mp4Export.ts 报「Cannot find name 'AudioEncoder'」等 8 错；
 *  - 根治方案是把 package.json 的 typescript 钉为精确 5.9.3（两种包管理器
 *    解析结果一致）；本 shim 保留作为"版本约束被放宽回 <5.7"时的兜底，
 *    成员均按 W3C WebCodecs 规范给出真实签名（非 any 糊弄）。
 *  - 与 lib.dom 共存说明：TS ≥5.7 下本声明与 lib.dom 的音频侧声明重名，
 *    tsconfig 已开 skipLibCheck，重名合并被抑制且两侧成员兼容（实测 5.9.3
 *    下 tsc 0 错误）；若未来升级 TS 大版本可考虑删除本文件。
 *
 * 运行时兼容性：
 *  - AudioEncoder / AudioData 在 Chrome 94+ 原生支持；
 *    mp4Export.ts 的 canUseWebCodecsExport() 会在调用前做能力预检，
 *    类型声明不影响运行时行为。
 */

/** isConfigSupported 的返回结果：是否支持给定编码配置 */
interface AudioEncoderSupport {
  /** 浏览器是否支持该配置 */
  supported: boolean;
  /** 浏览器实际会采用的配置（可能与请求值略有差异） */
  config?: AudioEncoderConfig;
}

/** 音频编码器配置（对应规范 AudioEncoderConfig） */
interface AudioEncoderConfig {
  /** 编解码器标识，如 AAC-LC 的 'mp4a.40.2' */
  codec: string;
  /** 采样率（Hz），如 48000 */
  sampleRate: number;
  /** 声道数（1=单声道，2=立体声） */
  numberOfChannels: number;
  /** 目标比特率（bps），如 128000 */
  bitrate?: number;
  /** 比特率模式：恒定 / 可变（缺省由实现决定） */
  bitrateMode?: 'constant' | 'variable';
}

/** 编码输出时附带的元数据（解码器配置描述，需透传给封装器） */
interface AudioEncoderConfigMetadata {
  /** AAC 等编码器的 AudioSpecificConfig 描述（mp4-muxer 写入 mp4a 盒） */
  decoderConfig?: {
    codec: string;
    description?: BufferSource;
    sampleRate: number;
    numberOfChannels: number;
  };
}

/** 已编码的音频块（output 回调的第一个参数，透传给封装器即可） */
interface EncodedAudioChunkLike {
  /** 编码后字节数 */
  readonly byteLength: number;
  /** 时间戳（微秒） */
  readonly timestamp: number;
  /** 块类型：关键帧 / 增量帧（音频通常均为 key） */
  readonly type: 'key' | 'delta';
}

/** AudioEncoder 构造参数：输出与错误两个回调 */
interface AudioEncoderInit {
  /**
   * 每编码完成一块音频时回调。
   * @param chunk 已编码音频块
   * @param meta  首块携带的解码器配置元数据（可能为空）
   */
  output: (chunk: EncodedAudioChunkLike, meta?: AudioEncoderConfigMetadata) => void;
  /** 编码过程中发生错误时回调 */
  error: (error: DOMException) => void;
}

/**
 * 音频编码器（WebCodecs）。
 * 用法：new → configure → encode(AudioData)×N → flush → close。
 */
declare class AudioEncoder {
  constructor(init: AudioEncoderInit);
  /** 静态预检：查询浏览器是否支持给定编码配置 */
  static isConfigSupported(config: AudioEncoderConfig): Promise<AudioEncoderSupport>;
  /** 应用编码配置（调用前状态必须为 unconfigured） */
  configure(config: AudioEncoderConfig): void;
  /** 提交一帧原始音频进行编码（异步，结果经 output 回调返回） */
  encode(data: AudioData): void;
  /** 等待编码队列清空（导出收尾时调用，确保所有块已输出） */
  flush(): Promise<void>;
  /** 关闭编码器并释放底层资源 */
  close(): void;
  /** 当前排队等待编码的帧数（用于背压控制） */
  readonly encodeQueueSize: number;
  /** 编码器状态机当前状态 */
  readonly state: 'unconfigured' | 'configured' | 'closed' | 'error';
}

/** AudioData 构造参数（从 PCM 数据创建原始音频帧） */
interface AudioDataInit {
  /** 采样格式：本项目固定使用 'f32-planar'（32 位浮点、按声道平面排布） */
  format: 'u8' | 's16' | 's32' | 'f32' | 'f32-planar';
  /** 采样率（Hz） */
  sampleRate: number;
  /** 本帧包含的采样帧数（每声道） */
  numberOfFrames: number;
  /** 声道数 */
  numberOfChannels: number;
  /** 帧起始时间戳（微秒） */
  timestamp: number;
  /** PCM 原始数据（字节布局须与 format/声道数/帧数匹配） */
  data: BufferSource;
}

/**
 * 原始音频帧（WebCodecs）。
 * 由 PCM 缓冲构造，提交给 AudioEncoder.encode() 后应调用 close() 释放。
 */
declare class AudioData {
  constructor(init: AudioDataInit);
  /** 释放底层音频缓冲（编码提交后立即调用，避免内存堆积） */
  close(): void;
}
