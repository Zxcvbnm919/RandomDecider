import { useSyncExternalStore } from 'react'
import { fromBackupJson, toBackupJson } from '../core/backup'
import { commitSession } from '../core/commit'
import {
  createEmptyAppData,
  createFolder as makeFolder,
  createResult,
  createSampleAppData,
  createSettings,
  createTopDecision,
  nextOrder,
} from '../core/defaults'
import { historyFromJson, historyToJson, type HistoryExportJson } from '../core/history'
import { nowIso } from '../core/ids'
import {
  detectDecisionConflicts,
  mergeAppData,
  type DecisionConflict,
  type DecisionConflictResolution,
} from '../core/merge'
import {
  applyNodeEdit,
  canFinish,
  clearFilters as coreClearFilters,
  continueToChild,
  createSession,
  currentLevel,
  draw as coreDraw,
  manualSelect,
  restart as coreRestart,
  setAllowRepeat as coreSetAllowRepeat,
  setFilterRule as coreSetFilterRule,
  toggleBlacklist as coreToggleBlacklist,
  undo as coreUndo,
  usedDecisionIds,
} from '../core/session'
import { clearNodePenalties, clearOwnedTreePenalties } from '../core/penalty'
import { findReferences, getTopDecision, resolveNode } from '../core/tree'
import type {
  AppData,
  DecisionNode,
  FilterRule,
  Folder,
  Settings,
  TopDecision,
} from '../core/types'
import type { Session } from '../core/session'
import { storage, timestampForFile } from './storage'
import { applyTheme } from './theme'

export type Route =
  | { name: 'main' }
  | {
      name: 'editor'
      decisionId: string
      path: string[]
      returnTo?: 'main' | 'decision'
    }
  | { name: 'decision' }
  | { name: 'summary' }
  | { name: 'history' }
  | { name: 'historyDetail'; id: string }
  | { name: 'stats' }
  | { name: 'settings' }
  | { name: 'presets' }

/** Android 返回键的“上一级”路由（不是浏览历史）。 */
export function parentRoute(route: Route): Route {
  switch (route.name) {
    case 'main':
      return { name: 'main' }
    case 'settings':
    case 'history':
    case 'stats':
    case 'decision':
      return { name: 'main' }
    case 'presets':
      return { name: 'settings' }
    case 'historyDetail':
      return { name: 'history' }
    case 'summary':
      return { name: 'decision' }
    case 'editor': {
      if (route.path.length > 0) {
        return {
          name: 'editor',
          decisionId: route.decisionId,
          path: route.path.slice(0, -1),
          returnTo: route.returnTo,
        }
      }
      if (route.returnTo === 'decision') return { name: 'decision' }
      return { name: 'main' }
    }
    default:
      return { name: 'main' }
  }
}

export interface AppStoreState {
  data: AppData
  session: Session | null
  route: Route
  version: number
  loading: boolean
  toast: string | null
  backgroundUrl: string | null
  editSnapshot: AppData | null
  dirty: boolean
  initialized: boolean
  pendingImport: { incoming: AppData; conflicts: DecisionConflict[] } | null
}

function samePath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

class AppStore {
  state: AppStoreState = {
    data: createEmptyAppData(),
    session: null,
    route: { name: 'main' },
    version: 0,
    loading: true,
    toast: null,
    backgroundUrl: null,
    editSnapshot: null,
    dirty: false,
    initialized: false,
    pendingImport: null,
  }

  private listeners = new Set<() => void>()
  private toastTimer: ReturnType<typeof setTimeout> | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getVersion = (): number => this.state.version

  private notify(): void {
    this.state.version += 1
    for (const listener of [...this.listeners]) listener()
  }

