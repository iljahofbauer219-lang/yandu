# 报告样例库 · 决策可追溯硬约束（I 阶段新增）

> 数据源：src/shared/sampleLibrary.ts / src/shared/sampleEnhance.ts（reportEnhance.ts 的 ensureSampleLibraryAlignment）
> 用途：作为 RAGFlow 知识库文档归档，让所有 AI 员工在跨任务中都能复用「决策可追溯」硬约束。
> 配套文档：sample-library-decision-gates.md（4 决策枚举 + 失败门禁）

## 1. 硬约束定义

报告样例库决策可追溯硬约束要求：

1. **决策枚举必须是以下 4 种之一**：
   - ✅ 建议入场
   - ⚠️ 有条件谨慎入场
   - ❌ 不建议入场
   - ❓ 数据不足，不能判定

2. **报告第六部分首行必须包含决策可追溯声明**：
   ```
   决策可追溯：系统入场结论 = X，报告最终结论 = X，二者必须完全一致
   ```
   其中 X 必须是上述 4 决策枚举之一，且「系统入场结论」与「报告最终结论」必须完全一致。

## 2. 检测算法（按 4 决策枚举精确拆分）

按 4 决策枚举字面量从「系统入场结论 = 」起点开始精确匹配，避免「❓ 数据不足，不能判定」中间的中文逗号被旧 regex 误截断：

```typescript
function detectDecisionTraceability(content) {
  const sysIdx = content.indexOf('系统入场结论')
  if (sysIdx < 0) return { ok: false }
  // 跳过 "系统入场结论 = " 前缀
  const afterEq = content.slice(sysIdx + '系统入场结论 = '.length)
  // 在 4 决策枚举中找 systemDecision（从起点起精确匹配）
  let systemDecision = null
  for (const d of ['✅ 建议入场', '⚠️ 有条件谨慎入场', '❌ 不建议入场', '❓ 数据不足，不能判定']) {
    if (afterEq.startsWith(d)) { systemDecision = d; break }
  }
  // 在 systemDecision 之后找 "，报告最终结论 = " 前缀
  // 在 4 决策枚举中找 reportDecision（从起点起精确匹配）
  // ok = (systemDecision === reportDecision) && (枚举中)
}
```

## 3. 渲染器兜底（ensureSampleLibraryAlignment）

模型偷懒时由 `src/shared/reportEnhance.ts` 的 `ensureSampleLibraryAlignment` 兜底：

- **缺决策可追溯**：在报告末尾追加「- 决策可追溯：系统入场结论 = X，报告最终结论 = X」
- **system ≠ report（两个都在枚举中但不同）**：移除原声明 + 追加「- 决策可追溯修正：原报告系统=...、报告=...，已按 4 决策枚举对齐为 系统入场结论 = X，报告最终结论 = X」

## 4. 与 sampleLibrary 同步

- 决策枚举定义：src/shared/sampleLibrary.ts `SAMPLE_DEFINITIONS[*].decision`
- 决策可追溯 regex：src/shared/sampleLibrary.ts `TRACEABILITY_RE`
- 兜底函数：src/shared/reportEnhance.ts `ensureSampleLibraryAlignment`
- 决策枚举数组：src/shared/reportEnhance.ts `SAMPLE_LIBRARY_DECISIONS`
- 6 部分常量：src/shared/reportEnhance.ts `SAMPLE_LIBRARY_SIX_PARTS`

## 5. 真实样例对照

| 样例 | 系统入场结论 | 报告最终结论 | 可追溯 ok |
|---|---|---|---|
| A | ✅ 建议入场 | ✅ 建议入场 | ✅ |
| B | ⚠️ 有条件谨慎入场 | ⚠️ 有条件谨慎入场 | ✅ |
| C | ❌ 不建议入场 | ❌ 不建议入场 | ✅ |
| D | ❓ 数据不足，不能判定 | ❓ 数据不足，不能判定 | ✅ |

> 4 样例全部满足决策可追溯硬约束（系统 = 报告）。如果模型生成报告时未满足此约束，渲染器会自动兜底修正。
