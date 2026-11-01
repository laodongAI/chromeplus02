# Sources功能的技术限制说明

## 核心问题

根据实际测试和Chrome Debugger API的返回数据，我们发现了一个**关键限制**：

### DevTools Sources面板的虚拟分组

Chrome DevTools 的 Sources 面板显示的结构如：
```
Page
├── top
│   └── app.base44.com
├── preview-sandbox--xxx
│   ├── @vite
│   │   └── src/
│   └── node_modules/
```

**但是**，`Page.getResourceTree` API 返回的实际数据是：
```json
{
  "frameTree": {
    "frame": { "url": "https://app.base44.com/..." },
    "resources": [ 所有HTTP加载的资源 ],
    "childFrames": [ 只有真实的iframe，没有preview-sandbox ]
  }
}
```

## 关键发现

1. **`preview-sandbox` 不是真实的 iframe**
   - 它是 DevTools 内部的虚拟分组
   - 用于显示沙箱环境、扩展、Service Worker等
   - **Chrome Debugger API 无法访问这个虚拟分组**

2. **`@vite` 是 Vite 的虚拟文件系统**
   - 这些文件不是通过HTTP请求加载的
   - 是通过ES模块动态import加载的
   - 在 `Page.getResourceTree` 中看不到

3. **实际可获取的只有 HTTP 资源**
   - vendors.js
   - main.js  
   - vendors.css
   - main.css
   - 图片、字体等静态资源

## Chrome Debugger API 的限制

### 可以获取的
- ✅ 通过HTTP/HTTPS加载的资源
- ✅ 真实iframe的内容
- ✅ 资源的Content-Type、大小等元数据

### 无法获取的
- ❌ DevTools的虚拟分组（preview-sandbox等）
- ❌ Vite的虚拟文件系统（@vite模块）
- ❌ 浏览器扩展的资源
- ❌ Service Worker的资源
- ❌ ES模块的源代码（未打包前的）

## 替代方案

### 方案1：使用 Performance API（当前实现）
```javascript
performance.getEntriesByType('resource')
```
- ✅ 可以获取所有加载的资源URL
- ❌ 无法获取文件内容
- ❌ 无法获取源代码结构

### 方案2：Vite特定方案
如果目标是Vite开发环境，可以：
```javascript
// 直接访问Vite的模块图
const modules = import.meta.glob('/src/**/*');
```
- ✅ 可以获取所有源文件
- ❌ 只适用于Vite项目
- ❌ 需要在页面代码中预先配置

### 方案3：让用户手动操作
提供工具让用户：
1. 打开DevTools
2. 手动导航到想要的目录
3. 复制文件列表
4. 粘贴到扩展中下载

## 当前实现的折中方案

### 我们能做的
1. **扫描所有HTTP加载的资源**
   - 使用 Performance API
   - 获取 script、link 标签
   - 过滤第三方域名

2. **智能过滤**
   - 过滤 Google Analytics、Facebook等
   - 只保留localhost和当前域名
   - 按文件类型分类

3. **保持目录结构**
   - 根据URL路径构建目录树
   - 如 `/static/js/main.js` → `static/js/main.js`

### 我们不能做的
1. 无法访问Vite的源代码（`src/App.jsx`等）
2. 无法访问未打包的模块
3. 无法访问DevTools的虚拟分组

## 给用户的说明

### 对于生产环境
Sources下载功能**可以正常使用**：
- 下载打包后的JS文件（main.js, vendors.js）
- 下载CSS文件
- 下载图片、字体等资源
- 保持目录结构

### 对于开发环境
如果你想下载Vite的**源代码**（`src/` 目录）：

**建议使用传统方法**：
1. 直接从文件系统复制
2. 使用 `git clone` 下载整个仓库
3. 使用 Vite 的构建工具导出

**为什么扩展无法实现**：
- Chrome的安全机制限制
- Debugger API无法访问虚拟文件系统
- DevTools的私有数据结构

## 结论

**Sources下载功能的真实用途**：
- ✅ 下载网站的生产环境资源（已打包的JS/CSS等）
- ✅ 分析网站的文件结构
- ✅ 保存静态资源到本地

**不适用于**：
- ❌ 下载开发环境的源代码
- ❌ 访问Vite/Webpack的模块系统
- ❌ 复制开发中的项目文件

如果你需要下载源代码，建议使用其他工具或方法。
