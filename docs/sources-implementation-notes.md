# Sources功能实现说明

## 问题分析

根据DevTools截图，Sources面板的结构是：
```
Page (标签)
├── top (顶层域名分组)
│   ├── accounts.google.com
│   ├── bat.bing.com
│   └── ...
├── preview-sandbox--baf05c1aac7f98c674d... (沙箱环境)
│   ├── @vite (Vite虚拟模块)
│   │   ├── node_modules
│   │   └── src
│   │       ├── api/
│   │       ├── components/
│   │       ├── lib/
│   │       ├── pages/
│   │       ├── App.jsx
│   │       ├── App.jsx
│   │       └── ...
│   └── ...
```

## 关键发现

1. **Page标签结构**：
   - `top` - 顶层框架的域名分组
   - `preview-sandbox--xxx` - 沙箱环境或iframe
   - `@vite` - Vite的虚拟文件系统

2. **实际需求**：
   - 用户想要的是 `preview-sandbox/src` 目录下的代码
   - 这不是普通的HTTP资源，而是Vite开发服务器提供的虚拟文件

3. **Chrome Debugger API的局限**：
   - `Page.getResourceTree` 主要返回HTTP请求的资源
   - Vite虚拟文件系统可能不在这个树中
   - 需要使用其他方法获取

## 解决方案

### 方案1：使用Debugger API获取所有脚本
使用 `Debugger.scriptParsed` 事件获取所有加载的脚本：

```typescript
// 启用Debugger domain
await sendDebuggerCommand(tabId, 'Debugger.enable');

// 获取所有脚本
const scripts = await sendDebuggerCommand(tabId, 'Debugger.getScriptSource', { scriptId });
```

### 方案2：直接从Vite开发服务器获取
如果是Vite开发服务器，可以直接访问：
```
http://localhost:5173/@fs/E:/path/to/project/src/
```

### 方案3：使用Performance API
使用Performance API获取所有加载的资源：

```typescript
const resources = await sendDebuggerCommand(tabId, 'Performance.getMetrics');
```

## 当前实现的问题

1. **只处理HTTP资源**：当前代码只处理通过HTTP加载的资源
2. **没有处理虚拟文件系统**：Vite的 `@vite` 模块是虚拟的
3. **结构不匹配**：实际的DevTools结构比我们解析的复杂

## 改进方案

我将实现一个更完整的解决方案：
1. 使用 `Runtime.evaluate` 在页面中执行脚本
2. 通过 `performance.getEntriesByType('resource')` 获取所有资源
3. 解析URL并构建完整的目录树
4. 支持识别Vite虚拟文件系统

## 实施步骤

1. 修改资源获取方式
2. 支持多种资源来源
3. 优化路径解析逻辑
4. 改进目录树构建
