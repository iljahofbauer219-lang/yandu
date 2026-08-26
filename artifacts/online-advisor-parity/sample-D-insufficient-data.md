# 选品分析报告样本 D（❓ 数据不足，不能判定）

> 数据源：1688 商品页 + Amazon 搜索页 + Amazon 详情页 + Amazon 评论页
> 证据等级：事实（系统抓取）/ 分析假设（用户录入）/ 外部估算（FBA 费率表）
> 报告生成方式：阶段 4 拼装 + 阶段 5 入场门禁（决策可追溯）

- 报告编号：SAMPLE-D-001
- 版本：v1.2
- 分析日期：2026-08-18
- 数据截止：2026-08-18
- 目标平台：Amazon美国站
- 履约方式：FBA
- 币种：USD

> 场景说明：本样本 23 个经营输入 evidence 均未核验（decisionEligible=false），系统按"待核验"处理，复算被拒。

---

## 第一部分：本品基础信息解析

## 第一部分：本品基础信息解析（系统事实块）
- 商品名称：宠物免洗清洁喷雾 200ml 猫狗通用
- 商品链接：https://detail.1688.com/offer/19.html
- 产品形态：液体精华｜证据等级：事实/人工锁定
- 采购价 USD：待验证｜1688 人民币区间：¥8–¥12（1688 原报区间；1688 商品页价格区间）
- 起订量：≥ 2 件｜发货地：广东广州
- 包装尺寸：5×5×18 cm（1688 商品页规格/详情）｜毛重：240 g（1688 商品页规格/详情）｜装箱数：待验证（未提供装箱数；可从 attributes 或问供货商获取）
- 产品尺寸/净重（单品）：待验证（未从 1688 详情页中独立提取；如需可从 attributes 中人工补齐）；待验证（未从 1688 详情页中独立提取净重；可参考 attributes 或包裹中标注）
- 材质/成分：标准成分｜液体风险：高（液体/喷雾/乳液）｜供货事实冲突：无冲突
- 款式/颜色/变体数（取 1688 规格属性前 8 条）：品牌: 萌宠乐园；规格: 200ml；适用对象: 猫狗；形态: 液体精华；香味: 标准
- 覆盖应用场景（取 1688 详情页前 400 字）：宠物免洗清洁喷雾 200ml 猫狗通用的 1688 详情页文字内容，用于填充覆盖应用场景的「事实」证据。（来源：1688 详情页）
- 视觉识别参考：视觉识别 液体精华（置信度 0.86%）
- 缺口提示：可解决核心痛点、用户核心购买理由、核心优势、现存劣势需后续由智能体或人工提炼补充；未识别前以"待验证"占位。

---

## 第二部分：目标平台细分市场调研

