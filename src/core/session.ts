import { nowIso } from './ids'
import { clearNodePenalties } from './penalty'
import { pickWeighted, systemRng, type Rng } from './rng'
import {
  cloneFilterState,
  emptyFilterState,
  filterResults,
  filterSnapshot,
  withFilterRule,
} from './tags'
import { findResult, getTopDecision, nodeDepth, resolveNode, topDepth } from './tree'
import type {
  AppData,
  DecisionNode,
  DrawStatus,
  FilterRule,
  FilterState,
  HistoryCandidate,
  HistoryFilter,
  HistoryRecord,
  NodeLocator,
  Result,
  SessionSummary,
  SummaryLevel,
} from './types'
import { effectiveWeight } from './weights'

export interface SessionLevel {
  locator: NodeLocator
  nodeId: string
  nodeName: string
  ownerDecisionId: string
  ownerDecisionName: string
  isReference: boolean
  filters: FilterState
  initialFilters: FilterState
  filtersUsed: HistoryFilter[]
  pool: string[]
  blacklist: string[]
  currentResultId: string | null
  status: DrawStatus | null
  replaced: string[]
  drawnIds: string[]
  systemDrawIds: string[]
  candidatesAtStart: HistoryCandidate[] | null
  excludedAtStart: HistoryCandidate[] | null
  provisionalLayers: string[]
  currentRound: number
}

export interface Session {
  rootId: string
  levels: SessionLevel[]
  startedAt: string
  committed: boolean
  summary: SessionSummary | null
  committedRecord: HistoryRecord | null
  revision: number
}

export interface DrawOutcome {
  ok: boolean
  reason?: 'no-candidates' | 'not-active'
  result?: Result
  autoReset?: boolean
}

export interface EligibleSnapshot {
  node: DecisionNode
  round: number
  matched: Result[]
  excluded: Result[]
  allEligible: Result[]
  eligible: Result[]
  allowRepeat: boolean
}

export function buildLevel(
  appData: AppData,
  locator: NodeLocator,
  isReference: boolean,
  filters: FilterState = emptyFilterState(),
): SessionLevel {
  const node = resolveNode(appData, locator)
  if (!node) throw new Error('节点不存在')
  const owner = getTopDecision(appData, locator.decisionId)
  if (!owner) throw new Error('所属决策不存在')
  return {
    locator: { decisionId: locator.decisionId, path: [...locator.path] },
    nodeId: node.id,
    nodeName: node.name,
    ownerDecisionId: owner.id,
    ownerDecisionName: owner.name,
    isReference,
    filters: cloneFilterState(filters),
    initialFilters: cloneFilterState(filters),
    filtersUsed: [],
    pool: [],
    blacklist: [],
    currentResultId: null,
    status: null,
    replaced: [],
    drawnIds: [],
    systemDrawIds: [],
    candidatesAtStart: null,
    excludedAtStart: null,
    provisionalLayers: [],
    currentRound: node.roundNo + 1,
  }
}

export function createSession(
  appData: AppData,
  rootId: string,
  now: string = nowIso(),
): Session {
  const top = getTopDecision(appData, rootId)
  if (!top) throw new Error('决策不存在')
  return {
    rootId,
    levels: [buildLevel(appData, { decisionId: rootId, path: [] }, false)],
    startedAt: now,
    committed: false,
    summary: null,
    committedRecord: null,
    revision: 0,
  }
}

export function currentLevel(session: Session): SessionLevel {
  const level = session.levels[session.levels.length - 1]
  if (!level) throw new Error('会话没有层级')
  return level
}

export function currentNode(session: Session, appData: AppData): DecisionNode {
  const node = resolveNode(appData, currentLevel(session).locator)
  if (!node) throw new Error('当前节点不存在')
  return node
}

export function usedDecisionIds(session: Session): Set<string> {
  const ids = new Set<string>([session.rootId])
  for (const level of session.levels) ids.add(level.ownerDecisionId)
  return ids
}

export function snapshotCandidates(
  level: SessionLevel,
  node: DecisionNode,
  round: number,
  matched: Result[],
  excluded: Result[],
): void {
  if (level.candidatesAtStart) return
  level.candidatesAtStart = matched.map((result) => ({
    name: result.name,
    baseWeight: result.weight,
    effectiveWeight: effectiveWeight(node, result, round),
  }))
  level.excludedAtStart = excluded.map((result) => ({
    name: result.name,
    baseWeight: result.weight,
    effectiveWeight: effectiveWeight(node, result, round),
  }))
}

