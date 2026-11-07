import { nowIso } from './ids'
import type { Session } from './session'
import { findResult, getTopDecision, resolveNode } from './tree'
import type { AppData, StatRecord } from './types'

export function statKey(decisionId: string, nodeId: string, resultId: string): string {
  return `${decisionId}\u0000${nodeId}\u0000${resultId}`
}

export function emptyStat(
  decisionId: string,
  decisionName: string,
  nodeId: string,
  nodeName: string,
  resultId: string,
  resultName: string,
): StatRecord {
  return {
    decisionId,
    decisionName,
    nodeId,
    nodeName,
    resultId,
    resultName,
    appear: 0,
    final: 0,
    manual: 0,
    lastAppear: null,
    lastFinal: null,
  }
}

export function updateStats(
  stats: StatRecord[],
  session: Session,
  appData: AppData,
  now: string = nowIso(),
): StatRecord[] {
  const map = new Map<string, StatRecord>()
  for (const record of stats) {
    map.set(statKey(record.decisionId, record.nodeId, record.resultId), { ...record })
  }

  for (const level of session.levels) {
    const node = resolveNode(appData, level.locator)
    const owner = getTopDecision(appData, level.ownerDecisionId)
    if (!node || !owner) continue

    const ensure = (resultId: string): StatRecord | null => {
      const result = findResult(node, resultId)
      if (!result) return null
      const key = statKey(owner.id, node.id, result.id)
      let record = map.get(key)
      if (!record) {
        record = emptyStat(owner.id, owner.name, node.id, node.name, result.id, result.name)
        map.set(key, record)
      }
      record.decisionName = owner.name
      record.nodeName = node.name
      record.resultName = result.name
      return record
    }

    for (const resultId of level.systemDrawIds) {
      const record = ensure(resultId)
      if (record) {
        record.appear += 1
        record.lastAppear = now
      }
    }

    if (level.currentResultId) {
      const record = ensure(level.currentResultId)
      if (record) {
        record.final += 1
        record.lastFinal = now
        if (level.status === 'manual') record.manual += 1
      }
    }
  }

  return [...map.values()]
}

export function statsForDecision(stats: StatRecord[], decisionId: string): StatRecord[] {
  return stats.filter((record) => record.decisionId === decisionId)
}

export function findStat(
  stats: StatRecord[],
  decisionId: string,
  nodeId: string,
  resultId: string,
): StatRecord | undefined {
  return stats.find(
    (record) =>
      record.decisionId === decisionId &&
      record.nodeId === nodeId &&
      record.resultId === resultId,
  )
}

export function totalAppear(stats: StatRecord[]): number {
  return stats.reduce((sum, record) => sum + record.appear, 0)
}
