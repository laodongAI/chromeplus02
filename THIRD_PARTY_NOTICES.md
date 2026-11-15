# 第三方 vendored 代码许可与署名

`src/vendor/` 下的文件是随扩展一起分发的第三方代码副本（不走 npm 依赖）。
本文件是它们的来源与许可记录；分发扩展时必须一并带上本文件与根目录 `LICENSE`。

本项目自身代码适用根目录 `LICENSE`（Apache-2.0），**不覆盖**下列第三方副本。

---

## 1. mp4-muxer

| 项 | 值 |
| --- | --- |
| 上游 | https://github.com/Vanilagy/mp4-muxer |
| 许可 | MIT |
| 版权 | Copyright (c) 2023 Vanilagy |
| 本地文件 | `src/vendor/mp4-muxer.mjs`、`src/vendor/mp4-muxer.d.ts` |
| 版本 | 引入时未记录；文件内无版本标记，不臆造 |
| 用途 | WebCodecs 编码结果封装为 MP4/M4A（`src/core/mp4Export.ts`、`src/core/mediaConvert.ts`） |

上游状态：作者已宣布 mp4-muxer **停止维护**，转向 Mediabunny，不再接受新功能与缺陷修复。
本地副本是冻结快照，不随上游更新；是否迁移到 Mediabunny 是独立决策。

MIT 要求版权声明与许可声明随副本一并保留，完整文本如下：

```
MIT License

Copyright (c) 2023 Vanilagy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. mux.js 6.3.0

| 项 | 值 |
| --- | --- |
| 上游 | https://github.com/videojs/mux.js |
| 许可 | Apache-2.0 |
| 本地文件 | `src/vendor/mux.umd.cjs` |
| 版本 | 6.3.0（取自文件自带 banner） |
| 用途 | MPEG2-TS → fMP4 转封装（`mp4.Transmuxer`），HLS 分段流合并 |

许可文本：Apache License 2.0，与根目录 `LICENSE` 为同一份标准文本，随分发一并提供。

**本地修改声明**（Apache-2.0 第 4(b) 条要求标注改动）：
UMD 头部第 3 行的 `require('global/window')` 已改为 `require('./global-window.js')`，
指向同目录自写垫片，使 Service Worker（无 `window`）与 vite/vitest 的 CJS 解析走同一条路径。
除此之外未改动上游逻辑。

## 3. global-window.js

`src/vendor/global-window.js` 是**本项目自写**的垫片，不是第三方代码，
适用根目录 `LICENSE`。列在此处只为避免与上面两个 vendored 副本混淆。