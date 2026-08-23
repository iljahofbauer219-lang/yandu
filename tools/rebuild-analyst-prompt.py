#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""重建 docs/选品分析师-智能体提示词.md：
head(规则1-12) + 规则15-17 + 自检清单(含新增三项) + 嵌入模板v1.3 + 尾部规则13/14。
head/尾部取自旧提示词文件（.tmp-ui-verify/analyst-sys-prompt.md 原始 v1.1）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
old = (ROOT / '.tmp-ui-verify/analyst-sys-prompt.md').read_text(encoding='utf-8')
tpl = (ROOT / 'docs/选品分析师-报告模板-v1.2.md').read_text(encoding='utf-8')

lines = old.splitlines()
head = []
for ln in lines:
    head.append(ln)
    if ln.startswith('12. '):
        break
else:
    raise SystemExit('未找到规则12')

# v1.4：规则6 证据等级中文化（禁 F/E/A/U 字母）
head_text = '\n'.join(head)
OLD_RULE6 = '6. 关键数据标记F（事实）、E（外部估算）、A（分析假设）、U（未知），附来源、日期、美国站、类目和口径。'
NEW_RULE6 = '6. 关键数据标记中文证据等级：事实/外部估算/分析假设/未知（禁止使用F/E/A/U英文字母），附来源、日期、美国站、类目和口径。'
if OLD_RULE6 not in head_text:
    raise SystemExit('未找到规则6原文')
head_text = head_text.replace(OLD_RULE6, NEW_RULE6)

tail = [ln for ln in lines if ln.startswith('13. ') or ln.startswith('14. ')]
if len(tail) != 2:
    raise SystemExit(f'尾部规则13/14 提取异常: {len(tail)}')

rules = """15. 链接可核验：「品牌/店铺」「竞店/品牌及链接」列必须输出品牌搜索链接 [品牌](https://www.amazon.com/s?k=品牌)（品牌做URL编码）；dp链接 [ASIN](https://www.amazon.com/dp/ASIN) 仅当 ASIN 为用户提供的或系统抓取的才允许输出，凭估算/记忆的 ASIN 一律输出纯文本+证据等级「未知」，禁止生成dp链接；3.3 末行「🔗 商品/品牌链接」ASIN可信填dp链接、否则填品牌搜索链接。未知时写「待验证」，禁止编造链接。
16. 无附录：报告以「数据来源、假设与待验证清单」表结束，禁止输出附录、术语表或证据等级速览等额外章节，控制版面。
17. 主标题一致：主标题固定为「# 跨境AI选品分析师 · 标准分析报告」，可前缀商品名，但标题中的平台名必须与目标平台（Amazon美国站）一致，禁止出现eBay等平台名；若用户要求分析其他平台，说明当前版本仅评估Amazon美国站。
"""

selfcheck = """## 输出前自检

- 六部分和全部表格是否齐全。
- TOP50、10–20款重点竞品、5–8款核心竞品、5–10家竞店的数量及不足原因是否明确。
- 不同规格是否按统一零售单位比较。
- 数据事实、估算、假设和未知是否区分。
- 证据等级是否全部使用中文（事实/外部估算/分析假设/未知）、无F/E/A/U字母。
- 是否未输出附录/术语表。
- 利润是否能从成本表复算。
- 结论是否被任何硬门槛否决。
- 标题平台是否与目标平台（Amazon美国站）一致。
- 是否存在为不可信 ASIN 编造的dp链接。

只有完成自检后才能输出最终报告。
"""

out = head_text.rstrip() + '\n' + rules + '\n' + selfcheck + '\n\n## 强制报告模板\n\n' + tpl.strip() + '\n\n' + '\n'.join(tail) + '\n'
(ROOT / 'docs/选品分析师-智能体提示词.md').write_text(out, encoding='utf-8')
print(f'OK prompt rebuilt: {len(out)} chars')
