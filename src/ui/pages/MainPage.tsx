import { useState } from 'react'
import { findReferences } from '../../core/tree'
import type { AppData, TopDecision } from '../../core/types'
import { EmptyState, Modal, PromptDialog, formatTime } from '../components'
import { folderDecisions, sortDecisions, store, useStore } from '../store'

export type GroupKey =
  | 'all'
  | 'favorites'
  | 'pinned'
  | 'uncategorized'
  | `folder:${string}`

export function groupLabel(data: AppData, group: GroupKey): string {
  if (group === 'all') return '全部决策'
  if (group === 'favorites') return '收藏'
  if (group === 'pinned') return '置顶'
  if (group === 'uncategorized') return '未分组'
  const id = group.slice('folder:'.length)
  return data.folders.find((folder) => folder.id === id)?.name ?? '文件夹'
}

function decisionsForGroup(data: AppData, group: GroupKey): TopDecision[] {
  if (group === 'all') return data.decisions.filter((decision) => !decision.pinned)
  if (group === 'favorites') return data.decisions.filter((decision) => decision.favorite)
  if (group === 'pinned') return data.decisions.filter((decision) => decision.pinned)
  if (group === 'uncategorized') {
    return data.decisions.filter((decision) => !decision.folderId && !decision.pinned)
  }
  const id = group.slice('folder:'.length)
  return folderDecisions(data, id).filter((decision) => !decision.pinned)
}

export function groupCount(data: AppData, group: GroupKey): number {
  return decisionsForGroup(data, group).length
}

function matchesSearch(decision: TopDecision, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (decision.name.toLowerCase().includes(q)) return true
  if (decision.note.toLowerCase().includes(q)) return true
  return decision.results.some((result) => result.name.toLowerCase().includes(q))
}

