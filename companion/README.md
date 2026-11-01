# MediaPlus 极速下载伴生程序（可选增强）

把本地 [yt-dlp](https://github.com/yt-dlp/yt-dlp)（支持 1700+ 网站）作为扩展的
「外挂下载引擎」：开启后，直链类下载任务会优先派发给它，失败自动回退扩展内置链路。
默认关闭、不安装完全不影响扩展使用。

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
