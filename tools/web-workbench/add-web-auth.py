#!/usr/bin/env python3
"""给 /web/api/agents/ 加登录门禁：auth_request 子请求复用后端 /api/auth/me。幂等。"""
import sys

CONF = '/etc/nginx/conf.d/yandu.conf'

with open(CONF, encoding='utf-8') as f:
    src = f.read()

if '_auth_verify' in src:
    print('already configured, skip')
    sys.exit(0)

# 1) 智能体 API location 内加 auth_request
anchor1 = '        limit_req zone=webchat burst=8 nodelay;'
if anchor1 not in src:
    print('limit_req anchor not found', file=sys.stderr)
    sys.exit(1)
src = src.replace(anchor1, anchor1 + '\n        auth_request /_auth_verify;', 1)

# 2) 内部鉴权子请求 location（透传 Authorization，后端 JWT 中间件校验）
anchor2 = '    # AI员工 Web 工作台：RAGFlow 智能体 API 反代'
verify_block = '''    # Web 工作台鉴权子请求：复用后端 JWT 校验（未登录 401）
    location = /_auth_verify {
        internal;
        proxy_pass http://127.0.0.1:8787/api/auth/me;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Authorization $http_authorization;
    }

'''
if anchor2 not in src:
    print('proxy anchor not found', file=sys.stderr)
    sys.exit(1)
src = src.replace(anchor2, verify_block + anchor2, 1)

with open(CONF, 'w', encoding='utf-8') as f:
    f.write(src)
print('patched OK')
