// 服务器产品页（大健云仓等）规格键为中文；eBay 英文详情页不得出现中文，键名在此统一英译。
const SPECIFIC_LABEL_ENGLISH: Record<string, string> = {
  '产品类型': 'Product Type',
  '产品名称': 'Product Name',
  '颜色': 'Color',
  '材质': 'Material',
  '品牌': 'Brand',
  '型号': 'Model Number',
  '组装长度 (英寸)': 'Assembled Length (in)',
  '组装宽度 (英寸)': 'Assembled Width (in)',
  '组装高度 (英寸)': 'Assembled Height (in)',
  '产品重量 (磅)': 'Product Weight (lb)',
  '长度 (英寸)': 'Package Length (in)',
  '宽度 (英寸)': 'Package Width (in)',
  '高度 (英寸)': 'Package Height (in)',
  '重量 (磅)': 'Package Weight (lb)',
}

const CJK = /[㐀-䶿一-鿿豈-﫿]/

export function containsCjk(text: string): boolean {
  return CJK.test(text)
}

/** 中文规格键→英文标签；含中文但不在映射表内返回 ''（调用方应丢弃该条，不能让中文流入英文详情页）；无中文原样返回 */
export function englishSpecificLabel(name: string): string {
  const key = name.trim()
  if (!key) return ''
  const mapped = SPECIFIC_LABEL_ENGLISH[key]
  if (mapped) return mapped
  return containsCjk(key) ? '' : key
}

/** 逐行规范化英文详情页：已知中文键英译；未知中文键或仍含中文的行整行丢弃；其余行原样保留（不清空用户手改的英文内容） */
export function normalizeEnglishDescription(text: string): string {
  return text
    .split('\n')
    .map(line => {
      const match = line.match(/^(\s*-\s*)?([^:：]{1,60})[:：](.*)$/)
      if (!match) return containsCjk(line) ? null : line
      const [, bullet, rawKey, rest] = match
      if (containsCjk(rawKey)) {
        const label = englishSpecificLabel(rawKey)
        if (!label) return null
        return containsCjk(rest) ? null : `${bullet || ''}${label}:${rest}`
      }
      return containsCjk(rest) ? null : line
    })
    .filter((line): line is string => line !== null)
    .join('\n')
}
