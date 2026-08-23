#!/usr/bin/env python3
"""发布「Listing精造师」智能体到 RAGFlow（可重复执行）。

流程：新建/复用数据集 → 上传五份知识库文档 → 解析 → 克隆选品分析师 DSL 改写为新智能体 → 创建/更新 → 尝试发布。
用法：python3 tools/publish-listing-agent.py
"""
import base64
import json
import time
import urllib.error
import urllib.request
import uuid

BASE = 'http://114.55.149.192:8090'
KEY = 'ragflow-QSmWWnQG96rLlX-_tpHKT6hKSQ_j-85vyY4s7OMXNTA'
ANALYST_ID = '8563cdb690e611f1b36bf39ef484774d'
DS_NAME = 'Listing精造师知识库'
AGENT_TITLE = 'Listing精造师'
LLM = 'qwen3-max-2026-01-23@Qwen@Tongyi-Qianwen'
DOCS = [
    'docs/Listing精造师方法论.md',
    'docs/Listing精造师-平台规则库.md',
    'docs/Listing精造师-术语库.md',
    'docs/Listing精造师-关键词库.md',
    'docs/Listing精造师-高分样例库.md',
]
PROLOGUE = '你好！我是「Listing精造师」。请提供中文商品素材（或1688链接），并告诉我目标平台与站点语言（默认 Amazon US）。我将输出母语级 Listing 包：标题/要点/描述/搜索词 + 自检表 + 发布结论。'
USER_TMPL = ('用户问题：{sys.query}\n\n知识库检索结果：\n{Retrieval:KnowledgeBase@content}\n\n'
             '严格按系统提示词的六阶段流程与输出格式作答：事实卡→关键词策略→中文底稿→各语言版本→自检表→三种结论。'
             '素材不足时列「需补充字段」，禁止编造。')


def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
                                 headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()[:500]
        try:
            return json.loads(raw)
        except Exception:
            return {'code': e.code, 'message': raw}


def upload_file(ds_id, name, data):
    boundary = '----yd' + uuid.uuid4().hex
    crlf = b'\r\n'
    body = (b'--' + boundary.encode() + crlf +
            b'Content-Disposition: form-data; name="file"; filename="' + name.encode() + b'"' + crlf +
            b'Content-Type: text/markdown' + crlf + crlf +
            data + crlf +
            b'--' + boundary.encode() + b'--' + crlf)
    req = urllib.request.Request(BASE + f'/api/v1/datasets/{ds_id}/documents', method='POST', data=body,
                                 headers={'Authorization': 'Bearer ' + KEY,
                                          'Content-Type': f'multipart/form-data; boundary={boundary}'})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {'code': e.code, 'message': e.read().decode()[:300]}