## 系统抓取 Amazon 美国站可比市场样本（抓取日期：2026-08-18）
- 本品身份：宠物免洗清洁喷雾 200ml 猫狗通用｜形态：液体精华｜用途：喷洒｜适用对象：猫狗
- 检索词：pet waterless shampoo；cat dog no rinse spray；pet cleansing water（模型生成并经身份规则清洗）
- 样本审计：原始 18｜自然位 18｜赞助位排除 0｜ASIN去重 18｜DIRECT直接竞品 15｜ADJACENT替代方案 2｜NON_COMPARABLE排除 1
- 样本完整率：100%｜检索词成功 3/3（100%）｜DIRECT核心字段覆盖 100%｜结论置信度：可决策
- 数据路径：OmkarCloud API 优先 3｜Amazon 页面补充 15｜双源同 ASIN 合并 0；合并时 API 字段优先，页面仅补全 API 缺失字段。
- 证据等级：事实（OmkarCloud API 与 Amazon 美国站搜索页直接观察值）；样本统计仅代表上述检索词和抓取窗口，不等同完整市场。
- 研究样本基线已通过：这只代表可评估市场竞争力，不自动等同于“建议入场”。
- DIRECT 标准化零售价（按本品零售单位 200ml）：P25 $25.99｜中位价 $27.00｜P75 $28.50｜区间 $24.99–$30.00｜均价 $27.13｜有效 15/15
- DIRECT 评分中位：4.1｜均值 4.1（15 个样本）
- DIRECT 评论量：中位 600｜P75 725｜均值 774
- DIRECT 月购买信号：15/15 个样本在 Amazon 搜索页显示“过去一个月购买量”；可见下限合计 15,000+。这是页面徽标下限，不是精确月销量，未显示徽标的样本不得按 0 计。
- DIRECT 直接竞品（仅这些样本可进入核心价格与竞争统计）：
  1. B0F4SAMPLE｜原始标价 $26.49（不等同标准化售价）｜评分 4.5｜评论 3,421｜B0F4SAMPLE Sample Product 4 200ml｜检索词 pet waterless shampoo
  2. B0C1AQUPET｜原始标价 $25.99（不等同标准化售价）｜评分 4.4｜评论 1,287｜B0C1AQUPET Sample Product 1 200ml｜检索词 pet waterless shampoo
  3. B0DIR000014｜原始标价 $27.00（不等同标准化售价）｜评分 4.2｜评论 800｜Pet Waterless Sample 14 200ml｜检索词 pet waterless shampoo
  4. B0DIR000013｜原始标价 $26.00（不等同标准化售价）｜评分 4.1｜评论 750｜Pet Waterless Sample 13 200ml｜检索词 pet waterless shampoo
  5. B0DIR000012｜原始标价 $25.00（不等同标准化售价）｜评分 4｜评论 700｜Pet Waterless Sample 12 200ml｜检索词 pet waterless shampoo
  6. B0DIR000011｜原始标价 $30.00（不等同标准化售价）｜评分 4.2｜评论 650｜Pet Waterless Sample 11 200ml｜检索词 pet waterless shampoo
  7. B0D2DOGCAT｜原始标价 $27.49（不等同标准化售价）｜评分 4.1｜评论 643｜B0D2DOGCAT Sample Product 2 200ml｜检索词 pet waterless shampoo
  8. B0DIR000010｜原始标价 $29.00（不等同标准化售价）｜评分 4.1｜评论 600｜Pet Waterless Sample 10 200ml｜检索词 pet waterless shampoo
- ADJACENT 替代方案（只用于需求空白/替代方案观察，不得回填本品形态或 DIRECT 统计）：
  1. B0ADJ0000001｜Pet Grooming Wipes 100ct｜解决同一任务，但产品形态不同
  2. B0ADJ0000002｜Pet Bath Foam 200ml｜解决同一任务，但产品形态不同
- NON_COMPARABLE 与纯赞助位已从统计和竞品表中排除。若存在上述“月购买信号”，报告只能称为“Amazon 搜索页购买徽标下限”，不得改写为精确月销量；未抓取的销售额、BSR 和趋势证据等级为“待验证”，必须写“待验证”。
- “✅ 建议入场”必须独立证明产品能正常动销且有竞争切入点：研究样本基线通过、至少一个DIRECT存在可核验购买信号、目标售价/评论门槛/竞争格局可承受、本品差异化可验证、FBA贡献利润可复算且合规/IP不存在未解决硬风险。样本数量达标本身不得输出“建议入场”。

---

## 第三部分：本品与核心竞品多维对比

### 3.1 DIRECT 竞品汇总表

| ASIN | 品牌 | 售价 | 评分 | 评论量 | BSR | 徽标 |
|---|---|---:|---:|---:|---|---|
| B0C1AQUPET | PawPure | $25.99 | 4.4 | 1,287 | #2,341 in Pet Supplies | Amazon's Choice |
| B0D2DOGCAT | FurFresh | $27.49 | 4.1 | 643 | #3,891 in Pet Supplies | 无 |
| B0E3LIVGRN | GreenPaw | $24.99 | 3.9 | 215 | #5,122 in Pet Supplies | 无 |
| B0F4SAMPLE | CozyPet | $26.49 | 4.5 | 3,421 | #1,899 in Pet Supplies | Amazon's Choice |

