# 发布打包脚本：dist/ → release/chromeplus02_v{version}.zip
# 使用 Python zipfile（正斜杠条目，Chrome Web Store 兼容）
import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'dist')
version = json.load(open(os.path.join(ROOT, 'package.json'), encoding='utf-8'))['version']
out = os.path.join(ROOT, 'release', f'chromeplus02_v{version}.zip')

os.makedirs(os.path.dirname(out), exist_ok=True)
if os.path.exists(out):
    os.remove(out)

count = 0
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, _, files in os.walk(SRC):
        for f in sorted(files):
            full = os.path.join(root, f)
            rel = os.path.relpath(full, SRC).replace(os.sep, '/')
            z.write(full, rel)
            count += 1

print(f'entries: {count} | size: {round(os.path.getsize(out) / 1024, 1)} KB | -> {out}')

with zipfile.ZipFile(out) as z:
    names = set(z.namelist())
    need = [
        'manifest.json',
        'js/background.js', 'js/content.js', 'js/sidepanel.js', 'js/editor.js',
        'src/sidepanel/index.html', 'src/editor/index.html',
        'icons/icon-16.png', 'icons/icon-48.png', 'icons/icon-128.png',
    ]
    missing = [n for n in need if n not in names]
    backslash = [n for n in names if '\\' in n]
    print('缺失关键文件:', missing if missing else '无')
    print('反斜杠条目:', len(backslash))
    if missing or backslash:
        raise SystemExit(1)
    print('zip 校验通过 ✓')
