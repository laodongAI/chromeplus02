/**
 * 工具函数入口：集中导出 TS 版工具。
 * 渐进迁移策略：保留根目录 utils.js 直至所有调用方迁移完成。
 * 变更记录：移除已废弃的 ./config（RootConfig 全项目无调用方，死代码清理）。
 */

export * from './site';
export * from './format';
export * from './dom';
export * from './domains';
