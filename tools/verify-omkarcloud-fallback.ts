#!/usr/bin/env node
import { describeOmkarCloudError } from '../src/shared/omkarCloud'
import { createSelectionReportPayload } from '../src/shared/selectionReportPayload'
import { renderSelectionReportMarkdown } from '../src/shared/selectionReportRenderer'

let failures = 0
function assert(label: string, ok: boolean): void { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures += 1 }

const quota = describeOmkarCloudError(400, { detail: 'You have exceeded your monthly request limit of 100. Please upgrade your plan or wait until your limit resets.' })
assert('额度耗尽返回可执行中文说明', quota.includes('当月请求额度已用尽') && quota.includes('Amazon 页面补充'))
assert('鉴权失败返回重新配置说明', describeOmkarCloudError(401, { detail: 'Invalid API key' }).includes('重新保存并测试连接'))
assert('一般HTTP错误保留服务端信息', describeOmkarCloudError(500, { detail: 'upstream unavailable' }).includes('upstream unavailable'))
const report = renderSelectionReportMarkdown(createSelectionReportPayload({
  info: { title: '宠物免洗擦浴精华', confirmedProductName: '宠物免洗擦浴精华', url: 'https://detail.1688.com/offer/fallback.html' },
  targetPlatform: 'Amazon美国站',
  marketDataNotice: quota
}))
assert('额度降级信息写入固定大盘表', report.includes('数据源状态') && report.includes('当月请求额度已用尽'))
if (failures) process.exitCode = 1
