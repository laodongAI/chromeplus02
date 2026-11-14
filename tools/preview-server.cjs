/**
 * MediaPlus 侧栏 UI 远程预览服务（仅用于界面预览，不是真正的扩展运行环境）。
 *
 * 背景：Chrome 152 已禁用 `--load-extension` 命令行加载未打包扩展，无法自动化装载扩展；
 * 因此这里把构建产物 dist-preview 用普通 HTTP 服务暴露出来，并在页面里注入一份
 * chrome.* API 桩（chrome-stub.js），让 Vue 侧栏在没有扩展宿主的浏览器里也能完整渲染。
 *
 * 用法：node tools/preview-server.cjs [端口]
 * 默认端口 8898，监听 0.0.0.0，同网段设备可用 http://<本机IP>:8898 访问。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

/** 预览产物根目录（vite build --outDir dist-preview 的输出） */
const ROOT = path.resolve(__dirname, '..', 'dist-preview');
/** 侧栏入口页面（相对 ROOT 的路径） */
const ENTRY = 'src/sidepanel/index.html';
/** 监听端口：命令行参数优先 */
const PORT = Number(process.argv[2]) || 8898;

/**
 * 日志输出（带级别与时间戳）。
 * @param {'info'|'warn'|'error'|'debug'} level 日志级别
 * @param {...any} args 日志内容
 */
function log(level, ...args) {
  const ts = new Date().toISOString().slice(11, 19);
  const tag = { info: 'INFO ', warn: 'WARN ', error: 'ERROR', debug: 'DEBUG' }[level] || 'INFO ';
  console[level === 'debug' ? 'log' : level](`[${ts}] [${tag}] [preview]`, ...args);
}

/** MIME 类型映射（预览只需要覆盖构建产物里出现的类型） */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * 读取 chrome API 桩脚本内容（与 HTML 注入的路径对应）。
 * @returns {string} 桩脚本源码
 */
function readStub() {
  const p = path.join(__dirname, 'chrome-stub.js');
  return fs.readFileSync(p, 'utf8').toString();
}

/**
 * 把桩脚本注入侧栏 HTML：插到 </head> 之前，确保先于模块脚本执行。
 * @param {string} html 原 HTML
 * @returns {string} 注入后的 HTML
 */
function injectStub(html) {
  if (html.includes('/chrome-stub.js')) return html;
  return html.replace('</head>', '  <script src="/chrome-stub.js"></script>\n  </head>');
}

/**
 * 统一发送文本/二进制响应。
 * @param {http.ServerResponse} res 响应对象
 * @param {number} status HTTP 状态码
 * @param {string} type Content-Type
 * @param {Buffer|string} body 响应体
 */
function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    log('debug', `${req.method} ${urlPath}`);

    // 1) 桩脚本
    if (urlPath === '/chrome-stub.js') {
      send(res, 200, MIME['.js'], readStub());
      return;
    }

    // 2) 根路径与 /sidepanel 都指向侧栏入口，并注入桩脚本
    if (urlPath === '/' || urlPath === '/sidepanel' || urlPath === '/sidepanel/') {
      const file = path.join(ROOT, ENTRY);
      const html = injectStub(fs.readFileSync(file, 'utf8'));
      send(res, 200, MIME['.html'], html);
      return;
    }

    // 3) 静态资源：限制在 ROOT 目录内，防止路径穿越
    const safeRel = path.normalize(urlPath).replace(/^([/\\])+/, '');
    const file = path.join(ROOT, safeRel);
    if (!file.startsWith(ROOT)) {
      send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
      return;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      send(res, 404, 'text/plain; charset=utf-8', `Not Found: ${urlPath}`);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    send(res, 200, MIME[ext] || 'application/octet-stream', fs.readFileSync(file));
  } catch (e) {
    log('error', '处理请求失败', e);
    send(res, 500, 'text/plain; charset=utf-8', 'Internal Error: ' + (e && e.message ? e.message : e));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    }
  }
  log('info', `预览服务已启动，产物目录: ${ROOT}`);
  log('info', `本机访问:   http://localhost:${PORT}/`);
  ips.forEach((ip) => log('info', `局域网访问: http://${ip}:${PORT}/`));
  log('warn', '这是 UI 预览（chrome API 为桩实现），不代表真实扩展的数据抓取能力');
});