def main():
    prompt = open('docs/Listing精造师-智能体提示词.md', encoding='utf-8').read()
    prompt = prompt.split('## 提示词正文', 1)[1].strip()

    # 1. 数据集（复用同名）
    ds_list = api('GET', '/api/v1/datasets?page=1&page_size=50').get('data', [])
    ds = next((d for d in ds_list if d['name'] == DS_NAME), None)
    if not ds:
        r = api('POST', '/api/v1/datasets', {'name': DS_NAME, 'chunk_method': 'naive',
                                             'embedding_model': 'text-embedding-v4@Qwen@Tongyi-Qianwen', 'permission': 'me'})
        print('create dataset:', r.get('code'), r.get('message'))
        ds_list = api('GET', '/api/v1/datasets?page=1&page_size=50').get('data', [])
        ds = next(d for d in ds_list if d['name'] == DS_NAME)
    ds_id = ds['id']
    print('dataset:', ds_id)

    # 2. 上传文档（同名先删）
    existing = api('GET', f'/api/v1/datasets/{ds_id}/documents?page=1&page_size=50').get('data', {}).get('docs', [])
    for name in [e['name'] for e in existing if e['name'] in [d.split('/')[-1] for d in DOCS]]:
        doc = next(e for e in existing if e['name'] == name)
        api('DELETE', f'/api/v1/datasets/{ds_id}/documents', {'ids': [doc['id']]})
    for path in DOCS:
        r = upload_file(ds_id, path.split('/')[-1], open(path, 'rb').read())
        print('upload', path.split('/')[-1], r.get('code'), r.get('message'))
    docs = api('GET', f'/api/v1/datasets/{ds_id}/documents?page=1&page_size=50').get('data', {}).get('docs', [])
    ids = [d['id'] for d in docs]

    # 3. 解析并轮询
    api('POST', f'/api/v1/datasets/{ds_id}/chunks', {'document_ids': ids})
    for _ in range(60):
        docs = api('GET', f'/api/v1/datasets/{ds_id}/documents?page=1&page_size=50').get('data', {}).get('docs', [])
        runs = [(d['name'], d.get('run')) for d in docs]
        if runs and all(r[1] in ('DONE', 'CANCEL', 'FAIL') for r in runs):
            print('parse:', runs)
            break
        time.sleep(5)

    # 4. 克隆 DSL 改写
    dsl = api('GET', f'/api/v1/agents/{ANALYST_ID}').get('data', {}).get('dsl')
    comps = dsl['components']
    del comps['Agent:FetchProduct']
    agent = comps.pop('Agent:Analyst')
    comps['Agent:Craftsman'] = agent
    p = agent['obj']['params']
    p.update({'sys_prompt': prompt, 'temperature': 0, 'temperatureEnabled': True, 'max_tokens': 16000,
              'mcp': [], 'tools': [], 'prompts': [{'content': USER_TMPL, 'role': 'user'}], 'user_prompt': ''})
    # 拓扑对齐选品分析师：主链 开始→Agent→回答（画布可见），检索作旁路分支
    # （v0.26.4 画布不渲染连到 knowledgeBaseNode 的边，检索串主链会显得“开始”断联）
    agent['upstream'] = ['begin', 'Retrieval:KnowledgeBase']
    agent['downstream'] = ['Message:Answer']
    comps['begin']['downstream'] = ['Retrieval:KnowledgeBase', 'Agent:Craftsman']
    comps['begin']['obj']['params']['prologue'] = PROLOGUE
    comps['Retrieval:KnowledgeBase']['upstream'] = ['begin']
    comps['Retrieval:KnowledgeBase']['downstream'] = ['Agent:Craftsman']
    comps['Retrieval:KnowledgeBase']['obj']['params']['kb_ids'] = [ds_id]
    comps['Message:Answer']['upstream'] = ['Agent:Craftsman']
    # graph 重写
    g = dsl['graph']
    g['nodes'] = [n for n in g['nodes'] if n['id'] != 'Agent:FetchProduct']
    for n in g['nodes']:
        if n['id'] == 'Agent:Analyst':
            n['id'] = 'Agent:Craftsman'
            n['data']['name'] = 'Agent:Craftsman'
            n['data']['label'] = 'Agent'
            n['data']['form'] = p
        if n['id'] == 'begin':
            n['data']['form']['prologue'] = PROLOGUE
        if n['id'] == 'Retrieval:KnowledgeBase':
            n['data']['form']['kb_ids'] = [ds_id]
    def edge(s, t):
        return {'data': {'isHovered': False}, 'id': f'xy-edge__{s}start-{t}end', 'source': s,
                'sourceHandle': 'start', 'target': t, 'targetHandle': 'end'}
    g['edges'] = [edge('begin', 'Retrieval:KnowledgeBase'), edge('begin', 'Agent:Craftsman'),
                  edge('Retrieval:KnowledgeBase', 'Agent:Craftsman'),
                  edge('Agent:Craftsman', 'Message:Answer')]
    # 全局改名：清理 Message 等组件内对旧组件名的引用（如 {Agent:Analyst@content}）
    dsl = json.loads(json.dumps(dsl).replace('Agent:Analyst', 'Agent:Craftsman'))
    # v0.26.4 运行时按 component_name+"Param" 导入组件类，必须英文内部类名（issue #9398）
    canon = {'begin': 'Begin', 'Retrieval': 'Retrieval', 'Agent': 'Agent', 'Message': 'Message'}
    for k, c in dsl['components'].items():
        c['obj']['component_name'] = canon.get(k.split(':')[0], c['obj']['component_name'])

    # 5. 创建/更新智能体
    agents = api('GET', '/api/v1/agents').get('data', {}).get('canvas', [])
    mine = next((a for a in agents if a['title'] == AGENT_TITLE), None)
    desc = '中文商品素材 × 多平台多语言母语级 Listing：标题/要点/描述/搜索词，术语强制命中、合规硬门禁、三种发布结论。'
    if mine:
        r = api('PUT', f"/api/v1/agents/{mine['id']}", {'title': AGENT_TITLE, 'description': desc, 'dsl': dsl})
        agent_id = mine['id']
    else:
        r = api('POST', '/api/v1/agents', {'title': AGENT_TITLE, 'description': desc, 'dsl': dsl})
        print('create agent:', r.get('code'), r.get('message'))
        agents = api('GET', '/api/v1/agents').get('data', {}).get('canvas', [])
        mine = next((a for a in agents if a['title'] == AGENT_TITLE), None)
        agent_id = mine['id'] if mine else r.get('data', {}).get('id')
    print('agent:', agent_id, 'update/create code:', r.get('code'), r.get('message'))

    # 6. 会话冒烟测试（chat 接口不依赖 release 状态）
    r = api('POST', '/api/v1/agents/chat/completions',
            {'agent_id': agent_id, 'openai-compatible': True, 'stream': False,
             'messages': [{'role': 'user', 'content': '冒烟测试：请只回复「Listing精造师就绪」五个字。'}]})
    print('chat smoke:', r.get('code'), str(r)[:300])
    smoke_content = r.get('choices', [{}])[0].get('message', {}).get('content', '')
    if '**ERROR**' in smoke_content or "Can't import" in smoke_content:
        raise SystemExit('SMOKE FAILED: ' + smoke_content[:200])
    print('DONE agent_id=', agent_id, 'dataset_id=', ds_id)


if __name__ == '__main__':
    main()
