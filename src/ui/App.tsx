import { useEffect, useRef, useState } from 'react'
import type { AppData } from '../core/types'
import { PromptDialog, Toast, WindowControls } from './components'
import ImportConflictDialog from './ImportConflictDialog'
import DecisionPage from './pages/DecisionPage'
import EditorPage from './pages/EditorPage'
import HistoryPage from './pages/HistoryPage'
import MainPage, { groupCount, groupLabel, type GroupKey } from './pages/MainPage'
import SettingsPage from './pages/SettingsPage'
import StatsPage from './pages/StatsPage'
import SummaryPage from './pages/SummaryPage'
import TagPresetsPage from './pages/TagPresetsPage'
import { parentRoute, store, useStore } from './store'
import { applyTheme, backgroundLayerStyle } from './theme'

function TopBar({
  search,
  onSearch,
  mobile,
}: {
  search: string
  onSearch: (value: string) => void
  mobile: boolean
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-icon">🎲</span>
        <span className="brand-name">随机决策</span>
      </div>
      <div className="topbar-search">
        <span className="search-icon">⌕</span>
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="搜索决策、备注或结果"
        />
        {search ? (
          <button className="icon-btn tiny" onClick={() => onSearch('')} aria-label="清空搜索">
            ✕
          </button>
        ) : null}
      </div>
      <nav className="topbar-nav">
        <button onClick={() => store.navigate({ name: 'history' })} title="历史">
          <span>📜</span>
          {!mobile ? <span>历史</span> : null}
        </button>
        <button onClick={() => store.navigate({ name: 'stats' })} title="统计">
          <span>📊</span>
          {!mobile ? <span>统计</span> : null}
        </button>
        <button onClick={() => store.navigate({ name: 'settings' })} title="设置">
          <span>⚙️</span>
          {!mobile ? <span>设置</span> : null}
        </button>
      </nav>
      <WindowControls />
    </header>
  )
}

function Sidebar({
  data,
  group,
  onGroup,
}: {
  data: AppData
  group: GroupKey
  onGroup: (group: GroupKey) => void
}) {
  const [folderPrompt, setFolderPrompt] = useState<{
    mode: 'add' | 'rename'
    id?: string
    name?: string
  } | null>(null)

  const groups: { key: GroupKey; icon: string }[] = [
    { key: 'all', icon: '📋' },
    { key: 'favorites', icon: '⭐' },
    { key: 'pinned', icon: '📌' },
    ...data.folders.map((folder) => ({
      key: `folder:${folder.id}` as GroupKey,
      icon: '📁',
    })),
    { key: 'uncategorized', icon: '🗂️' },
  ]

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        {groups.map((item) => {
          const isFolder = item.key.startsWith('folder:')
          const folderId = isFolder ? item.key.slice('folder:'.length) : null
          return (
            <div
              key={item.key}
              className={`nav-row ${group === item.key ? 'active' : ''}`}
              onClick={() => onGroup(item.key)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onGroup(item.key)
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{groupLabel(data, item.key)}</span>
              <span className="nav-count">{groupCount(data, item.key)}</span>
              {isFolder && folderId ? (
                <span className="nav-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    className="icon-btn tiny"
                    title="重命名文件夹"
                    onClick={() =>
                      setFolderPrompt({
                        mode: 'rename',
                        id: folderId,
                        name: groupLabel(data, item.key),
                      })
                    }
                  >
                    ✎
                  </button>
                  <button
                    className="icon-btn tiny"
                    title="删除文件夹"
                    onClick={() => {
                      if (window.confirm('删除文件夹？里面的决策会移到“未分组”。')) {
                        store.deleteFolder(folderId)
                        if (group === item.key) onGroup('all')
                      }
                    }}
                  >
                    🗑
                  </button>
                </span>
              ) : null}
            </div>
          )
        })}
        <button className="add-folder" onClick={() => setFolderPrompt({ mode: 'add' })}>
          ＋ 新建文件夹
        </button>
      </div>
      <div className="sidebar-foot">
        <label className="field inline tiny-field">
          <span>排序</span>
          <select
            value={data.settings.sortMode}
            onChange={(event) =>
              store.setSettings({ sortMode: event.target.value as AppData['settings']['sortMode'] })
            }
          >
            <option value="recent">最近使用</option>
            <option value="name">名称</option>
            <option value="created">创建时间</option>
            <option value="custom">自定义</option>
          </select>
        </label>
      </div>

      {folderPrompt ? (
        <PromptDialog
          title={folderPrompt.mode === 'add' ? '新建文件夹' : '重命名文件夹'}
          label="文件夹名称"
          defaultValue={folderPrompt.name ?? ''}
          placeholder="例如：生活"
          confirmText={folderPrompt.mode === 'add' ? '创建' : '保存'}
          onSubmit={(name) => {
            if (folderPrompt.mode === 'add') store.addFolder(name)
            else if (folderPrompt.id) store.renameFolder(folderPrompt.id, name)
            setFolderPrompt(null)
          }}
          onClose={() => setFolderPrompt(null)}
        />
      ) : null}
    </aside>
  )
}

