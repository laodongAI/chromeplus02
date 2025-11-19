/**
 * 构建后处理：拷贝旧版运行所需资源�?dist，保证功能不回退�?
 * 说明：待 TS 版本功能完成后，将切�?manifest 指向 dist 产物并移除旧文件�?
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const dist = path.join(root, 'dist');
const viteSidepanelHtml = path.join(dist, 'src', 'sidepanel', 'index.html');
const viteSidepanelJs = path.join(dist, 'js', 'sidepanel.js');
const viteBackgroundJs = path.join(dist, 'js', 'background.js');
const viteContentJs = path.join(dist, 'js', 'content.js');
const viteSrcDir = path.join(dist, 'src');
const legacyDir = path.join(root, 'old');

/** 拷贝文件 */
function copyFile(rel) {
  const src = path.join(root, rel);
  const dst = path.join(dist, rel);
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('copied', rel);
}

function copyLegacyFile(rel) {
  const src = path.join(legacyDir, rel);
  const dst = path.join(dist, rel);
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('copied legacy', rel);
}

/** 拷贝目录 */
function copyDir(rel) {
  const src = path.join(root, rel);
  const dst = path.join(dist, rel);
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(rel, f);
    const sp = path.join(root, s);
    const dp = path.join(dist, s);
    if (fs.statSync(sp).isDirectory()) {
      copyDir(s);
    } else {
      fs.mkdirSync(path.dirname(dp), { recursive: true });
      fs.copyFileSync(sp, dp);
    }
  }
  console.log('copied dir', rel);
}

function safeCopy(srcAbs, relTarget) {
  if (!fs.existsSync(srcAbs)) {
    console.warn('[postbuild] skip copy, missing', srcAbs);
    return;
  }
  const target = path.join(dist, relTarget);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(srcAbs, target);
  console.log('copied build output ->', relTarget);
}

/** 删除 Vite 残留目录，避免打包结果混�?*/
function removeLeftover(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: true });
  const rel = path.relative(dist, targetPath) || targetPath;
  console.log('removed leftover', rel);
}

// 保留 manifest / utils / config / styles 等静态文�?
copyFile('manifest.json');
['utils.js', 'config.js', 'styles.css'].forEach(copyLegacyFile);
copyDir('icons');

// �?Vite 产物复制�?Chrome 需要的文件�?
safeCopy(viteSidepanelHtml, 'sidepanel.html');
safeCopy(viteSidepanelJs, 'sidepanel.js');
safeCopy(viteBackgroundJs, 'background.js');
safeCopy(viteContentJs, 'content_script.js');
patchChunkImports('background.js');
patchChunkImports('content_script.js');
inlineChunkForContentScript('content_script.js');
guardContentScriptOnce('content_script.js');

// 清理 Vite 原始输出，避�?dist/src 文件夹残�?
removeLeftover(viteSrcDir);

console.log('postbuild done.');

function patchChunkImports(relFile) {
  const abs = path.join(dist, relFile);
  if (!fs.existsSync(abs)) return;
  const code = fs.readFileSync(abs, 'utf8');
  const pattern = /from(["'])\.\/(index-[^"']+)\1/g;
  const dynPattern = /import\((["'])\.\/(index-[^"']+)\1\)/g;
  let updated = code.replace(pattern, (_match, quote, chunk) => `from${quote}./js/${chunk}${quote}`);
  updated = updated.replace(dynPattern, (_match, quote, chunk) => `import(${quote}./js/${chunk}${quote})`);
  if (updated !== code) {
    fs.writeFileSync(abs, updated, 'utf8');
    console.log('patched chunk specifiers ->', relFile);
  }
}

function inlineChunkForContentScript(relFile) {
  const abs = path.join(dist, relFile);
  if (!fs.existsSync(abs)) return;
  const code = fs.readFileSync(abs, 'utf8');
  const importRegex = /import\s*\{\s*M\s+as\s+([A-Za-z0-9_$]+)\s*\}\s*from\s*(["'])\.\/js\/(index-[^"']+)\2;?/;
  const match = code.match(importRegex);
  if (!match) return;
  const alias = match[1];
  const chunkFile = match[3];
  const chunkPath = path.join(dist, 'js', chunkFile);
  if (!fs.existsSync(chunkPath)) {
    console.warn('[postbuild] missing chunk for inline content script:', chunkFile);
    return;
  }
  const chunkRaw = fs.readFileSync(chunkPath, 'utf8');
  const exportPattern = /export\s*\{\s*([A-Za-z0-9_$]+)\s+as\s+[A-Za-z0-9_$]+\s*\};?/;
  const exportMatch = chunkRaw.match(exportPattern);
  const exportedSymbol = exportMatch ? exportMatch[1] : null;
  const sanitizedChunk = chunkRaw.replace(exportPattern, '').trim();
  const returnExpr = exportedSymbol || 'undefined';
  const inlineBlock = `globalThis.__EXT_INLINE_M__ = globalThis.__EXT_INLINE_M__ || (() => {\n${sanitizedChunk}\nreturn ${returnExpr};\n})();\nvar ${alias} = globalThis.__EXT_INLINE_M__;`;
  const updated = code.replace(importRegex, inlineBlock);
  fs.writeFileSync(abs, updated, 'utf8');
  console.log('inlined chunk for content script ->', relFile);
}

function guardContentScriptOnce(relFile) {
  const abs = path.join(dist, relFile);
  if (!fs.existsSync(abs)) return;
  const code = fs.readFileSync(abs, 'utf8');
  if (/__EXT_CONTENT_GUARD__/.test(code)) {
    return; // already guarded
  }
  const wrapped = `if (!globalThis.__EXT_CONTENT_GUARD__) {\n  globalThis.__EXT_CONTENT_GUARD__ = 1;\n  (function() {\n${code}\n  })();\n}\n`;
  fs.writeFileSync(abs, wrapped, 'utf8');
  console.log('added once-guard for content script ->', relFile);
}

// legacy override removed now that Vite content script is stable
