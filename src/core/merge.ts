import { uuid } from './ids'
import { MAX_HISTORY, MAX_TOP_DECISIONS } from './limits'
import { validateTree } from './tree'
import type { AppData, DecisionNode, TopDecision } from './types'

export type DecisionConflictAction = 'skip' | 'overwrite' | 'rename'

export interface DecisionConflictResolution {
  action: DecisionConflictAction
  name?: string
}

export interface MergeOptions {
  /** key 为备份中的 incoming decision id */
  decisionResolutions?: Map<string, DecisionConflictResolution>
}

export interface DecisionConflict {
  incomingId: string
  name: string
  existingId: string
}

export interface MergeReport {
  addedDecisions: number
  skippedDecisions: number
  overwrittenDecisions: number
  addedFolders: number
  addedPresets: number
  addedStats: number
  addedHistory: number
  warnings: string[]
}

/** 找出备份中与当前数据同名的顶级决策。 */
export function detectDecisionConflicts(
  current: AppData,
  incoming: AppData,
): DecisionConflict[] {
  const conflicts: DecisionConflict[] = []
  for (const decision of incoming.decisions) {
    const existing = current.decisions.find(
      (item) => item.name.toLowerCase() === decision.name.toLowerCase(),
    )
    if (existing) {
      conflicts.push({
        incomingId: decision.id,
        name: decision.name,
        existingId: existing.id,
      })
    }
  }
  return conflicts
}

function uniqueImportedName(base: string, decisions: TopDecision[]): string {
  const root = ([...base].slice(0, 32).join('') || '导入决策').trim()
  let name = root
  let suffix = 2
  while (decisions.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
    const tail = ` (${suffix})`
    name = `${[...root].slice(0, Math.max(1, 32 - tail.length)).join('')}${tail}`
    suffix += 1
  }
  return name
}

function statKey(decisionId: string, nodeId: string, resultId: string): string {
  return `${decisionId}\u0000${nodeId}\u0000${resultId}`
}

function remapNode(
  node: DecisionNode,
  decisionMap: Map<string, string>,
  presetMap: Map<string, string>,
  current: AppData,
  report: MergeReport,
): void {
  if (node.appliedPresetId) {
    node.appliedPresetId = presetMap.get(node.appliedPresetId) ?? null
  }
  for (const result of node.results) {
    if (!result.child) continue
    if (result.child.kind === 'owned') {
      remapNode(result.child.node, decisionMap, presetMap, current, report)
      continue
    }
    const targetId = result.child.targetId
    const mapped = decisionMap.get(targetId)
    if (mapped) {
      result.child = { kind: 'reference', targetId: mapped }
    } else if (mapped === '') {
      result.child = null
      report.warnings.push(`引用目标被跳过，已解除引用：${result.name}`)
    } else if (!current.decisions.some((decision) => decision.id === targetId)) {
      result.child = null
      report.warnings.push(`引用目标不存在，已解除引用：${result.name}`)
    }
  }
}

/**
 * 合并全量备份：保留当前数据，按名称去重；同名决策/文件夹/预设默认跳过。
 * options.decisionResolutions 可按 incoming decision id 指定 skip / overwrite / rename。
 * 引用会按“备份内名称映射”重新指向当前或新导入的决策；找不到目标则解除引用。
 */
