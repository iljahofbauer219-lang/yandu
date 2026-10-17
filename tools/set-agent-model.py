#!/usr/bin/env python3
"""切换 RAGFlow 智能体绑定的大模型：只改 llm_id 的模型段，其余 DSL 字段原样回写。

工厂/实例后缀保持不变（如 `@Qwen@Tongyi-Qianwen`），components 与 graph.nodes[].data.form 两处同步。
改前自动备份原 DSL 到 ~/.yandu-agent-backups/，冒烟失败即退出并给出备份路径。

用法：RAGFLOW_API_KEY=... python3 tools/set-agent-model.py --agent <agent_id> --model qwen-max
      RAGFLOW_API_KEY=... python3 tools/set-agent-model.py --list   # 只读，打印各智能体当前绑定
"""
import argparse
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get('RAGFLOW_BASE', 'http://114.55.149.192:8090')
KEY = os.environ.get('RAGFLOW_API_KEY', '')
BACKUP_DIR = pathlib.Path.home() / '.yandu-agent-backups'


def api(method, path, body=None):
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, method=method, data=data,
                                 headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()[:400]
        try:
            return json.loads(raw)
        except Exception:
            return {'code': e.code, 'message': raw}


def swap_model(node, model):
    """node 为含 llm_id 的 params/form 字典，返回旧值（未改动时返回 None）。"""
    old = node.get('llm_id')
    if not isinstance(old, str) or '@' not in old:
        return None
    parts = old.split('@')
    if parts[0] == model:
        return None
    parts[0] = model
    node['llm_id'] = '@'.join(parts)
    return old


def current_bindings(dsl):
    seen = set()
    for comp in (dsl.get('components') or {}).values():
        params = (comp.get('obj') or {}).get('params')
        if isinstance(params, dict) and params.get('llm_id'):
            seen.add(params['llm_id'])
    return seen


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--agent')
    ap.add_argument('--model')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--smoke', default='冒烟测试：请只回复「就绪」两个字。')
    args = ap.parse_args()
    if not KEY:
        sys.exit('缺少 RAGFLOW_API_KEY 环境变量')

    if args.list:
        for item in api('GET', '/api/v1/agents').get('data', {}).get('canvas', []):
            dsl = api('GET', f"/api/v1/agents/{item['id']}").get('data', {}).get('dsl') or {}
            print(item['id'], '|', item.get('title'), '|', sorted(current_bindings(dsl)))
        return

    if not args.agent or not args.model:
        sys.exit('需要 --agent 与 --model（或改用 --list）')

    data = api('GET', f'/api/v1/agents/{args.agent}').get('data') or {}
    dsl, title = data.get('dsl'), data.get('title')
    if not isinstance(dsl, dict) or not title:
        sys.exit(f'读取 DSL 失败：{str(data)[:200]}')

    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup = BACKUP_DIR / f'{args.agent}-{stamp}.dsl.json'
    backup.write_text(json.dumps(dsl, ensure_ascii=False), encoding='utf-8')

    olds = set()
    for comp in (dsl.get('components') or {}).values():
        params = (comp.get('obj') or {}).get('params')
        if isinstance(params, dict):
            olds.add(swap_model(params, args.model))
    for node in (dsl.get('graph') or {}).get('nodes') or []:
        form = (node.get('data') or {}).get('form')
        if isinstance(form, dict):
            olds.add(swap_model(form, args.model))
    olds.discard(None)
    if not olds:
        print(f'已是 {args.model}，无需改动。备份={backup}')
    else:
        r = api('PUT', f'/api/v1/agents/{args.agent}', {'title': title, 'dsl': dsl})
        print(f'PUT {title} {sorted(olds)} -> {args.model} code={r.get("code")} {r.get("message")}')
        if r.get('code') not in (0, None):
            sys.exit(f'PUT 失败，备份={backup}')

    chat = api('POST', '/api/v1/agents/chat/completions',
               {'agent_id': args.agent, 'openai-compatible': True, 'stream': False,
                'messages': [{'role': 'user', 'content': args.smoke}]})
    content = str((chat.get('choices') or [{}])[0].get('message', {}).get('content', ''))
    if not content.strip() or '**ERROR**' in content or "Can't import" in content:
        sys.exit(f'SMOKE FAILED（回复={content[:200]!r}）回滚：python3 - 见备份 {backup}')
    print(f'SMOKE OK 模型={args.model} 回复={content[:40]!r} 备份={backup}')


if __name__ == '__main__':
    main()
