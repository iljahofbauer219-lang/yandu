// pdf-parse@1.x 未附带类型声明，此处做局部 declare（仅供主进程 AiEmployeeChatService 使用）
declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string
    numpages: number
    numrender: number
    info?: unknown
    metadata?: unknown
    version: string
  }
  function pdfParse(data: Buffer | Uint8Array, options?: Record<string, unknown>): Promise<PdfParseResult>
  export = pdfParse
}
