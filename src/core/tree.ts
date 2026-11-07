import { nowIso, uuid } from './ids'
import {
  MAX_DEPTH,
  MAX_OWNED_NODES,
  MAX_RESULTS_PER_NODE,
} from './limits'
import type {
  AppData,
  ChildRef,
  DecisionNode,
  NodeLocator,
  Result,
  TopDecision,
} from './types'

export function getTopDecision(appData: AppData, id: string): TopDecision | undefined {
  return appData.decisions.find((decision) => decision.id === id)
}

export function findResult(node: DecisionNode, resultId: string): Result | undefined {
  return node.results.find((result) => result.id === resultId)
}

export function nodeAtPath(root: DecisionNode, path: string[]): DecisionNode | null {
  let node: DecisionNode = root
  for (const resultId of path) {
    const result = node.results.find((item) => item.id === resultId)
    if (!result || result.child?.kind !== 'owned') return null
    node = result.child.node
  }
  return node
}

export function resolveNode(appData: AppData, locator: NodeLocator): DecisionNode | null {
  const top = getTopDecision(appData, locator.decisionId)
  if (!top) return null
  return nodeAtPath(top, locator.path)
}

export function resolveOwner(appData: AppData, locator: NodeLocator): TopDecision | null {
  return getTopDecision(appData, locator.decisionId) ?? null
}

function topDepthInternal(
  topId: string,
  appData: AppData,
  stack: Set<string>,
): number {
  if (stack.has(topId)) throw new Error('循环引用')
  const top = getTopDecision(appData, topId)
  if (!top) throw new Error('引用的决策不存在')
  stack.add(topId)
  try {
    return nodeDepth(top, appData, stack)
  } finally {
    stack.delete(topId)
  }
}

export function nodeDepth(
  node: DecisionNode,
  appData: AppData,
  stack: Set<string> = new Set(),
): number {
  let max = 1
  for (const result of node.results) {
    if (!result.child) continue
    const childDepth =
      result.child.kind === 'owned'
        ? nodeDepth(result.child.node, appData, stack)
        : topDepthInternal(result.child.targetId, appData, stack)
    max = Math.max(max, 1 + childDepth)
  }
  return max
}

export function topDepth(topId: string, appData: AppData): number {
  return topDepthInternal(topId, appData, new Set())
}

export function canAddChild(parentLevel: number, childDepth: number): boolean {
  return parentLevel + childDepth <= MAX_DEPTH
}

export function ownedNodeCount(node: DecisionNode): number {
  let count = 1
  for (const result of node.results) {
    if (result.child?.kind === 'owned') count += ownedNodeCount(result.child.node)
  }
  return count
}

export function walkOwnedNodes(
  node: DecisionNode,
  visit: (node: DecisionNode) => void,
): void {
  visit(node)
  for (const result of node.results) {
    if (result.child?.kind === 'owned') walkOwnedNodes(result.child.node, visit)
  }
}

export function cloneOwnedNode(node: DecisionNode): DecisionNode {
  const groupMap = new Map<string, string>()
  const groups = node.tagGroups.map((group) => {
    const id = uuid()
    groupMap.set(group.id, id)
    return { ...group, id }
  })
  const tagMap = new Map<string, string>()
  const tags = node.tags.map((tag) => {
    const id = uuid()
    tagMap.set(tag.id, id)
    return {
      ...tag,
      id,
      groupId: tag.groupId ? (groupMap.get(tag.groupId) ?? null) : null,
    }
  })
  const results = node.results.map((result, index) => {
    let child: ChildRef | null = null
    if (result.child?.kind === 'owned') {
      child = { kind: 'owned', node: cloneOwnedNode(result.child.node) }
    } else if (result.child?.kind === 'reference') {
      child = { kind: 'reference', targetId: result.child.targetId }
    }
    return {
      ...result,
      id: uuid(),
      order: index,
      tagIds: result.tagIds
        .map((id) => tagMap.get(id))
        .filter((id): id is string => Boolean(id)),
      child,
      createdAt: nowIso(),
    }
  })
  return {
    ...node,
    id: uuid(),
    tagGroups: groups,
    tags,
    results,
    roundNo: 0,
    penalties: [],
    createdAt: nowIso(),
  }
}

function nodeReferencesAny(
  node: DecisionNode,
  ids: Set<string>,
  appData: AppData,
  stack: Set<string>,
): boolean {
  for (const result of node.results) {
    if (!result.child) continue
    if (result.child.kind === 'owned') {
      if (nodeReferencesAny(result.child.node, ids, appData, stack)) return true
    } else {
      if (ids.has(result.child.targetId)) return true
      if (stack.has(result.child.targetId)) continue
      const top = getTopDecision(appData, result.child.targetId)
      if (!top) continue
      const next = new Set(stack)
      next.add(result.child.targetId)
      if (nodeReferencesAny(top, ids, appData, next)) return true
    }
  }
  return false
}

