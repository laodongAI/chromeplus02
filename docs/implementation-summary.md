# 功能实现总结

## 需求1：跨页面录制和下载任务管理

### 实现内容

1. **后台录制任务管理器** (`src/background/recording.ts`)
   - 创建了统一的录制任务管理系统
   - 支持跨页面切换时继续添加新的录制任务
   - 当页面关闭或切换时，自动停止相关录制任务
   - 维护录制任务状态，包括pending、recording、stopping、completed、error等

2. **录制任务生命周期管理**
   - 在background中维护所有录制任务
   - 监听标签页关闭和更新事件，自动清理相关任务
   - 定期清理已完成的任务（保留最近1小时）

3. **跨页面下载任务支持**
   - 下载任务已经在background中管理（`src/background/downloads.ts`）
   - 支持跨页面添加下载任务
   - 下载任务在后台持续执行，不受页面切换影响

### 使用方式

- 用户可以在任何页面启动录制，录制任务会被记录在background中
- 切换到其他页面时，可以继续添加新的录制任务
- 下载任务队列在background中统一管理，可以跨页面添加

## 需求2：Sources面板目录下载功能

### 实现内容

1. **Sources文件扫描** (`src/content-scripts/sources.ts`)
   - 扫描页面中的所有script标签
   - 扫描所有link标签（CSS等）
   - 扫描style标签中的@import
   - 提取文件URL和路径信息

2. **Sources下载管理器** (`src/background/sourcesDownload.ts`)
   - 创建下载任务
   - 并发下载所有选中的文件（最多5个同时）
   - 保持目录结构
   - 使用JSZip打包成zip文件
   - 自动触发下载
   - 超时控制（30秒/文件）
   - 内存管理和自动清理

3. **Sources下载面板** (`src/sidepanel/views/SourcesDownloadPanel.vue`)
   - 提供用户界面
   - 扫描页面资源
   - 选择要下载的文件
   - 显示下载进度
   - 批量下载并打包

### 使用方式

1. 打开侧边栏，切换到"Sources下载"标签
2. 点击"扫描页面资源"按钮
3. 选择要下载的文件（支持多选）
4. 点击"下载选中文件"按钮
5. 系统会自动下载所有文件，保持目录结构，并打包成zip文件下载到本地

### 技术实现

- 使用JSZip库进行文件打包
- 在background中处理下载和打包，避免阻塞UI
- 支持进度显示和错误处理
- 自动清理临时文件
- 并发下载提升性能

## 新增文件

1. `src/background/recording.ts` - 录制任务管理器
2. `src/background/sourcesDownload.ts` - Sources下载管理器
3. `src/content-scripts/sources.ts` - 页面资源扫描
4. `src/sidepanel/views/SourcesDownloadPanel.vue` - Sources下载面板UI

## 修改的文件

1. `src/background/index.ts` - 初始化录制管理器
2. `src/background/messageRouter.ts` - 添加Sources下载消息处理
3. `src/content-scripts/router.ts` - 添加资源扫描消息处理
4. `src/sidepanel/SidePanelApp.vue` - 添加Sources下载标签页

## 依赖

- `jszip` - 用于文件打包
- `@types/jszip` - TypeScript类型定义

## 注意事项

1. 录制功能仍然需要在content script中执行（因为MediaRecorder需要访问DOM）
2. 跨页面录制时，每个页面的录制是独立的，但可以在background中统一管理
3. Sources下载功能扫描的是页面中引用的资源文件，不是DevTools Sources面板中的文件（Chrome扩展无法直接访问DevTools API）
4. 某些资源文件可能因为CORS限制无法下载

## 后续优化建议

1. 添加录制任务的持久化存储
2. 支持录制任务的暂停和恢复
3. 优化Sources扫描，支持更多资源类型
4. 添加文件大小限制和下载超时处理
5. 支持自定义目录结构
