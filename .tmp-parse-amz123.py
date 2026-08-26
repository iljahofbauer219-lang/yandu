#!/usr/bin/env python3
"""解析 amz123.com/kd 的 HTML，提取所有平台卡片数据，输出 JSON。"""
import re
import json

REGION_MAP = {
    '热门平台': 'hot',
    '北美': 'na',
    '欧洲': 'eu',
    '日韩': 'jp-kr',
    '东南亚': 'sea',
    '拉美': 'latam',
    '澳洲': 'au',
    '中东': 'me',
    '非洲': 'africa',
    '南亚': 'sa',
    '中亚': 'cas',
    'B2B': 'b2b',
}

def extract_cards(html: str):
    """提取每张卡片：logo / name / desc / homepage / region"""
    ul_pattern = re.compile(
        r'<ul[^>]*data-sdk-position="([^"]+)"[^>]*data-columns="(\d+)"[^>]*>(.*?)(?=<ul|</div></div></div></div></div>)',
        re.DOTALL
    )
    li_pattern = re.compile(r'<li[^>]*class="[^"]*amz-item[^"]*"[^>]*>(.*?)</li>', re.DOTALL)

    sites = []
    for m in ul_pattern.finditer(html):
        region_zh = m.group(1).strip()
        body = m.group(3)
        region = REGION_MAP.get(region_zh)
        if not region:
            print(f'⚠ 未知区域: {region_zh}')
            continue
        for li in li_pattern.finditer(body):
            site = parse_card(li.group(1), region)
            if site:
                sites.append(site)
    return sites

def parse_card(card_html: str, region: str):
    logo_match = re.search(r'data-raw-src="([^"]+)"', card_html)
    if not logo_match:
        logo_match = re.search(r'<img[^>]+src="([^"]+)"', card_html)
    logo = logo_match.group(1) if logo_match else ''
    if 'empty.png' in logo:
        logo = ''

    name_match = re.search(r'class="amz-item-title"[^>]*>(.*?)</a>', card_html, re.DOTALL)
    if not name_match:
        return None
    name = strip_tags(name_match.group(1)).strip()

    desc_match = re.search(r'class="amz-item-intro"[^>]*>(.*?)</a>', card_html, re.DOTALL)
    desc = strip_tags(desc_match.group(1)).strip() if desc_match else ''

    links = re.findall(r'<a[^>]+href="([^"]+)"[^>]*class="amz-link-item[^"]*"[^>]*>([^<]*)</a>', card_html)
    homepage = links[0][0] if len(links) >= 1 else ''
    guide = links[1][0] if len(links) >= 2 else ''

    if not name or not homepage:
        return None
    return {
        'id': slugify(name),
        'name': name,
        'region': region,
        'logoUrl': logo,
        'description': desc,
        'homepageUrl': homepage,
        'openGuideUrl': guide,
    }

def strip_tags(s: str) -> str:
    return re.sub(r'<[^>]+>', '', s).strip()

def slugify(name: str) -> str:
    s = re.sub(r'[\s/\\]+', '-', name.lower())
    s = re.sub(r'[^\w\u4e00-\u9fff-]', '', s)
    return s or 'site'

def main():
    with open('/Users/zyc/Desktop/砚都跨境/.tmp-amz123-kd.html', 'r', encoding='utf-8') as f:
        html = f.read()
    sites = extract_cards(html)
    print(f'提取 {len(sites)} 张卡片')
    by_region = {}
    for s in sites:
        by_region.setdefault(s['region'], 0)
        by_region[s['region']] += 1
    for r, n in by_region.items():
        print(f'  {r}: {n}')
    with open('/Users/zyc/Desktop/砚都跨境/.tmp-sites.json', 'w', encoding='utf-8') as f:
        json.dump(sites, f, ensure_ascii=False, indent=2)
    print('JSON 写入 .tmp-sites.json')

if __name__ == '__main__':
    main()