export function mergeAppData(
  current: AppData,
  incoming: AppData,
  options: MergeOptions = {},
): MergeReport {
  const report: MergeReport = {
    addedDecisions: 0,
    skippedDecisions: 0,
    overwrittenDecisions: 0,
    addedFolders: 0,
    addedPresets: 0,
    addedStats: 0,
    addedHistory: 0,
    warnings: [],
  }

  const folderMap = new Map<string, string>()
  for (const folder of incoming.folders) {
    const existing = current.folders.find(
      (item) => item.name.toLowerCase() === folder.name.toLowerCase(),
    )
    if (existing) {
      folderMap.set(folder.id, existing.id)
      continue
    }
    if (current.folders.length >= 50) {
      report.warnings.push(`文件夹数量已达上限，跳过：${folder.name}`)
      continue
    }
    const id = current.folders.some((item) => item.id === folder.id) ? uuid() : folder.id
    current.folders.push({ ...folder, id })
    folderMap.set(folder.id, id)
    report.addedFolders += 1
  }

  const presetMap = new Map<string, string>()
  for (const preset of incoming.tagPresets) {
    const existing = current.tagPresets.find(
      (item) => item.name.toLowerCase() === preset.name.toLowerCase(),
    )
    if (existing) {
      presetMap.set(preset.id, existing.id)
      continue
    }
    if (current.tagPresets.length >= 100) {
      report.warnings.push(`标签预设数量已达上限，跳过：${preset.name}`)
      continue
    }
    const id = current.tagPresets.some((item) => item.id === preset.id) ? uuid() : preset.id
    current.tagPresets.push({ ...preset, id })
    presetMap.set(preset.id, id)
    report.addedPresets += 1
  }

  const decisionMap = new Map<string, string>()
  const added: TopDecision[] = []

  for (const incomingTop of incoming.decisions) {
    const existing = current.decisions.find(
      (decision) => decision.name.toLowerCase() === incomingTop.name.toLowerCase(),
    )
    if (existing) {
      const resolution = options.decisionResolutions?.get(incomingTop.id)
      if (resolution?.action === 'overwrite') {
        const clone = structuredClone(incomingTop)
        const keep = {
          id: existing.id,
          name: existing.name,
          folderId: existing.folderId,
          order: existing.order,
          favorite: existing.favorite,
          pinned: existing.pinned,
          createdAt: existing.createdAt,
          lastUsedAt: existing.lastUsedAt,
        }
        Object.assign(existing, clone)
        Object.assign(existing, keep)
        decisionMap.set(incomingTop.id, existing.id)
        added.push(existing)
        report.overwrittenDecisions += 1
        continue
      }
      if (resolution?.action === 'rename') {
        const clone = structuredClone(incomingTop)
        clone.name = uniqueImportedName(
          (resolution.name ?? `${incomingTop.name} (导入)`).trim() ||
            `${incomingTop.name} (导入)`,
          current.decisions,
        )
        clone.id = current.decisions.some((decision) => decision.id === clone.id)
          ? uuid()
          : clone.id
        clone.folderId = clone.folderId ? (folderMap.get(clone.folderId) ?? null) : null
        clone.order = current.decisions.length
        current.decisions.push(clone)
        decisionMap.set(incomingTop.id, clone.id)
        added.push(clone)
        report.addedDecisions += 1
        continue
      }
      decisionMap.set(incomingTop.id, existing.id)
      report.skippedDecisions += 1
      continue
    }
    if (current.decisions.length >= MAX_TOP_DECISIONS) {
      decisionMap.set(incomingTop.id, '')
      report.skippedDecisions += 1
      report.warnings.push(`顶级决策数量已达上限，跳过：${incomingTop.name}`)
      continue
    }

    const clone = structuredClone(incomingTop)
    clone.id = current.decisions.some((decision) => decision.id === clone.id)
      ? uuid()
      : clone.id
    clone.folderId = clone.folderId ? (folderMap.get(clone.folderId) ?? null) : null
    clone.order = current.decisions.length
    decisionMap.set(incomingTop.id, clone.id)
    current.decisions.push(clone)
    added.push(clone)
    report.addedDecisions += 1
  }

  for (const decision of added) {
    remapNode(decision, decisionMap, presetMap, current, report)
  }

  for (const decision of added) {
    const errors = validateTree(decision, current)
    if (errors.length > 0) {
      report.warnings.push(`导入的“${decision.name}”：${errors[0]!.message}`)
    }
  }

  const statKeys = new Set(
    current.stats.map((record) => statKey(record.decisionId, record.nodeId, record.resultId)),
  )
  for (const stat of incoming.stats) {
    const mapped = decisionMap.get(stat.decisionId)
    if (!mapped) continue
    const key = statKey(mapped, stat.nodeId, stat.resultId)
    if (statKeys.has(key)) continue
    statKeys.add(key)
    const decision = current.decisions.find((item) => item.id === mapped)
    current.stats.push({
      ...stat,
      decisionId: mapped,
      decisionName: decision?.name ?? stat.decisionName,
    })
    report.addedStats += 1
  }

  const historyIds = new Set(current.history.map((record) => record.id))
  for (const record of incoming.history) {
    if (historyIds.has(record.id)) continue
    historyIds.add(record.id)
    current.history.push(structuredClone(record))
    report.addedHistory += 1
  }
  current.history = [...current.history]
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(-MAX_HISTORY)

  return report
}