export default function App() {
  const state = useStore()
  const [width, setWidth] = useState(() => window.innerWidth)
  const mobile = width < 820
  const [group, setGroup] = useState<GroupKey>('all')
  const [mobileView, setMobileView] = useState<'groups' | 'decisions'>('groups')
  const [search, setSearch] = useState('')
  const routeKey = JSON.stringify(state.route)
  const skipHistoryRef = useRef(false)
  const lastRouteRef = useRef<string | null>(null)

  useEffect(() => {
    void store.init()
  }, [])

  // Android/PWA 返回键按“上一级”路由返回，而不是按浏览历史回退。
  // 子页面只保留一个 guard 历史条目；主页面移除 guard，让系统直接退出。
  useEffect(() => {
    if (!state.initialized) return
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false
      lastRouteRef.current = routeKey
      return
    }
    const needsMobileGuard =
      state.route.name === 'main' && mobile && mobileView === 'decisions'
    if (lastRouteRef.current === null) {
      window.history.replaceState({ appRoot: true }, '')
    } else if (state.route.name === 'main' && !needsMobileGuard) {
      if (window.history.state?.appGuard) {
        window.history.back()
      } else {
        window.history.replaceState({ appRoot: true }, '')
      }
    } else if (window.history.state?.appGuard) {
      window.history.replaceState({ appGuard: true }, '')
    } else {
      window.history.pushState({ appGuard: true }, '')
    }
    lastRouteRef.current = routeKey
  }, [routeKey, state.initialized, state.route, mobile, mobileView])

  useEffect(() => {
    const onPop = () => {
      const current = store.state.route
      if (current.name === 'main') {
        if (mobile && mobileView === 'decisions') setMobileView('groups')
        return
      }
      if (current.name === 'editor' && state.dirty) {
        const leave = window.confirm('当前编辑有未保存的修改，返回将丢弃。确定吗？')
        if (!leave) {
          window.history.pushState({ appGuard: true }, '')
          return
        }
        skipHistoryRef.current = true
        store.cancelEdit()
      } else {
        skipHistoryRef.current = true
      }
      const parent = parentRoute(current)
      store.setRouteFromHistory(parent)
      if (parent.name !== 'main') {
        window.history.pushState({ appGuard: true }, '')
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [state.route, state.dirty, mobile, mobileView])

  useEffect(() => {
    applyTheme(state.data.settings)
  }, [state.data.settings])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if ((store.state.data.settings.themeMode ?? 'light') === 'system') {
        applyTheme(store.state.data.settings)
      }
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (state.loading) {
    return (
      <div className="boot">
        <div className="boot-card">
          <div className="boot-icon">🎲</div>
          <h1>随机决策工具</h1>
          <p>正在读取本地数据…</p>
        </div>
      </div>
    )
  }

  const isMain = state.route.name === 'main'
  const bg =
    state.data.settings.backgroundImage && state.backgroundUrl
      ? backgroundLayerStyle(state.data.settings, state.backgroundUrl)
      : null

  const renderRoute = () => {
    const route = state.route
    if (route.name === 'main') {
      return (
        <MainPage
          group={group}
          onGroup={setGroup}
          mobile={mobile}
          mobileView={mobileView}
          onMobileView={setMobileView}
          search={search}
        />
      )
    }
    if (route.name === 'editor') return <EditorPage />
    if (route.name === 'decision') return <DecisionPage />
    if (route.name === 'summary') return <SummaryPage />
    if (route.name === 'history' || route.name === 'historyDetail') return <HistoryPage />
    if (route.name === 'stats') return <StatsPage />
    if (route.name === 'presets') return <TagPresetsPage />
    return <SettingsPage />
  }

  const desktopApp = Boolean(window.desktop)

  return (
    <div className={`app ${desktopApp ? 'desktop-app' : ''}`}>
      {bg ? <div className="bg-layer" style={bg} /> : null}
      {desktopApp && !isMain ? <WindowControls /> : null}
      {isMain ? <TopBar search={search} onSearch={setSearch} mobile={mobile} /> : null}
      <div className={`app-body ${isMain ? 'with-sidebar' : 'focus'}`}>
        {isMain && !mobile ? <Sidebar data={state.data} group={group} onGroup={setGroup} /> : null}
        <div className={`content ${isMain ? 'main-content' : 'focus-content'}`}>
          {renderRoute()}
        </div>
      </div>
      <ImportConflictDialog />
      <Toast />
    </div>
  )
}
