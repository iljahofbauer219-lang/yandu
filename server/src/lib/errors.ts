export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function httpError(statusCode: number, code: string, message: string): HttpError {
  return new HttpError(statusCode, code, message)
}
