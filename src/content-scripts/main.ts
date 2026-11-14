/**
 * Content Script 入口。
 * 当前：初始化站点路由，后续补充与背景通信与数据上报。
 */
import { initContentScript } from './router';

// 重复注入由 initContentScript 内的隔离世界标记拦截；扩展重载后世界重建，可正常重新初始化
initContentScript();
