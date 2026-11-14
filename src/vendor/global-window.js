// mux.js UMD 头部的 window 垫片：Service Worker 中无 window，等价返回全局对象。
// 头部原为 require('global/window')，已改成相对路径指向本文件，
// 这样 vite 构建与 node/vitest 的 CJS require 走同一套解析，不再依赖构建期别名。
module.exports = typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined' ? self : {});