export function getEligible(
  session: Session,
  appData: AppData,
  level: SessionLevel = currentLevel(session),
): EligibleSnapshot {
  const node = resolveNode(appData, level.locator)
  if (!node) throw new Error('当前节点不存在')
  const round = level.currentRound
  const { matched, excluded } = filterResults(node, level.filters)
  const allEligible = matched.filter(
    (result) => result.weight > 0 && !level.blacklist.includes(result.id),
  )
  const eligible = node.allowRepeat
    ? allEligible
    : allEligible.filter((result) => !level.pool.includes(result.id))
  return {
    node,
    round,
    matched,
    excluded,
    allEligible,
    eligible,
    allowRepeat: node.allowRepeat,
  }
}

function markReplaced(level: SessionLevel, node: DecisionNode, nextResultId: string): void {
  if (!level.currentResultId || level.currentResultId === nextResultId) return
  const previous = findResult(node, level.currentResultId)
  if (previous) level.replaced.push(previous.name)
}

function recordDraw(
  level: SessionLevel,
  node: DecisionNode,
  result: Result,
  status: DrawStatus,
  round: number,
): void {
  level.currentResultId = result.id
  level.status = status
  if (status === 'system') level.systemDrawIds.push(result.id)
  if (result.weight > 0) {
    if (!level.drawnIds.includes(result.id)) level.drawnIds.push(result.id)
    if (!node.allowRepeat && !level.pool.includes(result.id)) level.pool.push(result.id)
  }
  level.blacklist = level.blacklist.filter((id) => id !== result.id)
  if (node.avoidRepeat.enabled && !level.provisionalLayers.includes(result.id)) {
    level.provisionalLayers.push(result.id)
  }
  level.filtersUsed = filterSnapshot(node, level.filters)
}

export function draw(
  session: Session,
  appData: AppData,
  rng: Rng = systemRng,
): DrawOutcome {
  if (session.committed || session.levels.length === 0) {
    return { ok: false, reason: 'not-active' }
  }
  const level = currentLevel(session)
  const node = resolveNode(appData, level.locator)
  if (!node) return { ok: false, reason: 'not-active' }
  const round = level.currentRound
  const { matched, excluded } = filterResults(node, level.filters)
  const allEligible = matched.filter(
    (result) => result.weight > 0 && !level.blacklist.includes(result.id),
  )
  if (allEligible.length === 0) return { ok: false, reason: 'no-candidates' }

  let autoReset = false
  let eligible = node.allowRepeat
    ? allEligible
    : allEligible.filter((result) => !level.pool.includes(result.id))
  if (!node.allowRepeat && eligible.length === 0) {
    level.pool = []
    autoReset = true
    eligible = allEligible
  }
  if (eligible.length === 0) return { ok: false, reason: 'no-candidates' }

  snapshotCandidates(level, node, round, matched, excluded)
  const entries = eligible
    .map((result) => ({ item: result, weight: effectiveWeight(node, result, round) }))
    .filter((entry) => entry.weight > 0)
  if (entries.length === 0) return { ok: false, reason: 'no-candidates' }

  const result = pickWeighted(entries, rng)
  markReplaced(level, node, result.id)
  recordDraw(level, node, result, 'system', round)
  session.revision += 1
  return { ok: true, result, autoReset }
}

export function manualSelect(
  session: Session,
  appData: AppData,
  resultId: string,
): DrawOutcome {
  if (session.committed || session.levels.length === 0) {
    return { ok: false, reason: 'not-active' }
  }
  const level = currentLevel(session)
  const node = resolveNode(appData, level.locator)
  if (!node) return { ok: false, reason: 'not-active' }
  const result = findResult(node, resultId)
  if (!result) return { ok: false, reason: 'not-active' }

  markReplaced(level, node, result.id)
  recordDraw(level, node, result, 'manual', level.currentRound)
  session.revision += 1
  return { ok: true, result }
}

export function undo(session: Session, appData: AppData): void {
  if (session.committed) return
  const level = currentLevel(session)
  if (session.levels.length > 1) {
    session.levels.pop()
  } else {
    level.currentResultId = null
    level.status = null
    level.replaced = []
    level.pool = []
    level.blacklist = []
    level.drawnIds = []
    level.systemDrawIds = []
    level.provisionalLayers = []
    level.candidatesAtStart = null
    level.excludedAtStart = null
    level.filtersUsed = []
    level.filters = cloneFilterState(level.initialFilters)
  }
  session.revision += 1
}

export function restart(session: Session, appData: AppData): void {
  if (session.committed) return
  const root = getTopDecision(appData, session.rootId)
  if (!root) return
  session.levels = [buildLevel(appData, { decisionId: session.rootId, path: [] }, false)]
  session.revision += 1
}

/** 重置当前级：清空排除池 + 当前节点全部降温层；保留筛选与当前结果。 */
export function resetCurrentLevelState(session: Session, appData: AppData): void {
  const level = currentLevel(session)
  const node = resolveNode(appData, level.locator)
  if (node) clearNodePenalties(node)
  level.pool = []
  level.provisionalLayers = []
  session.revision += 1
}

