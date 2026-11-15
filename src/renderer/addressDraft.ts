// 地址栏跟随主进程状态推送时的草稿保护：用户敲了还没回车的网址不能被推送冲掉。
// previousUrl = 上一次推送（或用户显式动作登记）的网址；null 表示还没同步过，此时必须跟随，
// 否则地址栏会被组件的初始默认网址永久卡住。
export function addressAfterPush(current: string, previousUrl: string | null, pushedUrl: string): string {
  if (previousUrl === null || current === '' || current === previousUrl) return pushedUrl
  return current
}
