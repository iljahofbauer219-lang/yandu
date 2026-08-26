#!/usr/bin/env python3
"""给 yandu.conf 增加 Web 工作台配置：限流区域 + /web/ 静态 + API 反代。幂等。"""
import sys

CONF = '/etc/nginx/conf.d/yandu.conf'
ZONE_LINE = 'limit_req_zone $binary_remote_addr zone=webchat:10m rate=20r/m;'

BLOCK = '''
    # AI员工 Web 工作台：静态页
    location /web/ {
        alias /opt/yandu/web/;
    }

    # AI员工 Web 工作台：RAGFlow 智能体 API 反代（Key 留服务端 + 按 IP 限流）
    location /web/api/agents/ {
        limit_req zone=webchat burst=8 nodelay;
        proxy_pass http://127.0.0.1:8090/api/v1/agents/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization "Bearer ragflow-QSmWWnQG96rLlX-_tpHKT6hKSQ_j-85vyY4s7OMXNTA";
        proxy_buffering off;
        proxy_read_timeout 420s;
        proxy_send_timeout 420s;
        client_max_body_size 2m;
    }

'''

with open(CONF, encoding='utf-8') as f:
    src = f.read()

if 'location /web/' in src:
    print('already configured, skip')
    sys.exit(0)

lines = src.splitlines(keepends=True)
if not any(ZONE_LINE in line for line in lines):
    lines.insert(0, ZONE_LINE + '\n')
src = ''.join(lines)

anchor = '    location /download/ {'
if anchor not in src:
    print('anchor not found', file=sys.stderr)
    sys.exit(1)
src = src.replace(anchor, BLOCK + anchor, 1)

with open(CONF, 'w', encoding='utf-8') as f:
    f.write(src)
print('patched OK')
