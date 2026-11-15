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
// dist 才是实际打包分发的目录：第三方 vendored 副本的许可与署名必须随包走
copyFile('LICENSE');
copyFile('THIRD_PARTY_NOTICES.md');

// 版本统一：以 package.json 为唯一版本源。
// 同时回写「根 manifest.json」与「dist/manifest.json」，
// 使仓库内根 manifest 的版本字段自动跟随 package.json，无需手工双维护。
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  /**
   * 将指定 manifest 文件的 version 同步为 package.json 的版本号。
   * @param {string} manifestPath manifest 文件绝对路径
   * @param {string} label 日志标签（区分根目录/dist 副本）
   */
  function syncManifestVersion(manifestPath, label) {
    if (!fs.existsSync(manifestPath)) return;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.version === pkg.version) return; // 已一致则跳过，避免无谓写盘
    manifest.version = pkg.version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`synced ${label} manifest version ->`, pkg.version);
  }
  syncManifestVersion(path.join(dist, 'manifest.json'), 'dist');
  syncManifestVersion(path.join(root, 'manifest.json'), 'root');
} catch (e) {
  console.warn('version sync failed:', e?.message || e);
}

console.log('Postbuild complete.');
