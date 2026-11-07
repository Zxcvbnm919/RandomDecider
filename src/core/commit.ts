import { buildHistoryRecord, pushHistory } from './history'
import { nowIso } from './ids'
import { addPenaltyLayer, pruneExpiredLayers } from './penalty'
import { buildSummary, canFinish, type Session } from './session'
import { updateStats } from './stats'
import { findResult, getTopDecision, resolveNode } from './tree'
import type { AppData, DecisionNode, HistoryRecord, SessionSummary } from './types'

export interface CommitResult {
  record: HistoryRecord
  summary: SessionSummary
}

/**
 * 到达汇总页时提交：写历史、更新统计、提交降温层、推进轮次。
 * 失败时抛错，调用方应停留在汇总页并提示重试。
 */
export function commitSession(
  session: Session,
  appData: AppData,
  now: string = nowIso(),
): CommitResult {
  if (session.committed && session.committedRecord) {
    return {
      record: session.committedRecord,
      summary: session.summary ?? buildSummary(session, appData),
    }
  }
  if (!canFinish(session)) throw new Error('还有层级没有抽取结果')

  const summary = buildSummary(session, appData)
  summary.time = now
  const record = buildHistoryRecord(session, appData, now)

  const nodes = new Map<string, DecisionNode>()
  for (const level of session.levels) {
    const node = resolveNode(appData, level.locator)
    if (node) nodes.set(node.id, node)
  }

  // 先写入本次产生的降温层，再推进轮次。
  for (const level of session.levels) {
    const node = resolveNode(appData, level.locator)
    if (!node || !node.avoidRepeat.enabled) continue
    for (const resultId of level.provisionalLayers) {
      if (!findResult(node, resultId)) continue
      addPenaltyLayer(node, resultId, node.roundNo + 1)
    }
  }

  for (const node of nodes.values()) {
    node.roundNo += 1
    pruneExpiredLayers(node, node.roundNo)
  }

  const root = getTopDecision(appData, session.rootId)
  if (root) root.lastUsedAt = now
  for (const level of session.levels) {
    const owner = getTopDecision(appData, level.ownerDecisionId)
    if (owner) owner.lastUsedAt = now
  }

  // 统计与历史只在这里写一次。
  appData.stats = updateStats(appData.stats, session, appData, now)
  appData.history = pushHistory(appData.history, record)

  session.committed = true
  session.summary = summary
  session.committedRecord = record
  session.revision += 1

  return { record, summary }
}
