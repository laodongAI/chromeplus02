# Chrome API 使用说明

## 1. 权限
- `tabs`：查询活动标签页、可视截图。
- `scripting`：向页面注入函数并在页面上下文执行。
- `sidePanel`：侧边栏宿主。
- `downloads`：文件下载与进度监听。
- `storage`：设置项持久化。
- `host_permissions`：目标站点域名（尽量最小化）。

## 2. 关键 API 用法
- 注入执行
```js
await chrome.scripting.executeScript({ target: { tabId }, func: yourFunction });
```
- 消息传递
```js
chrome.tabs.sendMessage(tabId, { type: 'REQUEST_AUDIO_LIST' }, cb);
```
- 下载
```js
chrome.downloads.download({ url, filename, saveAs: true });
chrome.downloads.onChanged.addListener(delta => { /* 进度更新 */ });
```
- 可视截图
```js
const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
```
- 存储
```js
chrome.storage.local.get('config', r => r.config);
chrome.storage.local.set({ config });
```

## 3. 兼容性与限制
- `captureStream()` 受站点与 DRM 影响；若不可用，提示并降级。
- `canvas.toDataURL` 受跨域图片污染限制（tainted canvas）。# Chrome API Usage (Current vs Target)

## Current Usage Inventory
| API | Where | Purpose | Notes |
|-----|-------|---------|-------|
| chrome.tabs | background.js / sidepanel.js | Query active tabs, track updates, injection targets | Duplicate logic for active tab resolution |
| chrome.runtime | background.js / content_script.js / sidepanel.js | Message passing | Unstructured `message.type` strings |
| chrome.scripting | background.js / sidepanel.js | Inject scripts (utils.js, inline functions) | Inline function injection hides errors |
| chrome.storage.local | background.js / utils.js / sidepanel.js | Persist config, last tab IDs, MCP status | Keys not namespaced |
| sidePanel manifest | manifest.json | Provide sidepanel UI | Static default_path only |
| fetch (Moonshot/OpenAI) | background.js | Proxy AI requests | No provider abstraction |
| fetch (MCP) | mcp_init.js | Filesystem operations | No retries/backoff |

## Host Permissions Mapping
| Host | Functionality | Still Needed? | Action |
|------|---------------|---------------|--------|
| *.bilibili.com / b23.tv | Video extraction, playback control | Yes | Keep |
| *.douyin.com | Video extraction | Yes | Keep |
| *.youtube.com / youtu.be | Video extraction | Yes | Keep |
| *.zhihu.com | Answer / video extraction (partial) | Maybe | Re-confirm scope |
| *.weibo.com | Not yet extracted (placeholder) | Maybe | Implement or remove |
| *.xiaohongshu.com | Not yet extracted (placeholder) | Maybe | Implement or remove |
| api.moonshot.cn | AI analysis | Yes | Keep |
| api.openai.com | Optional provider | Optional | Toggle by config |
| localhost:51512 | MCP service | Yes (dev) | Optionally dev-only flag |

## 3. 兼容性与限制
- `captureStream()` 受站点与 DRM 影响；若不可用，提示并降级。
- `canvas.toDataURL` 受跨域图片污染限制（tainted canvas）。

## 4. 目前实际使用情况
- `chrome.tabs`：主要在 `background.js`、`sidepanel.js` 中使用，用于查询当前活动标签页、跟踪标签页更新，以及作为注入脚本的目标。
- `chrome.runtime`：在 `background.js`、`content_script.js`、`sidepanel.js` 中用于消息传递，目前仍以简单 `message.type` 字符串协议为主（后续会逐步类型化）。
- `chrome.scripting`：在 `background.js`、`sidepanel.js` 中用于注入函数到页面上下文执行，后续会尽量收敛为少数统一入口，减少零散注入。
- `chrome.storage.local`：在 `background.js`、`utils.js`、`sidepanel.js` 中持久化配置、站点信息与 MCP 状态等，后续会逐步统一 Key 命名。
- `sidePanel`（manifest）：在 `manifest.json` 中声明侧边栏入口，当前采用静态 `default_path`，未来 Vue 迁移后仍沿用此入口。
- `chrome.downloads`：目前在 `sidepanel.js` 中直接用于触发下载，后续可以在 `background.js` 中集中监听进度并反馈给侧边栏。

## 5. 权限与域名映射（当前）
- B 站 / b23.tv：用于视频识别、播放控制与录制。
- 抖音：用于视频识别与录制。
- YouTube / youtu.be：用于视频识别、播放控制与录制。
- 知乎：用于图文页面的视频/图片识别（部分实现）。
- 微博 / 小红书：目前主要作为占位，后续视情况补充适配或收缩权限。
- AI 与 MCP 相关域名：用于可选的 AI 分析与本地 MCP 文件保存能力，当前在业务上不是主路径，可根据需要开启/关闭。

## 6. 后续优化方向（API 层面）
- 封装常用 API：在未来 TypeScript 迁移阶段，将 `tabs/runtime/storage/downloads` 等常用调用封装成服务层，统一错误处理与日志输出。
- 最小权限与审计：结合 `docs/security.md`，定期检查 `manifest.json` 中的权限与域名列表，移除未使用的条目，减少审核风险。
- 统一消息协议：为 `chrome.runtime.sendMessage` 定义枚举与结构化请求/响应，避免魔法字符串与协议漂移。
  ACTIVE_SITE_TABS: 'activeSiteTabs',
