# UI/交互设计

## 1. 信息架构（侧边栏）
- 顶部通知条：显示扫描/下载/录制状态与错误提示。
- 资源扫描区：
  - 按钮：扫描视频 / 扫描音频 / 扫描图片 / 一键扫描。
  - 徽标：各类资源识别数量。
- 视频列表：缩略图/分辨率/时长/静音；操作：播放/暂停/切换、录制（开始/停止，实时计时）、抓帧、复制、下载（可用时）；状态徽标需实时反馈“录制中/停止中/失败/完成”。
- 音频列表：标题/来源域；操作：复制、下载；顶部支持全选/批量下载。
- 图片列表：缩略图网格；操作：预览、复制、下载、批量下载。
- 批量操作区：全选/反选、筛选（类型/域名/大小阈值）、下载并发上限与进度条。
- 设置面板：自动扫描开关、命名模板、默认封装/质量、下载并发上限等（storage 持久化）。

## 2. 交互细节
- 扫描：默认“先列出后操作”；设置中可开启“识别后自动下载”（默认关闭）。
- 录制：按钮必须由用户手势触发；开始后显示计时与大小估算；停止后自动下载；错误提示（DRM/CORS/权限）。
- 抓帧：优先在页面内用 `canvas` 导出；失败时提示并引导使用“页面截图”。
- 下载进度：监听 `downloads.onChanged` 更新条目状态（进行中/完成/失败），提供重试/取消。
- 命名模板：输入示例与即时预览；非法字符自动清理；支持变量：`{siteName,title,date,index}`。

## 3. 空/加载/失败态
- 空：展示“尚未扫描，点击上方按钮开始”。
- 加载：列表显示骨架屏或“扫描中…”；按钮防抖与禁用态。
- 失败：具体原因（无权限/DRM/跨域/内容脚本未注入），提供可行替代操作（截图/直链下载/登录后重试/授予站点权限）。

## 5. Recent updates
- Re-introduced the video capture toolbar with play / pause / toggle playback actions plus explicit start / stop recording controls and inline status badges.
- Audio capture now retries message delivery automatically and surfaces a friendly hint when the content script is missing, guiding users to reopen the side panel on supported sites.
- 视频列表在行首增加复选框并提供表头全选，为后续批量操作铺垫交互基础。


## 4. 可访问性与快捷键
- 快捷键建议：空格（播放/暂停）、R（录制开/关）、F（抓帧）、A（全选）。
- 按钮增加 `aria-label` 与状态文本，保证读屏可用。