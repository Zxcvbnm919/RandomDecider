import { uuid, nowIso } from './ids'
import {
  MAX_GROUP_NAME_LENGTH,
  MAX_TAG_NAME_LENGTH,
  MAX_TAGS_PER_RESULT,
} from './limits'
import type {
  DecisionNode,
  FilterMode,
  FilterRule,
  FilterState,
  HistoryFilter,
  Result,
  Tag,
  TagGroup,
  TagPreset,
} from './types'

export function emptyFilterState(): FilterState {
  return {}
}

export function cloneFilterState(state: FilterState): FilterState {
  const copy: FilterState = {}
  for (const [groupId, rule] of Object.entries(state)) {
    copy[groupId] = { mode: rule.mode, tagIds: [...rule.tagIds] }
  }
  return copy
}

export function getFilterRule(state: FilterState, groupId: string): FilterRule {
  return state[groupId] ?? { mode: 'none', tagIds: [] }
}

export function withFilterRule(
  state: FilterState,
  groupId: string,
  patch: Partial<FilterRule>,
): FilterState {
  const current = getFilterRule(state, groupId)
  return {
    ...state,
    [groupId]: {
      mode: patch.mode ?? current.mode,
      tagIds: patch.tagIds ? [...patch.tagIds] : [...current.tagIds],
    },
  }
}

export function toggleFilterTag(
  state: FilterState,
  groupId: string,
  tagId: string,
): FilterState {
  const current = getFilterRule(state, groupId)
  const exists = current.tagIds.includes(tagId)
  const tagIds = exists
    ? current.tagIds.filter((id) => id !== tagId)
    : [...current.tagIds, tagId]
  return withFilterRule(state, groupId, { tagIds })
}

export function normalizeTagIds(tagIds: string[]): string[] {
  return [...new Set(tagIds)]
}

export function tagNameMap(node: DecisionNode): Map<string, Tag> {
  return new Map(node.tags.map((tag) => [tag.id, tag]))
}

export function groupNameMap(node: DecisionNode): Map<string, TagGroup> {
  return new Map(node.tagGroups.map((group) => [group.id, group]))
}

export function tagColor(node: DecisionNode, tagId: string): string {
  const tag = node.tags.find((item) => item.id === tagId)
  if (!tag || !tag.groupId) return '#FFFFFF'
  return node.tagGroups.find((group) => group.id === tag.groupId)?.color ?? '#FFFFFF'
}

export function tagsOfResult(node: DecisionNode, result: Result): Tag[] {
  const map = tagNameMap(node)
  return result.tagIds
    .map((id) => map.get(id))
    .filter((tag): tag is Tag => Boolean(tag))
    .sort((a, b) => a.order - b.order)
}

/**
 * 当前筛选下结果是否保留。
 * 只看组：必须包含该组至少一个选中标签（组内 OR），所有只看组同时满足；
 * 排除组：包含任一被排除标签即淘汰（跨组 OR）。
 */
export function matchesFilter(
  node: DecisionNode,
  result: Result,
  state: FilterState,
): boolean {
  const tags = tagNameMap(node)
  const groups = groupNameMap(node)
  for (const [groupId, rule] of Object.entries(state)) {
    if (rule.mode === 'none' || rule.tagIds.length === 0) continue
    const group = groups.get(groupId)
    if (!group) continue
    const valid = rule.tagIds.filter((id) => {
      const tag = tags.get(id)
      return tag && tag.groupId === groupId
    })
    if (valid.length === 0) continue
    const has = valid.some((id) => result.tagIds.includes(id))
    if (rule.mode === 'include' && !has) return false
    if (rule.mode === 'exclude' && has) return false
  }
  return true
}

export function filterResults(
  node: DecisionNode,
  state: FilterState,
): { matched: Result[]; excluded: Result[] } {
  const matched: Result[] = []
  const excluded: Result[] = []
  for (const result of node.results) {
    if (matchesFilter(node, result, state)) matched.push(result)
    else excluded.push(result)
  }
  return { matched, excluded }
}

export interface ActiveFilterRule {
  group: TagGroup
  rule: FilterRule
  tags: Tag[]
}

export function activeFilterRules(
  node: DecisionNode,
  state: FilterState,
): ActiveFilterRule[] {
  const result: ActiveFilterRule[] = []
  const tags = tagNameMap(node)
  for (const group of [...node.tagGroups].sort((a, b) => a.order - b.order)) {
    const rule = state[group.id]
    if (!rule || rule.mode === 'none' || rule.tagIds.length === 0) continue
    const valid = rule.tagIds
      .map((id) => tags.get(id))
      .filter((tag): tag is Tag => tag !== undefined && tag.groupId === group.id)
    if (valid.length === 0) continue
    result.push({ group, rule, tags: valid })
  }
  return result
}

export function filterSnapshot(node: DecisionNode, state: FilterState): HistoryFilter[] {
  return activeFilterRules(node, state).map(({ group, rule, tags }) => ({
    groupId: group.id,
    groupName: group.name,
    mode: rule.mode === 'exclude' ? 'exclude' : 'include',
    tagIds: tags.map((tag) => tag.id),
    tagNames: tags.map((tag) => tag.name),
  }))
}

export function validateTagName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('标签名不能为空')
  if ([...trimmed].length > MAX_TAG_NAME_LENGTH) {
    throw new Error(`标签名不能超过 ${MAX_TAG_NAME_LENGTH} 字`)
  }
  return trimmed
}

export function validateGroupName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('分组名不能为空')
  if ([...trimmed].length > MAX_GROUP_NAME_LENGTH) {
    throw new Error(`分组名不能超过 ${MAX_GROUP_NAME_LENGTH} 字`)
  }
  return trimmed
}

