export const SCHEMA_VERSION = 1

export type Id = string
export type IsoDate = string

export type BackgroundFit =
  | 'auto'
  | 'tile'
  | 'center'
  | 'stretch'
  | 'left-top'
  | 'left-center'
  | 'left-bottom'
  | 'center-top'
  | 'center-center'
  | 'center-bottom'
  | 'right-top'
  | 'right-center'
  | 'right-bottom'

export type FontScale = 70 | 85 | 100 | 125 | 150
export type ThemeMode = 'light' | 'dark' | 'system'
export type SortMode = 'recent' | 'name' | 'created' | 'custom'
export type FilterMode = 'none' | 'include' | 'exclude'
export type DrawStatus = 'system' | 'manual'

export interface Settings {
  themeColor: string
  themeMode: ThemeMode
  backgroundImage: string | null
  backgroundFit: BackgroundFit
  backgroundOpacity: number
  backgroundBlur: number
  fontScale: FontScale
  sortMode: SortMode
}

export interface Folder {
  id: Id
  name: string
  order: number
  createdAt: IsoDate
}

export interface TagGroup {
  id: Id
  name: string
  color: string
  order: number
}

export interface Tag {
  id: Id
  name: string
  groupId: Id | null
  order: number
}

export interface AvoidRepeatSettings {
  enabled: boolean
  reducePercent: number
  rounds: number
}

export interface PenaltyLayer {
  resultId: Id
  createdRound: number
  expiresAtRound: number
}

export interface Result {
  id: Id
  name: string
  weight: number
  order: number
  tagIds: Id[]
  child: ChildRef | null
  createdAt: IsoDate
}

export type ChildRef =
  | { kind: 'owned'; node: DecisionNode }
  | { kind: 'reference'; targetId: Id }

export interface DecisionNode {
  id: Id
  name: string
  allowRepeat: boolean
  avoidRepeat: AvoidRepeatSettings
  roundNo: number
  penalties: PenaltyLayer[]
  appliedPresetId: Id | null
  tagGroups: TagGroup[]
  tags: Tag[]
  results: Result[]
  createdAt: IsoDate
}

export interface TopDecision extends DecisionNode {
  icon: string
  note: string
  folderId: Id | null
  favorite: boolean
  pinned: boolean
  order: number
  lastUsedAt: IsoDate | null
}

export interface TagPreset {
  id: Id
  name: string
  groups: TagGroup[]
  tags: Tag[]
  createdAt: IsoDate
}

export interface FilterRule {
  mode: FilterMode
  tagIds: Id[]
}

export type FilterState = Record<Id, FilterRule>

export interface HistoryFilter {
  groupId: Id
  groupName: string
  mode: 'include' | 'exclude'
  tagIds: Id[]
  tagNames: string[]
}

export interface HistoryCandidate {
  name: string
  baseWeight: number
  effectiveWeight: number
}

export interface HistoryLevel {
  level: number
  decisionId: Id
  decisionName: string
  nodeId: Id
  nodeName: string
  isReference: boolean
  finalResult: string
  status: DrawStatus
  filters: HistoryFilter[]
  candidates: HistoryCandidate[]
  excluded: HistoryCandidate[]
  blacklisted: string[]
  replaced: string[]
}

export interface HistoryRecord {
  id: Id
  decisionId: Id
  decisionName: string
  time: IsoDate
  levels: HistoryLevel[]
}

export interface StatRecord {
  decisionId: Id
  decisionName: string
  nodeId: Id
  nodeName: string
  resultId: Id
  resultName: string
  appear: number
  final: number
  manual: number
  lastAppear: IsoDate | null
  lastFinal: IsoDate | null
}

export interface AppData {
  schemaVersion: number
  settings: Settings
  folders: Folder[]
  decisions: TopDecision[]
  tagPresets: TagPreset[]
  stats: StatRecord[]
  history: HistoryRecord[]
}

/** 节点定位：decisionId 为拥有该节点的顶级决策；path 为从该决策根到节点的结果 id 链。 */
export interface NodeLocator {
  decisionId: Id
  path: Id[]
}

export interface SummaryLevel {
  level: number
  decisionName: string
  nodeName: string
  isReference: boolean
  finalResult: string
  status: DrawStatus
  replaced: string[]
}

export interface SessionSummary {
  rootId: Id
  rootName: string
  time: IsoDate
  levels: SummaryLevel[]
  finalChain: string[]
  manualParts: string[]
  replacedByLevel: { level: number; names: string[] }[]
}