### 3.2 竞品评论意见聚合

## 阶段3+ 竞品评论意见聚合（纯聚合，不调大模型）
- 口径：仅 DIRECT 竞品的 Amazon 详情页评论样本，按 rating 分桶、标题去重、TOP3；样本不足或缺评论页时输出"待验证"。
- B0C1AQUPET｜高频好评：Amazing for my long-haired cat；Smells wonderful and gentle｜高频差评：Bottle is too small｜来源：Amazon 评论页 https://www.amazon.com/product-reviews/B0C1AQUPET（采买日期 2026-08-18）
- B0D2DOGCAT｜高频好评：Best waterless shampoo for golden retriever｜高频差评：Made my dog itch｜来源：Amazon 评论页 https://www.amazon.com/product-reviews/B0D2DOGCAT（采买日期 2026-08-18）
- B0E3LIVGRN｜高频好评：My puppy loves the lavender scent｜高频差评：Leaves residue on dark fur｜来源：Amazon 评论页 https://www.amazon.com/product-reviews/B0E3LIVGRN（采买日期 2026-08-18）
- B0F4SAMPLE｜高频好评：Multi-pet household must-have｜高频差评：待验证｜来源：Amazon 评论页 https://www.amazon.com/product-reviews/B0F4SAMPLE（采买日期 2026-08-18）

### 3.3 竞品详情页 bullet 摘要

## 阶段3+ 竞品详情页 bullet 摘要（纯聚合，不调大模型）
- 口径：仅 DIRECT 竞品的 Amazon 详情页 bullet points，截前 2 条并限 80 字符；bullet 缺失时输出"待验证"。
- B0C1AQUPET｜品牌 PawPure｜SKU 8oz / 16oz｜卖家 PawPure Direct｜核心结构/技术方案：WATERLESS CLEANSING - No-rinse formula gently removes dirt and odors from pet fu；GENTLE FOR SENSITIVE SKIN - Hypoallergenic with aloe vera and chamomile extracts｜来源：Amazon 详情页 https://www.amazon.com/dp/B0C1AQUPET（采买日期 2026-08-18）
- B0D2DOGCAT｜品牌 FurFresh｜SKU 250ml｜卖家 FurFresh Co.｜核心结构/技术方案：WATERLESS DOG SHAMPOO - Clean and deodorize without water；SAFE INGREDIENTS - Plant-based formula｜来源：Amazon 详情页 https://www.amazon.com/dp/B0D2DOGCAT（采买日期 2026-08-18）
- B0E3LIVGRN｜品牌 GreenPaw｜SKU 200ml｜卖家 GreenPaw LLC｜核心结构/技术方案：LAVENDER SCENT - Soothing aroma for stress relief｜来源：Amazon 详情页 https://www.amazon.com/dp/B0E3LIVGRN（采买日期 2026-08-18）
- B0F4SAMPLE｜品牌 CozyPet｜SKU 200ml / 500ml｜卖家 CozyPet Inc.｜核心结构/技术方案：MULTI-PET FORMULA - Safe for cats, dogs, and small animals；NATURAL INGREDIENTS - Plant-based formula with essential oils｜来源：Amazon 详情页 https://www.amazon.com/dp/B0F4SAMPLE（采买日期 2026-08-18）

---

## 第四部分：价格、成本与单位经济

## 快速市场利润率（每件｜USD）
- 口径：标准化销售价－采购价－Amazon佣金－FBA履约费－退货损耗－广告费－优惠券；不含国内物流、头程、关税、清关、入仓、仓储及固定成本，不能视为全成本落地利润率。
- 快速市场利润率：待验证（采购价（USD）（待核验）、Amazon佣金率（待核验）、FBA履约费（USD）（待核验）、退货损耗率（待核验）、广告费率（待核验）、优惠券成本（USD）（待核验）尚未完成确认；暂缺填零或候选预设不得参与利润复算）。

