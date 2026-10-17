import { describe, expect, it } from 'vitest'
import { flattenOntoWhite } from '../linduoImageReference'

describe('flattenOntoWhite', () => {
  it('全不透明时原样返回，不做无谓拷贝', () => {
    const opaque = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255])
    expect(flattenOntoWhite(opaque)).toBe(opaque)
    expect([...opaque]).toEqual([10, 20, 30, 255, 40, 50, 60, 255])
  })

  it('直通 alpha 按 alpha 混合到白底，并把 alpha 写回不透明', () => {
    // alpha=128：一半原始色 + 一半白
    const bitmap = flattenOntoWhite(new Uint8Array([200, 100, 50, 128]))
    expect([...bitmap]).toEqual([Math.round((200 * 128 + 255 * 127) / 255), Math.round((100 * 128 + 255 * 127) / 255), Math.round((50 * 128 + 255 * 127) / 255), 255])
    expect([...bitmap]).toEqual([227, 177, 152, 255])
  })

  it('完全透明的像素变成纯白', () => {
    expect([...flattenOntoWhite(new Uint8Array([12, 34, 56, 0]))]).toEqual([255, 255, 255, 255])
  })

  it('预乘 alpha（通道值不超过 alpha）按预乘公式补白，不再二次乘 alpha', () => {
    // 预乘下 [0,0,0,alpha] 是纯黑半透明，压白底后应为灰 127
    const bitmap = flattenOntoWhite(new Uint8Array([0, 0, 0, 127]))
    expect([...bitmap]).toEqual([128, 128, 128, 255])
  })

  it('同图内混合直通与不透明像素时逐像素独立处理', () => {
    const bitmap = flattenOntoWhite(new Uint8Array([255, 0, 0, 255, 255, 0, 0, 0]))
    expect([...bitmap]).toEqual([255, 0, 0, 255, 255, 255, 255, 255])
  })

  it('通道值大于 alpha 即判为直通数据（不误判成预乘导致偏暗）', () => {
    const bitmap = flattenOntoWhite(new Uint8Array([255, 255, 255, 10]))
    // 直通白 + 低 alpha 仍是白；若误按预乘会变成 255（相同），改用高值彩色的用例锁定判定
    expect([...bitmap]).toEqual([255, 255, 255, 255])
    const colored = flattenOntoWhite(new Uint8Array([250, 10, 10, 200]))
    expect([...colored]).toEqual([Math.round((250 * 200 + 255 * 55) / 255), Math.round((10 * 200 + 255 * 55) / 255), Math.round((10 * 200 + 255 * 55) / 255), 255])
  })
})
