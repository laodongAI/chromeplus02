/**
 * Content Script 入口。
 * 当前：初始化站点路由，后续补充与背景通信与数据上报。
 */
import { initContentScript } from './router';

// 避免重复初始化
if (!(window as any).__EXT_CONTENT_INIT__) {
	(window as any).__EXT_CONTENT_INIT__ = true;
	initContentScript();
}
