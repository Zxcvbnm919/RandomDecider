import { nowIso, uuid } from './ids'
import {
  DEFAULT_WEIGHT,
  MAX_GROUPS_PER_NODE,
  MAX_TAGS_PER_NODE,
} from './limits'
import type {
  AppData,
  DecisionNode,
  Folder,
  Result,
  Settings,
  Tag,
  TagGroup,
  TagPreset,
  TopDecision,
} from './types'
import { SCHEMA_VERSION } from './types'

export const DEFAULT_THEME_COLOR = '#1377DB'
export const DEFAULT_BG_FROM = '#EAF4FD'
export const DEFAULT_BG_TO = '#D2E6F7'

export const THEME_PALETTE: { name: string; color: string }[] = [
  { name: '蓝', color: '#1377DB' },
  { name: '绿', color: '#2E9E5B' },
  { name: '青', color: '#0E9AA7' },
  { name: '紫', color: '#7A5AF8' },
  { name: '靛', color: '#4F5BD5' },
  { name: '粉', color: '#D6558C' },
  { name: '红', color: '#D9534F' },
  { name: '橙', color: '#E8833A' },
  { name: '琥珀', color: '#D99A1B' },
  { name: '灰', color: '#5B6B7C' },
]

export const GROUP_COLORS = [
  '#D9534F',
  '#E8833A',
  '#D99A1B',
  '#2E9E5B',
  '#0E9AA7',
  '#1377DB',
  '#4F5BD5',
  '#7A5AF8',
  '#D6558C',
  '#5B6B7C',
]

export function createSettings(): Settings {
  return {
    themeColor: DEFAULT_THEME_COLOR,
    themeMode: 'light',
    backgroundImage: null,
    backgroundFit: 'auto',
    backgroundOpacity: 100,
    backgroundBlur: 0,
    fontScale: 100,
    sortMode: 'recent',
  }
}

export function nextOrder(items: { order: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.order), -1) + 1
}

export function createResult(
  name: string,
  weight = DEFAULT_WEIGHT,
  order = 0,
): Result {
  return {
    id: uuid(),
    name,
    weight,
    order,
    tagIds: [],
    child: null,
    createdAt: nowIso(),
  }
}

export function createGroup(
  name: string,
  color = GROUP_COLORS[0]!,
  order = 0,
): TagGroup {
  return { id: uuid(), name, color, order }
}

export function createTag(name: string, groupId: string | null, order = 0): Tag {
  return { id: uuid(), name, groupId, order }
}

export function createNode(name: string): DecisionNode {
  return {
    id: uuid(),
    name,
    allowRepeat: false,
    avoidRepeat: { enabled: false, reducePercent: 50, rounds: 3 },
    roundNo: 0,
    penalties: [],
    appliedPresetId: null,
    tagGroups: [],
    tags: [],
    results: [],
    createdAt: nowIso(),
  }
}

export function createTopDecision(
  name: string,
  folderId: string | null = null,
  overrides: Partial<TopDecision> = {},
): TopDecision {
  const node = createNode(name)
  return {
    ...node,
    icon: '🎲',
    note: '',
    folderId,
    favorite: false,
    pinned: false,
    order: 0,
    lastUsedAt: null,
    ...overrides,
  }
}

export function createFolder(name: string, order = 0): Folder {
  return { id: uuid(), name, order, createdAt: nowIso() }
}

export function createPreset(name: string): TagPreset {
  return { id: uuid(), name, groups: [], tags: [], createdAt: nowIso() }
}

export function createEmptyAppData(): AppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: createSettings(),
    folders: [],
    decisions: [],
    tagPresets: [],
    stats: [],
    history: [],
  }
}

export function createSampleAppData(): AppData {
  const data = createEmptyAppData()
  const decision = createTopDecision('今天吃什么')
  decision.icon = '🍜'
  decision.note = '示例决策，可以直接删除或改成自己的。'
  decision.order = 0
  decision.results = [
    createResult('火锅', 1000, 0),
    createResult('烧烤', 1000, 1),
    createResult('面条', 1000, 2),
  ]
  decision.tagGroups = [
    { id: uuid(), name: '口味', color: GROUP_COLORS[0]!, order: 0 },
  ]
  const group = decision.tagGroups[0]!
  decision.tags = [
    createTag('辣', group.id, 0),
    createTag('清淡', group.id, 1),
  ]
  const [spicy, mild] = decision.tags
  if (spicy) decision.results[0]!.tagIds = [spicy.id]
  if (mild) decision.results[2]!.tagIds = [mild.id]
  data.decisions.push(decision)
  return data
}

/** 新建节点时确保标签数量不会超过上限。 */
export function canAddTag(node: DecisionNode): boolean {
  return node.tags.length < MAX_TAGS_PER_NODE
}

export function canAddGroup(node: DecisionNode): boolean {
  return node.tagGroups.length < MAX_GROUPS_PER_NODE
}
