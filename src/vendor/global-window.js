// mux.js UMD 的 global/window 依赖垫片：Service Worker 中无 window，等价返回全局对象
module.exports = typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined' ? self : {});
