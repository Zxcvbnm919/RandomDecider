import { useState } from 'react'
import type { HistoryLevel } from '../../core/types'
import { EmptyState, formatTime } from '../components'
import { store, useStore } from '../store'

function chainOf(levels: HistoryLevel[]): string {
  return levels.map((level) => level.finalResult).join(' → ')
}

export default function HistoryPage() {
  const state = useStore()
  const [query, setQuery] = useState('')
  const route = state.route
  const detailId = route.name === 'historyDetail' ? route.id : null
  const detail = detailId
    ? state.data.history.find((record) => record.id === detailId) ?? null
    : null

  if (detailId) {
    if (!detail) {
      return (
        <div className="focus-page">
          <header className="focus-head">
            <button className="icon-btn" onClick={() => store.navigate({ name: 'history' })}>
              ‹
            </button>
            <h1>历史详情</h1>
          </header>
          <EmptyState icon="📜" title="这条记录不存在" />
        </div>
      )
    }
    return (
      <div className="focus-page">
        <header className="focus-head">
          <button className="icon-btn" onClick={() => store.navigate({ name: 'history' })}>
            ‹
          </button>
          <div className="focus-title">
            <h1>{detail.decisionName}</h1>
            <p className="muted">{formatTime(detail.time)}</p>
          </div>
          <button
            className="btn danger"
            onClick={() => {
              if (!window.confirm('删除这条历史记录？')) return
              store.deleteHistory(detail.id)
            }}
          >
            删除
          </button>
        </header>
        <div className="scroll summary-scroll">
          <section className="summary-hero">
            <div className="summary-label">最终结果</div>
            <div className="summary-chain">
              {detail.levels.map((level, index) => (
                <span className="chain-item" key={`${level.level}-${index}`}>
                  {level.finalResult}
                  {index < detail.levels.length - 1 ? <span className="chain-arrow">→</span> : null}
                </span>
              ))}
            </div>
          </section>

          {detail.levels.map((level) => (
            <section className="summary-block" key={level.level}>
              <h2>
                第 {level.level} 级 · {level.nodeName}
              </h2>
              <p className="muted">
                所属决策：{level.decisionName}
                {level.isReference ? ' · 引用' : ''}
              </p>
              <div className="history-final">
                <strong>{level.finalResult}</strong>
                <span className={`badge ${level.status === 'manual' ? 'manual' : 'soft'}`}>
                  {level.status === 'manual' ? '手动选择' : '系统抽取'}
                </span>
              </div>
              {level.filters.length > 0 ? (
                <div className="history-line">
                  <span className="muted">筛选：</span>
                  {level.filters.map((filter) => (
                    <span key={filter.groupId} className="badge soft">
                      {filter.groupName}：{filter.mode === 'include' ? '只看' : '排除'}{' '}
                      {filter.tagNames.join('、')}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted small">筛选：无</p>
              )}
              <p className="muted small">
                被替换：
                {level.replaced.length > 0 ? level.replaced.join('；') : '-'}
              </p>
              {level.blacklisted.length > 0 ? (
                <p className="muted small">临时拉黑：{level.blacklisted.join('、')}</p>
              ) : null}
              <details className="history-details">
                <summary>
                  候选快照（{level.candidates.length}）与筛掉（{level.excluded.length}）
                </summary>
                <div className="history-candidates">
                  {level.candidates.map((candidate, index) => (
                    <span key={`${candidate.name}-${index}`} className="badge soft">
                      {candidate.name} · {candidate.baseWeight} → {candidate.effectiveWeight.toFixed(2)}
                    </span>
                  ))}
                  {level.excluded.map((candidate, index) => (
                    <span key={`${candidate.name}-x-${index}`} className="badge warn">
                      筛掉：{candidate.name}
                    </span>
                  ))}
                </div>
              </details>
            </section>
          ))}
        </div>
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const records = [...state.data.history]
    .sort((a, b) => b.time.localeCompare(a.time))
    .filter((record) => {
      if (!q) return true
      if (record.decisionName.toLowerCase().includes(q)) return true
      return chainOf(record.levels).toLowerCase().includes(q)
    })

  return (
    <div className="focus-page">
      <header className="focus-head">
        <button className="icon-btn" onClick={() => store.navigate({ name: 'main' })}>
          ‹
        </button>
        <div className="focus-title">
          <h1>历史</h1>
          <p className="muted">{state.data.history.length} / 500 条</p>
        </div>
        <button className="btn small" onClick={() => void store.exportHistory()}>
          导出
        </button>
        <button
          className="btn small danger"
          onClick={() => {
            if (!window.confirm('清空全部历史记录？统计与降温不受影响。')) return
            store.clearHistory()
          }}
        >
          清空
        </button>
      </header>
      <div className="scroll">
        <div className="toolbar">
          <input
            className="search-input"
            placeholder="按决策名或最终结果搜索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {records.length === 0 ? (
          <EmptyState
            icon="📜"
            title="还没有历史"
            description="完成一次决策并到达汇总页后，这里会出现记录。"
          />
        ) : (
          <div className="history-list">
            {records.map((record) => (
              <button
                key={record.id}
                className="history-row"
                onClick={() => store.navigate({ name: 'historyDetail', id: record.id })}
              >
                <div className="history-row-head">
                  <strong>{record.decisionName}</strong>
                  <span className="muted small">
                    {formatTime(record.time)} · {record.levels.length} 级
                  </span>
                </div>
                <div className="history-chain">{chainOf(record.levels)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