export function canContinue(session: Session, appData: AppData): boolean {
  const level = currentLevel(session)
  const node = resolveNode(appData, level.locator)
  if (!node || !level.currentResultId) return false
  const result = findResult(node, level.currentResultId)
  if (!result?.child) return false
  const parentLevel = session.levels.length
  try {
    const childDepth =
      result.child.kind === 'owned'
        ? nodeDepth(result.child.node, appData)
        : topDepth(result.child.targetId, appData)
    return parentLevel + childDepth <= 10
  } catch {
    return false
  }
}

export function continueToChild(session: Session, appData: AppData): boolean {
  if (!canContinue(session, appData)) return false
  const level = currentLevel(session)
  const node = resolveNode(appData, level.locator)
  if (!node || !level.currentResultId) return false
  const result = findResult(node, level.currentResultId)
  if (!result?.child) return false

  let nextLocator: NodeLocator
  let isReference = false
  if (result.child.kind === 'owned') {
    nextLocator = {
      decisionId: level.locator.decisionId,
      path: [...level.locator.path, result.id],
    }
  } else {
    nextLocator = { decisionId: result.child.targetId, path: [] }
    isReference = true
  }
  session.levels.push(buildLevel(appData, nextLocator, isReference))
  session.revision += 1
  return true
}

export function setAllowRepeat(
  session: Session,
  appData: AppData,
  value: boolean,
): void {
  const level = currentLevel(session)
  const node = resolveNode(appData, level.locator)
  if (!node) return
  node.allowRepeat = value
  if (value) {
    level.pool = []
  } else {
    level.pool = [...new Set(level.drawnIds)].filter((id) => {
      const result = findResult(node, id)
      return Boolean(result && result.weight > 0)
    })
  }
  session.revision += 1
}

export function setFilterRule(
  session: Session,
  groupId: string,
  patch: Partial<FilterRule>,
): void {
  const level = currentLevel(session)
  level.filters = withFilterRule(level.filters, groupId, patch)
  session.revision += 1
}

export function clearFilters(session: Session): void {
  currentLevel(session).filters = emptyFilterState()
  session.revision += 1
}

export function toggleBlacklist(session: Session, resultId: string): void {
  const level = currentLevel(session)
  if (level.blacklist.includes(resultId)) {
    level.blacklist = level.blacklist.filter((id) => id !== resultId)
  } else {
    level.blacklist = [...level.blacklist, resultId]
  }
  session.revision += 1
}

/**
 * 会话中保存了当前级编辑后调用：清空排除池；若当前结果被删则清空选择。
 * 返回当前级别是否仍然有效。
 */
export function applyNodeEdit(session: Session, appData: AppData): boolean {
  const level = currentLevel(session)
  const node = resolveNode(appData, level.locator)
  if (!node) return false
  level.currentRound = node.roundNo + 1
  level.pool = []
  level.provisionalLayers = level.provisionalLayers.filter((id) => Boolean(findResult(node, id)))
  if (level.currentResultId && !findResult(node, level.currentResultId)) {
    level.currentResultId = null
    level.status = null
    level.replaced = []
    level.systemDrawIds = []
    level.drawnIds = []
    level.filtersUsed = []
    level.candidatesAtStart = null
    level.excludedAtStart = null
  }
  session.revision += 1
  return true
}

export function currentResult(session: Session, appData: AppData): Result | null {
  const level = currentLevel(session)
  if (!level.currentResultId) return null
  const node = resolveNode(appData, level.locator)
  if (!node) return null
  return findResult(node, level.currentResultId) ?? null
}

export function canFinish(session: Session): boolean {
  return session.levels.every((level) => Boolean(level.currentResultId && level.status))
}

export function buildSummary(session: Session, appData: AppData): SessionSummary {
  if (!canFinish(session)) throw new Error('还有层级没有抽取结果')
  const root = getTopDecision(appData, session.rootId)
  if (!root) throw new Error('根决策不存在')
  const levels: SummaryLevel[] = session.levels.map((level, index) => {
    const node = resolveNode(appData, level.locator)
    const result = node && level.currentResultId ? findResult(node, level.currentResultId) : null
    return {
      level: index + 1,
      decisionName: level.ownerDecisionName,
      nodeName: node?.name ?? level.nodeName,
      isReference: level.isReference,
      finalResult: result?.name ?? '',
      status: level.status ?? 'system',
      replaced: [...level.replaced],
    }
  })
  return {
    rootId: root.id,
    rootName: root.name,
    time: nowIso(),
    levels,
    finalChain: levels.map((level) => level.finalResult),
    manualParts: levels
      .filter((level) => level.status === 'manual')
      .map((level) => level.finalResult),
    replacedByLevel: levels.map((level) => ({
      level: level.level,
      names: level.replaced,
    })),
  }
}

export function currentOwner(session: Session, appData: AppData) {
  return getTopDecision(appData, currentLevel(session).locator.decisionId) ?? null
}
