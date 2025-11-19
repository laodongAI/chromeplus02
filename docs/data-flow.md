# 数据与流程说明

## 1. 数据模型
- VideoItem：`{ index, src, currentSrc, width, height, duration, muted }`
- AudioItem：`{ url, title }`
- ImageItem：`{ url, width?, height?, type? }`
- Settings：`{ autoScan, namingTemplate, downloadConcurrency, recordFormat, recordQuality, ... }`

## 2. 典型交互流程
- 扫描媒体：
  1) 侧边栏点击“扫描” → `chrome.tabs.sendMessage(REQUEST_SCAN)`；
  2) 内容脚本扫描 DOM，整合 `<video>/<audio>/<img>` 与 `og:*`、`preload`、`JSON-LD` 线索；
  3) 内容脚本返回清单 → 侧边栏渲染列表与统计徽标。
- 视频控制：
  1) 侧边栏传入 `videoIndex` → 内容脚本定位对应 `<video>`；
  2) 执行播放/暂停或抓帧操作；
  3) 成功/失败通过消息返回并在通知区展示。
- 录制与保存：
  1) 侧边栏在视频列表指定 `videoIndex`，发送 `START_RECORD_VIDEO` → 内容脚本调用 `captureStream()` + `MediaRecorder`（画面+声音）；
  2) 录制过程通过消息反馈状态（录制中/时长/失败原因），`STOP_RECORD_VIDEO` 后聚合 Blob 并回传；
  3) 侧边栏或后台使用命名模板触发 `chrome.downloads.download` 保存；无法录制（DRM/无权限）时提示改用直链下载。
  4) 若选择“仅音频”，发送 `START_AUDIO_RECORD`，只保留音轨并导出 WebM/Ogg。
- 下载与进度：
  1) 调用 `chrome.downloads.download`；
  2) 后台监听 `downloads.onChanged`（可选）并反馈给侧边栏更新进度；
  3) 失败重试与并发控制由侧边栏队列管理。
 - 原视频直链下载：
   1) 侧边栏请求内容脚本返回该视频可能的源 URL（`video.src`、`<source>`、站点自定义 API）。
   2) 若存在可用直链，直接调用 `chrome.downloads.download`，并展示进度/重试入口；
   3) 若没有直链（或返回 403/401/DRM），提示用户改用录制方案。

## 3. 状态持久化
- Settings 持久化于 `chrome.storage.local`；
## 4. 错误与回退策略
- DRM/EME：录制/抓帧不可用 → 引导使用“可视区域截图”或尝试直链下载。
- CORS/Tainted Canvas：无法导出图像 → 使用 `captureVisibleTab` 替代；
- 无直链/403：提示保持视频播放状态或用户登录后重试，并推荐切换到录制模式。

## 5. 当前消息与数据流（文字版）
1. 用户在侧边栏点击按钮（播放/暂停、录制、抓帧、扫描音频列表等），触发 `sidepanel.js` 中的对应函数。
2. `sidepanel.js`：
  - 对于需要在页面上下文执行的操作（播放/暂停、录制、抓帧），通过 `chrome.scripting.executeScript` 注入函数；
  - 对于需要内容脚本参与的操作（如音频扫描），通过 `chrome.tabs.sendMessage` / `chrome.runtime.sendMessage` 发送请求。
3. `content_script.js`：
  - 在页面加载时识别站点并抽取基础 PageInfo，必要时通过 `CONTENT_SITE_INFO` 消息发送给 `background.js` 缓存；
  - 收到来自侧边栏的消息后进行 DOM 扫描（如音频列表）、视频控制等，并将结果/状态通过 `sendResponse` 返回。
4. `background.js`：
  - 监听 `runtime.onMessage`，处理站点信息更新、配置读取/保存等；
  - 维护每个标签页与站点的对应关系，并在需要时供侧边栏或内容脚本查询。
5. 配置与状态：
  - 配置（Settings）主要由侧边栏读取/修改，存储在 `chrome.storage.local`；
  - 站点信息和部分缓存由 `background.js` 维护，以减少重复解析开销。

## 6. 未来数据与消息流（规划简述）
- 在不影响现有 JS 功能的前提下，后续会：
  - 为 `message.type` 引入枚举与结构化请求/响应对象，用类型或 JSDoc 约束消息字段；
  - 将“站点定义”“PageInfo”“媒体条目”等数据结构抽象为可复用的接口/类型；
  - 引入更清晰的“消息客户端”和“消息路由器”角色，避免在各文件中散落的 `sendMessage`/`onMessage` 调用。
- Publish time may be locale-dependent -> consider ISO normalization.
- Video recording pipeline incomplete -> evaluate feasibility or postpone.
