# Sources功能技术说明

## 当前实现方案

### 使用Performance API获取资源

由于Chrome Debugger API的 `Page.getResourceTree` 主要返回HTTP加载的资源，对于Vite开发环境中的虚拟文件系统（如 `@vite/src/...`），我们改用以下方案：

```javascript
// 在页面上下文中执行
const resources = performance.getEntriesByType('resource');
const scripts = Array.from(document.scripts);
const links = Array.from(document.querySelectorAll('link[href]'));
```

这样可以获取所有通过浏览器加载的资源，包括：
- JavaScript文件
- CSS文件
- 图片文件
- 字体文件
- 其他资源

### 路径解析策略

```
完整URL: http://localhost:5173/src/components/App.jsx
解析为:   localhost:5173 / src / components / App.jsx
树结构:   
  page/
    localhost:5173/
      src/
        components/
          App.jsx
```

## DevTools Sources面板结构分析

### Top层级
- 包含所有顶层域名的资源
- 每个域名是一个独立的分组

### 沙箱/Iframe层级
- `preview-sandbox--xxx` - 沙箱环境
- 可能包含虚拟文件系统（如Vite的@vite）

### 文件系统映射
- Vite开发环境会映射本地文件系统
- URL路径通常对应实际文件路径
- 需要正确解析和保持结构

## 实现细节

### 1. 资源获取
```typescript
// 使用Runtime.evaluate在页面上下文执行
const result = await chrome.debugger.sendCommand(
  { tabId },
  'Runtime.evaluate',
  {
    expression: 'performance.getEntriesByType("resource")',
    returnByValue: true
  }
);
```

### 2. 路径构建
```typescript
// 从URL提取路径部分
function extractFullPathParts(url: string): string[] {
  const urlObj = new URL(url);
  const domain = urlObj.hostname + (urlObj.port ? ':' + urlObj.port : '');
  const pathParts = urlObj.pathname.split('/').filter(p => p);
  return [domain, ...pathParts];
}
```

### 3. 树构建
```typescript
// 递归构建目录树
function addResourceToTree(parent, pathParts, resource) {
  const [first, ...rest] = pathParts;
  
  if (rest.length === 0) {
    // 叶子节点（文件）
    parent.children.push({ name: first, type: 'file', url: resource.url });
  } else {
    // 中间节点（目录）
    let dir = parent.children.find(c => c.name === first);
    if (!dir) {
      dir = { name: first, type: 'directory', children: [] };
      parent.children.push(dir);
    }
    addResourceToTree(dir, rest, resource);
  }
}
```

### 4. 深度限制
```typescript
// 限制为3级目录
function limitTreeDepth(nodes, currentDepth, maxDepth = 3) {
  if (currentDepth >= maxDepth) {
    return nodes.map(node => ({ ...node, children: undefined }));
  }
  // 递归处理
}
```

## 下载实现

### 文件内容获取

对于HTTP资源：
```typescript
const response = await fetch(url);
const content = await response.text(); // 或 arrayBuffer()
```

对于Debugger API：
```typescript
const result = await chrome.debugger.sendCommand(
  { tabId },
  'Page.getResourceContent',
  { frameId, url }
);
```

### 目录遍历
```typescript
function getAllFilesInDirectory(node) {
  const files = [];
  if (node.type === 'file') {
    files.push(node);
  } else if (node.children) {
    node.children.forEach(child => {
      files.push(...getAllFilesInDirectory(child));
    });
  }
  return files;
}
```

### 打包下载
```typescript
const zip = new JSZip();
files.forEach(file => {
  zip.file(file.path, file.content);
});
const blob = await zip.generateAsync({ type: 'blob' });
// 触发下载
```

## 限制和注意事项

### Chrome Debugger API限制
1. **单一调试器**：同一时间只能有一个调试器附加
2. **DevTools冲突**：使用时不能同时打开DevTools
3. **权限要求**：需要debugger权限

### 资源访问限制
1. **CORS限制**：某些跨域资源无法下载
2. **虚拟文件**：Vite等工具的虚拟文件需特殊处理
3. **动态资源**：某些动态生成的资源可能无法获取

### 性能考虑
1. **大文件**：超过30秒会超时
2. **文件数量**：建议单次不超过100个
3. **内存限制**：大量文件可能占用大量内存

## 改进方向

### 短期
- [ ] 优化Vite虚拟文件系统识别
- [ ] 改进路径解析逻辑
- [ ] 添加资源类型过滤

### 中期
- [ ] 支持增量下载
- [ ] 添加下载缓存
- [ ] 优化大文件处理

### 长期
- [ ] 支持多种开发服务器
- [ ] 智能识别项目结构
- [ ] 支持源码映射

## 测试建议

1. **常规网站**：测试普通HTML/JS/CSS网站
2. **Vite项目**：测试Vite开发服务器
3. **React/Vue项目**：测试现代前端项目
4. **大型网站**：测试大量资源的情况

## 调试方法

```javascript
// 在控制台查看资源
performance.getEntriesByType('resource').forEach(r => {
  console.log(r.name, r.initiatorType);
});

// 查看所有script标签
Array.from(document.scripts).map(s => s.src);

// 查看所有link标签
Array.from(document.querySelectorAll('link[href]')).map(l => l.href);
```
