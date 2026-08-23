#!/usr/bin/env python3
"""发布「选品分析师」报告模板 v1.4 到 RAGFlow（可重复执行）。

双源同步：知识库模板文档 + 智能体 sys_prompt（内嵌同一模板）。
本地事实源：docs/选品分析师-报告模板-v1.2.md（内容 v1.4）、docs/选品分析师-智能体提示词.md。
v1.4 要点：删附录（省版面）、证据等级中文化（事实/外部估算/分析假设/未知，禁 F/E/A/U）、
保留 v1.3：dp 链接信任规则、3.3 末行「🔗 商品/品牌链接」、主标题平台一致。
用法：python3 tools/publish-analyst-template.py
"""
import json
import time
import urllib.error
import urllib.request
import uuid

BASE = 'http://114.55.149.192:8090'
KEY = 'ragflow-QSmWWnQG96rLlX-_tpHKT6hKSQ_j-85vyY4s7OMXNTA'
ANALYST_ID = '8563cdb690e611f1b36bf39ef484774d'
DS_ID = 'e01b0a7690af11f1b36bf39ef484774d'  # 跨境运营知识库
OLD_DOC_PREFIX = '跨境AI选品分析师-标准报告模板'
NEW_DOC_NAME = '跨境AI选品分析师-标准报告模板-v1.3.md'
TPL_PATH = 'docs/选品分析师-报告模板-v1.2.md'
PROMPT_PATH = 'docs/选品分析师-智能体提示词.md'
# RAGFlow v0.26.4 运行时按 component_class(component_name + "Param") 动态导入，
# GET /agents 返回的是本地化（中文）component_name 视图，PUT 前必须归一为英文内部类名，
# 否则运行时报 "**ERROR**: Can't import XXParam"。
CANON = {'begin': 'Begin', 'Retrieval': 'Retrieval', 'Agent': 'Agent', 'Message': 'Message'}


def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
                                 headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
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
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {'code': e.code, 'message': e.read().decode()[:300]}


def main():
    prompt = open(PROMPT_PATH, encoding='utf-8').read()

    # 1. 知识库模板文档：删旧（v1.x 同名前缀）传新并解析
    existing = api('GET', f'/api/v1/datasets/{DS_ID}/documents?page=1&page_size=50').get('data', {}).get('docs', [])
    for doc in [d for d in existing if d['name'].startswith(OLD_DOC_PREFIX)]:
        r = api('DELETE', f'/api/v1/datasets/{DS_ID}/documents', {'ids': [doc['id']]})
        print('delete old', doc['name'], r.get('code'))
    r = upload_file(DS_ID, NEW_DOC_NAME, open(TPL_PATH, 'rb').read())
    print('upload', NEW_DOC_NAME, r.get('code'), r.get('message'))
    docs = api('GET', f'/api/v1/datasets/{DS_ID}/documents?page=1&page_size=50').get('data', {}).get('docs', [])
    new_doc = next((d for d in docs if d['name'] == NEW_DOC_NAME), None)
    if new_doc:
        api('POST', f'/api/v1/datasets/{DS_ID}/chunks', {'document_ids': [new_doc['id']]})
        for _ in range(60):
            docs = api('GET', f'/api/v1/datasets/{DS_ID}/documents?page=1&page_size=50').get('data', {}).get('docs', [])
            doc = next((d for d in docs if d['name'] == NEW_DOC_NAME), None)
            if doc and doc.get('run') in ('DONE', 'CANCEL', 'FAIL'):
                print('parse:', doc['name'], doc.get('run'))
                break
            time.sleep(5)

    # 2. 智能体 sys_prompt 更新（components + graph 双写），并归一英文 component_name
    data = api('GET', f'/api/v1/agents/{ANALYST_ID}').get('data', {})
    dsl = data['dsl']
    dsl['components']['Agent:Analyst']['obj']['params']['sys_prompt'] = prompt
    for node in dsl['graph']['nodes']:
        if node['id'] == 'Agent:Analyst':
            node['data']['form']['sys_prompt'] = prompt
    fixed = []
    for key, comp in dsl['components'].items():
        canon = CANON.get(key.split(':')[0])
        obj = comp.get('obj', {})
        if canon and obj.get('component_name') != canon:
            fixed.append((key, obj.get('component_name'), canon))
            obj['component_name'] = canon
    if fixed:
        print('normalize component_name:', fixed)
    r = api('PUT', f'/api/v1/agents/{ANALYST_ID}', {'title': data.get('title', '选品分析师'), 'dsl': dsl})
    print('agent update code:', r.get('code'), r.get('message'))
    print('注意：服务器有 per-process 内存 canvas 缓存且 PUT 不失效，若冒烟仍报旧状态，'
          '需先 ssh root@114.55.149.192 "cd /opt/yandu/ragflow && docker compose restart ragflow-cpu" 再重跑本脚本。')

    # 3. 冒烟：就绪 + v1.3 规则抽查（标题平台/链接信任/附录完整）
    r = api('POST', '/api/v1/agents/chat/completions',
            {'agent_id': ANALYST_ID, 'openai-compatible': True, 'stream': False,
             'messages': [{'role': 'user', 'content': '冒烟测试：请只回复「选品分析师v1.4就绪」十个字。'}]})
    print('smoke ready:', str(r)[:200])
    r = api('POST', '/api/v1/agents/chat/completions',
            {'agent_id': ANALYST_ID, 'openai-compatible': True, 'stream': False,
             'messages': [{'role': 'user', 'content':
                           '模板抽查：不要做完整分析。请依次输出：①商品「宠物安抚喷雾」报告的主标题行；'
                           '②3.2 表格两行示例（TropiClean、Petkin，ASIN均按凭估算/记忆处理、非用户提供）；'
                           '③3.3 表格的「🔗 商品/品牌链接」行示例（两款竞品）；④数据来源表一行示例（证据等级用中文）。'
                           '注意：不要输出附录。'}]})
    try:
        content = r['choices'][0]['message']['content']
    except Exception:
        try:
            content = r['data']['choices'][0]['message']['content']
        except Exception:
            content = str(r)[:800]
    print('--- template probe v1.4 ---')
    print(content[:1500])
    ok_title = '跨境AI选品分析师' in content and 'eBay' not in content
    ok_no_dp = 'amazon.com/dp/' not in content  # 估算 ASIN 禁 dp 链接
    ok_brand = '](https://www.amazon.com/s?k=' in content
    ok_row = '商品/品牌链接' in content
    ok_no_appendix = '附录' not in content
    ok_cn_evidence = ('外部估算' in content or '事实' in content) and '| F |' not in content
    print('probe title:', ok_title, '| no dp link:', ok_no_dp, '| brand link:', ok_brand, '| 3.3 row:', ok_row, '| no appendix:', ok_no_appendix, '| cn evidence:', ok_cn_evidence)
    print('DONE')


if __name__ == '__main__':
    main()
