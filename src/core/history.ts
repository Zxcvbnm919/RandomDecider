import { nowIso, uuid } from './ids'
import { MAX_HISTORY } from './limits'
import type { Session } from './session'
import { findResult, getTopDecision, resolveNode } from './tree'
import type { HistoryLevel, HistoryRecord } from './types'

export function buildHistoryRecord(
  session: Session,
  appData: import('./types').AppData,
  time: string = nowIso(),
): HistoryRecord {
  const root = getTopDecision(appData, session.rootId)
  if (!root) throw new Error('根决策不存在')
  const levels: HistoryLevel[] = session.levels.map((level, index) => {
    const node = resolveNode(appData, level.locator)
    if (!node) throw new Error('历史节点不存在')
    const owner = getTopDecision(appData, level.ownerDecisionId)
    const finalResult =
      node && level.currentResultId ? findResult(node, level.currentResultId) : undefined
    const blacklisted = level.blacklist
      .map((id) => findResult(node, id)?.name)
      .filter((name): name is string => Boolean(name))
    return {
      level: index + 1,
      decisionId: owner?.id ?? level.ownerDecisionId,
      decisionName: owner?.name ?? level.ownerDecisionName,
      nodeId: node.id,
      nodeName: node.name,
      isReference: level.isReference,
      finalResult: finalResult?.name ?? '',
      status: level.status ?? 'system',
      filters: [...level.filtersUsed],
      candidates: [...(level.candidatesAtStart ?? [])],
      excluded: [...(level.excludedAtStart ?? [])],
      blacklisted,
      replaced: [...level.replaced],
    }
  })
  return {
    id: uuid(),
    decisionId: root.id,
    decisionName: root.name,
    time,
    levels,
  }
}

export function pushHistory(
  history: HistoryRecord[],
  record: HistoryRecord,
): HistoryRecord[] {
  const next = [...history, record]
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next
}

export interface HistoryExportJson {
  格式版本: number
  类型: '历史导出'
  导出时间: string
  历史数据: {
    记录ID: string
    决策名称: string
    决策时间: string
    决策明细: {
      层级: number
      决策名称: string
      所属决策: string
      是否引用: boolean
      最终结果: string
      状态: '系统抽取' | '手动选择'
      筛选: {
        标签组: string
        筛选模式: '只看' | '排除'
        选中的标签: string[]
      }[]
      候选结果: { 名称: string; 基础权重: number; 实际权重: number }[]
      排除结果: { 名称: string; 基础权重: number; 实际权重: number }[]
      临时拉黑: string[]
      被替换结果: string[]
    }[]
  }[]
}

export function historyToJson(
  history: HistoryRecord[],
  exportedAt: string = nowIso(),
): HistoryExportJson {
  return {
    格式版本: 1,
    类型: '历史导出',
    导出时间: exportedAt,
    历史数据: history.map((record) => ({
      记录ID: record.id,
      决策名称: record.decisionName,
      决策时间: record.time,
      决策明细: record.levels.map((level) => ({
        层级: level.level,
        决策名称: level.nodeName,
        所属决策: level.decisionName,
        是否引用: level.isReference,
        最终结果: level.finalResult,
        状态: level.status === 'manual' ? '手动选择' : '系统抽取',
        筛选: level.filters.map((filter) => ({
          标签组: filter.groupName,
          筛选模式: filter.mode === 'include' ? '只看' : '排除',
          选中的标签: [...filter.tagNames],
        })),
        候选结果: level.candidates.map((candidate) => ({
          名称: candidate.name,
          基础权重: candidate.baseWeight,
          实际权重: candidate.effectiveWeight,
        })),
        排除结果: level.excluded.map((candidate) => ({
          名称: candidate.name,
          基础权重: candidate.baseWeight,
          实际权重: candidate.effectiveWeight,
        })),
        临时拉黑: [...level.blacklisted],
        被替换结果: [...level.replaced],
      })),
    })),
  }
}

export function historyFromJson(json: HistoryExportJson): HistoryRecord[] {
  return json.历史数据.map((record) => ({
    id: record.记录ID,
    decisionId: '',
    decisionName: record.决策名称,
    time: record.决策时间,
    levels: record.决策明细.map((level) => ({
      level: level.层级,
      decisionId: '',
      decisionName: level.所属决策 ?? level.决策名称,
      nodeId: '',
      nodeName: level.决策名称,
      isReference: Boolean(level.是否引用),
      finalResult: level.最终结果,
      status: level.状态 === '手动选择' ? 'manual' : 'system',
      filters: (level.筛选 ?? []).map((filter, index) => ({
        groupId: `imported-group-${index}`,
        groupName: filter.标签组,
        mode: filter.筛选模式 === '排除' ? 'exclude' : 'include',
        tagIds: [],
        tagNames: [...filter.选中的标签],
      })),
      candidates: (level.候选结果 ?? []).map((candidate) => ({
        name: candidate.名称,
        baseWeight: candidate.基础权重,
        effectiveWeight: candidate.实际权重,
      })),
      excluded: (level.排除结果 ?? []).map((candidate) => ({
        name: candidate.名称,
        baseWeight: candidate.基础权重,
        effectiveWeight: candidate.实际权重,
      })),
      blacklisted: [...(level.临时拉黑 ?? [])],
      replaced: [...(level.被替换结果 ?? [])],
    })),
  }))
}
