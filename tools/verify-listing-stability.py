#!/usr/bin/env python3
"""Listing精造师 P1 稳定性验收：四类平台案例 × 2 重复（temperature=0）。

验收维度：两次运行的结论类型一致、六段结构一致、术语命中一致、禁词为零；并给出全文相似度参考。
用法：python3 tools/verify-listing-stability.py
"""
import difflib
import json
import re
import time
import urllib.request

BASE = 'http://114.55.149.192:8090'
KEY = 'ragflow-QSmWWnQG96rLlX-_tpHKT6hKSQ_j-85vyY4s7OMXNTA'
AGENT_ID = 'a80d0348932d11f1b36bf39ef484774d'

BRUSH = ('商品名称：一键退毛自洁梳；材质：ABS手柄+不锈钢针+TPU软垫；重量180g；包装尺寸22×10×5 cm；'
         '功能：双弹簧一键退毛按钮、一体成型不锈钢针头、圆头针尖、TPE防滑握柄；场景：家庭猫犬美容；认证：无。')
CASES = [
    {'name': 'Amazon-US-en', 'query': f'以下是中文商品素材，请生成 Amazon 美国站（en-US）Listing 包：\n{BRUSH}'},
    {'name': 'Amazon-DE-de', 'query': f'以下是中文商品素材，请生成 Amazon 德国站（de）Listing 包：\n{BRUSH}'},
    {'name': 'Shopee-MY-ms', 'query': '商品名称：水槽下可调节收纳架；材质：碳钢架+ABS层板；结构：两层、高度可调、免工具安装；'
                                      '包装40×25×10 cm、重1.2kg；场景：厨房/浴室收纳。请生成 Shopee 马来西亚站（ms）Listing 包。'},
    {'name': 'eBay-US-en', 'query': '商品名称：不锈钢压蒜器；材质：304不锈钢+防滑手柄；功能：压蒜头带清洁刷、可洗碗机；'
                                    '包装18×6×4 cm、120g。请生成 eBay 美国站（en）Listing 包。'},
]
FORBIDDEN = ['best seller', 'fda approved', 'free shipping']
FORBIDDEN_RE = [r'\bcure\b', r'100%']


def chat(query):
    req = urllib.request.Request(BASE + '/api/v1/agents/chat/completions', method='POST',
                                 headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'},
                                 data=json.dumps({'agent_id': AGENT_ID, 'openai-compatible': True, 'stream': False,
                                                  'messages': [{'role': 'user', 'content': query}]}).encode())
    with urllib.request.urlopen(req, timeout=300) as resp:
        payload = json.loads(resp.read().decode())
    return payload['choices'][0]['message']['content']


def conclusion(text):
    m = re.search(r'可直接发布|需人工复核后发布|红线阻断', text)
    return m.group(0) if m else 'NONE'


def sections(text):
    return sorted(set(re.findall(r'^(一|二|三|四|五|六|七|八)、[^\n]{0,20}', text, re.M)))


def listing_body(text):
    # 禁词只查文案正文（事实卡/关键词/底稿/各语言版本），自检表与结论段会元引用禁词，不参与
    idx = re.search(r'^五、', text, re.M)
    return text[:idx.start()] if idx else text


def term_hits(name, text):
    low = text.lower()
    hits = {}
    if name == 'Amazon-DE-de':
        hits['Edelstahl'] = 'edelstahl' in low
    if name in ('Amazon-US-en', 'eBay-US-en'):
        hits['stainless steel'] = 'stainless steel' in low
    if name == 'Shopee-MY-ms':
        hits['local-term(rak/sink)'] = ('rak' in low) or ('sink' in low)
    body = listing_body(text).lower()
    hits['no-forbidden'] = (not any(f in body for f in FORBIDDEN) and
                            not any(re.search(p, body, re.I) for p in FORBIDDEN_RE))
    return hits


def main():
    report = []
    for case in CASES:
        runs = []
        for i in range(2):
            t0 = time.time()
            text = chat(case['query'])
            print(f"[{case['name']}] run{i + 1} {int(time.time() - t0)}s len={len(text)}")
            runs.append(text)
        a, b = runs
        sa, sb = sections(a), sections(b)
        ha, hb = term_hits(case['name'], a), term_hits(case['name'], b)
        ratio = difflib.SequenceMatcher(None, a, b).ratio()
        item = {
            'case': case['name'],
            'conclusion_run1': conclusion(a), 'conclusion_run2': conclusion(b),
            'conclusion_stable': conclusion(a) == conclusion(b) and conclusion(a) != 'NONE',
            'sections_run1': sa, 'sections_run2': sb, 'sections_stable': sa == sb and len(sa) >= 5,
            'terms_run1': ha, 'terms_run2': hb, 'terms_stable': ha == hb and all(ha.values()),
            'similarity': round(ratio, 3),
        }
        report.append(item)
        with open(f'.tmp-ui-verify/listing-stability-{case["name"]}-run1.md', 'w', encoding='utf-8') as f:
            f.write(a)
        with open(f'.tmp-ui-verify/listing-stability-{case["name"]}-run2.md', 'w', encoding='utf-8') as f:
            f.write(b)
    with open('.tmp-ui-verify/listing-stability-report.json', 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    ok = all(r['conclusion_stable'] and r['sections_stable'] and r['terms_stable'] for r in report)
    for r in report:
        print(json.dumps(r, ensure_ascii=False)[:400])
    print('STABILITY PASS' if ok else 'STABILITY FAIL')


if __name__ == '__main__':
    main()