## 全成本落地利润率（每件｜USD）
- 口径：标准化销售价－采购价－Amazon佣金－FBA履约费－退货损耗－广告费－优惠券－包装/质检－国内物流－头程－关税－清关－入仓－仓储。
- 全成本落地利润率：待验证（采购价（USD）（待核验）、Amazon佣金率（待核验）、FBA履约费（USD）（待核验）、退货损耗率（待核验）、广告费率（待核验）、优惠券成本（USD）（待核验）、包装/质检（低）（待核验）、包装/质检（基准）（待核验）、包装/质检（高）（待核验）、国内物流（低）（待核验）、国内物流（基准）（待核验）、国内物流（高）（待核验）、头程（低）（待核验）、头程（基准）（待核验）、头程（高）（待核验）、关税（低）（待核验）、关税（基准）（待核验）、关税（高）（待核验）、清关（低）（待核验）、清关（基准）（待核验）、清关（高）（待核验）、入仓（低）（待核验）、入仓（基准）（待核验）、入仓（高）（待核验）、仓储（低）（待核验）、仓储（基准）（待核验）、仓储（高）（待核验）、目标贡献利润率（待核验）、差异化核验依据（待核验）、合规/IP核验依据（待核验）尚未完成确认；暂缺填零、候选类目费率或自动提取线索不得当作真实经营成本/核验结论）。

---

## 第五部分：合规、知识产权与差异化核验

- 差异化核验依据：植物精华 + 双香型 + 200ml 大瓶装。
- 合规/IP 核验依据：成分均为常见日化原料。

---

## 第六部分：入场结论与30天验证计划

- 最终结论：❓ 数据不足，不能判定
- 门禁依据：关键经营输入尚未核验：采购价（USD）（待核验）、Amazon佣金率（待核验）、FBA履约费（USD）（待核验）、退货损耗率（待核验）、广告费率（待核验）、优惠券成本（USD）（待核验）、包装/质检（低）（待核验）、包装/质检（基准）（待核验）、包装/质检（高）（待核验）、国内物流（低）（待核验）、国内物流（基准）（待核验）、国内物流（高）（待核验）、头程（低）（待核验）、头程（基准）（待核验）、头程（高）（待核验）、关税（低）（待核验）、关税（基准）（待核验）、关税（高）（待核验）、清关（低）（待核验）、清关（基准）（待核验）、清关（高）（待核验）、入仓（低）（待核验）、入仓（基准）（待核验）、入仓（高）（待核验）、仓储（低）（待核验）、仓储（基准）（待核验）、仓储（高）（待核验）、目标贡献利润率（待核验）、差异化核验依据（待核验）、合规/IP核验依据（待核验）。暂缺填零、候选费率和自动提取线索均不得支持“建议入场”。
- 决策可追溯：系统入场结论 = ❓ 数据不足，不能判定，报告最终结论 = ❓ 数据不足，不能判定，二者必须完全一致。

### 30天验证计划

1. 包装尺寸/毛重复核 → 复算 FBA 履约费
2. 货代/关税/清关报价 → 复算全成本
3. 试单 50 件 → A/B 转化与退货率

---

## 附录：阶段 4 systemFact 块（拼装路径直供智能体）

