# MediaPlus 伴生程序（可选增强）

伴生程序为扩展提供三项本机能力，默认关闭、不安装完全不影响扩展使用：

1. **极速下载**：把本地 [yt-dlp](https://github.com/yt-dlp/yt-dlp)（支持 1700+ 网站）
   作为「外挂下载引擎」，直链类下载任务优先派发给它，失败自动回退扩展内置链路。
2. **外挂下载器**：m3u8DL-RE / ffmpeg 经伴生程序在本机执行（aria2 走本机 RPC，
   不需要伴生程序），见下文「外挂下载器」一节。
3. **桌面标注**：在整个桌面上叠加透明画布（见下文「桌面标注」一节），
   配合扩展录屏可在任意应用窗口上画重点。

> 极速下载需要 yt-dlp.exe，外挂下载器需要对应的 exe；桌面标注无需额外文件，安装伴生程序即可用。

## 安装（三步）

1. **下载 yt-dlp.exe**
   从 https://github.com/yt-dlp/yt-dlp/releases/latest 下载 `yt-dlp.exe`，
   放到本目录的 `bin\` 文件夹（没有就新建）：`companion\bin\yt-dlp.exe`

2. **获取扩展 ID**
   打开 `chrome://extensions/`，在 MediaPlus 卡片上复制 ID（32 个小写字母），
   或在扩展「设置」页查看。

3. **运行安装器**
   双击运行：
   ```
   install.bat <扩展ID>
   ```
   例如：`install.bat abcdefghijklmnopqrstuvwxyzabcdef`
   脚本会：复制文件到 `%LOCALAPPDATA%\MediaPlusCompanion` → 生成 host 清单 → 注册当前用户注册表（无需管理员）。

4. 回到扩展「设置 → ⚡极速下载」：打开开关，点击**重新检测**，显示"✓ 在线"即生效。

## 卸载

双击 `uninstall.bat` 即可（删除注册表项与本地目录）。

## 工作原理

```
扩展（设置开启 + 队列派单）
   │ chrome.runtime.connectNative('com.chromeplus02.media')
   ▼
host.bat → host.ps1（4字节长度前缀 + JSON 的 stdio 协议）
   │ 启动 bin\yt-dlp.exe --newline --progress-template ...
   ▼
进度行 [download] xx% → progress 消息回传 → 扩展队列展示进度
完成后 done 消息 → 文件在 Downloads\MediaPlus\
```

- 下载保存到 `下载\MediaPlus\` 目录
- 任务失败/超时会自动回退扩展内置下载链路，不会丢任务
- 与扩展的通信全部走本机 stdio，不上传任何数据

## 外挂下载器（m3u8DL-RE / ffmpeg / aria2）

在扩展「设置 → 外挂下载器」开启。三条通道对伴生程序的依赖不同：

| 工具 | 走什么通道 | 需要伴生程序 |
| --- | --- | --- |
| aria2 | 本机 JSON-RPC（`http://127.0.0.1:6800/jsonrpc`） | 不需要 |
| m3u8DL-RE | Native Messaging（`download_ext`） | 需要 |
| ffmpeg | Native Messaging（`download_ext`） | 需要 |

**放工具**：把可执行文件放进 `companion\bin\`（安装后是 `%LOCALAPPDATA%\MediaPlusCompanion\bin\`）：
`N_m3u8DL-RE.exe`（也认 `m3u8DL-RE.exe` / `m3u8dl.exe`）、`ffmpeg.exe`。
已经用 winget/scoop 装进 PATH 的同名工具也会被认出来，不必重复放。
设置页「外挂下载器」里的**检测**按钮即调用 `tools_probe`，回传三个工具的可用状态。

**aria2 必须放开 Origin 校验**，否则一律 403：

```
aria2c --enable-rpc --rpc-listen-all=false --rpc-origin-whitelist-required=false
```

（或改用 `--rpc-origin-whitelist=chrome-extension://<扩展ID>` 只放行本扩展。）
设了 `--rpc-secret` 的话，把同一个值填进设置页的「RPC 密钥」。

**协议**（stdio，4 字节长度前缀 + JSON）：

```
→ {"type":"tools_probe","reqId":1}
← {"type":"ext_result","reqId":1,"ok":true,"available":{"ytDlp":true,"m3u8dl":true,"ffmpeg":false}}

→ {"type":"download_ext","reqId":2,"tool":"m3u8dl","url":"https://…","fileName":"video","args":["--input-url","…"]}
← {"type":"progress","reqId":2,"pct":0.42}      # m3u8DL-RE 的百分比行；ffmpeg 无进度输出
← {"type":"done","reqId":2,"file":"<下载\\MediaPlus>","tool":"m3u8dl"}
   或 {"type":"error","reqId":2,"message":"m3u8dl 退出码 1：…"}
```

argv 由扩展侧构造，host 只负责转义与 `CreateProcess`（不经过 shell），输出目录固定为
`下载\MediaPlus\`，扩展不能指定任意路径。任一环节失败都会回退扩展内置下载链路，不丢任务。

**参数限制**：含双引号、或「含空白且以反斜杠结尾」的参数会被直接拒绝并回退内置下载。
原因是 ffmpeg（MSVC CRT）与 m3u8DL-RE（.NET，走 `CommandLineToArgvW`）对这两类字符的
解析规则相反，不存在能同时满足两者的转义；宁可回退，也不猜一种转义把下载悄悄写坏。
回归验证：`powershell -File companion\test-argv.ps1`（两套解析器各跑一遍，输出 `ARGV_OK`）。

## 桌面标注（在任意应用窗口上画）

`overlay\overlay.ps1` 会在整个桌面上叠加一层透明画布，可直接在 PPT、播放器、
浏览器之外的任何窗口上画重点，配 Chrome「整屏录制」时笔迹会一起录入视频。

使用方式：
- 安装完 companion 后，在侧栏「录制中」控制栏点 **桌面标注** 开关；或直接双击
  `overlay\start-overlay.bat`。
- 全局快捷键（任何应用在前台都生效）：
  - `Ctrl+Alt+D` 切换 绘制 / 操作（操作模式 = 鼠标点击穿透，可正常使用电脑）
  - `Ctrl+Alt+T` 显示 / 隐藏工具栏（隐藏后录屏画面更干净）
  - `Ctrl+Alt+Z` 撤销上一笔，`Ctrl+Alt+X` 清空，`Ctrl+Alt+Q` 退出
  - 空格：窗口有焦点时同样切换 绘制 / 操作
- 工具：画笔 / 荧光笔 / 橡皮擦 / 文字 / 矩形 / 直线 / 箭头，5 种颜色、粗细 1-12、
  白板/黑板背景；工具栏是自绘的，隐藏后不会出现在录制画面中。
- 录制结束后侧栏会自动关闭标注层；若手动运行过 `start-overlay.bat`，请按
  `Ctrl+Alt+Q` 退出。

> 只有 Windows 支持桌面标注（依赖 WinForms 分层窗口 + GDI+），扩展本身受浏览器
> 沙箱限制，无法在桌面绘制。

## 常见问题

- **重新检测仍显示未检测到**：确认注册表
  `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.chromeplus02.media`
  指向的 json 存在，且 json 中 `allowed_origins` 的扩展 ID 与当前安装一致
  （重新打包/重新加载扩展后 ID 可能变化，需重跑 install.bat）。
- **双击 install.bat 闪退**：先打开 cmd，手动执行并看报错。
- **提示找不到 yt-dlp.exe**：确认放在 `%LOCALAPPDATA%\MediaPlusCompanion\bin\yt-dlp.exe`。
- **宿主是 .bat 的兼容性**：个别 Chrome 版本对 .bat 宿主支持不佳；若始终连不上，
  可把 `host.bat` 的内容改为调用 `powershell.exe -File host.ps1` 的绝对路径方式，
  或参照 yt-dlp-bridge 等项目改用编译型宿主。
- **切勿在 .bat 文件中写中文或改成 LF 换行**：cmd.exe 按 OEM 代码页（GBK）解析
  批处理，UTF-8 中文或 LF 换行会破坏解析、导致宿主启动即崩溃（症状：扩展提示
  "伴生程序未安装或未响应"）。中文说明一律放在本 README 与 .ps1 脚本注释中。
