/** 给无超时保证的请求加竞态超时：服务器半死（TCP 通但不响应）时避免 UI 永久等待 */
export function raceTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    operation.then(
      value => { clearTimeout(timer); resolve(value) },
      reason => { clearTimeout(timer); reject(reason) }
    )
  })
}