```
## 第一部分：本品基础信息解析（系统事实块）
## 第一部分：本品基础信息解析（系统事实块）
- 商品名称：宠物免洗清洁喷雾 200ml 猫狗通用
- 商品链接：https://detail.1688.com/offer/19.html
- 产品形态：液体精华｜证据等级：事实/人工锁定
- 采购价 USD：待验证｜1688 人民币区间：¥8–¥12（1688 原报区间；1688 商品页价格区间）
- 起订量：≥ 2 件｜发货地：广东广州
- 包装尺寸：5×5×18 cm（1688 商品页规格/详情）｜毛重：240 g（1688 商品页规格/详情）｜装箱数：待验证（未提供装箱数；可从 attributes 或问供货商获取）
- 产品尺寸/净重（单品）：待验证（未从 1688 详情页中独立提取；如需可从 attributes 中人工补齐）；待验证（未从 1688 详情页中独立提取净重；可参考 attributes 或包裹中标注）
- 材质/成分：标准成分｜液体风险：高（液体/喷雾/乳液）｜供货事实冲突：无冲突
- 款式/颜色/变体数（取 1688 规格属性前 8 条）：品牌: 萌宠乐园；规格: 200ml；适用对象: 猫狗；形态: 液体精华；香味: 标准
- 覆盖应用场景（取 1688 详情页前 400 字）：宠物免洗清洁喷雾 200ml 猫狗通用的 1688 详情页文字内容，用于填充覆盖应用场景的「事实」证据。（来源：1688 详情页）
- 视觉识别参考：视觉识别 液体精华（置信度 0.86%）
- 缺口提示：可解决核心痛点、用户核心购买理由、核心优势、现存劣势需后续由智能体或人工提炼补充；未识别前以"待验证"占位。

## 系统抓取 Amazon 美国站可比市场样本（抓取日期：2026-08-18）
- 本品身份：宠物免洗清洁喷雾 200ml 猫狗通用｜形态：液体精华｜用途：喷洒｜适用对象：猫狗
- 检索词：pet waterless shampoo；cat dog no rinse spray；pet cleansing water（模型生成并经身份规则清洗）
- 样本审计：原始 18｜自然位 18｜赞助位排除 0｜ASIN去重 18｜DIRECT直接竞品 15｜ADJACENT替代方案 2｜NON_COMPARABLE排除 1
- 样本完整率：100%｜检索词成功 3/3（100%）｜DIRECT核心字段覆盖 100%｜结论置信度：可决策
- 数据路径：OmkarCloud API 优先 3｜Amazon 页面补充 15｜双源同 ASIN 合并 0；合并时 API 字段优先，页面仅补全 API 缺失字段。
- 证据等级：事实（OmkarCloud API 与 Amazon 美国站搜索页直接观察值）；样本统计仅代表上述检索词和抓取窗口，不等同完整市场。
- 研究样本基线已通过：这只代表可评估市场竞争力，不自动等同于“建议入场”。
- DIRECT 标准化零售价（按本品零售单位 200ml）：P25 $25.99｜中位价 $27.00｜P75 $28.50｜区间 $24.99–$30.00｜均价 $27.13｜有效 15/15
- DIRECT 评分中位：4.1｜均值 4.1（15 个样本）
- DIRECT 评论量：中位 600｜P75 725｜均值 774
- DIRECT 月购买信号：15/15 个样本在 Amazon 搜索页显示“过去一个月购买量”；可见下限合计 15,000+。这是页面徽标下限，不是精确月销量，未显示徽标的样本不得按 0 计。
- DIRECT 直接竞品（仅这些样本可进入核心价格与竞争统计）：
  1. B0F4SAMPLE｜原始标价 $26.49（不等同标准化售价）｜评分 4.5｜评论 3,421｜B0F4SAMPLE Sample Product 4 200ml｜检索词 pet waterless shampoo
  2. B0C1AQUPET｜原始标价 $25.99（不等同标准化售价）｜评分 4.4｜评论 1,287｜B0C1AQUPET Sample Product 1 200ml｜检索词 pet waterless shampoo
  3. B0DIR000014｜原始标价 $27.00（不等同标准化售价）｜评分 4.2｜评论 800｜Pet Waterless Sample 14 200ml｜检索词 pet waterless shampoo
  4. B0DIR000013｜原始标价 $26.00（不等同标准化售价）｜评分 4.1｜评论 750｜Pet Waterless Sample 13 200ml｜检索词 pet waterless shampoo
  5. B0DIR000012｜原始标价 $25.00（不等同标准化售价）｜评分 4｜评论 700｜Pet Waterless Sample 12 200ml｜检索词 pet waterless shampoo
  6. B0DIR000011｜原始标价 $30.00（不等同标准化售价）｜评分 4.2｜评论 650｜Pet Waterless Sample 11 200ml｜检索词 pet waterless shampoo
  7. B0D2DOGCAT｜原始标价 $27.49（不等同标准化售价）｜评分 4.1｜评论 643｜B0D2DOGCAT Sample Product 2 200ml｜检索词 pet waterless shampoo
  8. B0DIR000010｜原始标价 $29.00（不等同标准化售价）｜评分 4.1｜评论 600｜Pet Waterless Sample 10 200ml｜检索词 pet waterless shampoo
- ADJACENT 替代方案（只用于需求空白/替代方案观察，不得回填本品形态或 DIRECT 统计）：
  1. B0ADJ0000001｜Pet Grooming Wipes 100ct｜解决同一任务，但产品形态不同
  2. B0ADJ0000002｜Pet Bath Foam 200ml｜解决同一任务，但产品形态不同
- NON_COMPARABLE 与纯赞助位已从统计和竞品表中排除。若存在上述“月购买信号”，报告只能称为“Amazon 搜索页购买徽标下限”，不得改写为精确月销量；未抓取的销售额、BSR 和趋势证据等级为“待验证”，必须写“待验证”。
- “✅ 建议入场”必须独立证明产品能正常动销且有竞争切入点：研究样本基线通过、至少一个DIRECT存在可核验购买信号、目标售价/评论门槛/竞争格局可承受、本品差异化可验证、FBA贡献利润可复算且合规/IP不存在未解决硬风险。样本数量达标本身不得输出“建议入场”。

## 阶段3+ 竞品评论意见聚合（纯聚合，不调大模型）
- 口径：仅 DIRECT 竞品的 Amazon 详情页评论样本，按 rating 分桶、标题去重、TOP3；样本不足或缺评论页时输出"待验证"。
- B0C1AQUPET｜高频好评：Amazing for my long-haired cat；Smells wonderful and gentle｜高频差评：Bottle is too small｜来源：Amazon 评论页 https://www.amazon.com/product-reviews/B0C1AQUPET（采买日期 2026-08-18）
- B0D2DOGCAT｜高频好评：Best waterless shampoo for golden retriever｜高频差评：Made my dog itch｜来源：Amazon 评论页 https://www.amazon.com/product-reviews/B0D2DOGCAT（采买日期 2026-08-18）
- B0E3LIVGRN｜高频好评：My puppy loves the lavender scent｜高频差评：Leaves residue on dark fur｜来源：Amazon 评论页 https://www.amazon.com/product-reviews/B0E3LIVGRN（采买日期 2026-08-18）
- B0F4SAMPLE｜高频好评：Multi-pet household must-have｜高频差评：待验证｜来源：Amazon 评论页 https://www.amazon.com/product-reviews/B0F4SAMPLE（采买日期 2026-08-18）

## 阶段3+ 竞品详情页 bullet 摘要（纯聚合，不调大模型）
- 口径：仅 DIRECT 竞品的 Amazon 详情页 bullet points，截前 2 条并限 80 字符；bullet 缺失时输出"待验证"。
- B0C1AQUPET｜品牌 PawPure｜SKU 8oz / 16oz｜卖家 PawPure Direct｜核心结构/技术方案：WATERLESS CLEANSING - No-rinse formula gently removes dirt and odors from pet fu；GENTLE FOR SENSITIVE SKIN - Hypoallergenic with aloe vera and chamomile extracts｜来源：Amazon 详情页 https://www.amazon.com/dp/B0C1AQUPET（采买日期 2026-08-18）
- B0D2DOGCAT｜品牌 FurFresh｜SKU 250ml｜卖家 FurFresh Co.｜核心结构/技术方案：WATERLESS DOG SHAMPOO - Clean and deodorize without water；SAFE INGREDIENTS - Plant-based formula｜来源：Amazon 详情页 https://www.amazon.com/dp/B0D2DOGCAT（采买日期 2026-08-18）
- B0E3LIVGRN｜品牌 GreenPaw｜SKU 200ml｜卖家 GreenPaw LLC｜核心结构/技术方案：LAVENDER SCENT - Soothing aroma for stress relief｜来源：Amazon 详情页 https://www.amazon.com/dp/B0E3LIVGRN（采买日期 2026-08-18）
- B0F4SAMPLE｜品牌 CozyPet｜SKU 200ml / 500ml｜卖家 CozyPet Inc.｜核心结构/技术方案：MULTI-PET FORMULA - Safe for cats, dogs, and small animals；NATURAL INGREDIENTS - Plant-based formula with essential oils｜来源：Amazon 详情页 https://www.amazon.com/dp/B0F4SAMPLE（采买日期 2026-08-18）

## 快速市场利润率（每件｜USD）
- 口径：标准化销售价－采购价－Amazon佣金－FBA履约费－退货损耗－广告费－优惠券；不含国内物流、头程、关税、清关、入仓、仓储及固定成本，不能视为全成本落地利润率。
- 快速市场利润率：待验证（采购价（USD）（待核验）、Amazon佣金率（待核验）、FBA履约费（USD）（待核验）、退货损耗率（待核验）、广告费率（待核验）、优惠券成本（USD）（待核验）尚未完成确认；暂缺填零或候选预设不得参与利润复算）。

## 全成本落地利润率（每件｜USD）
- 口径：标准化销售价－采购价－Amazon佣金－FBA履约费－退货损耗－广告费－优惠券－包装/质检－国内物流－头程－关税－清关－入仓－仓储。
- 全成本落地利润率：待验证（采购价（USD）（待核验）、Amazon佣金率（待核验）、FBA履约费（USD）（待核验）、退货损耗率（待核验）、广告费率（待核验）、优惠券成本（USD）（待核验）、包装/质检（低）（待核验）、包装/质检（基准）（待核验）、包装/质检（高）（待核验）、国内物流（低）（待核验）、国内物流（基准）（待核验）、国内物流（高）（待核验）、头程（低）（待核验）、头程（基准）（待核验）、头程（高）（待核验）、关税（低）（待核验）、关税（基准）（待核验）、关税（高）（待核验）、清关（低）（待核验）、清关（基准）（待核验）、清关（高）（待核验）、入仓（低）（待核验）、入仓（基准）（待核验）、入仓（高）（待核验）、仓储（低）（待核验）、仓储（基准）（待核验）、仓储（高）（待核验）、目标贡献利润率（待核验）、差异化核验依据（待核验）、合规/IP核验依据（待核验）尚未完成确认；暂缺填零、候选类目费率或自动提取线索不得当作真实经营成本/核验结论）。

## 阶段5：Amazon 入场决策门禁
- 系统入场结论：❓ 数据不足，不能判定
- 门禁依据：关键经营输入尚未核验：采购价（USD）（待核验）、Amazon佣金率（待核验）、FBA履约费（USD）（待核验）、退货损耗率（待核验）、广告费率（待核验）、优惠券成本（USD）（待核验）、包装/质检（低）（待核验）、包装/质检（基准）（待核验）、包装/质检（高）（待核验）、国内物流（低）（待核验）、国内物流（基准）（待核验）、国内物流（高）（待核验）、头程（低）（待核验）、头程（基准）（待核验）、头程（高）（待核验）、关税（低）（待核验）、关税（基准）（待核验）、关税（高）（待核验）、清关（低）（待核验）、清关（基准）（待核验）、清关（高）（待核验）、入仓（低）（待核验）、入仓（基准）（待核验）、入仓（高）（待核验）、仓储（低）（待核验）、仓储（基准）（待核验）、仓储（高）（待核验）、目标贡献利润率（待核验）、差异化核验依据（待核验）、合规/IP核验依据（待核验）。暂缺填零、候选费率和自动提取线索均不得支持“建议入场”。
- 报告最终结论必须与系统入场结论完全一致；不得因样本数量、模型评分或销售话术自行上调结论。
```
