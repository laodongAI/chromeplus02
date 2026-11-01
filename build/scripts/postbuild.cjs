/**
 * 构建后处理：拷贝 manifest 和 icons 到 dist 目录
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const dist = path.join(root, 'dist');

/** 拷贝文件 */
function copyFile(rel) {
  const src = path.join(root, rel);
  const dst = path.join(dist, rel);
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('copied', rel);
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

// 执行拷贝
copyFile('manifest.json');
copyDir('icons');

// 版本统一：以 package.json 为唯一版本源，同步写入 dist/manifest.json
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const manifestPath = path.join(dist, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.version = pkg.version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log('synced manifest version ->', pkg.version);
  }
} catch (e) {
  console.warn('version sync failed:', e?.message || e);
}

console.log('Postbuild complete.');
