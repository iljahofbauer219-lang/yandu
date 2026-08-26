import { useEffect, useMemo, useState } from 'react'
import { TOP_NAV } from './data/_topNav'
import { HOT_SEARCH } from './data/_hotSearch'
import { REGIONS } from './data/_regions'
import { ALL_SITES } from './data/_sites'
import { TOPICS } from './data/_topics'
import { FOOTER } from './data/_footer'
import { findDetailBySlug } from './data/_platformDetails'
import { TopNav } from './components/TopNav'
import { SearchBar } from './components/SearchBar'
import { PlatformGrid } from './components/PlatformGrid'
import { TopicList } from './components/TopicList'
import { SiteFooter } from './components/SiteFooter'
import { PlatformDetailPage } from './components/PlatformDetailPage'

// ===== 迷你路由：/nav/platform/{slug} → 详情页，其余 → 首页 =====
type Route =
  | { page: 'home' }
  | { page: 'platform'; slug: string; home: string }

function parseRoute(): Route {
  const path = window.location.pathname
  const m = path.match(/^(.*)\/platform\/([\w-]+)\/?$/)
  if (m && findDetailBySlug(m[2])) {
    const home = m[1].endsWith('/') ? m[1] : `${m[1]}/`
    return { page: 'platform', slug: m[2], home }
  }
  return { page: 'home' }
}

function navigate(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function App() {
  const [query, setQuery] = useState('')
  const [activeRegion, setActiveRegion] = useState<string>('热门平台')
  const [route, setRoute] = useState<Route>(parseRoute)

  useEffect(() => {
    const onPop = () => setRoute(parseRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 全局搜索：跨区域匹配 name / desc
  const filteredRegions = useMemo(() => {
    if (!query.trim()) return REGIONS
    const q = query.trim().toLowerCase()
    return REGIONS.map((r) => ({
      ...r,
      sites: r.sites.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.desc || '').toLowerCase().includes(q),
      ),
    })).filter((r) => r.sites.length > 0)
  }, [query])

  const totalShown = filteredRegions.reduce((sum, r) => sum + r.sites.length, 0)

  // 详情页分支：/nav/platform/{slug}
  if (route.page === 'platform') {
    const detail = findDetailBySlug(route.slug)
    if (detail) {
      return (
        <PlatformDetailPage
          detail={detail}
          base={route.home}
          onBack={() => navigate(route.home)}
        />
      )
    }
  }

  return (
    <div className="app">
      <TopNav items={TOP_NAV} />

      <header className="hero">
        <div className="hero-inner">
          <div className="hero-logo">
            <span className="hero-logo-text">YANDU</span>
            <span className="hero-logo-sub">跨境导航</span>
          </div>
          <SearchBar
            value={query}
            onChange={setQuery}
            hotSearch={HOT_SEARCH}
            totalCount={ALL_SITES.length}
            shownCount={totalShown}
          />
        </div>
      </header>

      <nav className="region-tabs">
        <div className="region-tabs-inner">
          {REGIONS.map((r) => (
            <button
              key={r.title}
              className={`region-tab ${activeRegion === r.title ? 'active' : ''}`}
              onClick={() => {
                setActiveRegion(r.title)
                setQuery('')
                // 滚动到对应区域
                const el = document.getElementById(`region-${r.title}`)
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              {r.title}
              <span className="region-tab-count">{r.sites.length}</span>
            </button>
          ))}
        </div>
      </nav>

      <main className="main">
        <PlatformGrid
          regions={filteredRegions}
          query={query}
          onOpenDetail={(slug) => {
            const home = window.location.pathname.endsWith('/')
              ? window.location.pathname
              : `${window.location.pathname}/`
            navigate(`${home}platform/${slug}`)
          }}
        />
      </main>

      <TopicList topics={TOPICS} />
      <SiteFooter footer={FOOTER} />
    </div>
  )
}
