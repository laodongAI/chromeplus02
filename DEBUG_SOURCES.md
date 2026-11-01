# Sources功能调试指南

## 问题描述

从截图看到，DevTools Sources面板显示：
```
preview-sandbox--xxx/
  @vite/
    node_modules/
    src/
      api/
      components/
      lib/
      pages/
      App.jsx
      ...
```

但扩展只识别出了 `preview-sandbox` 下的 `index.html`，没有识别出 `src` 目录。

## 根本原因

Chrome的 `Page.getResourceTree` API 返回的是**实际加载的HTTP资源**，而不是虚拟文件系统的目录结构。

对于Vite开发服务器：
- `/src/App.jsx` 实际上会被请求为 `http://localhost:5173/src/App.jsx`
- 这是一个HTTP资源，会在 `resources` 数组中
- 但DevTools会将其组织成目录树结构

## 解决方案

### 1. 正确解析资源URL
对于每个资源URL，需要：
```typescript
URL: http://localhost:5173/src/components/App.jsx
解析为路径: ['src', 'components', 'App.jsx']
```

### 2. 构建完整目录树
遍历所有资源，提取路径，构建树：
```
localhost:5173/
  src/
    components/
      App.jsx
    api/
      ...
```

### 3. 处理子frame
`preview-sandbox` 是一个iframe，需要递归处理 `childFrames` 中的资源。

## 调试步骤

### 1. 在控制台查看资源树
```javascript
// 在扩展的background页面执行
chrome.tabs.query({active: true}, async tabs => {
  const tabId = tabs[0].id;
  await chrome.debugger.attach({tabId}, '1.3');
  await chrome.debugger.sendCommand({tabId}, 'Page.enable');
  const result = await chrome.debugger.sendCommand({tabId}, 'Page.getResourceTree');
  console.log('Resource Tree:', result);
  await chrome.debugger.detach({tabId});
});
```

### 2. 查看frame结构
```javascript
console.log('Main frame:', result.frameTree.frame);
console.log('Resources:', result.frameTree.resources.length);
console.log('Child frames:', result.frameTree.childFrames?.length);

// 查看子frame
result.frameTree.childFrames?.forEach((child, i) => {
  console.log(`Child frame ${i}:`, child.frame.name, child.frame.url);
  console.log(`  Resources:`, child.resources?.length);
});
```

### 3. 查看具体资源URL
```javascript
result.frameTree.resources.forEach(r => {
  console.log(r.url, r.type, r.mimeType);
});
```

## 预期输出

正确的实现应该能够：
1. 识别出 `preview-sandbox` frame
2. 从其resources中提取所有 `/src/...` 路径
3. 构建完整的目录树
4. 限制为3级深度

## 测试用例

### 测试1: 本地开发服务器
- URL: `http://localhost:5173`
- 预期: 能看到 `src/` 目录及其子目录

### 测试2: 生产环境
- URL: `https://example.com`
- 预期: 能看到实际的JS/CSS文件路径

### 测试3: 复杂iframe
- 包含多个iframe的页面
- 预期: 能看到所有iframe的资源

## 当前实现

已修改 `buildCompleteTree` 函数：
1. 处理主frame和所有childFrames
2. 正确解析URL路径
3. 递归构建目录结构
4. 自动排序和限制深度

## 下一步

1. 测试扫描功能
2. 查看控制台日志
3. 根据实际输出调整解析逻辑
