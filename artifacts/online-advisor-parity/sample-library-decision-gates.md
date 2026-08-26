# 报告样例库 · 决策门禁与失败原因汇总（I 阶段新增）

> 数据源：artifacts/online-advisor-parity/sample-{A,B,C,D}-*.md + src/shared/sampleLibrary.ts
> 用途：作为 RAGFlow 知识库文档归档，供「选品分析师」AI 智能体在生成报告时参考 4 决策枚举的失败门禁与触发条件。
> 配套文档：sample-library-traceability-rule.md（决策可追溯硬约束）

## 1. 4 决策枚举（仅限以下 4 种）

| 枚举 | 触发条件 | 失败门禁 |
|---|---|---|
| ✅ 建议入场 | 全 DIRECT 命中 + 利润达标 + 合规证据完整 + 差异化可验证 | （无） |
| ⚠️ 有条件谨慎入场 | 利润达标但合规/IP 证据偏短，需补强后复评 | 差异化或合规证据偏短 |
| ❌ 不建议入场 | 成本结构过重 / 悲观情景亏损 / 合规 IP 存在未解决硬风险 | 定价无法覆盖全成本 / 悲观情景亏损 / 差异化不可验证 / 合规 IP 存在未解决硬风险 |
| ❓ 数据不足，不能判定 | 23 evidence 至少一项未核验 / DIRECT 不够 / 缺关键经营输入 | 23 evidence 至少一项未核验 |

## 2. 4 真实样例决策路径

| 样例 | 决策 | baseMargin | downsideProfit | DIRECT | failedGates |
|---|---|---:|---:|---:|---|
| A | ✅ 建议入场 | 39.3% | $8.57 | 15 | （无） |
| B | ⚠️ 有条件谨慎入场 | 35.2% | $7.91 | 15 | complianceIpEvidence ≥ 8 字符 |
| C | ❌ 不建议入场 | -17.6% | -$8.00 | 15 | numbers.base.margin ≥ target、numbers.downside.profit ≥ 0 |
| D | ❓ 数据不足，不能判定 | 数据不足 | 数据不足 | 15 | 23 evidence 全部 decisionEligible=true |

## 3. 决策门禁链（10 道门禁）

按顺序：

1. **23 evidence 全部 decisionEligible=true**（采购价、佣金率、FBA、退货、广告、包装、国内物流、头程、关税、清关、入仓、仓储、目标贡献利润率、差异化、合规/IP 至少 14 项）
2. **研究样本基线**：≥ 3 个购买意图关键词成功检索 + 至少 1 个 DIRECT 命中
3. **DIRECT 占比**：DIRECT 样本 ≥ 70%（DIRECT / (DIRECT+ADJACENT+NON_COMPARABLE)）
4. **价格带覆盖**：TOP50 价格带覆盖本研究品零售价 ±20%
5. **同质化商品统计**：同款/高度相似品数量在可接受范围
6. **numbers.base.margin ≥ target**：基准情景毛利率 ≥ 用户设定目标
7. **numbers.downside.profit ≥ 0**：悲观情景每件利润 ≥ 0
8. **差异化可验证**：有明确卖点（功能/材质/技术/场景/原创设计）
9. **complianceIpEvidence ≥ 8 字符**：合规与 IP 风险描述 ≥ 8 字符
10. **30 天验证计划**：首批测试量 + 补货条件 + 停止投入条件

## 4. 决策判定算法

```
if (any(failedGate in [numbers.base.margin < target, numbers.downside.profit < 0, 差异化不可验证, 合规IP存在未解决硬风险])):
    decision = '❌ 不建议入场'
elif (failedGate in [complianceIpEvidence < 8 字符, 差异化证据偏短]):
    decision = '⚠️ 有条件谨慎入场'
elif (failedGate in [23 evidence 至少一项未核验, DIRECT < 1, 缺关键经营输入]):
    decision = '❓ 数据不足，不能判定'
else:
    decision = '✅ 建议入场'
```

## 5. 与 sampleLibrary 同步

- 决策枚举：src/shared/sampleLibrary.ts SAMPLE_DEFINITIONS
- 失败门禁：src/shared/sampleLibrary.ts failedGates
- 决策矩阵：src/shared/sampleLibraryPrompt.ts buildSampleLibraryDecisionMatrix
- 提示词规则 18：src/shared/sampleLibraryPrompt.ts PROMPT_RULE_18
- 渲染器兜底：src/shared/reportEnhance.ts ensureSampleLibraryAlignment
