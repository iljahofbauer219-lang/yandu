/**
 * 浏览器页面「被要求安全验证 / 被限流」的文本词表。
 *
 * 这些判定全部跑在注入页面的脚本里（executeJavaScript 模板串），主进程拿不到正则，
 * 故词表在 shared 归一，注入脚本用 ${challengeRegexSource(family)} 拼出正则字面量。
 *
 * 2026-11-09 C 批统一：原 5 族按厂商各写一份、词互缺（同一块风控门在供应站能认、在 eBay 当正常页继续读），
 * 现按意图分两族，跨厂商共用：
 *   VERIFY      —— 安全验证 / 确认身份门
 *   VERIFY_RATE —— VERIFY + 限流频繁门；只给本来就把两类合并上报的供应站站点
 * 分族依据是站点分支语义：扫描站点 BrowserWorkspace 里「访问频繁→任务自动暂停」是独立分支，
 * 若把限流词并进 VERIFY，该分支会被抢先命中，用户会被要求去做不存在的验证。
 * 刻意收紧：punish 只认 URL 形态，裸词会把书名 The Punisher、punished 类正常文案判成风控门。
 * 补词、删词、改族界均属判定口径变更，src/shared/__tests__/browserChallenge.test.ts 会先红。
 */
export const CHALLENGE_WORDLISTS = {
  VERIFY: [
    'punish(?:[/?=&]|\\.htm|$)',
    'captcha',
    'verify',
    '安全验证',
    '滑块',
    '验证码',
    'cloud_ip_bl',
    'security check',
    'verification code',
    '确认是您本人',
    'pardon the interruption',
  ],
  VERIFY_RATE: [
    'punish(?:[/?=&]|\\.htm|$)',
    'captcha',
    'verify',
    '安全验证',
    '滑块',
    '验证码',
    'cloud_ip_bl',
    'security check',
    'verification code',
    '确认是您本人',
    'pardon the interruption',
    '访问频繁',
    '操作异常',
    '请求过于频繁',
    'too many requests',
  ],
} as const

export type ChallengeFamily = keyof typeof CHALLENGE_WORDLISTS

/** 拼成注入页面脚本可直接使用的正则字面量源码，如 /captcha|verify/i */
export function challengeRegexSource(family: ChallengeFamily): string {
  return `/${CHALLENGE_WORDLISTS[family].join('|')}/i`
}

export const LOGIN_WORDLISTS = {
  /** 采集保护站点原样搬运 */
  SUPPLY_ACCOUNT: ['account\\/login', '请登录', '重新登录', '登录已失效'],
  /** 1688 商品页读取原样搬运（只认 login.1688.com，不含 route=account/login） */
  SUPPLY_1688: ['login\\.1688\\.com', '请登录', '重新登录', '登录已失效'],
  /** 货源站批量读取原样搬运（最全的一组，含英文 sign in to continue） */
  SUPPLY_FULL: ['route=account\\/login', 'login\\.1688\\.com', 'account\\/login', '请登录', '重新登录', '登录已失效', 'sign in to continue'],
  /** eBay 系：DOM 凭据输入框判定之外的路径哨兵，原样搬运 */
  EBAY_PATH: ['signin', 'login'],
} as const

export type LoginWordlistFamily = keyof typeof LOGIN_WORDLISTS

export function loginRegexSource(family: LoginWordlistFamily): string {
  return `/${LOGIN_WORDLISTS[family].join('|')}/i`
}