  async init(): Promise<void> {
    if (this.state.initialized) return
    this.state.initialized = true
    try {
      const saved = await storage.load()
      const data = saved
        ? {
            ...createEmptyAppData(),
            ...saved,
            settings: { ...createSettings(), ...saved.settings },
          }
        : createSampleAppData()
      this.state.data = data
      this.state.backgroundUrl = await storage.loadBackgroundUrl()
      applyTheme(data.settings)
      this.state.loading = false
      this.notify()
      if (!saved) await this.persist()
    } catch (error) {
      this.state.data = createSampleAppData()
      this.state.loading = false
      this.notify()
      this.toast(`读取本地数据失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async persist(): Promise<void> {
    try {
      await storage.save(this.state.data)
    } catch (error) {
      this.toast(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  toast(text: string): void {
    this.state.toast = text
    this.notify()
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      if (this.state.toast === text) {
        this.state.toast = null
        this.notify()
      }
    }, 2600)
  }

  navigate(route: Route): void {
    this.state.route = route
    this.notify()
  }

  /** 由浏览器/Android 返回键恢复路由；返回是否真的发生了变化。 */
  setRouteFromHistory(route: Route): boolean {
    if (JSON.stringify(route) === JSON.stringify(this.state.route)) return false
    this.state.route = route
    this.notify()
    return true
  }

  markDirty(): void {
    this.state.dirty = true
    this.notify()
  }

  beginEdit(): void {
    if (!this.state.editSnapshot) {
      this.state.editSnapshot = structuredClone(this.state.data)
    }
    this.state.dirty = false
    this.notify()
  }

  cancelEdit(): void {
    if (!this.state.editSnapshot) return
    this.state.data = this.state.editSnapshot
    this.state.editSnapshot = null
    this.state.dirty = false
    applyTheme(this.state.data.settings)
    if (this.state.session) {
      const level = currentLevel(this.state.session)
      if (!resolveNode(this.state.data, level.locator)) {
        this.state.session = null
        this.state.route = { name: 'main' }
      }
    }
    this.notify()
  }

  async saveEdit(): Promise<void> {
    if (this.state.session && this.state.route.name === 'editor') {
      const level = currentLevel(this.state.session)
      if (
        level.locator.decisionId === this.state.route.decisionId &&
        samePath(level.locator.path, this.state.route.path)
      ) {
        if (!applyNodeEdit(this.state.session, this.state.data)) {
          this.state.session = null
          this.state.route = { name: 'main' }
        }
      }
    }
    this.state.editSnapshot = null
    this.state.dirty = false
    await this.persist()
    this.notify()
    this.toast('已保存')
  }

  updateData(mutator: (data: AppData) => void): void {
    mutator(this.state.data)
    this.markDirty()
  }

  createDecision(folderId: string | null = null): void {
    if (this.state.data.decisions.length >= 100) {
      this.toast('决策数量已达上限（100）')
      return
    }
    this.beginEdit()
    let name = '未命名决策'
    let index = 2
    while (this.state.data.decisions.some((item) => item.name === name)) {
      name = `未命名决策 ${index}`
      index += 1
    }
    const decision = createTopDecision(name, folderId)
    decision.order = nextOrder(this.state.data.decisions)
    decision.results = [createResult('选项 1', 1000, 0)]
    this.state.data.decisions.push(decision)
    this.state.route = { name: 'editor', decisionId: decision.id, path: [] }
    this.markDirty()
    this.notify()
  }

  reorderDecisions(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return
    const wasCustom = this.state.data.settings.sortMode === 'custom'
    const ordered = sortDecisions(
      this.state.data.decisions,
      this.state.data.settings.sortMode,
    )
    const from = ordered.findIndex((decision) => decision.id === sourceId)
    if (from < 0) return
    const targetBefore = ordered.findIndex((decision) => decision.id === targetId)
    if (targetBefore < 0) return
    const [item] = ordered.splice(from, 1)
    if (!item) return
    let to = ordered.findIndex((decision) => decision.id === targetId)
    if (to < 0) return
    // 向下拖到下一张卡片时放到目标之后，避免落点与原来相同。
    if (from < targetBefore) to += 1
    ordered.splice(to, 0, item)
    ordered.forEach((decision, index) => {
      decision.order = index
    })
    this.state.data.decisions = ordered
    this.state.data.settings.sortMode = 'custom'
    this.notify()
    void this.persist()
    if (!wasCustom) this.toast('已切换为自定义排序')
  }

  moveDecision(id: string, delta: number): void {
    if (!Number.isInteger(delta) || delta === 0) return
    const wasCustom = this.state.data.settings.sortMode === 'custom'
    const ordered = sortDecisions(
      this.state.data.decisions,
      this.state.data.settings.sortMode,
    )
    const from = ordered.findIndex((decision) => decision.id === id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= ordered.length) return
    const [item] = ordered.splice(from, 1)
    if (!item) return
    ordered.splice(to, 0, item)
    ordered.forEach((decision, index) => {
      decision.order = index
    })
    this.state.data.decisions = ordered
    this.state.data.settings.sortMode = 'custom'
    this.notify()
    void this.persist()
    if (!wasCustom) this.toast('已切换为自定义排序')
  }

  deleteDecision(id: string, mode: 'unlink' | 'cascade' = 'unlink'): void {
    const decision = getTopDecision(this.state.data, id)
    if (!decision) return
    const references = findReferences(this.state.data, id)

    if (mode === 'cascade') {
      for (const location of references) {
        location.node.results = location.node.results.filter(
          (result) => result.id !== location.result.id,
        )
        location.node.results.forEach((result, index) => {
          result.order = index
        })
      }
    } else {
      for (const location of references) {
        location.result.child = null
      }
    }

    if (this.state.session && usedDecisionIds(this.state.session).has(id)) {
      this.state.session = null
      if (
        this.state.route.name === 'decision' ||
        this.state.route.name === 'summary'
      ) {
        this.state.route = { name: 'main' }
      }
    }

    this.state.data.decisions = this.state.data.decisions.filter((d) => d.id !== id)
    if (this.state.route.name === 'editor' && this.state.route.decisionId === id) {
      this.state.route = { name: 'main' }
    }
    this.notify()
    void this.persist()
    if (references.length === 0) {
      this.toast('已删除决策')
    } else if (mode === 'cascade') {
      this.toast(`已删除决策，并级联删除 ${references.length} 处引用`)
    } else {
      this.toast(`已删除决策，解除了 ${references.length} 处引用`)
    }
  }

  enterDecision(id: string): void {
    try {
      this.state.session = createSession(this.state.data, id)
      this.state.route = { name: 'decision' }
      this.notify()
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error))
    }
  }

  draw(): void {
    if (!this.state.session) return
    const outcome = coreDraw(this.state.session, this.state.data)
    if (!outcome.ok) {
      this.toast(outcome.reason === 'no-candidates' ? '没有可用结果' : '当前无法抽取')
    } else if (outcome.autoReset) {
      this.toast('已全部抽过，自动重新开始')
    }
    this.notify()
  }

  manualSelect(resultId: string): void {
    if (!this.state.session) return
    const outcome = manualSelect(this.state.session, this.state.data, resultId)
    if (!outcome.ok) this.toast('无法选择该结果')
    this.notify()
  }

  undo(): void {
    if (!this.state.session) return
    coreUndo(this.state.session, this.state.data)
    this.notify()
  }

  restart(): void {
    if (!this.state.session) return
    coreRestart(this.state.session, this.state.data)
    this.notify()
  }

  continueLevel(): void {
    if (!this.state.session) return
    if (!continueToChild(this.state.session, this.state.data)) {
      this.toast('没有可继续的子决策，或层级已达上限')
    }
    this.notify()
  }

  async finish(): Promise<void> {
    if (!this.state.session) return
    if (!canFinish(this.state.session)) {
      this.toast('请先完成本级的抽取')
      return
    }
    try {
      commitSession(this.state.session, this.state.data, nowIso())
      await this.persist()
      this.state.route = { name: 'summary' }
      this.notify()
    } catch (error) {
      this.toast(`提交失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  exitSession(): void {
    this.state.session = null
    this.state.route = { name: 'main' }
    this.notify()
  }

  setFilterRule(groupId: string, patch: Partial<FilterRule>): void {
    if (!this.state.session) return
    coreSetFilterRule(this.state.session, groupId, patch)
    this.notify()
  }

  clearFilters(): void {
    if (!this.state.session) return
    coreClearFilters(this.state.session)
    this.notify()
  }

  toggleBlacklist(resultId: string): void {
    if (!this.state.session) return
    coreToggleBlacklist(this.state.session, resultId)
    this.notify()
  }

  togglePool(resultId: string): void {
    if (!this.state.session) return
    const level = currentLevel(this.state.session)
    if (level.pool.includes(resultId)) {
      level.pool = level.pool.filter((id) => id !== resultId)
    } else {
      level.pool = [...level.pool, resultId]
    }
    this.state.session.revision += 1
    this.notify()
  }

  setAllowRepeat(value: boolean): void {
    if (!this.state.session) return
    coreSetAllowRepeat(this.state.session, this.state.data, value)
    this.notify()
    void this.persist()
  }

  resetCurrentLevelState(): void {
    if (!this.state.session) return
    const level = currentLevel(this.state.session)
    const node = resolveNode(this.state.data, level.locator)
    if (node) clearNodePenalties(node)
    level.pool = []
    level.provisionalLayers = []
    this.state.session.revision += 1
    this.notify()
    void this.persist()
    this.toast('已重置本级状态')
  }

  resetDecisionState(decisionId: string): void {
    const top = getTopDecision(this.state.data, decisionId)
    if (!top) return
    clearOwnedTreePenalties(top)
    this.notify()
    void this.persist()
    this.toast('已清除该决策的降温状态')
  }

  setSettings(patch: Partial<Settings>): void {
    Object.assign(this.state.data.settings, patch)
    applyTheme(this.state.data.settings)
    this.notify()
    void this.persist()
  }

  async setBackground(file: File): Promise<void> {
    try {
      const url = await storage.saveBackground(file)
      this.state.backgroundUrl = url
      this.state.data.settings.backgroundImage = 'background'
      this.notify()
      await this.persist()
      this.toast('背景图已更新')
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error))
    }
  }

  async clearBackground(): Promise<void> {
    await storage.clearBackground()
    this.state.backgroundUrl = null
    this.state.data.settings.backgroundImage = null
    this.notify()
    await this.persist()
  }

  async clearAllData(): Promise<void> {
    this.state.data = createEmptyAppData()
    this.state.session = null
    this.state.editSnapshot = null
    this.state.dirty = false
    this.state.backgroundUrl = null
    this.state.route = { name: 'main' }
    await storage.clearBackground()
    applyTheme(this.state.data.settings)
    this.notify()
    await this.persist()
    this.toast('已清空全部数据')
  }

  async exportFull(): Promise<void> {
    await storage.exportJson(
      `随机决策-备份-${timestampForFile()}.json`,
      toBackupJson(this.state.data),
    )
    this.toast('已导出全量备份')
  }

  async importFull(): Promise<void> {
    const json = await storage.pickJson()
    if (!json) return
    try {
      const incoming = fromBackupJson(json)
      this.state.data = incoming
      this.state.session = null
      this.state.editSnapshot = null
      this.state.dirty = false
      this.state.pendingImport = null
      this.state.backgroundUrl = null
      await storage.clearBackground()
      applyTheme(incoming.settings)
      this.state.route = { name: 'main' }
      this.notify()
      await this.persist()
      this.toast('已导入全量备份（覆盖）')
    } catch (error) {
      this.toast(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async prepareMergeImport(): Promise<void> {
    const json = await storage.pickJson()
    if (!json) return
    try {
      const incoming = fromBackupJson(json)
      const conflicts = detectDecisionConflicts(this.state.data, incoming)
      if (conflicts.length === 0) {
        const draft = structuredClone(this.state.data)
        const report = mergeAppData(draft, incoming)
        this.state.data = draft
        this.state.session = null
        this.state.editSnapshot = null
        this.state.dirty = false
        this.state.pendingImport = null
        this.state.route = { name: 'main' }
        this.notify()
        await this.persist()
        const warning = report.warnings[0] ? `；提示：${report.warnings[0]}` : ''
        this.toast(
          `合并完成：新增 ${report.addedDecisions} 个决策，跳过 ${report.skippedDecisions} 个同名决策${warning}`,
        )
        return
      }
      this.state.pendingImport = { incoming, conflicts }
      this.notify()
    } catch (error) {
      this.toast(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async applyPendingImport(
    resolutions: Map<string, DecisionConflictResolution>,
  ): Promise<void> {
    const pending = this.state.pendingImport
    if (!pending) return
    try {
      const draft = structuredClone(this.state.data)
      const report = mergeAppData(draft, pending.incoming, {
        decisionResolutions: resolutions,
      })
      this.state.data = draft
      this.state.session = null
      this.state.editSnapshot = null
      this.state.dirty = false
      this.state.pendingImport = null
      this.state.route = { name: 'main' }
      this.notify()
      await this.persist()
      const warning = report.warnings[0] ? `；提示：${report.warnings[0]}` : ''
      this.toast(
        `合并完成：新增 ${report.addedDecisions} 个，覆盖 ${report.overwrittenDecisions} 个，跳过 ${report.skippedDecisions} 个${warning}`,
      )
    } catch (error) {
      this.toast(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  cancelPendingImport(): void {
    this.state.pendingImport = null
    this.notify()
  }

  deleteHistory(id: string): void {
    this.state.data.history = this.state.data.history.filter((record) => record.id !== id)
    if (this.state.route.name === 'historyDetail' && this.state.route.id === id) {
      this.state.route = { name: 'history' }
    }
    this.notify()
    void this.persist()
  }

  clearHistory(): void {
    this.state.data.history = []
    this.state.route = { name: 'history' }
    this.notify()
    void this.persist()
    this.toast('已清空历史记录')
  }

  async exportHistory(): Promise<void> {
    await storage.exportJson(
      `随机决策-历史-${timestampForFile()}.json`,
      historyToJson(this.state.data.history),
    )
    this.toast('已导出历史记录')
  }

  async importHistory(): Promise<void> {
    const json = await storage.pickJson()
    if (!json) return
    try {
      const imported = historyFromJson(json as HistoryExportJson)
      const existing = new Map(this.state.data.history.map((record) => [record.id, record]))
      for (const record of imported) {
        if (!existing.has(record.id)) existing.set(record.id, record)
      }
      this.state.data.history = [...existing.values()]
        .sort((a, b) => a.time.localeCompare(b.time))
        .slice(-500)
      this.notify()
      await this.persist()
      this.toast('已导入历史记录')
    } catch (error) {
      this.toast(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  addFolder(name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    if ([...trimmed].length > 32) {
      this.toast('文件夹名称不能超过 32 字')
      return
    }
    if (this.state.data.folders.length >= 50) {
      this.toast('文件夹数量已达上限（50）')
      return
    }
    if (this.state.data.folders.some((folder) => folder.name === trimmed)) {
      this.toast('文件夹名称已存在')
      return
    }
    const folder = makeFolder(trimmed, nextOrder(this.state.data.folders))
    this.state.data.folders.push(folder)
    this.notify()
    void this.persist()
  }

  renameFolder(id: string, name: string): void {
    const folder = this.state.data.folders.find((item) => item.id === id)
    if (!folder) return
    const trimmed = name.trim()
    if (!trimmed) return
    if ([...trimmed].length > 32) {
      this.toast('文件夹名称不能超过 32 字')
      return
    }
    if (
      this.state.data.folders.some(
        (item) => item.id !== id && item.name.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      this.toast('文件夹名称已存在')
      return
    }
    folder.name = trimmed
    this.notify()
    void this.persist()
  }

  deleteFolder(id: string): void {
    const folder = this.state.data.folders.find((item) => item.id === id)
    if (!folder) return
    for (const decision of this.state.data.decisions) {
      if (decision.folderId === id) decision.folderId = null
    }
    this.state.data.folders = this.state.data.folders.filter((item) => item.id !== id)
    this.notify()
    void this.persist()
  }
}

export const store = new AppStore()

export function useStore(): AppStoreState {
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion)
  return store.state
}

export function editorNode(
  data: AppData,
  route: Extract<Route, { name: 'editor' }>,
): { top: TopDecision; node: DecisionNode } | null {
  const top = getTopDecision(data, route.decisionId)
  if (!top) return null
  const node = resolveNode(data, { decisionId: route.decisionId, path: route.path })
  if (!node) return null
  return { top, node }
}

export function folderDecisions(data: AppData, folderId: string | null): TopDecision[] {
  return data.decisions.filter((decision) => decision.folderId === folderId)
}

export function sortDecisions(
  decisions: TopDecision[],
  mode: Settings['sortMode'],
): TopDecision[] {
  const copy = [...decisions]
  if (mode === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  if (mode === 'created') return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  if (mode === 'custom') return copy.sort((a, b) => a.order - b.order)
  return copy.sort((a, b) => {
    const at = a.lastUsedAt ?? a.createdAt
    const bt = b.lastUsedAt ?? b.createdAt
    return bt.localeCompare(at)
  })
}

export function foldersOf(data: AppData): Folder[] {
  return [...data.folders].sort((a, b) => a.order - b.order)
}