export interface ReferenceOption {
  decision: TopDecision
  depth: number
}

export interface ReferenceLocation {
  top: TopDecision
  node: DecisionNode
  result: Result
  /** 从顶层决策根到“引用所在节点”的结果 id 链（不含引用结果本身）。 */
  path: string[]
}

/** 查找所有引用 targetId 的位置（不包含 target 自身内部的引用）。 */
export function findReferences(
  appData: AppData,
  targetId: string,
): ReferenceLocation[] {
  const locations: ReferenceLocation[] = []

  const walk = (top: TopDecision, node: DecisionNode, path: string[]): void => {
    for (const result of node.results) {
      if (result.child?.kind === 'reference' && result.child.targetId === targetId) {
        locations.push({ top, node, result, path: [...path] })
      } else if (result.child?.kind === 'owned') {
        walk(top, result.child.node, [...path, result.id])
      }
    }
  }

  for (const top of appData.decisions) {
    if (top.id === targetId) continue
    walk(top, top, [])
  }
  return locations
}

/**
 * 当前链里还能引用哪些顶级决策。
 * usedDecisionIds 应包含根决策与链上已出现的引用目标。
 * parentLevel 为引用所在父结果的层级（引用节点将是 parentLevel + 1）。
 */
export function referenceCandidates(
  appData: AppData,
  usedDecisionIds: Set<string>,
  parentLevel: number,
): ReferenceOption[] {
  const options: ReferenceOption[] = []
  for (const decision of appData.decisions) {
    if (usedDecisionIds.has(decision.id)) continue
    let depth: number
    try {
      depth = topDepth(decision.id, appData)
    } catch {
      continue
    }
    if (parentLevel + depth > MAX_DEPTH) continue
    if (nodeReferencesAny(decision, usedDecisionIds, appData, new Set([decision.id]))) {
      continue
    }
    options.push({ decision, depth })
  }
  return options.sort((a, b) => a.decision.name.localeCompare(b.decision.name, 'zh-CN'))
}

export interface TreeError {
  path: string
  message: string
}

export function validateTree(
  root: DecisionNode,
  appData: AppData,
  rootLabel = root.name,
): TreeError[] {
  const errors: TreeError[] = []
  const owned = ownedNodeCount(root)
  if (owned > MAX_OWNED_NODES) {
    errors.push({ path: rootLabel, message: `节点数超过上限（${MAX_OWNED_NODES}）` })
  }

  const visit = (node: DecisionNode, path: string, stack: Set<string>): void => {
    const label = `${path} / ${node.name}`
    if (node.results.length > MAX_RESULTS_PER_NODE) {
      errors.push({ path: label, message: `结果数超过上限（${MAX_RESULTS_PER_NODE}）` })
    }
    const names = new Set<string>()
    const tagIds = new Set(node.tags.map((tag) => tag.id))
    for (const result of node.results) {
      const trimmed = result.name.trim()
      if (!trimmed) errors.push({ path: label, message: '存在空结果名' })
      const key = trimmed.toLowerCase()
      if (names.has(key)) errors.push({ path: label, message: `结果重名：${trimmed}` })
      names.add(key)
      if (result.weight < 0 || result.weight > 1_000_000 || !Number.isInteger(result.weight)) {
        errors.push({ path: label, message: `权重非法：${result.name}` })
      }
      for (const tagId of result.tagIds) {
        if (!tagIds.has(tagId)) {
          errors.push({ path: label, message: `结果 ${result.name} 引用了不存在的标签` })
        }
      }
      if (!result.child) continue
      if (result.child.kind === 'owned') {
        visit(result.child.node, `${path} → ${result.name}`, stack)
      } else {
        const target = getTopDecision(appData, result.child.targetId)
        if (!target) {
          errors.push({ path: label, message: `引用目标不存在：${result.name}` })
          continue
        }
        if (stack.has(target.id)) {
          errors.push({ path: label, message: `循环引用：${target.name}` })
          continue
        }
        try {
          const depth = topDepth(target.id, appData)
          if (depth + countPathDepth(path) > MAX_DEPTH) {
            errors.push({ path: label, message: `引用后层级超过 ${MAX_DEPTH}` })
          }
        } catch {
          errors.push({ path: label, message: `引用目标存在循环：${target.name}` })
        }
      }
    }
  }

  try {
    const depth = nodeDepth(root, appData, new Set(root.id ? [root.id] : []))
    if (depth > MAX_DEPTH) {
      errors.push({ path: rootLabel, message: `层级超过 ${MAX_DEPTH}` })
    }
  } catch (error) {
    errors.push({ path: rootLabel, message: error instanceof Error ? error.message : String(error) })
  }

  visit(root, rootLabel, new Set([root.id]))
  return errors
}

function countPathDepth(path: string): number {
  if (!path) return 1
  return path.split('→').length
}
