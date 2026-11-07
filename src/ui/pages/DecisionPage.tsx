import { useMemo, useState } from 'react'
import { canContinue, currentLevel, getEligible } from '../../core/session'
import { activeFilterRules, matchesFilter, tagColor, tagsOfResult } from '../../core/tags'
import { findResult, getTopDecision } from '../../core/tree'
import type { FilterMode } from '../../core/types'
import { activeLayerCount, effectiveWeight, formatPercent, probabilities } from '../../core/weights'
import { Modal, TagChip } from '../components'
import { store, useStore } from '../store'

export default function DecisionPage() {
  const state = useStore()
  const session = state.session
  const [filterOpen, setFilterOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [stateOpen, setStateOpen] = useState(false)

  if (!session) {
    return (
      <div className="focus-page">
        <div className="empty">
          <h3>没有正在进行的决策</h3>
          <button className="btn primary" onClick={() => store.navigate({ name: 'main' })}>
            返回主界面
          </button>
        </div>
      </div>
    )
  }

  const level = currentLevel(session)
  const data = state.data
  const eligible = getEligible(session, data, level)
  const node = eligible.node
  const top = getTopDecision(data, session.rootId)
  const current = level.currentResultId
    ? findResult(node, level.currentResultId) ?? null
    : null
  const round = level.currentRound
  const probability = probabilities(node, eligible.eligible, round)
  const activeFilters = activeFilterRules(node, level.filters)
  const continueOk = canContinue(session, data)
  const currentTags = current ? tagsOfResult(node, current) : []
  const currentPenalty = current ? activeLayerCount(node, current.id, round) : 0
  const currentProbability = current ? probability.get(current.id) : undefined
  const childName = current?.child
    ? current.child.kind === 'owned'
      ? current.child.node.name
      : getTopDecision(data, current.child.targetId)?.name ?? '已删除的引用'
    : null
  const poolExhausted =
    !node.allowRepeat && eligible.allEligible.length > 0 && eligible.eligible.length === 0

  const exit = () => {
    if (!window.confirm('退出后本次决策不会保存，确定退出吗？')) return
    store.exitSession()
  }

  const undo = () => {
    if (!window.confirm('撤销当前级的选择并回到上一级（或清空本级）？')) return
    store.undo()
  }

  const restart = () => {
    if (!window.confirm('重新开始会撤销本次全部结果，确定吗？')) return
    store.restart()
  }

  const finish = () => {
    void store.finish()
  }

  const editCurrentLevel = () => {
    store.beginEdit()
    store.navigate({
      name: 'editor',
      decisionId: level.locator.decisionId,
      path: level.locator.path,
      returnTo: 'decision',
    })
  }

  const toggleFilterTag = (groupId: string, tagId: string) => {
    const rule = level.filters[groupId] ?? { mode: 'none' as FilterMode, tagIds: [] }
    const nextTags = rule.tagIds.includes(tagId)
      ? rule.tagIds.filter((id) => id !== tagId)
      : [...rule.tagIds, tagId]
    store.setFilterRule(groupId, {
      mode: rule.mode === 'none' ? 'include' : rule.mode,
      tagIds: nextTags,
    })
  }

  const setFilterMode = (groupId: string, mode: FilterMode) => {
    const rule = level.filters[groupId] ?? { mode: 'none' as FilterMode, tagIds: [] }
    store.setFilterRule(groupId, { mode, tagIds: rule.tagIds })
  }

  return (
    <div className="focus-page decision-page">
      <header className="focus-head">
        <button className="icon-btn" onClick={exit} aria-label="退出">
          ✕
        </button>
        <div className="focus-title">
          <h1>{top?.name ?? node.name}</h1>
          <p className="muted">
            第 {session.levels.length} 级 · {node.name}
          </p>
        </div>
        <button className="btn small" onClick={() => setFilterOpen(true)}>
          筛选{activeFilters.length ? ` (${activeFilters.length})` : ''}
        </button>
        <button className="icon-btn" onClick={() => setStateOpen(true)} title="状态与候选">
          ⋯
        </button>
      </header>

      <div className="decision-body">
        <div className="level-pill">
          第 {session.levels.length} 级 / 最多 10 级
          {node.allowRepeat ? ' · 允许重复' : ''}
          {node.avoidRepeat.enabled ? ` · 降温 ${node.avoidRepeat.reducePercent}% / ${node.avoidRepeat.rounds} 轮` : ''}
        </div>

        <div className="result-stage">
          {current ? (
            <>
              <div className="result-big">{current.name}</div>
              <div className="result-tags">
                {currentTags.map((tag) => (
                  <TagChip key={tag.id} tag={tag} color={tagColor(node, tag.id)} />
                ))}
                {level.status === 'manual' ? <span className="badge manual">手动选择</span> : null}
                {currentPenalty > 0 ? <span className="badge cool">降温 ×{currentPenalty}</span> : null}
              </div>
              <div className="result-meta">
                <span>实际权重 {effectiveWeight(node, current, round).toFixed(2)}</span>
                {currentProbability !== undefined ? (
                  <span>当前候选概率 {formatPercent(currentProbability)}</span>
                ) : (
                  <span className="muted">本次已抽中</span>
                )}
                {current.weight === 0 ? <span className="badge zero">永不出现</span> : null}
              </div>
              <p className="muted">
                {childName
                  ? `下一级：${childName}`
                  : '这个结果没有子决策，结束流程即完成本次决策。'}
              </p>
            </>
          ) : (
            <div className="result-placeholder">
              <div className="placeholder-icon">🎲</div>
              <h2>
                {eligible.eligible.length > 0
                  ? '准备好了'
                  : poolExhausted
                    ? '已全部抽过'
                    : '没有可用结果'}
              </h2>
              <p>
                {eligible.eligible.length > 0
                  ? `当前有 ${eligible.eligible.length} 个可抽候选。`
                  : poolExhausted
                    ? '点“抽取”会自动清空排除池并重新开始。'
                    : '所有结果都可能被筛掉、权重为 0，或已被拉黑。试试调整筛选。'}
              </p>
              {eligible.eligible.length === 0 && !poolExhausted ? (
                <button className="btn" onClick={() => setFilterOpen(true)}>
                  调整筛选
                </button>
              ) : null}
            </div>
          )}
        </div>

        <div className="decision-actions">
          <button className="btn primary big" onClick={() => store.draw()}>
            {current ? '换一个' : '抽取'}
          </button>
          {continueOk ? (
            <button className="btn big" onClick={() => store.continueLevel()}>
              继续下一级
            </button>
          ) : null}
          <button className="btn big" onClick={finish} disabled={!current}>
            结束流程
          </button>
          <div className="action-row">
            <button className="btn" onClick={undo}>
              撤销
            </button>
            <button className="btn" onClick={restart}>
              重新开始
            </button>
            <button className="btn" onClick={() => setManualOpen(true)}>
              手动选择
            </button>
          </div>
        </div>
      </div>

      {filterOpen ? (
        <Modal
          title="筛选标签"
          onClose={() => setFilterOpen(false)}
          wide
          footer={
            <div className="row gap">
              <button
                className="btn"
                onClick={() => {
                  store.clearFilters()
                }}
              >
                清除筛选
              </button>
              <button className="btn primary" onClick={() => setFilterOpen(false)}>
                完成
              </button>
            </div>
          }
        >
          {node.tagGroups.length === 0 ? (
            <p className="muted">这个决策还没有标签分组，先去编辑页添加。</p>
          ) : (
            <div className="stack">
              {node.tagGroups.map((group) => {
                const rule = level.filters[group.id] ?? {
                  mode: 'none' as FilterMode,
                  tagIds: [],
                }
                return (
                  <div className="filter-group" key={group.id}>
                    <div className="filter-head">
                      <span className="color-dot" style={{ background: group.color }} />
                      <strong>{group.name}</strong>
                      <div className="segmented">
                        {(
                          [
                            ['none', '不筛选'],
                            ['include', '只看'],
                            ['exclude', '排除'],
                          ] as [FilterMode, string][]
                        ).map(([mode, label]) => (
                          <button
                            key={mode}
                            className={`seg ${rule.mode === mode ? 'active' : ''}`}
                            onClick={() => setFilterMode(group.id, mode)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="tag-list">
                      {node.tags
                        .filter((tag) => tag.groupId === group.id)
                        .map((tag) => (
                          <TagChip
                            key={tag.id}
                            tag={tag}
                            color={group.color}
                            active={rule.tagIds.includes(tag.id)}
                            onClick={() => toggleFilterTag(group.id, tag.id)}
                          />
                        ))}
                      {node.tags.filter((tag) => tag.groupId === group.id).length === 0 ? (
                        <span className="muted small">该分组暂无标签</span>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Modal>
      ) : null}

      {manualOpen ? (
        <Modal title="手动选择结果" onClose={() => setManualOpen(false)} wide>
          <p className="muted">
            手动选择会记为“手动选择”，影响降温与“已抽过”；可以选权重 0 或被筛选掉的结果。
          </p>
          <div className="stack">
            {node.results.map((result) => {
              const excluded = !matchesFilter(node, result, level.filters)
              const inPool = level.pool.includes(result.id)
              const black = level.blacklist.includes(result.id)
              const isCurrent = level.currentResultId === result.id
              return (
                <button
                  key={result.id}
                  className={`list-row ${isCurrent ? 'selected' : ''}`}
                  onClick={() => {
                    store.manualSelect(result.id)
                    setManualOpen(false)
                  }}
                >
                  <span className="list-row-main">
                    <strong>{result.name}</strong>
                    <small className="muted">
                      权重 {result.weight}
                      {result.weight === 0 ? ' · 永不出现' : ''}
                    </small>
                  </span>
                  <span className="row gap wrap">
                    {isCurrent ? <span className="badge">当前</span> : null}
                    {inPool ? <span className="badge soft">已抽过</span> : null}
                    {excluded ? <span className="badge warn">被筛掉</span> : null}
                    {black ? <span className="badge warn">已拉黑</span> : null}
                  </span>
                </button>
              )
            })}
          </div>
        </Modal>
      ) : null}

      {stateOpen ? (
        <Modal
          title="状态与候选"
          onClose={() => setStateOpen(false)}
          wide
          footer={
            <div className="row gap wrap">
              <button className="btn" onClick={editCurrentLevel}>
                编辑本级
              </button>
              <button
                className="btn"
                onClick={() => {
                  if (!window.confirm('清空本级排除池与降温？')) return
                  store.resetCurrentLevelState()
                }}
              >
                重置本级状态
              </button>
              <button className="btn primary" onClick={() => setStateOpen(false)}>
                完成
              </button>
            </div>
          }
        >
          <label className="check-row">
            <input
              type="checkbox"
              checked={node.allowRepeat}
              onChange={(event) => store.setAllowRepeat(event.target.checked)}
            />
            <span>允许重复抽取（关闭“换一个”不重复）</span>
          </label>
          <p className="muted small">
            当前候选 {eligible.eligible.length} 个；已抽过 {level.pool.length} 个；拉黑{' '}
            {level.blacklist.length} 个。
          </p>
          <div className="state-list">
            {node.results.map((result) => (
              <div className="state-row" key={result.id}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={level.pool.includes(result.id)}
                    disabled={result.weight === 0}
                    onChange={() => store.togglePool(result.id)}
                  />
                  <span>{result.name}</span>
                </label>
                <span className="muted small">
                  权重 {result.weight} · 降温 {activeLayerCount(node, result.id, round)} 层
                </span>
                <button
                  className={`btn small ${level.blacklist.includes(result.id) ? 'danger' : ''}`}
                  onClick={() => store.toggleBlacklist(result.id)}
                >
                  {level.blacklist.includes(result.id) ? '取消拉黑' : '临时拉黑'}
                </button>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
