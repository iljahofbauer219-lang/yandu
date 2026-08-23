#!/usr/bin/env python3
"""Listing精造师 P2 验收：1 商品 × 3 平台 × 3 语言 = 9 个 Listing 包。

与工作台前端同一口径的查询词与自检：结论存在、六段结构、禁词为零（只查「五、」前正文）、术语命中。
用法：python3 tools/verify-listing-matrix.py
"""
import json
import re
import time
import urllib.request

BASE = 'http://114.55.149.192:8090'
KEY = 'ragflow-QSmWWnQG96rLlX-_tpHKT6hKSQ_j-85vyY4s7OMXNTA'
AGENT_ID = 'a80d0348932d11f1b36bf39ef484774d'

MATERIAL = ('商品名称：一键退毛自洁梳；品牌：PetPal；型号：PP-201；材质：ABS手柄+不锈钢针+TPU软垫；'
            '重量180g；包装尺寸22×10×5 cm；功能：双弹簧一键退毛按钮、一体成型不锈钢针头、圆头针尖、TPE防滑握柄；'
            '场景：家庭猫犬美容；认证：无。')

SITES = [('Amazon', '美国站'), ('eBay', '美国站'), ('Shopee', '马来西亚站')]
LANGS = ['en-US', 'de', 'ms']
# 术语命中候选（ms 不在术语库映射表内，接受马来语本地词或保留英文）
TERMS = {'不锈钢': {'en': ['stainless steel'], 'de': ['edelstahl'],
                  'ms': ['keluli tahan karat', 'besi tahan karat', 'stainless steel']},
         'ABS': {'en': ['abs plastic', 'abs'], 'de': ['abs-kunststoff', 'abs'],
                 'ms': ['plastik abs', 'abs plastic', 'abs']}}
FORBIDDEN = ['best seller', 'fda approved', 'free shipping']
FORBIDDEN_RE = [r'\bcure\b', r'100%']


def chat(query):
    req = urllib.request.Request(BASE + '/api/v1/agents/chat/completions', method='POST',
                                 headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'},
                                 data=json.dumps({'agent_id': AGENT_ID, 'openai-compatible': True, 'stream': False,
                                                  'messages': [{'role': 'user', 'content': query}]}).encode())
    with urllib.request.urlopen(req, timeout=360) as resp:
        payload = json.loads(resp.read().decode())
    return payload['choices'][0]['message']['content']


def self_check(text, lang):
    checks = {}
    checks['conclusion'] = bool(re.search(r'可直接发布|需人工复核后发布|红线阻断', text))
    checks['sections'] = len(set(re.findall(r'^(一|二|三|四|五|六)、', text, re.M))) >= 5
    idx = re.search(r'^五、', text, re.M)
    body = (text[:idx.start()] if idx else text).lower()
    hits = [f for f in FORBIDDEN if f in body] + [p for p in FORBIDDEN_RE if re.search(p, body, re.I)]
    checks['forbidden_zero'] = not hits
    checks['forbidden_hits'] = hits
    base = lang.split('-')[0]
    misses = []
    for zh, mapping in TERMS.items():
        candidates = mapping.get(base) or []
        if candidates and zh in MATERIAL and not any(c in text.lower() for c in candidates):
            misses.append(zh)
    checks['terms_ok'] = not misses
    checks['term_misses'] = misses
    checks['pass'] = checks['conclusion'] and checks['sections'] and checks['forbidden_zero'] and checks['terms_ok']
    return checks


def main():
    report = []
    for platform, site in SITES:
        for lang in LANGS:
            name = f'{platform}-{site}-{lang}'
            query = f'以下是中文商品素材，请生成 {platform} {site}（{lang}）Listing 包：\n{MATERIAL}'
            t0 = time.time()
            try:
                text = chat(query)
                checks = self_check(text, lang)
                with open(f'.tmp-ui-verify/listing-matrix-{name}.md', 'w', encoding='utf-8') as f:
                    f.write(text)
            except Exception as exc:  # noqa: BLE001
                checks = {'pass': False, 'error': str(exc)}
            report.append({'case': name, 'seconds': int(time.time() - t0), **checks})
            print(json.dumps(report[-1], ensure_ascii=False)[:300])
    with open('.tmp-ui-verify/listing-matrix-report.json', 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    ok = len(report) == 9 and all(r['pass'] for r in report)
    print('MATRIX PASS' if ok else 'MATRIX FAIL')


if __name__ == '__main__':
    main()
