// word-extractor@1.x 未附带类型声明
declare module 'word-extractor' {
  export interface WordDocument {
    getBody(): string
    getFootnotes(): string
    getEndnotes(): string
    getHeaders(): { default?: string; first?: string; even?: string }
  }
  export class WordExtractor {
    extract(source: string | Buffer): Promise<WordDocument>
  }
  const _default: typeof WordExtractor
  export default _default
}