export default function MainPage({
  group,
  onGroup,
  mobile,
  mobileView,
  onMobileView,
  search,
}: {
  group: GroupKey
  onGroup: (group: GroupKey) => void
  mobile: boolean
  mobileView: 'groups' | 'decisions'
  onMobileView: (view: 'groups' | 'decisions') => void
  search: string
}) {
  const state = useStore()
  const data = state.data
  const [detail, setDetail] = useState<TopDecision | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TopDecision | null>(null)
  const [folderPromptOpen, setFolderPromptOpen] = useState(false)
  const [folderRename, setFolderRename] = useState<{ id: string; name: string } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const base = search.trim()
    ? data.decisions.filter((decision) => matchesSearch(decision, search))
    : decisionsForGroup(data, group)
  const decisions = sortDecisions(base, data.settings.sortMode)

  const title = search.trim() ? '搜索结果' : groupLabel(data, group)

  const folderForNew = group.startsWith('folder:') ? group.slice('folder:'.length) : null

  const openEditor = (decision: TopDecision) => {
    store.beginEdit()
    store.navigate({ name: 'editor', decisionId: decision.id, path: [], returnTo: 'main' })
  }

  const toggleFavorite = (decision: TopDecision) => {
    store.updateData(() => {
      decision.favorite = !decision.favorite
    })
    void store.persist()
    setDetail((current) => (current ? { ...current, favorite: decision.favorite } : current))
  }

  const togglePinned = (decision: TopDecision) => {
    store.updateData(() => {
      decision.pinned = !decision.pinned
    })
    void store.persist()
    setDetail((current) => (current ? { ...current, pinned: decision.pinned } : current))
  }

  const deleteDecision = (decision: TopDecision) => {
    setDetail(null)
    setDeleteTarget(decision)
  }

  const references = deleteTarget ? findReferences(data, deleteTarget.id) : []

  const addFolder = () => {
    setFolderPromptOpen(true)
  }

  const moveDecisionBy = (id: string, delta: number) => {
    store.moveDecision(id, delta)
  }

  const renderGroups = () => {
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
      <div className="stack">
        <div className="mobile-page-head">
          <h1>分组</h1>
          <button className="btn primary" onClick={() => store.createDecision(null)}>
            ＋ 新建
          </button>
        </div>
        <div className="group-list">
          {groups.map((item) => {
            const folderId = item.key.startsWith('folder:')
              ? item.key.slice('folder:'.length)
              : null
            const folder = folderId
              ? data.folders.find((entry) => entry.id === folderId)
              : undefined
            return (
              <div className="group-row" key={item.key}>
                <button
                  className="group-row-main"
                  onClick={() => {
                    onGroup(item.key)
                    onMobileView('decisions')
                  }}
                >
                  <span className="group-icon">{item.icon}</span>
                  <span className="group-name">{groupLabel(data, item.key)}</span>
                  <span className="group-count">{groupCount(data, item.key)}</span>
                </button>
                {folder ? (
                  <div className="group-row-actions">
                    <button
                      className="icon-btn tiny"
                      title="重命名文件夹"
                      onClick={() => setFolderRename({ id: folder.id, name: folder.name })}
                    >
                      ✎
                    </button>
                    <button
                      className="icon-btn tiny danger-text"
                      title="删除文件夹"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `删除文件夹“${folder.name}”？里面的决策会移到未分组。`,
                          )
                        ) {
                          return
                        }
                        store.deleteFolder(folder.id)
                        if (group === item.key) onGroup('all')
                      }}
                    >
                      🗑
                    </button>
                  </div>
                ) : null}
                <span className="group-arrow">›</span>
              </div>
            )
          })}
        </div>
        <div className="mobile-actions">
          <button className="btn" onClick={addFolder}>
            ＋ 新建文件夹
          </button>
          <label className="field inline">
            <span>排序</span>
            <select
              value={data.settings.sortMode}
              onChange={(event) =>
                store.setSettings({ sortMode: event.target.value as typeof data.settings.sortMode })
              }
            >
              <option value="recent">最近使用</option>
              <option value="name">名称</option>
              <option value="created">创建时间</option>
              <option value="custom">自定义</option>
            </select>
          </label>
        </div>

        {folderPromptOpen ? (
          <PromptDialog
            title="新建文件夹"
            label="文件夹名称"
            placeholder="例如：生活"
            confirmText="创建"
            onSubmit={(name) => {
              store.addFolder(name)
              setFolderPromptOpen(false)
            }}
            onClose={() => setFolderPromptOpen(false)}
          />
        ) : null}

        {folderRename ? (
          <PromptDialog
            title="重命名文件夹"
            label="文件夹名称"
            defaultValue={folderRename.name}
            confirmText="保存"
            onSubmit={(name) => {
              store.renameFolder(folderRename.id, name)
              setFolderRename(null)
            }}
            onClose={() => setFolderRename(null)}
          />
        ) : null}
      </div>
    )
  }

  const renderDecisions = () => (
    <div className="stack">
      <div className="page-head">
        <div className="page-head-left">
          {mobile ? (
            <button
              className="icon-btn"
              onClick={() => onMobileView('groups')}
              aria-label="返回分组"
            >
              ‹
            </button>
          ) : null}
          <div>
            <h1>{title}</h1>
            <p className="muted">
              {decisions.length} 个决策
              {search.trim() ? ' · 全部分组' : ''}
            </p>
          </div>
        </div>
        <div className="page-head-actions">
          {mobile ? (
            <select
              className="compact-select"
              value={data.settings.sortMode}
              onChange={(event) =>
                store.setSettings({ sortMode: event.target.value as typeof data.settings.sortMode })
              }
            >
              <option value="recent">最近使用</option>
              <option value="name">名称</option>
              <option value="created">创建时间</option>
              <option value="custom">自定义</option>
            </select>
          ) : null}
          <button className="btn primary" onClick={() => store.createDecision(folderForNew)}>
            ＋ 新建决策
          </button>
        </div>
      </div>

      {decisions.length === 0 ? (
        <EmptyState
          icon="🎲"
          title={search.trim() ? '没有匹配的决策' : '这里还没有决策'}
          description={
            search.trim()
              ? '换个关键词，或清空搜索。'
              : '新建一个决策，添加几个结果和权重，然后交给随机。'
          }
          action={
            search.trim() ? null : (
              <button className="btn primary" onClick={() => store.createDecision(folderForNew)}>
                新建决策
              </button>
            )
          }
        />
      ) : (
        <div className="card-grid">
          {decisions.map((decision, index) => (
            <article
              key={decision.id}
              className={`decision-card ${
                draggingId === decision.id ? 'dragging' : ''
              } ${dragOverId === decision.id ? 'drag-over' : ''}`}
              onClick={() => store.enterDecision(decision.id)}
              onDragOver={(event) => {
                if (!draggingId) return
                event.preventDefault()
                setDragOverId(decision.id)
              }}
              onDragLeave={() => {
                if (dragOverId === decision.id) setDragOverId(null)
              }}
              onDrop={(event) => {
                event.preventDefault()
                const sourceId = event.dataTransfer.getData('text/plain')
                if (sourceId) store.reorderDecisions(sourceId, decision.id)
                setDraggingId(null)
                setDragOverId(null)
              }}
            >
              <span
                className="drag-handle card-drag"
                draggable
                title="拖动排序"
                onClick={(event) => event.stopPropagation()}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', decision.id)
                  event.dataTransfer.effectAllowed = 'move'
                  setDraggingId(decision.id)
                }}
                onDragEnd={() => {
                  setDraggingId(null)
                  setDragOverId(null)
                }}
              >
                ⋮⋮
              </span>
              <div
                className="card-move"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="icon-btn tiny"
                  disabled={index === 0}
                  title="上移"
                  onClick={() => moveDecisionBy(decision.id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn tiny"
                  disabled={index === decisions.length - 1}
                  title="下移"
                  onClick={() => moveDecisionBy(decision.id, 1)}
                >
                  ↓
                </button>
              </div>
              <div className="card-icon">{decision.icon || '🎲'}</div>
              <div className="card-main">
                <div className="card-title-row">
                  <h3>{decision.name}</h3>
                  {decision.pinned ? <span className="mini-badge">置顶</span> : null}
                </div>
                <div className="card-meta">
                  <span>{decision.results.length} 个结果</span>
                  <span>最近使用 {formatTime(decision.lastUsedAt)}</span>
                </div>
              </div>
              <div className="card-actions" onClick={(event) => event.stopPropagation()}>
                <button
                  className={`icon-btn ${decision.favorite ? 'on' : ''}`}
                  onClick={() => toggleFavorite(decision)}
                  aria-label="收藏"
                  title="收藏"
                >
                  {decision.favorite ? '★' : '☆'}
                </button>
                <button
                  className="icon-btn"
                  onClick={() => setDetail(decision)}
                  aria-label="详情"
                  title="详情"
                >
                  ⋯
                </button>
                <button
                  className="icon-btn"
                  onClick={() => openEditor(decision)}
                  aria-label="编辑"
                  title="编辑"
                >
                  ✎
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {detail ? (
        <Modal
          title="决策详情"
          onClose={() => setDetail(null)}
          footer={
            <div className="row gap">
              <button className="btn" onClick={() => setDetail(null)}>
                关闭
              </button>
              <button className="btn" onClick={() => togglePinned(detail)}>
                {detail.pinned ? '取消置顶' : '置顶'}
              </button>
              <button className="btn" onClick={() => toggleFavorite(detail)}>
                {detail.favorite ? '取消收藏' : '收藏'}
              </button>
              <button className="btn primary" onClick={() => openEditor(detail)}>
                编辑
              </button>
              <button className="btn danger" onClick={() => deleteDecision(detail)}>
                删除
              </button>
            </div>
          }
        >
          <div className="detail-head">
            <div className="detail-icon">{detail.icon || '🎲'}</div>
            <div>
              <h3>{detail.name}</h3>
              <p className="muted">
                {detail.results.length} 个结果 · 创建于 {formatTime(detail.createdAt)}
              </p>
            </div>
          </div>
          <dl className="detail-list">
            <dt>备注</dt>
            <dd>{detail.note || '—'}</dd>
            <dt>最近使用</dt>
            <dd>{formatTime(detail.lastUsedAt)}</dd>
            <dt>文件夹</dt>
            <dd>
              {detail.folderId
                ? data.folders.find((folder) => folder.id === detail.folderId)?.name ?? '—'
                : '未分组'}
            </dd>
            <dt>结果</dt>
            <dd>{detail.results.map((result) => result.name).join('、') || '—'}</dd>
          </dl>
        </Modal>
      ) : null}

      {deleteTarget ? (
        <Modal
          title="删除决策"
          onClose={() => setDeleteTarget(null)}
          footer={
            <div className="row gap wrap">
              <button className="btn" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              {references.length > 0 ? (
                <button
                  className="btn"
                  onClick={() => {
                    store.deleteDecision(deleteTarget.id, 'unlink')
                    setDeleteTarget(null)
                  }}
                >
                  解除引用后删除
                </button>
              ) : null}
              <button
                className="btn danger"
                onClick={() => {
                  store.deleteDecision(
                    deleteTarget.id,
                    references.length > 0 ? 'cascade' : 'unlink',
                  )
                  setDeleteTarget(null)
                }}
              >
                {references.length > 0 ? '级联删除所有引用' : '删除'}
              </button>
            </div>
          }
        >
          <p>确定删除“{deleteTarget.name}”吗？历史与统计会保留。</p>
          {references.length > 0 ? (
            <>
              <p className="muted">它被 {references.length} 处引用：</p>
              <div className="stack">
                {references.map((reference, index) => (
                  <div
                    className="list-row"
                    key={`${reference.top.id}-${reference.result.id}-${index}`}
                  >
                    <span className="list-row-main">
                      <strong>{reference.top.name}</strong>
                      <small className="muted">
                        {reference.node.name} · 第 {reference.path.length + 1} 级 · 结果“
                        {reference.result.name}”
                      </small>
                    </span>
                  </div>
                ))}
              </div>
              <p className="muted small">
                “解除引用”保留这些结果，只删掉下一级；“级联删除”会把这些结果整条移除。
              </p>
            </>
          ) : (
            <p className="muted small">没有其他决策引用它。</p>
          )}
        </Modal>
      ) : null}
    </div>
  )

  if (mobile && mobileView === 'groups' && !search.trim()) return renderGroups()
  return renderDecisions()
}
