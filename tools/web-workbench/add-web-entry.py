#!/usr/bin/env python3
"""下载页加 AI员工 Web 工作台入口。幂等。"""
import sys

PATH = '/opt/yandu/download/index.html'

with open(PATH, encoding='utf-8') as f:
    src = f.read()

if 'btn web' in src:
    print('already patched, skip')
    sys.exit(0)

style_anchor = '  .mac { background: #1f2329; color: #fff; }'
style_add = '\n  .web { background: #0abab5; color: #fff; }'
if style_anchor not in src:
    print('style anchor not found', file=sys.stderr)
    sys.exit(1)
src = src.replace(style_anchor, style_anchor + style_add, 1)

btn_anchor = '  <a class="btn win"'
btn_add = '  <a class="btn web" href="/web/">AI员工 Web 工作台（浏览器直接用，无需安装）</a>\n'
if btn_anchor not in src:
    print('btn anchor not found', file=sys.stderr)
    sys.exit(1)
src = src.replace(btn_anchor, btn_add + btn_anchor, 1)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(src)
print('patched OK')
