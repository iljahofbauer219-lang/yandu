// officeparser@7.x 未附带类型声明，这里为 advisor 文档解析路径做局部 declare
declare module 'officeparser' {
  export interface OfficeParserConfig {
    extractAttachments?: boolean
    ocr?: boolean
    includeRawContent?: boolean
  }
  export interface OfficeParserAST {
    toText(): string
    content?: unknown
    metadata?: Record<string, unknown>
  }
  export class OfficeParser {
    static parseOffice(
      input: string | Buffer | Uint8Array,
      config?: OfficeParserConfig
    ): Promise<OfficeParserAST>
  }
  export const parseOffice: typeof OfficeParser.parseOffice
  const _default: typeof OfficeParser
  export default _default
}
