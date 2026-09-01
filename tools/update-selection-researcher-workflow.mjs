/**
 * 选品调研员Agent 工作流重构（MaxKB admin API，不发布）
 *
 * 目标应用：选品调研员Agent（复制自深度研究 Agent）
 * 业务：1688 选品 → 目标平台（默认亚马逊美国站）竞争力调研 →
 *       按《跨境AI选品调研员·标准分析报告》六部分 11 表格式合同输出报告。
 *
 * 拓扑（新）：
 *   开始 → 意图识别 ─┬─ 有效 ─→ 问题优化 ─┬→ 图片理解 ────┐(异常也汇入)
 *                    │                     ├→ 知识库检索 ──┤
 *                    │                     ├→ 1688抓取 ────┼→ 报告生成 → 质量门(判断器)
 *                    │                     ├→ 市场深度调研 ┤                ├ IF → 变量聚合
 *                    │                     └→ Amazon-Skills┘                └ ELSE → 兜底重写 → 变量聚合
 *                    ├─ 不足 ─→ 指定回复1                                   变量聚合(条件=OR) → 参数提取
 *                    └─ 其他 ─→ 指定回复2                                   → Markdown转HTML → 最终回复
 *                                                                            兜底重写异常 → 指定回复4
 *
 * 引擎语义依据（v2.10.5 commit 01b21db）：
 * - get_reference_field 对未执行节点返回 None（提示词占位渲染为空串），不抛异常
 * - 节点 condition='AND' 时，汇聚节点等待所有入边源节点执行完毕（含异常执行）
 * - 节点 condition='OR' 时，任一条入边触发即执行（用于互斥分支汇入变量聚合）
 * - enableException 节点的异常分支锚点为 {id}_exception_right，异常节点同样计入 node_context
 *
 * 运行：node tools/update-selection-researcher-workflow.mjs [--dry-run]
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(ROOT, '.env.local')
const DRY_RUN = process.argv.includes('--dry-run')

// ─── 常量 ─────────────────────────────────────────────────────
const APP_ID = '01a043e0-d19b-7f20-8420-cfe8dad604a0' // 选品调研员Agent
const AMAZON_SKILLS_APP_ID = '01a005f0-a471-7403-9d78-8702d5765816'
const KB1_ID = '01a00117-e215-7e90-b6ed-e782da8ddbb1' // 跨境运营知识库
const QWEN_FLASH_ID = '01a000f4-9bde-7e40-84e3-4e2f8867e2ab' // 兜底重写用（低成本）
const LUNA = { model_id: '01a043ee-be22-7e62-bd37-9617379ebb15', provider: 'model_openai_provider', model_name: 'gpt-5.6-luna' }
const QWEN_FLASH = { model_id: QWEN_FLASH_ID, provider: 'aliyun_bai_lian_model_provider', model_name: 'qwen3.6-flash' }
const VISION_MODEL_NAME = 'qwen3-vl-plus'

// 既有节点 ID
const ID = {
  intent: 'fae46337-6335-4988-bb2f-20b16895f9e0',
  reply1: 'aad8058f-19eb-4cfd-a192-f361e8da4188',
  reply2: '45b23522-57e9-49e4-ba74-8184923e2b21',
  dr: '0bca4262-325b-4823-8839-d7245ecf8432', // 市场深度调研（原 DeepResearch）
  condition: '9f55d665-e57f-4029-a8c6-2f492af39975', // 质量门判断器
  param: '0d353bc7-44ca-43aa-9192-d3423609144b', // 参数提取
  tool: 'fa51d6bc-a3e2-4c67-b89a-f174ee33bda2', // Markdown转HTML工具
  finalReply: 'ceefd8ec-4728-4c0a-972f-9666ef227b79',
  reply4: '9fc37c3d-209b-4372-8481-a6f5bafbb7d9', // 兜底重写异常回复
  removeReply: 'c750a6f1-3be2-4b90-8cdc-f2aba997d674', // 原 DeepResearch 异常回复（删除）
}
// 新增节点 ID（固定，便于幂等与引用）
const NEW = {
  qn: 'sel-question-node', // 问题优化
  iu: 'sel-image-node', // 图片理解
  sk: 'sel-knowledge-node', // 知识库检索
  t1688: 'sel-1688-tool-node', // 1688抓取
  eq: 'sel-expert-question-node', // 专家提问（收窄子智能体问题）
  app: 'sel-amazon-node', // Amazon-Skills 子智能体
  rg: 'sel-report-node', // 报告生成
  fb: 'sel-fallback-node', // 兜底重写
  va: 'sel-aggregate-node', // 变量聚合（first_non_null）
  bar: 'sel-barrier-node', // 调研汇合（AND 屏障，只收正常边）
}
const BR = { valid: 'QtoRGYrd_gI4gxulMNA3H', lack: 'XvZCYQPYaS-h27tO3jo0n', other: 'tvePyzJ3Sezqf9xFRtH5g' }
const COND = { pass: 'k0SIHImQ2Rh7-ztEcre14', fail: 'AXXLoOThyo-bQpfXBeSf_' }

// ─── 提示词 ───────────────────────────────────────────────────
const PROLOGUE = `您好！我是跨境AI选品调研员。给我一款 1688 产品（商品链接、产品图片，或直接描述），并告诉我目标销售平台与市场（如：亚马逊美国站），我将为您产出《跨境AI选品调研员·标准分析报告》：
本品基础信息解析 → 细分市场大盘调研 → 本品与核心竞品多维对比 → 头部竞店竞争实力拆解 → 入市机会与盈利可行性判定 → 产品改良方案与长期市场机会。

示例：
- 帮我调研这款产品能不能上亚马逊美国站：https://detail.1688.com/offer/xxxxx.html
- （上传产品图片）这款保温杯在亚马逊美国站有机会吗？`

const APP_DESC = '1688 选品 → 目标平台（默认亚马逊美国站）竞争力调研，输出六部分 11 表标准分析报告'

const QN_SYSTEM = '你是跨境电商选品调研任务澄清专家，负责把用户输入改写为一条可直接执行的选品调研任务指令。'
const QN_PROMPT = `用户输入：{{开始.question}}
当前时间：{{global.time}}

请改写为一条清晰完整的选品调研任务指令，必须包含：
1. 产品对象：1688 商品链接原样保留；若为图片/文字描述，则概述产品品类、材质与规格；
2. 来源平台：未说明时默认 1688；
3. 目标销售平台与市场：未说明时默认亚马逊美国站。

只输出改写后的任务指令文本本身，不要解释，不要输出其他内容。`

const EQ_SYSTEM = '你是任务收窄专家，负责把选品调研任务改写成一条只问“入市机会”的简短提问。'
const EQ_PROMPT = `调研任务：{{问题优化.answer}}

请改写为一条不超过 60 字的提问，只问该产品在目标平台的入市机会与整体判断（如：“评估XX产品在亚马逊美国站的入市机会，给出结构化专家判断”）。
禁止出现以下词汇（会触发不必要的技能调用）：关键词、竞品、利润、FBA、Listing、PPC、合规、价格带、认证。
只输出提问本身。`

const T1688_CODE = `"""
1688 产品信息抓取工具（防御式）
从用户输入中提取 1688 商品链接并抓取标题/价格/页面要点；
任何失败都返回结构化结果，绝不抛异常（失败时 status 标记 no_url/empty/error）。
"""
import re
import requests

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def _strip_html(s):
    s = re.sub(r"<script[\\s\\S]*?</script>", " ", s or "")
    s = re.sub(r"<style[\\s\\S]*?</style>", " ", s)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\\s+", " ", s).strip()


def main(text: str):
    text = text or ""
    m = re.search(r"https?://detail\\.1688\\.com/offer/[0-9]+\\.html[^\\s'\\"<>]*", text)
    if not m:
        m = re.search(r"https?://[^\\s'\\"<>]*1688\\.com[^\\s'\\"<>]*", text)
    if not m:
        return {"status": "no_url",
                "message": "输入中未发现 1688 商品链接，本次未抓取，请依据图片分析与用户描述推进",
                "url": "", "title": "", "price": "", "attrs": ""}
    url = m.group(0).rstrip("，。,.")
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"}, timeout=20)
        body = r.text or ""
        title = ""
        tm = re.search(r"<title>([\\s\\S]*?)</title>", body)
        if tm:
            title = _strip_html(tm.group(1)).replace("-阿里巴巴", "").strip()
        price = ""
        pm = re.search(r'"price"\\s*:\\s*"?([0-9]+(?:\\.[0-9]+)?)', body)
        if pm:
            price = pm.group(1) + " 元（1688 页面价，仅供成本参考）"
        attrs = _strip_html(body)[:1500] if r.status_code == 200 else ""
        ok = bool(title or attrs)
        return {"status": "ok" if ok else "empty",
                "message": "抓取成功" if ok else "页面为空或被反爬拦截，请依据图片分析与用户描述推进",
                "url": url, "title": title, "price": price, "attrs": attrs}
    except Exception as e:
        return {"status": "error",
                "message": f"抓取失败：{type(e).__name__}，请依据图片分析与用户描述推进",
                "url": url, "title": "", "price": "", "attrs": ""}
`

const IU_SYSTEM = '你是跨境电商产品图片分析师，擅长从产品主图/细节图中提取可用于选品判断的结构化信息。'
const IU_PROMPT = `请分析用户上传的产品图片，输出以下要点（无图片可识别内容时直接说明"未提供可识别的产品图片"）：
1. 产品类型与所属品类；
2. 外观特征：材质、颜色、尺寸感、工艺细节；
3. 图中可见的文字、品牌、认证标识；
4. 包装、配件与组合销售线索；
5. 推测的目标使用场景与人群。
输出简洁的要点列表，不要编造图中不存在的信息。`

const DR_SYSTEM = `# 角色
你是一名跨境电商选品调研员，职责是"锁事实"：围绕给定产品在目标平台（默认亚马逊美国站）收集并核实市场事实。你不做入市判定，那是分析师的职责。

# 任务步骤
1. 把调研任务拆为子问题：品类大盘（规模/趋势/季节性）、价格带分布、头部竞品与竞店、评论高频痛点、合规与认证门槛、成本与物流线索。
2. 调用已挂载的搜索工具/技能获取资料；无可用工具时基于自身知识作答并在开头声明"本次基于模型知识"。
3. 输出完整的 Markdown 调研事实清单。

# 规则
- 【P0 数据真实性】工具返回的数据直接引用并标明来源；来自模型知识的内容必须加限定语（约/左右/大致），禁止编造精确数字、日期、公司名与来源。
- 只输出事实与线索，不写"建议进入/放弃"类判定。
- 不确定的内容写清信息缺口原因。

# 输出结构
用 ## 二级标题分节：品类大盘、价格带与销量线索、头部竞品清单、头部竞店清单、评论高频痛点、合规与认证要求、成本与物流线索、信息缺口说明。鼓励用表格呈现对比数据。一次性完整输出，不要用代码块包裹全文。
【篇幅硬约束】全文控制在 800 字以内：每节只保留对选品判定最关键的 2-4 条事实，每条一句话；不要写引言、总结与客套话。`
const DR_PROMPT = `调研任务：{{问题优化.answer}}
用户原始输入：{{开始.question}}
当前时间：{{global.time}}

按系统提示执行，输出完整 Markdown 调研事实清单。`

const RG_SYSTEM = `# 角色
你是跨境AI选品调研报告撰写人。请基于各调研节点的输出，撰写《跨境AI选品调研员·标准分析报告》。

# 格式合同（六大部分、11 张表格，逐字遵守，不得增删章节、不得修改表头）
## 第一部分：本品基础信息解析
- 表「本品基础信息表」，列：信息分类 | 明细项 | 本品数据 | 备注
## 第二部分：目标平台细分市场大盘调研
- 表「2.1 细分市场大盘数据」，列：统计指标 | 大盘数据 | 区间分布 | 市场判断
- 表「2.2 类目推荐」，列：推荐类目 | 类目路径 | 推荐理由 | 竞争程度 | 机会判断 | 备注
- 表「2.3 合规与IP风险」，列：核验项 | 本品情况 | 平台/法规要求 | 证据与来源 | 处理建议
## 第三部分：本品与核心竞品多维对比
- 表「核心竞品对比表」，列：对比维度 | 本品 | 竞品1 | 竞品2 | 竞品3 | 结论
## 第四部分：头部竞店竞争实力拆解
- 表「头部竞店拆解表」，列：竞店/品牌 | 核心产品 | 价格带 | 评分/评论 | 流量/销量线索 | 差异化卖点 | 运营动作 | 可借鉴点
## 第五部分：入市机会与盈利可行性判定
- 表「5.1 利润测算表」，列：测算项目 | 快速市场口径 | 全成本口径 | 证据/说明
- 表「5.2 入市机会评估表」，列：评估维度 | 证据与结果 | 风险 | 建议动作
- 表「5.3 最终入市判定」，列：决策项 | 结论
## 第六部分：产品改良方案与长期市场机会
- 表「6.1 本品改良优化清单表」，列：改良方向 | 具体优化方案 | 对应痛点/竞品 | 改造成本 | 预期效果
- 表「6.2 长期市场机会」，列：机会方向 | 验证与落地建议

# 写作规则
1. 报告标题用一级标题：# 跨境AI选品调研报告：{产品名}（{目标平台市场}）
2. 数据真实性：调研材料中有来源的数据照写并标注来源；材料缺失时给出区间估计并标注「待验证」；绝不编造精确数字。
3. 每个部分先用 2-4 句陈述段概述，再给出该部分全部表格；表格单元格不得留空，无数据写「待验证」。
4. 第五部分必须给出明确判定（建议入市 / 谨慎观望 / 不建议入市）并说明理由；利润测算区分快速市场口径与全成本口径。
5. 【篇幅约束】表格单元格保持精简（每项 1 句以内），陈述段 2-3 句即可；全文目标 2000-3000 字，不要重复铺陈相同信息。
6. 【表格完整性】上述 11 张表格必须全部出现，一张都不能少；数据缺失时保留表头与至少一行，单元格写「待验证」，不得省略整表。
7. 只输出 Markdown 正文，不要用代码块包裹全文，一次性完整输出。`
const RG_PROMPT = `调研任务：{{问题优化.answer}}
当前时间：{{global.time}}

【知识库检索结果（平台规则/运营知识）】
{{知识库检索.data}}

【1688 产品信息抓取结果】
{{1688抓取.result}}

【产品图片分析】
{{图片理解.answer}}

【市场与竞品深度调研（事实清单）】
{{市场深度调研.answer}}

【亚马逊平台专家判断（Amazon-Skills 子智能体）】
{{Amazon-Skills.result}}

请按系统提示中的格式合同撰写完整报告。`

const FB_SYSTEM = `你是报告结构修复专家。用户会给你一份结构不完整的选品报告初稿，请将其修复为完整标准结构：
六大部分（第一部分：本品基础信息解析 / 第二部分：目标平台细分市场大盘调研 / 第三部分：本品与核心竞品多维对比 / 第四部分：头部竞店竞争实力拆解 / 第五部分：入市机会与盈利可行性判定 / 第六部分：产品改良方案与长期市场机会）。
必须包含以下全部表格（表名逐字出现，缺数据写「待验证」，不得省略任何一张）：
「本品基础信息表」「2.1 细分市场大盘数据」「2.2 类目推荐」「2.3 合规与IP风险」「核心竞品对比表」「头部竞店拆解表」「5.1 利润测算表」「5.2 入市机会评估表」「5.3 最终入市判定」「6.1 本品改良优化清单表」「6.2 长期市场机会」。
规则：
1. 沿用初稿中的事实与数据，不得新增编造数据；缺失内容写「待验证」；
2. 章节标题逐字使用"第一部分：…"至"第六部分：…"；
3. 只输出修复后的完整 Markdown 报告正文，不要用代码块包裹。`
const FB_PROMPT = `报告初稿如下：

{{报告生成.answer}}

请输出修复后的完整报告。`

// ─── 助手函数 ─────────────────────────────────────────────────
const uuid = () => crypto.randomUUID()
const NODE_W = 330

function mkEdge(srcId, srcAnchor, srcX, tgtId, tgtX, tgtY) {
  const sx = srcX + NODE_W
  const sy = tgtY // 简化：与目标同高的贝塞尔折线
  const mx1 = sx + 110
  const mx2 = tgtX - 110
  return {
    id: uuid(), type: 'app-edge',
    endPoint: { x: tgtX, y: tgtY },
    pointsList: [{ x: sx, y: sy }, { x: mx1, y: sy }, { x: mx2, y: tgtY }, { x: tgtX, y: tgtY }],
    properties: {},
    startPoint: { x: sx, y: sy },
    sourceNodeId: srcId, targetNodeId: tgtId,
    sourceAnchorId: srcAnchor, targetAnchorId: `${tgtId}_left`,
  }
}

const chatFields = () => ([
  { label: 'AI 回答内容', value: 'answer' },
  { label: '思考过程', value: 'reasoning_content' },
  { label: '历史聊天记录', value: 'history_message' },
])

async function loadEnv() {
  const envRaw = await fsp.readFile(ENV_FILE, 'utf8')
  return Object.fromEntries(
    envRaw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
      const i = l.indexOf('=')
      return i === -1 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
  )
}

// ─── 主流程 ───────────────────────────────────────────────────
async function main() {
  const env = await loadEnv()
  const BASE = (env.MAXKB_BASE_URL || 'http://114.55.149.192:8080').replace(/\/+$/, '')

  const loginRes = await fetch(`${BASE}/admin/api/user/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.MAXKB_ADMIN_PASSWORD || '' })
  })
  const TOKEN = (await loginRes.json())?.data?.token
  if (!TOKEN) { console.error('FAIL: admin 登录失败'); process.exit(1) }
  const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

  // 视觉模型必须已注册（tools/add-maxkb-vision-model.mjs）
  const models = (await (await fetch(`${BASE}/admin/api/workspace/default/model`, { headers: H })).json())?.data || []
  const vision = models.find(m => m.model_name === VISION_MODEL_NAME && m.model_type === 'IMAGE')
  if (!vision) { console.error(`FAIL: 未找到 IMAGE 视觉模型 ${VISION_MODEL_NAME}，请先运行 node tools/add-maxkb-vision-model.mjs`); process.exit(1) }
  console.log(`OK: 视觉模型 id=${vision.id} (${vision.name})`)

  // 拉取当前应用
  const appRes = await fetch(`${BASE}/admin/api/workspace/default/application/${APP_ID}`, { headers: H })
  const appBody = await appRes.json()
  if (appRes.status !== 200 || !appBody?.data) { console.error('FAIL: 拉取应用失败', JSON.stringify(appBody).slice(0, 300)); process.exit(1) }
  const app = appBody.data
  const wf = app.work_flow
  const nodes = wf.nodes
  const byId = id => nodes.find(n => n.id === id)
  if (!byId(ID.intent) || !byId(ID.dr) || !byId(ID.tool)) { console.error('FAIL: 既有节点缺失，应用结构与预期不符'); process.exit(1) }

  // ═══ 1. 应用层：开启文件上传 ═══
  app.file_upload_enable = true
  app.file_upload_setting = { image: true, document: false, audio: false, video: false, other: false, maxFiles: 3, fileLimit: 10, otherExtensions: '' }
  app.desc = APP_DESC
  // PUT 校验要求 knowledge_setting / model_setting 为完整结构（GET 可能返回 {}，需补齐）
  if (!app.knowledge_setting || app.knowledge_setting.top_n == null) {
    app.knowledge_setting = {
      top_n: 5, similarity: 0.3, search_mode: 'blend', max_paragraph_char_number: 3000,
      no_references_setting: { status: 'designated_answer', value: '当前知识库未找到相关内容，以下回答基于模型知识。' },
    }
  }
  if (!app.model_setting || app.model_setting.no_references_prompt == null) {
    app.model_setting = { prompt: '', system: '', no_references_prompt: '' }
  }

  // ═══ 2. base-node：开场白 / 描述 / 模型选择器指向现有可用模型 ═══
  const base = byId('base-node')
  base.properties.node_data.prologue = PROLOGUE
  base.properties.node_data.desc = APP_DESC
  const modelField = (base.properties.user_input_field_list || []).find(f => f.input_type === 'Model' || f.field === 'model')
  if (modelField?.attrs?.provider_list?.[0]?.model_form_field) {
    const formTpl = modelField.attrs.provider_list[0].model_form_field
    modelField.attrs.provider_list = [
      { ...LUNA, model_form_field: formTpl, model_params_setting: { max_tokens: 60000, temperature: 0.3 } },
      { ...QWEN_FLASH, model_form_field: formTpl, model_params_setting: { max_tokens: 60000, temperature: 0.3 } },
    ]
    console.log('OK: base-node 模型选择器已指向 Luna / Qwen Flash')
  } else {
    console.warn('WARN: base-node 未找到 Model 输入字段，跳过模型选择器更新')
  }
  // 表单三字段默认值：发布页不填表单也能跑通全链路。
  // model 默认 Luna；upload 凭据默认本服务地址 + 当前 admin token（token 过期后重跑本脚本即可刷新默认值）。
  for (const f of base.properties.user_input_field_list || []) {
    if (f.field === 'model') f.default_value = { model_id: LUNA.model_id, model_params_setting: { max_tokens: 60000, temperature: 0.3 } }
    if (f.field === 'upload_url') f.default_value = BASE
    if (f.field === 'upload_headers') f.default_value = TOKEN
    // 上传凭据字段对发布页隐藏：公共频道运行时曾被客户端旧表单缓存污染（掩码脏值 xxx:8882 导致上传 DNS 失败）
    if (f.field === 'upload_url' || f.field === 'upload_headers') f.show = false
  }
  console.log('OK: base-node 表单默认值已修正（model / upload_url / upload_headers）')

  // ═══ 3. start-node：暴露图片字段 ═══
  const start = byId('start-node')
  if (!start.properties.config.fields.some(f => f.value === 'image')) {
    start.properties.config.fields.push({ label: '产品图片', value: 'image' })
  }

  // ═══ 4. 意图识别：三分支改为选品语义 ═══
  const intent = byId(ID.intent)
  const branchMap = {
    [BR.valid]: '有效选品调研请求（优先选择本分支）：用户输入包含以下任一线索即属于本分支：①商品链接（如 1688/亚马逊等网址）；②提到产品图片（“图中/图片/这张图/上传的产品/附件”）；③具体产品名称或描述（如保温杯、手机壳、服装、家居用品等任何商品）。示例：“这款保温杯在亚马逊美国站有机会吗”“请调研图中产品”“帮我调研这个链接”。即使同时包含问候语或疑问句式也属于本分支。即使用户在复述/引用上一轮的示例话术（如以“1688 商品链接 + 目标平台市场：”开头），只要输入中出现真实链接、附件图片或具体商品名，也必须判入本分支',
    [BR.lack]: '信息不足：用户想做选品调研但没有任何产品线索，例如仅打招呼后说“帮我选品”“推荐个产品”，无链接、无图片描述、无具体商品名',
    [BR.other]: '其他：仅当用户输入与产品、图片、链接完全无关时才选此项，例如纯闲聊、问天气、问你是谁。禁止规则：输入中只要出现任何网址链接、商品名称或图片相关表述，一律不得选此项',
  }
  for (const b of intent.properties.node_data.branch) if (branchMap[b.id]) b.content = branchMap[b.id]
  // 意图判断：锁 Flash + temp=0 + 不带历史；根因：qwen3 系默认开 thinking，max_tokens=800 被思考流占满、JSON 被截断→解析失败→静默兜底"其他"（answer_tokens=802 实测），需留足思考预算
  intent.properties.node_data.model_id = QWEN_FLASH_ID
  intent.properties.node_data.model_id_type = 'custom'
  intent.properties.node_data.model_id_reference = []
  intent.properties.node_data.model_params_setting = { max_tokens: 8000, temperature: 0 }
  intent.properties.node_data.dialogue_number = 0

  // ═══ 5. 指定回复1/2 文案 ═══
  byId(ID.reply1).properties.node_data.content =
    '您提供的信息还不足以启动选品调研，请补充：\n1. 产品信息：1688 商品链接、产品图片，或具体的产品名称与规格描述（至少其一）；\n2. 目标销售平台与市场（如：亚马逊美国站）。'
  byId(ID.reply2).properties.node_data.content =
    '我是跨境AI选品调研员，请直接发送选品调研请求，例如：\n- 1688 商品链接 + 目标平台市场：帮我调研这款产品能不能上亚马逊美国站：https://detail.1688.com/offer/xxxxx.html\n- 上传产品图片并说明目标市场：这款保温杯在亚马逊美国站有机会吗？'
  byId(ID.reply4).properties.node_data.content =
    '调研链路出现异常（某个调研节点执行失败且无法恢复）。请稍后重试，或简化输入：仅提供 1688 商品链接/产品图片 + 目标平台市场。'
  byId(ID.reply4).properties.condition = 'OR' // 5 条异常入边 + 兜底异常入边，任一触发即回复

  // ═══ 6. 市场深度调研（原 DeepResearch）：改为调研员角色 ═══
  const dr = byId(ID.dr)
  dr.properties.stepName = '市场深度调研'
  dr.x = 2100; dr.y = 4560
  dr.properties.node_data.system = DR_SYSTEM
  dr.properties.node_data.prompt = DR_PROMPT
  dr.properties.enableException = true
  // 锁定更快的事实型模型（Qwen Flash），不跟随全局选择器（调试时传入的 Luna 推理慢，曾独占 350s+ 拖垮全链路）
  dr.properties.node_data.model_id = QWEN_FLASH_ID
  dr.properties.node_data.model_id_type = 'custom'
  dr.properties.node_data.model_id_reference = []
  dr.properties.node_data.model_params_setting = { max_tokens: 2000, temperature: 0.2 }
  // 移除损坏的“深度搜索”技能（zip 包内容触发 ValidationError，确定性失败）；
  // 同时清空 tool_ids（019ddc74 为孤儿工具，GET 定义即报 NoneType 错误，会拖入工具调用循环）；
  // 节点降级为“基于模型知识”，系统提示词已含声明策略。
  dr.properties.node_data.skill_tool_ids = []
  dr.properties.node_data.tool_ids = []

  // ═══ 7. 质量门判断器：按格式合同把关 ═══
  const cond = byId(ID.condition)
  cond.x = 5400; cond.y = 3900
  cond.properties.node_data.branch = [
    {
      id: COND.pass, type: 'IF', condition: 'and',
      conditions: [
        { field: [NEW.rg, 'answer'], value: '第一部分', compare: 'contain' },
        { field: [NEW.rg, 'answer'], value: '第六部分', compare: 'contain' },
        // 关键表名合同（六大部分各自的代表表，防止只写章节不写表）
        { field: [NEW.rg, 'answer'], value: '基础信息表', compare: 'contain' },
        { field: [NEW.rg, 'answer'], value: '大盘数据', compare: 'contain' },
        { field: [NEW.rg, 'answer'], value: '竞品对比', compare: 'contain' },
        { field: [NEW.rg, 'answer'], value: '竞店', compare: 'contain' },
        { field: [NEW.rg, 'answer'], value: '利润测算', compare: 'contain' },
        { field: [NEW.rg, 'answer'], value: '最终入市判定', compare: 'contain' },
        { field: [NEW.rg, 'answer'], value: '改良', compare: 'contain' },
        { field: [NEW.rg, 'answer'], value: '1500', compare: 'len_gt' },
      ],
    },
    { id: COND.fail, type: 'ELSE', condition: 'and', conditions: [] },
  ]

  // ═══ 8. 参数提取：输入改为变量聚合的 final_md ═══
  const param = byId(ID.param)
  param.x = 7200; param.y = 3900
  param.properties.node_data.input_variable = [NEW.va, 'final_md']
  // 锁定模型：原为引用全局 model，发布页表单不传 model 时后段断链；参数提取为纯结构化抽取，Flash 足够
  param.properties.node_data.model_id = QWEN_FLASH_ID
  param.properties.node_data.model_id_type = 'custom'
  param.properties.node_data.model_id_reference = []

  // ═══ 9. Markdown转HTML / 最终回复 ═══
  const toolNode = byId(ID.tool)
  toolNode.x = 7900; toolNode.y = 3900
  // 修复 file_id 解析：上传端点实际返回相对路径 "./oss/file/{file_id}"，
  // 原正则 r"/oss/file/..." 要求前导斜杠导致匹配失败 → download_url 恒为空。
  // 幂等：已修复过的代码不含旧正则，replace 不生效、不破坏。
  const oldRe = 'r"/oss/file/([^/]+)/?"'
  if (toolNode.properties.node_data.code.includes(oldRe)) {
    toolNode.properties.node_data.code = toolNode.properties.node_data.code.replace(oldRe, 'r"oss/file/([^/]+)"')
    console.log('OK: 已修补 Markdown转HTML 工具的 file_id 解析正则（兼容 ./oss/file/ 相对路径）')
  }
  // filename 入参兜底：参数提取的 issue 可能为空（is_required=true 会直接抛异常中断链路）；
  // 置为非必填后工具内部会自动从 Markdown 首个 # 标题提取文件名。
  // 上传凭据改为字面量输入（source=custom），切断“表单→全局变量”链路被客户端缓存污染的路径。
  for (const f of toolNode.properties.node_data.input_field_list || []) {
    if (f.name === 'filename') f.is_required = false
    if (f.name === 'upload_url') { f.source = 'custom'; f.value = BASE }
    if (f.name === 'upload_headers') { f.source = 'custom'; f.value = TOKEN }
  }
  // ── 工具代码：仓库规范文件为唯一事实源（含 Word 二次上传 / 凭据兜底 / 标题保护），运行时注入当前凭据 ──
  const toolCodeTpl = await fsp.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "md2html-tool-code.py"), "utf8")
  toolNode.properties.node_data.code = toolCodeTpl
    .replace("__FALLBACK_UPLOAD_URL__", BASE)
    .replace("__FALLBACK_UPLOAD_HEADERS__", TOKEN)
  console.log("OK: Markdown转HTML 工具代码已整体覆盖（Word 二次上传 / 凭据兜底 / 标题保护）")
  // 工具节点开启异常保护，异常时走指定回复4，不再把 Exception 原文吐给用户
  toolNode.properties.enableException = true
  const finalReply = byId(ID.finalReply)
  finalReply.x = 8700; finalReply.y = 3900
  // 呈现模式对齐桌面端：报告正文直接在对话框内渲染，文末附 Word / HTML 双下载链接
  const toolName = toolNode.properties.stepName
  const paramName = byId(ID.param).properties.stepName
  finalReply.properties.node_data.content =
    `{{${paramName}.md_text}}\n\n---\n📎 报告下载（30 分钟内有效）：\n- [下载 Word 版（.doc）]({{${toolName}.result.word_url}})\n- [下载 HTML 版（.html）]({{${toolName}.result.download_url}})`
  byId(ID.reply4).x = 6600; byId(ID.reply4).y = 4800

  // ═══ 10. 删除原 DeepResearch 异常回复节点 ═══
  const rmIdx = nodes.findIndex(n => n.id === ID.removeReply)
  if (rmIdx >= 0) nodes.splice(rmIdx, 1)

  // ─── 幂等：若新增节点已存在则先移除再重建 ───
  for (const nid of Object.values(NEW)) {
    const i = nodes.findIndex(n => n.id === nid)
    if (i >= 0) nodes.splice(i, 1)
  }

  console.log('OK: 既有节点改写完成，开始构建新节点…')

  // ═══ 11. 新增节点 ═══
  const POS = { qn: [1400, 3830], iu: [2100, 3200], sk: [2100, 3600], t1688: [2100, 4080], eq: [2100, 4750], app: [2600, 5050], bar: [2800, 3900], rg: [3300, 3900], fb: [6000, 4500], va: [6600, 3900] }
  const mkNode = (id, type, stepName, x, y, props) => ({
    x, y, id, type,
    properties: { config: { fields: [] }, height: 512, showNode: true, stepName, condition: 'AND', enableException: false, ...props },
  })

  // 11.1 问题优化（开启异常保护：失败时用原始问题兜底，仍汇入主流程）
  nodes.push(mkNode(NEW.qn, 'question-node', '问题优化', ...POS.qn, {
    enableException: true,
    node_data: {
      // 锁定 Qwen Flash：原引用全局模型选择器，发布页不传 model 时断链，且空 model_id 会被前端编辑器改写；
      // 任务改写为短文本，Flash 足够且不受 Luna 限流影响
      model_id: QWEN_FLASH_ID, model_id_type: 'custom', model_id_reference: [],
      system: QN_SYSTEM, prompt: QN_PROMPT, dialogue_number: 1, is_result: false,
      model_params_setting: { max_tokens: 800, temperature: 0.3 },
    },
    config: { fields: [{ label: '优化结果', value: 'answer' }] },
  }))

  // 11.2 图片理解（IMAGE 视觉模型；未传图时走异常分支汇入报告生成）
  nodes.push(mkNode(NEW.iu, 'image-understand-node', '图片理解', ...POS.iu, {
    enableException: true,
    node_data: {
      model_id: vision.id, model_id_type: 'custom', model_id_reference: [],
      system: IU_SYSTEM, prompt: IU_PROMPT, dialogue_number: 1, dialogue_type: 'WORKFLOW',
      is_result: false, image_list: ['start-node', 'image'],
      model_params_setting: {}, model_setting: { reasoning_content_enable: false, reasoning_content_start: '<think>', reasoning_content_end: '</think>' },
    },
    config: { fields: chatFields() },
  }))

  // 11.3 知识库检索（跨境运营知识库，混合检索）——辅助节点：失败静默降级，不阻塞主链路（见边定义处注释）
  nodes.push(mkNode(NEW.sk, 'search-knowledge-node', '知识库检索', ...POS.sk, {
    enableException: true,
    node_data: {
      knowledge_id_list: [KB1_ID],
      knowledge_setting: { top_n: 8, similarity: 0.3, search_mode: 'blend', max_paragraph_char_number: 3000 },
      question_reference_address: [NEW.qn, 'answer'],
      show_knowledge: true,
      search_scope_type: 'custom', search_scope_source: 'knowledge', search_scope_reference: [],
    },
    config: { fields: [{ label: '检索结果', value: 'data' }, { label: '段落列表', value: 'paragraph_list' }] },
  }))

  // 11.4 1688抓取（inline Python，防御式）
  nodes.push(mkNode(NEW.t1688, 'tool-node', '1688抓取', ...POS.t1688, {
    enableException: true,
    node_data: {
      code: T1688_CODE, is_result: false,
      input_field_list: [
        { name: 'text', desc: '用户原始输入（用于提取 1688 商品链接）', type: 'string', source: 'reference', value: ['start-node', 'question'], is_required: true },
      ],
    },
    config: { fields: [{ label: '结果', value: 'result' }] },
  }))

  // 11.5a 专家提问（收窄为单一“入市机会”问题：多维任务会触发子智能体 8 个技能全部多轮调用，限流期撞断流上限）
  nodes.push(mkNode(NEW.eq, 'ai-chat-node', '专家提问', ...POS.eq, {
    enableException: true,
    node_data: {
      prompt: EQ_PROMPT, system: EQ_SYSTEM,
      model_id: QWEN_FLASH_ID, model_id_type: 'custom', model_id_reference: [],
      max_tokens: 300, temperature: 0.1,
      tool_ids: [], skill_tool_ids: [], mcp_source: 'referencing', mcp_servers: '', mcp_tool_ids: [], mcp_output_enable: false,
      dialogue_type: 'WORKFLOW', dialogue_number: 0, is_result: false,
      model_setting: { reasoning_content_enable: false, reasoning_content_start: '<think>', reasoning_content_end: '</think>' },
    },
    config: { fields: chatFields() },
  }))

  // 11.5 Amazon-Skills 子智能体（分析师：平台判断；问题来自专家提问节点，只触发选品技能）
  nodes.push(mkNode(NEW.app, 'application-node', 'Amazon-Skills', ...POS.app, {
    enableException: true,
    node_data: {
      application_id: AMAZON_SKILLS_APP_ID,
      question_reference_address: [NEW.eq, 'answer'],
      api_input_field_list: [], user_input_field_list: [],
      image_list: [], document_list: [], audio_list: [], video_list: [],
      child_node: null, node_data: null,
    },
    // 输出字段与服务端序列化行为对齐（application-node 归一化后只保留 result）；
    // RG_PROMPT 因此引用 {{Amazon-Skills.result}}——含连字符的字段名若无法被替换，
    // jinja2 会把 Amazon-Skills 解析为减法表达式导致 "'Skills' is undefined" 异常。
    config: { fields: [{ label: '结果', value: 'result' }] },
  }))

  // 11.6 调研汇合（AND 屏障：只收 5 条正常 _right 边，解决正常+异常边混接时 dependent_node 永不满足的问题）
  nodes.push(mkNode(NEW.bar, 'ai-chat-node', '调研汇合', ...POS.bar, {
    node_data: {
      prompt: '输出 OK 两个字符，不要输出其他内容。', system: '你是流程屏障节点，只需输出 OK。',
      model_id: QWEN_FLASH_ID, model_id_type: 'custom', model_id_reference: [],
      max_tokens: null, temperature: null,
      tool_ids: [], skill_tool_ids: [], mcp_source: 'referencing', mcp_servers: '', mcp_tool_ids: [], mcp_output_enable: false,
      dialogue_type: 'WORKFLOW', dialogue_number: 0, is_result: false,
      model_setting: { reasoning_content_enable: false, reasoning_content_start: '<think>', reasoning_content_end: '</think>' },
    },
    config: { fields: chatFields() },
  }))

  // 11.7 报告生成（六部分 11 表格式合同）
  nodes.push(mkNode(NEW.rg, 'ai-chat-node', '报告生成', ...POS.rg, {
    // 异常保护：失败时走指定回复4，避免无保护节点静默断链（用户只看到半截回答）
    enableException: true,
    node_data: {
      prompt: RG_PROMPT, system: RG_SYSTEM,
      // 锁定 Qwen Flash：Luna 在网关限流期流式速度会跌到 ~3 字/秒，4000+ 字报告必撞 320s 断流上限；
      // Flash 全程未受限流影响，且兜底重写已验证其能产出 11 表全齐的报告。
      model_id: QWEN_FLASH_ID, model_id_type: 'custom', model_id_reference: [],
      max_tokens: 4500, temperature: 0.3,
      tool_ids: [], skill_tool_ids: [], mcp_source: 'referencing', mcp_servers: '', mcp_tool_ids: [], mcp_output_enable: false,
      dialogue_type: 'WORKFLOW', dialogue_number: 1, is_result: false,
      model_setting: { reasoning_content_enable: false, reasoning_content_start: '<think>', reasoning_content_end: '</think>' },
    },
    config: { fields: chatFields() },
  }))

  // 11.7 兜底重写（质量门未过时修复结构；Qwen Flash 低成本）
  nodes.push(mkNode(NEW.fb, 'ai-chat-node', '兜底重写', ...POS.fb, {
    enableException: true,
    node_data: {
      prompt: FB_PROMPT, system: FB_SYSTEM,
      model_id: QWEN_FLASH_ID, model_id_type: 'custom', model_id_reference: [],
      max_tokens: 8000, temperature: 0.3,
      tool_ids: [], skill_tool_ids: [], mcp_source: 'referencing', mcp_servers: '', mcp_tool_ids: [], mcp_output_enable: false,
      dialogue_type: 'WORKFLOW', dialogue_number: 1, is_result: false,
      model_setting: { reasoning_content_enable: false, reasoning_content_start: '<think>', reasoning_content_end: '</think>' },
    },
    config: { fields: chatFields() },
  }))

  // 11.8 变量聚合（first_non_null：ELSE 路径优先取兜底重写结果，IF 路径取报告生成结果）
  //      condition='OR'：IF 分支与兜底重写互斥，任一入边触发即执行
  nodes.push(mkNode(NEW.va, 'variable-aggregation-node', '变量聚合', ...POS.va, {
    condition: 'OR',
    node_data: {
      strategy: 'first_non_null',
      group_list: [{
        id: 'grp-final-md', field: 'final_md', label: '最终报告',
        variable_list: [
          { v_id: 'var-fb', key: null, variable: [NEW.fb, 'answer'] },
          { v_id: 'var-rg', key: null, variable: [NEW.rg, 'answer'] },
        ],
      }],
    },
    config: { fields: [{ label: '最终报告', value: 'final_md' }, { label: '结果', value: 'result' }] },
  }))

  // ═══ 12. 边：全量重建 ═══
  const X = Object.fromEntries(nodes.map(n => [n.id, n.x]))
  const Y = Object.fromEntries(nodes.map(n => [n.id, n.y]))
  const E = (src, anchor, tgt) => mkEdge(src, `${src}_${anchor}`, X[src], tgt, X[tgt], Y[tgt] + 40)
  wf.edges = [
    // 开始 → 意图识别 → 三分支
    E('start-node', 'right', ID.intent),
    E(ID.intent, `${BR.valid}_right`, NEW.qn),
    E(ID.intent, `${BR.lack}_right`, ID.reply1),
    E(ID.intent, `${BR.other}_right`, ID.reply2),
    // 问题优化 → 五路并行（app 路先经专家提问收窄，避免子智能体多技能多轮调用拖垮全链路）
    E(NEW.qn, 'right', NEW.iu),
    E(NEW.qn, 'right', NEW.sk),
    E(NEW.qn, 'right', NEW.t1688),
    E(NEW.qn, 'right', ID.dr),
    E(NEW.qn, 'right', NEW.eq),
    E(NEW.eq, 'right', NEW.app),
    E(NEW.eq, 'exception_right', ID.reply4),
    E(NEW.qn, 'exception_right', ID.reply4),
    // 各核心调研节点正常边汇入屏障；异常边统一进故障恢复回复（避免混接破坏 AND 汇聚）。
    // 知识库检索为辅助节点：不进屏障、不接异常边——检索失败时静默降级（报告中引用渲染为空），不阻塞主链路；
    // 若接入屏障，其异常分支与正常边混接会导致 AND 汇聚永不满足（源码按分支锚点严格匹配）。
    ...[NEW.iu, NEW.t1688, ID.dr, NEW.app].map(src => E(src, 'right', NEW.bar)),
    ...[NEW.iu, NEW.t1688, ID.dr, NEW.app].map(src => E(src, 'exception_right', ID.reply4)),
    E(NEW.bar, 'right', NEW.rg),
    // 报告生成 → 质量门 → 通过直达聚合 / 未过先兜底重写；报告生成异常走故障恢复回复
    E(NEW.rg, 'right', ID.condition),
    E(NEW.rg, 'exception_right', ID.reply4),
    E(ID.condition, `${COND.pass}_right`, NEW.va),
    E(ID.condition, `${COND.fail}_right`, NEW.fb),
    E(NEW.fb, 'right', NEW.va),
    E(NEW.fb, 'exception_right', ID.reply4),
    E(ID.tool, 'exception_right', ID.reply4),
    // 聚合 → 参数提取 → HTML 转换 → 最终回复
    E(NEW.va, 'right', ID.param),
    E(ID.param, 'right', ID.tool),
    E(ID.tool, 'right', ID.finalReply),
  ]

  // ═══ 13. 静态校验 ═══
  const errs = []
  const nodeIds = new Set(nodes.map(n => n.id))
  for (const e of wf.edges) {
    if (!nodeIds.has(e.sourceNodeId)) errs.push(`边 ${e.id}: 源节点不存在 ${e.sourceNodeId}`)
    if (!nodeIds.has(e.targetNodeId)) errs.push(`边 ${e.id}: 目标节点不存在 ${e.targetNodeId}`)
  }
  const referenced = [
    ...byId(ID.condition).properties.node_data.branch.flatMap(b => b.conditions.map(c => c.field[0])),
    ...byId(ID.param).properties.node_data.input_variable.slice(0, 1),
    ...byId(NEW.va).properties.node_data.group_list.flatMap(g => g.variable_list.map(v => v.variable[0])),
    ...byId(NEW.app).properties.node_data.question_reference_address.slice(0, 1),
    ...byId(NEW.sk).properties.node_data.question_reference_address.slice(0, 1),
  ]
  for (const rid of referenced) if (!nodeIds.has(rid)) errs.push(`引用节点不存在: ${rid}`)
  if (byId(ID.tool).properties.node_data.input_field_list.some(f => f.source === 'reference' && !nodeIds.has(f.value[0]) && f.value[0] !== 'global')) errs.push('工具节点引用缺失')
  if (errs.length) { console.error('FAIL: 静态校验未通过:\n' + errs.join('\n')); process.exit(1) }
  console.log(`OK: 校验通过 — 节点 ${nodes.length} 个，边 ${wf.edges.length} 条`)

  if (DRY_RUN) {
    const out = path.join(ROOT, '.tmp-maxkb-researcher-app-new.json')
    await fsp.writeFile(out, JSON.stringify(app, null, 2))
    console.log(`DRY-RUN: 已写出 ${out}，未提交`)
    return
  }

  // ═══ 14. PUT 写回（不发布） ═══
  const putRes = await fetch(`${BASE}/admin/api/workspace/default/application/${APP_ID}`, {
    method: 'PUT', headers: H, body: JSON.stringify(app),
  })
  const putBody = await putRes.json()
  if (putRes.status !== 200 || putBody?.code !== 200) {
    console.error(`FAIL: PUT 应用失败 HTTP ${putRes.status}:`, JSON.stringify(putBody).slice(0, 800))
    process.exit(1)
  }
  console.log('OK: 工作流已写回（未发布）')

  // ═══ 15. 回读验收 ═══
  const verify = (await (await fetch(`${BASE}/admin/api/workspace/default/application/${APP_ID}`, { headers: H })).json())?.data
  const vNodes = verify?.work_flow?.nodes || []
  const vEdges = verify?.work_flow?.edges || []
  const checks = [
    ['文件上传已开启', verify?.file_upload_enable === true],
    ['节点数一致', vNodes.length === nodes.length],
    ['边数一致', vEdges.length === wf.edges.length],
    ['新增节点齐全', Object.values(NEW).every(id => vNodes.some(n => n.id === id))],
    ['旧异常回复已删除', !vNodes.some(n => n.id === ID.removeReply)],
    ['图片理解引用开始节点图片', JSON.stringify(vNodes.find(n => n.id === NEW.iu)?.properties?.node_data?.image_list) === JSON.stringify(['start-node', 'image'])],
    ['子智能体指向 Amazon-Skills', vNodes.find(n => n.id === NEW.app)?.properties?.node_data?.application_id === AMAZON_SKILLS_APP_ID],
    ['子智能体输出字段为 result', JSON.stringify(vNodes.find(n => n.id === NEW.app)?.properties?.config?.fields?.map(f => f.value)) === JSON.stringify(['result'])],
    ['RG 提示词引用 Amazon-Skills.result', vNodes.find(n => n.id === NEW.rg)?.properties?.node_data?.prompt?.includes('{{Amazon-Skills.result}}') === true],
    ['问题优化锁定 Flash（不再引用全局 model）', vNodes.find(n => n.id === NEW.qn)?.properties?.node_data?.model_id === QWEN_FLASH_ID && vNodes.find(n => n.id === NEW.qn)?.properties?.node_data?.model_id_type === 'custom'],
    ['参数提取锁定 Flash（不再引用全局 model）', byId(ID.param) && vNodes.find(n => n.id === ID.param)?.properties?.node_data?.model_id_type === 'custom'],
    ['dr/eq/bar/rg/fb 均锁定 Flash 未被改写', [ID.dr, NEW.eq, NEW.bar, NEW.rg, NEW.fb].every(id => vNodes.find(n => n.id === id)?.properties?.node_data?.model_id === QWEN_FLASH_ID)],
    ['意图识别锁定 Flash 且不带历史', vNodes.find(n => n.id === ID.intent)?.properties?.node_data?.model_id === QWEN_FLASH_ID && vNodes.find(n => n.id === ID.intent)?.properties?.node_data?.dialogue_number === 0],
    ['意图分支文案已强化（防复述误判）', (vNodes.find(n => n.id === ID.intent)?.properties?.node_data?.branch || []).some(b => b.id === BR.valid && b.content.includes('复述')) && (vNodes.find(n => n.id === ID.intent)?.properties?.node_data?.branch || []).some(b => b.id === BR.other && b.content.includes('一律不得'))],
  ]
  const vTool = vNodes.find(n => n.id === ID.tool)
  const vBase = vNodes.find(n => n.id === 'base-node')
  checks.push(
    ['工具含 Word 二次上传与凭据兜底', (vTool?.properties?.node_data?.code || '').includes('-- word-upload-v2 --') && (vTool?.properties?.node_data?.code || '').includes('FALLBACK_UPLOAD_URL')],
    ['工具上传凭据为字面量输入', (vTool?.properties?.node_data?.input_field_list || []).filter(f => ['upload_url', 'upload_headers'].includes(f.name)).every(f => f.source === 'custom' && !!f.value)],
    ['发布页隐藏上传凭据字段', (vBase?.properties?.user_input_field_list || []).filter(f => ['upload_url', 'upload_headers'].includes(f.field)).every(f => f.show === false)],
    ['最终回复内嵌正文与双下载链接', ['md_text', 'word_url', 'download_url', '下载 Word 版'].every(k => (vNodes.find(n => n.id === ID.finalReply)?.properties?.node_data?.content || '').includes(k))],
  )
  let fail = false
  for (const [name, ok] of checks) { console.log(`${ok ? 'OK ' : 'FAIL'}: ${name}`); if (!ok) fail = true }
  if (fail) process.exit(1)
  console.log(`\n完成。请到管理台核对连线后自行发布：${BASE}/admin/application/workspace/${APP_ID}/workflow`)
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
