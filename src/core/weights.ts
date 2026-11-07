import { MAX_REDUCE_PERCENT, MIN_REDUCE_PERCENT } from './limits'
import type { DecisionNode, Result } from './types'

export function currentRound(node: DecisionNode): number {
  return node.roundNo + 1
}

export function clampReducePercent(value: number): number {
  if (!Number.isFinite(value)) return 50
  return Math.min(MAX_REDUCE_PERCENT, Math.max(MIN_REDUCE_PERCENT, Math.round(value)))
}

/** 某一结果在第 round 轮开始时生效的降温层数。 */
export function activeLayerCount(
  node: DecisionNode,
  resultId: string,
  round: number,
): number {
  if (!node.avoidRepeat.enabled) return 0
  let count = 0
  for (const layer of node.penalties) {
    if (layer.resultId !== resultId) continue
    if (layer.createdRound < round && round <= layer.expiresAtRound) count += 1
  }
  return count
}

export function effectiveWeight(
  node: DecisionNode,
  result: Pick<Result, 'id' | 'weight'>,
  round: number,
): number {
  const base = Math.max(0, result.weight)
  if (base <= 0) return 0
  const k = activeLayerCount(node, result.id, round)
  if (k <= 0) return base
  const r = clampReducePercent(node.avoidRepeat.reducePercent) / 100
  return base * (1 - r) ** k
}

export function effectiveWeights(
  node: DecisionNode,
  round: number,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const result of node.results) {
    map.set(result.id, effectiveWeight(node, result, round))
  }
  return map
}

export function totalWeight(weights: Iterable<number>): number {
  let total = 0
  for (const w of weights) total += Math.max(0, w)
  return total
}

/** 将一组结果按实际权重归一化为概率（0..1）。总和为 0 时全为 0。 */
export function probabilities(
  node: DecisionNode,
  results: Result[],
  round: number,
): Map<string, number> {
  const map = new Map<string, number>()
  const weights = results.map((result) => effectiveWeight(node, result, round))
  const total = totalWeight(weights)
  results.forEach((result, index) => {
    map.set(result.id, total > 0 ? weights[index]! / total : 0)
  })
  return map
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function formatPercent(probability: number): string {
  return `${(probability * 100).toFixed(2)}%`
}

export function formatWeight(weight: number): string {
  return weight.toFixed(2)
}
