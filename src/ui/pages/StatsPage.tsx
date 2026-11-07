import { useMemo, useState } from 'react'
import type { DecisionNode, StatRecord } from '../../core/types'
import { EmptyState, formatTime } from '../components'
import { store, useStore } from '../store'

function findNode(node: DecisionNode, id: string): DecisionNode | null {
  if (node.id === id) return node
  for (const result of node.results) {
    if (result.child?.kind === 'owned') {
      const found = findNode(result.child.node, id)
      if (found) return found
    }
  }
  return null
}

function resultExists(
  data: ReturnType<typeof useStore>['data'],
  record: StatRecord,
): boolean {
  const top = data.decisions.find((decision) => decision.id === record.decisionId)
  if (!top) return false
  const node = findNode(top, record.nodeId)
  if (!node) return false
  return node.results.some((result) => result.id === record.resultId)
}

export default function StatsPage() {
  const state = useStore()
  const [decisionId, setDecisionId] = useState('all')

  const options = useMemo(() => {
    const map = new Map<string, string>()
    for (const decision of state.data.decisions) map.set(decision.id, decision.name)
    for (const record of state.data.stats) {
      if (!map.has(record.decisionId)) map.set(record.decisionId, record.decisionName)
    }
    return [...map.entries()]
  }, [state.data.decisions, state.data.stats])

  const rows = useMemo(() => {
    const filtered =
      decisionId === 'all'
        ? state.data.stats
        : state.data.stats.filter((record) => record.decisionId === decisionId)
    return [...filtered].sort((a, b) => {
      if (b.appear !== a.appear) return b.appear - a.appear
      return a.resultName.localeCompare(b.resultName, 'zh-CN')
    })
  }, [state.data.stats, decisionId])

  const totals = rows.reduce(
    (acc, row) => ({
      appear: acc.appear + row.appear,
      final: acc.final + row.final,
      manual: acc.manual + row.manual,
    }),
    { appear: 0, final: 0, manual: 0 },
  )

  return (
    <div className="focus-page">
      <header className="focus-head">
        <button className="icon-btn" onClick={() => store.navigate({ name: 'main' })}>
          ‹
        </button>
        <div className="focus-title">
          <h1>统计</h1>
          <p className="muted">出现 / 采用 / 手动分开统计，不受历史清理影响</p>
        </div>
      </header>
      <div className="scroll">
        <div className="toolbar">
          <label className="field inline">
            <span>决策</span>
            <select value={decisionId} onChange={(event) => setDecisionId(event.target.value)}>
              <option value="all">全部</option>
              {options.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <span className="muted small">
            出现 {totals.appear} · 采用 {totals.final} · 手动 {totals.manual}
          </span>
          <button className="btn small" onClick={() => store.navigate({ name: 'history' })}>
            查看历史
          </button>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon="📊"
            title="还没有统计数据"
            description="完成决策后，系统抽取、最终采用和手动选择会分别累计。"
          />
        ) : (
          <div className="table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>决策</th>
                  <th>层级</th>
                  <th>结果</th>
                  <th>出现</th>
                  <th>采用</th>
                  <th>手动</th>
                  <th>上次出现</th>
                  <th>上次采用</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((record) => {
                  const exists = resultExists(state.data, record)
                  return (
                    <tr key={`${record.decisionId}-${record.nodeId}-${record.resultId}`}>
                      <td>
                        {record.decisionName}
                        {!state.data.decisions.some((d) => d.id === record.decisionId) ? (
                          <span className="badge warn">已删除</span>
                        ) : null}
                      </td>
                      <td>{record.nodeName}</td>
                      <td>
                        {record.resultName}
                        {!exists ? <span className="badge warn">已删除</span> : null}
                      </td>
                      <td className="num">{record.appear}</td>
                      <td className="num">{record.final}</td>
                      <td className="num">{record.manual}</td>
                      <td>{formatTime(record.lastAppear)}</td>
                      <td>{formatTime(record.lastFinal)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