export function uniqueTagName(
  node: DecisionNode,
  name: string,
  groupId: string | null,
  exceptId?: string,
): boolean {
  return !node.tags.some(
    (tag) =>
      tag.id !== exceptId &&
      tag.groupId === groupId &&
      tag.name.toLowerCase() === name.toLowerCase(),
  )
}

export function uniqueGroupName(
  node: DecisionNode,
  name: string,
  exceptId?: string,
): boolean {
  return !node.tagGroups.some(
    (group) =>
      group.id !== exceptId && group.name.toLowerCase() === name.toLowerCase(),
  )
}

export function resultTagCount(result: Result): number {
  return result.tagIds.length
}

export function canAttachTag(result: Result): boolean {
  return result.tagIds.length < MAX_TAGS_PER_RESULT
}

export function attachTagToResult(result: Result, tagId: string): Result {
  if (result.tagIds.includes(tagId)) return result
  if (result.tagIds.length >= MAX_TAGS_PER_RESULT) return result
  return { ...result, tagIds: [...result.tagIds, tagId] }
}

export function detachTagFromResult(result: Result, tagId: string): Result {
  return { ...result, tagIds: result.tagIds.filter((id) => id !== tagId) }
}

/** 应用预设：复制分组和标签到节点；同名分组合并，同名标签跳过。 */
export function applyPreset(
  node: DecisionNode,
  preset: TagPreset,
  tagIds?: string[],
): Pick<DecisionNode, 'tagGroups' | 'tags' | 'appliedPresetId'> {
  if (node.appliedPresetId) throw new Error('每个决策只能应用一个标签预设')
  const selectedTags = tagIds
    ? preset.tags.filter((tag) => tagIds.includes(tag.id))
    : preset.tags
  if (selectedTags.length === 0) throw new Error('至少选择一个标签')
  const selectedGroupIds = new Set(
    selectedTags.map((tag) => tag.groupId).filter((id): id is string => Boolean(id)),
  )
  const groups = [...node.tagGroups]
  const tags = [...node.tags]
  const groupByName = new Map(groups.map((group) => [group.name.toLowerCase(), group]))

  for (const presetGroup of preset.groups) {
    if (tagIds && !selectedGroupIds.has(presetGroup.id)) continue
    const key = presetGroup.name.toLowerCase()
    if (!groupByName.has(key)) {
      const copied: TagGroup = {
        id: uuid(),
        name: presetGroup.name,
        color: presetGroup.color,
        order: groups.length,
      }
      groups.push(copied)
      groupByName.set(key, copied)
    }
  }

  for (const presetTag of selectedTags) {
    const sourceGroup = preset.groups.find((group) => group.id === presetTag.groupId)
    const targetGroup = sourceGroup
      ? groupByName.get(sourceGroup.name.toLowerCase())
      : undefined
    const targetGroupId = targetGroup ? targetGroup.id : null
    const exists = tags.some(
      (tag) =>
        tag.name.toLowerCase() === presetTag.name.toLowerCase() &&
        tag.groupId === targetGroupId,
    )
    if (!exists) {
      tags.push({
        id: uuid(),
        name: presetTag.name,
        groupId: targetGroupId,
        order: tags.length,
      })
    }
  }

  return { tagGroups: groups, tags, appliedPresetId: preset.id }
}

/** 把节点内选中的标签保存为新的全局预设。 */
export function tagsToPreset(
  node: DecisionNode,
  tagIds: string[],
  name: string,
): TagPreset {
  const selected = node.tags.filter((tag) => tagIds.includes(tag.id))
  if (selected.length === 0) throw new Error('至少选择一个标签')
  const groupIds = new Set(
    selected.map((tag) => tag.groupId).filter((id): id is string => Boolean(id)),
  )
  const groups: TagGroup[] = []
  const groupMap = new Map<string, TagGroup>()
  for (const group of node.tagGroups) {
    if (!groupIds.has(group.id)) continue
    const copied: TagGroup = {
      id: uuid(),
      name: group.name,
      color: group.color,
      order: groups.length,
    }
    groups.push(copied)
    groupMap.set(group.id, copied)
  }
  const tags: Tag[] = selected.map((tag, index) => {
    const sourceGroup = tag.groupId ? groupMap.get(tag.groupId) : undefined
    return {
      id: uuid(),
      name: tag.name,
      groupId: sourceGroup ? sourceGroup.id : null,
      order: index,
    }
  })
  return { id: uuid(), name, groups, tags, createdAt: nowIso() }
}

/** 删除节点内标签；返回新的 tags 与结果列表。 */
export function removeTagFromNode(
  node: DecisionNode,
  tagId: string,
): { tags: Tag[]; results: Result[] } {
  return {
    tags: node.tags.filter((tag) => tag.id !== tagId),
    results: node.results.map((result) => ({
      ...result,
      tagIds: result.tagIds.filter((id) => id !== tagId),
    })),
  }
}

/** 删除节点内分组及其标签。 */
export function removeGroupFromNode(
  node: DecisionNode,
  groupId: string,
): { tagGroups: TagGroup[]; tags: Tag[]; results: Result[] } {
  const tagIds = new Set(
    node.tags.filter((tag) => tag.groupId === groupId).map((tag) => tag.id),
  )
  return {
    tagGroups: node.tagGroups.filter((group) => group.id !== groupId),
    tags: node.tags.filter((tag) => tag.groupId !== groupId),
    results: node.results.map((result) => ({
      ...result,
      tagIds: result.tagIds.filter((id) => !tagIds.has(id)),
    })),
  }
}

export function filterModeLabel(mode: FilterMode): string {
  if (mode === 'include') return '只看'
  if (mode === 'exclude') return '排除'
  return '不筛选'
}
