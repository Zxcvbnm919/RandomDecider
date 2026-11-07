import { MAX_ROUNDS, MIN_ROUNDS } from './limits'
import type { DecisionNode, PenaltyLayer } from './types'

export function normalizeRounds(rounds: number): number {
  if (!Number.isFinite(rounds)) return 3
  return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.round(rounds)))
}

/**
 * 在第 round 轮抽中某结果时增加一层。
 * 同一轮同一结果不重复；返回新增的层，未新增则 null。
 */
export function addPenaltyLayer(
  node: DecisionNode,
  resultId: string,
  round: number,
): PenaltyLayer | null {
  if (!node.avoidRepeat.enabled) return null
  if (node.penalties.some((l) => l.resultId === resultId && l.createdRound === round)) {
    return null
  }
  const rounds = normalizeRounds(node.avoidRepeat.rounds)
  const layer: PenaltyLayer = {
    resultId,
    createdRound: round,
    expiresAtRound: round + rounds,
  }
  node.penalties.push(layer)
  return layer
}

/** 撤销/重开：移除本轮会话中新增的层。 */
export function removeLayersForRound(
  node: DecisionNode,
  round: number,
  resultId?: string,
): void {
  node.penalties = node.penalties.filter((layer) => {
    if (layer.createdRound !== round) return true
    if (resultId !== undefined && layer.resultId !== resultId) return true
    return false
  })
}

export function clearNodePenalties(node: DecisionNode): void {
  node.penalties = []
}

/** 重置状态（会话外）：只清自有节点，不跟进引用，避免影响共享决策。 */
export function clearOwnedTreePenalties(node: DecisionNode): void {
  node.penalties = []
  for (const result of node.results) {
    if (result.child?.kind === 'owned') clearOwnedTreePenalties(result.child.node)
  }
}

/** 提交后清理已过期的层，避免数组无限增长。 */
export function pruneExpiredLayers(node: DecisionNode, round: number): void {
  node.penalties = node.penalties.filter((layer) => layer.expiresAtRound >= round)
}

export function layerCount(node: DecisionNode, resultId: string): number {
  return node.penalties.filter((layer) => layer.resultId === resultId).length
}
