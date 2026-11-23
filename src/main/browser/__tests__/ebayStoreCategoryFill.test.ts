import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ebayStoreCategoryFillPlan } from '../ebayLocalFill'

describe('ebayStoreCategoryFillPlan 店铺类别弹窗计划', () => {
  it('类目ID纯数字且名称非空才出计划，与政策 byPolicyId 同口径不按名称猜', () => {
    expect(ebayStoreCategoryFillPlan({ categoryId: '', categoryName: 'Car maintenance and repair' })).toBeNull()
    expect(ebayStoreCategoryFillPlan({ categoryId: 'abc', categoryName: 'X' })).toBeNull()
    expect(ebayStoreCategoryFillPlan({ categoryId: '42344397010', categoryName: '  ' })).toBeNull()
    expect(ebayStoreCategoryFillPlan({ categoryId: '42344397010', categoryName: 'Car maintenance and repair' })).toEqual({ categoryId: '42344397010', categoryName: 'Car maintenance and repair' })
  })
})

describe('页内脚本店铺类别弹窗写链源码守卫', () => {
  const src = fs.readFileSync(path.join(__dirname, '../BrowserWorkspace.ts'), 'utf8')
  const start = src.indexOf('private buildRevisionFillScript')
  const end = src.indexOf('async prepareEbayLocalProductRevision')
  const body = src.slice(start, end)
  it('按ID命中弹窗radio、点完成、回读落定才算填；命不中关闭弹窗并点名跳过', () => {
    expect(body).toContain('button[name="primaryStoreCategoryId"]')
    expect(body).toContain('dialog-sidepane')
    expect(body).toContain('input[type="radio"][name="primaryStoreCategoryId"]')
    expect(body).toContain('clean(node.value)===clean(storePlan.categoryId)')
    expect(body).toContain('lightbox-dialog__close')
    expect(body).toContain("filledFields.push('店铺类别')")
    expect(body).toContain("skippedFields.push('店铺类别")
  })
  it('自动填写与准备发布两个调用点都传店铺类别计划', () => {
    expect(src).toContain('ebayStoreCategoryFillPlan(product)')
    const calls = [...src.matchAll(/buildRevisionFillScript\(payload,targets,policyPlan,storePlan\)/g)]
    expect(calls.length).toBe(2)
  })
})