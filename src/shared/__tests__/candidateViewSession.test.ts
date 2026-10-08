import { describe, expect, it } from 'vitest'
import { CANDIDATE_VIEW_SESSION_KEY, readCandidateViewSession, writeCandidateViewSession } from '../candidateViewSession'

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    store
  }
}

describe('candidateViewSession', () => {
  it('往返读写 area 与 platform', () => {
    const storage = makeStorage()
    writeCandidateViewSession(storage.setItem, { area: 'SUPPLY', platform: 'GIGACLOUD' })
    expect(readCandidateViewSession(storage.getItem)).toEqual({ area: 'SUPPLY', platform: 'GIGACLOUD' })
    expect(storage.store.has(CANDIDATE_VIEW_SESSION_KEY)).toBe(true)
  })

  it('无会话值返回 null', () => {
    expect(readCandidateViewSession(makeStorage().getItem)).toBeNull()
  })

  it('损坏或非法会话值返回 null 而非抛错', () => {
    expect(readCandidateViewSession(makeStorage({ [CANDIDATE_VIEW_SESSION_KEY]: '{bad json' }).getItem)).toBeNull()
    expect(readCandidateViewSession(makeStorage({ [CANDIDATE_VIEW_SESSION_KEY]: JSON.stringify({ area: 'NOPE', platform: 'GIGACLOUD' }) }).getItem)).toBeNull()
    expect(readCandidateViewSession(makeStorage({ [CANDIDATE_VIEW_SESSION_KEY]: JSON.stringify({ area: 'SUPPLY', platform: '' }) }).getItem)).toBeNull()
    expect(readCandidateViewSession(makeStorage({ [CANDIDATE_VIEW_SESSION_KEY]: JSON.stringify({ area: 'MARKET', platform: 'OZON' }) }).getItem)).toEqual({ area: 'MARKET', platform: 'OZON' })
  })
})
