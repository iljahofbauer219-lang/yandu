#!/usr/bin/env python3
"""修复 RAGFlow v0.26.4 运行时兼容：归一智能体 DSL 的 obj.component_name。

背景：v0.26.4 运行时按 component_class(obj.component_name + "Param") 动态导入组件类
（见 ragflow issue #9398），component_name 必须为英文内部类名（Begin/Retrieval/Agent/Message）。
旧版中文界面写入的中文显示名（知识库检索/抓取商品页/回答/…）会导致
"**ERROR**: Can't import XXParam"。本脚本按组件 key 前缀归一并回写，随后冒烟断言。

用法：python3 tools/repair-agent-component-names.py
"""
import json
import sys
import urllib.request

BASE = 'http://114.55.149.192:8090'
KEY = 'ragflow-QSmWWnQG96rLlX-_tpHKT6hKSQ_j-85vyY4s7OMXNTA'
AGENTS = {
    'Listing精造师': 'a80d0348932d11f1b36bf39ef484774d',
    '选品分析师': '8563cdb690e611f1b36bf39ef484774d',
}
CANON = {'begin': 'Begin', 'Retrieval': 'Retrieval', 'Agent': 'Agent', 'Message': 'Message'}


def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
                                 headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'},
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read().decode())


def smoke(agent_id):
    r = api('POST', '/api/v1/agents/chat/completions',
            {'agent_id': agent_id, 'openai-compatible': True, 'stream': False,
             'messages': [{'role': 'user', 'content': '冒烟测试：请只回复「就绪」两个字。'}]})
    if r.get('code') not in (0, None):
        return False, str(r)[:300]
    content = r.get('choices', [{}])[0].get('message', {}).get('content', '')
    return ('**ERROR**' not in content and 'Can\'t import' not in content), content[:200]


def main():
    failed = []
    for title, aid in AGENTS.items():
        data = api('GET', f'/api/v1/agents/{aid}').get('data', {})
        dsl = data.get('dsl')
        changed = []
        for key, comp in dsl['components'].items():
            canon = CANON.get(key.split(':')[0])
            if canon and comp.get('obj', {}).get('component_name') != canon:
                changed.append((key, comp['obj'].get('component_name'), canon))
                comp['obj']['component_name'] = canon
        if changed:
            body = {'dsl': dsl}
            if data.get('title'):
                body['title'] = data['title']
            r = api('PUT', f'/api/v1/agents/{aid}', body)
            print(f'[{title}] normalize {len(changed)} comps:', changed, '-> put code:', r.get('code'))
        else:
            print(f'[{title}] component_name already canonical')
        ok, detail = smoke(aid)
        print(f'[{title}] smoke {"PASS" if ok else "FAIL"}:', detail)
        if not ok:
            failed.append(title)
    if failed:
        print('REPAIR FAILED:', failed)
        sys.exit(1)
    print('REPAIR ALL PASS')


if __name__ == '__main__':
    main()
