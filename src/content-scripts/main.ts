/**
 * Content Script 入口。
 * 当前：初始化站点路由，后续补充与背景通信与数据上报。
 */
import { initContentScript } from './router';

// 始终初始化，以支持扩展重载后的重新注入
// 注意：initContentScript 内部应处理重复监听器的问题（如使用具名函数或清理逻辑）
initContentScript();
