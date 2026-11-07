import { useEffect, useState } from 'react'
import {
  GROUP_COLORS,
  createGroup,
  createNode,
  createResult,
  createTag,
  nextOrder,
} from '../../core/defaults'
import { clearOwnedTreePenalties } from '../../core/penalty'
import {
  applyPreset,
  removeGroupFromNode,
  removeTagFromNode,
  tagsOfResult,
  tagsToPreset,
  tagColor,
  uniqueGroupName,
  uniqueTagName,
  validateGroupName,
  validateTagName,
} from '../../core/tags'
import {
  canAddChild,
  cloneOwnedNode,
  getTopDecision,
  nodeDepth,
  ownedNodeCount,
  referenceCandidates,
  validateTree,
} from '../../core/tree'
import type {
  DecisionNode,
  Result,
  Tag,
  TagGroup,
  TagPreset,
  TopDecision,
} from '../../core/types'
import {
  activeLayerCount,
  effectiveWeight,
  formatPercent,
  probabilities,
} from '../../core/weights'
import ColorPickerModal from '../ColorPickerModal'
import { IconPicker, Modal, PromptDialog, Section, TagChip, formatTime } from '../components'
import { editorNode, store, useStore, type Route } from '../store'

function WeightField({
  value,
  onCommit,
}: {
  value: number
  onCommit: (value: number) => void
}) {
  const [text, setText] = useState(String(value))
  const [error, setError] = useState('')
  useEffect(() => setText(String(value)), [value])

  const commit = () => {
    const number = Number(text)
    if (!Number.isInteger(number) || number < 0 || number > 1_000_000) {
      setError('只能输入 0 到 1,000,000 的整数')
      return
    }
    setError('')
    if (number !== value) onCommit(number)
  }

  return (
    <label className="weight-field">
      <input
        inputMode="numeric"
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setError('')
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
            ;(event.target as HTMLInputElement).blur()
          }
        }}
      />
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  )
}

function collectUsed(data: ReturnType<typeof useStore>['data'], top: TopDecision, path: string[]): Set<string> {
  const used = new Set<string>([top.id])
  let node: DecisionNode = top
  for (const resultId of path) {
    const result = node.results.find((item) => item.id === resultId)
    if (!result) break
    if (result.child?.kind === 'reference') {
      used.add(result.child.targetId)
      const target = getTopDecision(data, result.child.targetId)
      if (!target) break
      node = target
    } else if (result.child?.kind === 'owned') {
      node = result.child.node
    } else break
  }
  return used
}

export default function EditorPage() {
  const state = useStore()
  const route = state.route as Extract<Route, { name: 'editor' }>
  const resolved = editorNode(state.data, route)
  const [iconOpen, setIconOpen] = useState(false)
  const [tagResultId, setTagResultId] = useState<string | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [childPicker, setChildPicker] = useState<Result | null>(null)
  const [referencePicker, setReferencePicker] = useState<Result | null>(null)
  const [saving, setSaving] = useState(false)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [presetOpen, setPresetOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presetTagIds, setPresetTagIds] = useState<string[]>([])
  const [applyOpen, setApplyOpen] = useState(false)
  const [applyPresetId, setApplyPresetId] = useState('')
  const [applyTagIds, setApplyTagIds] = useState<string[]>([])
  const [tagPrompt, setTagPrompt] = useState<
    { kind: 'group' } | { kind: 'tag'; group: TagGroup } | null
  >(null)
  const [groupColor, setGroupColor] = useState<TagGroup | null>(null)

  useEffect(() => {
    store.beginEdit()
  }, [])

  if (!resolved) {
    return (
      <div className="focus-page">
        <div className="focus-head">
          <button className="icon-btn" onClick={() => store.navigate({ name: 'main' })}>
            ‹
          </button>
          <h1>编辑决策</h1>
        </div>
        <div className="empty">
          <h3>决策不存在</h3>
          <button className="btn" onClick={() => store.navigate({ name: 'main' })}>
            返回
          </button>
        </div>
      </div>
    )
  }

  const { top, node } = resolved
  const tagResult = tagResultId
    ? node.results.find((result) => result.id === tagResultId) ?? null
    : null
  const isRoot = route.path.length === 0
  const returnTo = route.returnTo ?? 'main'
  const round = node.roundNo + 1
  // 直接在渲染时计算：节点是原地修改的，useMemo 依赖 node 引用会拿到旧概率。
  const probability = probabilities(node, node.results, round)
  const nameCounts = new Map<string, number>()
  for (const result of node.results) {
    const key = result.name.trim().toLowerCase()
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }
  const duplicateNames = new Set(
    [...nameCounts.entries()].filter(([, count]) => count > 1).map(([name]) => name),
  )

  const touch = () => store.markDirty()

  const goBack = () => {
    if (route.path.length > 0) {
      store.navigate({
        name: 'editor',
        decisionId: route.decisionId,
        path: route.path.slice(0, -1),
        returnTo,
      })
      return
    }
    if (state.dirty && !window.confirm('有未保存的修改，确定放弃吗？')) return
    store.cancelEdit()
    store.navigate({
      name: returnTo === 'decision' && store.state.session ? 'decision' : 'main',
    })
  }

  const validate = (): string[] => {
    const errors: string[] = []
    const name = node.name.trim()
    if (!name) errors.push('名称不能为空')
    if ([...name].length > 32) errors.push('名称最多 32 字')
    if (isRoot) {
      const duplicate = state.data.decisions.some(
        (decision) =>
          decision.id !== top.id &&
          decision.name.trim().toLowerCase() === name.toLowerCase(),
      )
      if (duplicate) errors.push('顶级决策名称不能重复')
    }
    if (node.results.length > 100) errors.push('每个决策最多 100 个结果')
    if (duplicateNames.size > 0) errors.push('同一决策内结果不能重名')
    for (const result of node.results) {
      if (!result.name.trim()) errors.push('结果名不能为空')
      if ([...result.name.trim()].length > 32) errors.push(`结果名过长：${result.name}`)
      if (
        !Number.isInteger(result.weight) ||
        result.weight < 0 ||
        result.weight > 1_000_000
      ) {
        errors.push(`权重非法：${result.name}`)
      }
      if (result.tagIds.length > 20) errors.push(`标签超过 20 个：${result.name}`)
    }
    for (const tag of node.tags) {
      if (!tag.name.trim()) errors.push('标签名不能为空')
      if ([...tag.name].length > 16) errors.push(`标签名过长：${tag.name}`)
    }
    for (const group of node.tagGroups) {
      if (!group.name.trim()) errors.push('标签组名不能为空')
      if ([...group.name].length > 32) errors.push(`标签组名过长：${group.name}`)
    }
    // 编辑一个被引用的决策可能让其他决策树变深，所以对所有树做一次校验。
    for (const decision of state.data.decisions) {
      const treeErrors = validateTree(decision, state.data)
      const firstTreeError = treeErrors[0]
      if (firstTreeError) {
        errors.push(`${decision.name}：${firstTreeError.message}`)
        break
      }
    }
    return errors
  }

  const save = async () => {
    const errors = validate()
    const firstError = errors[0]
    if (firstError) {
      store.toast(firstError)
      return
    }
    setSaving(true)
    try {
      await store.saveEdit()
      store.navigate({
        name: returnTo === 'decision' && store.state.session ? 'decision' : 'main',
      })
    } finally {
      setSaving(false)
    }
  }

  const addResult = () => {
    if (node.results.length >= 100) {
      store.toast('结果数量已达上限（100）')
      return
    }
    node.results.push(createResult(`选项 ${node.results.length + 1}`, 1000, node.results.length))
    touch()
  }

  const deleteResult = (result: Result) => {
    const hasChild = result.child
    const ok = window.confirm(
      hasChild?.kind === 'owned'
        ? `删除结果“${result.name}”会连同它的子决策整棵删除，确定吗？`
        : `确定删除结果“${result.name}”吗？`,
    )
    if (!ok) return
    node.results = node.results.filter((item) => item.id !== result.id)
    node.results.forEach((item, index) => {
      item.order = index
    })
    touch()
  }

  const moveResult = (from: number, to: number) => {
    if (!Number.isInteger(from) || from === to) return
    if (from < 0 || to < 0 || from >= node.results.length || to >= node.results.length) return
    const list = [...node.results]
    const [item] = list.splice(from, 1)
    if (!item) return
    list.splice(to, 0, item)
    node.results = list
    node.results.forEach((result, index) => {
      result.order = index
    })
    touch()
  }

  const moveResultBy = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= node.results.length) return
    moveResult(index, target)
  }

  const sortResults = (mode: string) => {
    const list = [...node.results]
    if (mode === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    if (mode === 'created') list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    if (mode === 'weight-desc') list.sort((a, b) => b.weight - a.weight)
    if (mode === 'weight-asc') list.sort((a, b) => a.weight - b.weight)
    if (mode === 'custom') list.sort((a, b) => a.order - b.order)
    node.results = list
    node.results.forEach((item, index) => {
      item.order = index
    })
    touch()
  }

  const applyBatch = () => {
    const lines = batchText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    let added = 0
    let truncated = 0
    for (const raw of lines) {
      if (node.results.length >= 100) break
      let name = [...raw].length > 32 ? [...raw].slice(0, 32).join('') : raw
      if (name !== raw) truncated += 1
      let suffix = 2
      const base = name
      while (node.results.some((result) => result.name === name)) {
        name = `${base} (${suffix})`
        suffix += 1
      }
      node.results.push(createResult(name, 1000, node.results.length))
      added += 1
    }
    setBatchOpen(false)
    setBatchText('')
    touch()
    store.toast(
      `已添加 ${added} 个结果${truncated ? `，${truncated} 个名称被截断` : ''}${
        added < lines.length ? '（达到上限已截断）' : ''
      }`,
    )
  }

  const createOwnedChild = (result: Result) => {
    const parentLevel = route.path.length + 1
    if (!canAddChild(parentLevel, 1)) {
      store.toast('决策层级数已达上限！')
      return
    }
    if (ownedNodeCount(top) >= 1000) {
      store.toast('节点数量已达上限（1000）')
      return
    }
    const child = createNode(result.name.trim() || '子决策')
    result.child = { kind: 'owned', node: child }
    touch()
    setChildPicker(null)
    store.navigate({
      name: 'editor',
      decisionId: route.decisionId,
      path: [...route.path, result.id],
      returnTo,
    })
  }

  const setReference = (result: Result, targetId: string) => {
    result.child = { kind: 'reference', targetId }
    touch()
    setReferencePicker(null)
  }

  const copyReference = (result: Result) => {
    if (result.child?.kind !== 'reference') return
    const target = getTopDecision(state.data, result.child.targetId)
    if (!target) return
    const parentLevel = route.path.length + 1
    const copy = cloneOwnedNode(target)
    if (!canAddChild(parentLevel, nodeDepth(copy, state.data))) {
      store.toast('决策层级数已达上限！')
      return
    }
    if (ownedNodeCount(top) + ownedNodeCount(copy) > 1000) {
      store.toast('节点数量已达上限（1000）')
      return
    }
    if (!window.confirm('复制为独立副本后，历史/统计/降温会清零，确定吗？')) return
    result.child = { kind: 'owned', node: copy }
    touch()
    store.toast('已复制为独立副本')
  }

  const openReferenced = async (result: Result) => {
    if (result.child?.kind !== 'reference') return
    const targetId = result.child.targetId
    const errors = validate()
    const firstError = errors[0]
    if (firstError) {
      store.toast(firstError)
      return
    }
    setSaving(true)
    try {
      await store.saveEdit()
      store.beginEdit()
      store.navigate({
        name: 'editor',
        decisionId: targetId,
        path: [],
        returnTo: 'main',
      })
    } finally {
      setSaving(false)
    }
  }

  const removeChild = (result: Result) => {
    if (!result.child) return
    const ok = window.confirm(
      result.child.kind === 'owned'
        ? '删除子决策会连同它的整棵子树一起删除，确定吗？'
        : '解除引用不会删除被引用的决策，确定吗？',
    )
    if (!ok) return
    result.child = null
    touch()
  }

  const openChildEditor = (result: Result) => {
    if (result.child?.kind !== 'owned') return
    store.navigate({
      name: 'editor',
      decisionId: route.decisionId,
      path: [...route.path, result.id],
      returnTo,
    })
  }

  const addTagGroup = () => {
    setTagPrompt({ kind: 'group' })
  }

  const addTag = (group: TagGroup) => {
    setTagPrompt({ kind: 'tag', group })
  }

  const submitTagPrompt = (name: string) => {
    if (!tagPrompt) return
    try {
      if (tagPrompt.kind === 'group') {
        const trimmed = validateGroupName(name)
        if (!uniqueGroupName(node, trimmed)) {
          store.toast('同节点内分组名不能重复')
          return
        }
        node.tagGroups.push(
          createGroup(
            trimmed,
            GROUP_COLORS[node.tagGroups.length % GROUP_COLORS.length]!,
            node.tagGroups.length,
          ),
        )
      } else {
        const group = tagPrompt.group
        const trimmed = validateTagName(name)
        if (!uniqueTagName(node, trimmed, group.id)) {
          store.toast('同分组内标签名不能重复')
          return
        }
        node.tags.push(createTag(trimmed, group.id, node.tags.length))
      }
      touch()
      setTagPrompt(null)
    } catch (error) {
      store.toast(error instanceof Error ? error.message : String(error))
    }
  }

  const deleteTag = (tag: Tag) => {
    if (!window.confirm(`删除标签“${tag.name}”？会从所有结果移除。`)) return
    const next = removeTagFromNode(node, tag.id)
    node.tags = next.tags
    node.results = next.results
    touch()
  }

  const deleteGroup = (group: TagGroup) => {
    if (!window.confirm(`删除分组“${group.name}”及组内标签？会从所有结果移除。`)) return
    const next = removeGroupFromNode(node, group.id)
    node.tagGroups = next.tagGroups
    node.tags = next.tags
    node.results = next.results
    touch()
  }

  const applyTagPreset = (presetId: string, tagIds?: string[]) => {
    if (!presetId) return false
    const preset = state.data.tagPresets.find((item) => item.id === presetId)
    if (!preset) return false
    try {
      const next = applyPreset(node, preset, tagIds)
      node.tagGroups = next.tagGroups
      node.tags = next.tags
      node.appliedPresetId = next.appliedPresetId
      touch()
      store.toast(`已应用预设“${preset.name}”`)
      return true
    } catch (error) {
      store.toast(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  const openApplyPreset = () => {
    if (state.data.tagPresets.length === 0) {
      store.toast('还没有全局标签预设，请先在标签预设页新建')
      return
    }
    const first = state.data.tagPresets[0]!
    setApplyPresetId(first.id)
    setApplyTagIds(first.tags.map((tag) => tag.id))
    setApplyOpen(true)
  }

  const chooseApplyPreset = (presetId: string) => {
    setApplyPresetId(presetId)
    const preset = state.data.tagPresets.find((item) => item.id === presetId)
    setApplyTagIds(preset?.tags.map((tag) => tag.id) ?? [])
  }

  const toggleApplyTag = (tagId: string) => {
    setApplyTagIds((current) =>
      current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId],
    )
  }

  const confirmApplyPreset = () => {
    if (applyTagPreset(applyPresetId, applyTagIds)) setApplyOpen(false)
  }

  const detachPreset = () => {
    node.appliedPresetId = null
    touch()
  }

  const openPresetModal = () => {
    if (node.tags.length === 0) {
      store.toast('当前没有标签可保存')
      return
    }
    setPresetName('')
    setPresetTagIds(node.tags.map((tag) => tag.id))
    setPresetOpen(true)
  }

  const togglePresetTag = (tagId: string) => {
    setPresetTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    )
  }

  const savePreset = () => {
    const name = presetName.trim()
    if (!name) {
      store.toast('请输入预设名称')
      return
    }
    if ([...name].length > 32) {
      store.toast('预设名称不能超过 32 字')
      return
    }
    if (
      state.data.tagPresets.some(
        (preset) => preset.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      store.toast('预设名称已存在')
      return
    }
    if (state.data.tagPresets.length >= 100) {
      store.toast('预设数量已达上限（100）')
      return
    }
    if (presetTagIds.length === 0) {
      store.toast('至少选择一个标签')
      return
    }
    const preset = tagsToPreset(node, presetTagIds, name)
    state.data.tagPresets.push(preset)
    setPresetOpen(false)
    touch()
    store.toast('已保存为全局预设')
  }

  const toggleResultTag = (result: Result, tagId: string) => {
    if (result.tagIds.includes(tagId)) {
      result.tagIds = result.tagIds.filter((id) => id !== tagId)
    } else {
      if (result.tagIds.length >= 20) {
        store.toast('每个结果最多 20 个标签')
        return
      }
      result.tagIds = [...result.tagIds, tagId]
    }
    touch()
  }

  const tagMap = new Map(node.tags.map((tag) => [tag.id, tag]))
  const appliedPreset = state.data.tagPresets.find(
    (preset) => preset.id === node.appliedPresetId,
  )
  const applyTarget = state.data.tagPresets.find(
    (preset) => preset.id === applyPresetId,
  )
  const parentLevel = route.path.length + 1

  return (
    <div className="focus-page editor-page">
      <header className="focus-head">
        <button className="icon-btn" onClick={goBack} aria-label="返回">
          ‹
        </button>
        <div className="focus-title">
          <h1>{isRoot ? '编辑决策' : '编辑子决策'}</h1>
          <p className="muted">
            {isRoot ? top.name : `${top.name} · 第 ${route.path.length + 1} 级`}
          </p>
        </div>
        {isRoot ? (
          <button className="btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        ) : (
          <button className="btn" onClick={goBack}>
            完成
          </button>
        )}
      </header>

      <div className="editor-scroll">
        <Section title="基本信息">
          <div className="form-grid">
            <label className="field">
              <span>名称</span>
              <input
                value={node.name}
                maxLength={32}
                onChange={(event) => {
                  node.name = event.target.value
                  touch()
                }}
              />
              <small className="muted">{node.name.length}/32</small>
            </label>
            {isRoot ? (
              <>
                <div className="field">
                  <span>图标</span>
                  <button
                    className="icon-preview"
                    onClick={() => setIconOpen(true)}
                    title="选择图标"
                  >
                    {top.icon || '🎲'}
                  </button>
                </div>
                <label className="field">
                  <span>文件夹</span>
                  <select
                    value={top.folderId ?? ''}
                    onChange={(event) => {
                      top.folderId = event.target.value || null
                      touch()
                    }}
                  >
                    <option value="">未分组</option>
                    {state.data.folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field">
                  <span>标记</span>
                  <div className="row gap">
                    <button
                      className={`btn small ${top.favorite ? 'primary' : ''}`}
                      onClick={() => {
                        top.favorite = !top.favorite
                        touch()
                      }}
                    >
                      {top.favorite ? '★ 已收藏' : '☆ 收藏'}
                    </button>
                    <button
                      className={`btn small ${top.pinned ? 'primary' : ''}`}
                      onClick={() => {
                        top.pinned = !top.pinned
                        touch()
                      }}
                    >
                      {top.pinned ? '📌 已置顶' : '📍 置顶'}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
          {isRoot ? (
            <label className="field">
              <span>备注</span>
              <textarea
                rows={3}
                maxLength={500}
                value={top.note}
                onChange={(event) => {
                  top.note = event.target.value
                  touch()
                }}
                placeholder="只在“详情”里显示"
              />
            </label>
          ) : null}
        </Section>

        <Section
          title="随机设置"
          description="这些设置只作用于当前这一级决策。"
        >
          <div className="form-grid">
            <label className="check-row">
              <input
                type="checkbox"
                checked={node.allowRepeat}
                onChange={(event) => {
                  node.allowRepeat = event.target.checked
                  touch()
                }}
              />
              <span>允许重复抽取（关闭“换一个”不重复）</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={node.avoidRepeat.enabled}
                onChange={(event) => {
                  node.avoidRepeat.enabled = event.target.checked
                  touch()
                }}
              />
              <span>避免重复出现相同结果</span>
            </label>
            <p className="muted small">
              不重复模式下，每个正权重结果每轮必定各出现一次，权重只影响出现顺序；要按权重频率抽取，请开启“允许重复抽取”。
            </p>
            {node.avoidRepeat.enabled ? (
              <div className="row gap wrap">
                <label className="field inline">
                  <span>降低幅度</span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={node.avoidRepeat.reducePercent}
                    onChange={(event) => {
                      const value = Math.max(1, Math.min(99, Number(event.target.value) || 50))
                      node.avoidRepeat.reducePercent = value
                      touch()
                    }}
                  />
                  <span>%</span>
                </label>
                <label className="field inline">
                  <span>持续轮数</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={node.avoidRepeat.rounds}
                    onChange={(event) => {
                      const value = Math.max(1, Math.min(10, Number(event.target.value) || 3))
                      node.avoidRepeat.rounds = value
                      touch()
                    }}
                  />
                  <span>轮</span>
                </label>
              </div>
            ) : null}
          </div>
          <p className="muted small">
            “轮”=一次完整提交的决策链；当前已提交 {node.roundNo} 轮。
          </p>
        </Section>

        <Section
          title="结果"
          description="权重是相对值，0 表示随机时永不出现；可手动选择。"
          actions={
            <div className="row gap wrap">
              <select className="compact-select" defaultValue="" onChange={(event) => { sortResults(event.target.value); event.currentTarget.value = '' }}>
                <option value="" disabled>
                  排序…
                </option>
                <option value="custom">自定义</option>
                <option value="name">名称</option>
                <option value="created">创建时间</option>
                <option value="weight-desc">权重高→低</option>
                <option value="weight-asc">权重低→高</option>
              </select>
              <button className="btn" onClick={() => setBatchOpen(true)}>
                批量粘贴
              </button>
              <button className="btn primary" onClick={addResult}>
                ＋ 添加结果
              </button>
            </div>
          }
        >
          <div className="result-list">
            {node.results.map((result, index) => {
              const tags = tagsOfResult(node, result)
              const penalty = activeLayerCount(node, result.id, round)
              const duplicate = duplicateNames.has(result.name.trim().toLowerCase())
              return (
                <div
                  className={`result-row ${duplicate ? 'invalid' : ''} ${
                    draggingIndex === index ? 'dragging' : ''
                  } ${dragOverIndex === index ? 'drag-over' : ''}`}
                  key={result.id}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDragOverIndex(index)
                  }}
                  onDragLeave={() => {
                    if (dragOverIndex === index) setDragOverIndex(null)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const from = Number(event.dataTransfer.getData('text/plain'))
                    moveResult(from, index)
                    setDraggingIndex(null)
                    setDragOverIndex(null)
                  }}
                >
                  <span
                    className="drag-handle"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', String(index))
                      event.dataTransfer.effectAllowed = 'move'
                      setDraggingIndex(index)
                    }}
                    onDragEnd={() => {
                      setDraggingIndex(null)
                      setDragOverIndex(null)
                    }}
                    title="拖动排序"
                  >
                    ⋮⋮
                  </span>
                  <div className="result-move">
                    <button
                      type="button"
                      className="icon-btn tiny"
                      disabled={index === 0}
                      title="上移"
                      onClick={() => moveResultBy(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-btn tiny"
                      disabled={index === node.results.length - 1}
                      title="下移"
                      onClick={() => moveResultBy(index, 1)}
                    >
                      ↓
                    </button>
                  </div>
                  <div className="result-index">{index + 1}</div>
                  <div className="result-main">
                    <div className="result-line">
                      <input
                        className="result-name"
                        value={result.name}
                        maxLength={32}
                        onChange={(event) => {
                          result.name = event.target.value
                          touch()
                        }}
                      />
                      <WeightField
                        value={result.weight}
                        onCommit={(value) => {
                          result.weight = value
                          touch()
                        }}
                      />
                      <span className={`prob ${result.weight === 0 ? 'zero' : ''}`}>
                        {result.weight === 0 ? '永不出现' : formatPercent(probability.get(result.id) ?? 0)}
                      </span>
                      <span className="muted small">
                        实际 {effectiveWeight(node, result, round).toFixed(2)}
                      </span>
                      {penalty > 0 ? <span className="badge cool">降温 ×{penalty}</span> : null}
                    </div>
                    <div className="result-tags">
                      {tags.map((tag) => (
                        <TagChip
                          key={tag.id}
                          tag={tag}
                          color={tagColor(node, tag.id)}
                        />
                      ))}
                      <button className="link-btn" onClick={() => setTagResultId(result.id)}>
                        {tags.length ? '改标签' : '＋ 标签'}
                      </button>
                    </div>
                    <div className="result-child-line">
                      {!result.child ? (
                        <button className="link-btn" onClick={() => setChildPicker(result)}>
                          ＋ 子决策
                        </button>
                      ) : result.child.kind === 'owned' ? (
                        <>
                          <span className="badge soft">子决策：{result.child.node.name}</span>
                          <button className="link-btn" onClick={() => openChildEditor(result)}>
                            编辑
                          </button>
                          <button className="link-btn danger-text" onClick={() => removeChild(result)}>
                            删除
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="badge soft">
                            引用：{getTopDecision(state.data, result.child.targetId)?.name ?? '已删除'}
                          </span>
                          {!state.session ? (
                            <button
                              className="link-btn"
                              disabled={saving}
                              onClick={() => void openReferenced(result)}
                            >
                              打开
                            </button>
                          ) : null}
                          <button className="link-btn" onClick={() => copyReference(result)}>
                            复制为副本
                          </button>
                          <button className="link-btn danger-text" onClick={() => removeChild(result)}>
                            解除
                          </button>
                        </>
                      )}
                    </div>
                    {duplicate ? <p className="field-error">同一决策内结果不能重名</p> : null}
                  </div>
                  <button
                    className="icon-btn danger-text"
                    onClick={() => deleteResult(result)}
                    title="删除结果"
                  >
                    🗑
                  </button>
                </div>
              )
            })}
            {node.results.length === 0 ? (
              <div className="empty small-empty">
                <p>还没有结果，先添加一个。</p>
                <button className="btn primary" onClick={addResult}>
                  ＋ 添加结果
                </button>
              </div>
            ) : null}
          </div>
        </Section>

        <Section
          title="标签"
          description="标签属于当前这一级决策；分组颜色在标签 chip 上展示。"
          actions={
            <div className="row gap wrap">
              <button
                className="btn small"
                disabled={Boolean(node.appliedPresetId)}
                onClick={openApplyPreset}
              >
                {node.appliedPresetId ? '已应用预设' : '应用全局预设…'}
              </button>
              <button className="btn" onClick={openPresetModal}>
                保存为预设
              </button>
              <button className="btn" onClick={addTagGroup}>
                ＋ 分组
              </button>
            </div>
          }
        >
          {appliedPreset ? (
            <div className="preset-line">
              <span className="badge soft">已应用预设：{appliedPreset.name}</span>
              <button className="link-btn" onClick={detachPreset}>
                移除关联
              </button>
            </div>
          ) : null}
          {node.tagGroups.length === 0 ? (
            <p className="muted">还没有标签分组。点“＋ 分组”创建。</p>
          ) : (
            <div className="tag-group-list">
              {node.tagGroups.map((group) => (
                <div className="tag-group-row" key={group.id}>
                  <button
                    type="button"
                    className="color-dot color-dot-button"
                    style={{ background: group.color }}
                    title="修改分组颜色"
                    onClick={() => setGroupColor(group)}
                  />
                  <div className="tag-group-main">
                    <div className="tag-group-head">
                      <strong>{group.name}</strong>
                      <button className="link-btn" onClick={() => addTag(group)}>
                        ＋ 标签
                      </button>
                      <button className="link-btn danger-text" onClick={() => deleteGroup(group)}>
                        删除组
                      </button>
                    </div>
                    <div className="tag-list">
                      {node.tags
                        .filter((tag) => tag.groupId === group.id)
                        .map((tag) => (
                          <TagChip
                            key={tag.id}
                            tag={tag}
                            color={group.color}
                            onRemove={() => deleteTag(tag)}
                          />
                        ))}
                    </div>
                  </div>
                </div>
              ))}
              {node.tags.filter((tag) => !tag.groupId).length > 0 ? (
                <div className="tag-group-row">
                  <span className="color-dot" style={{ background: '#FFFFFF', border: '1px solid #CBD5E1' }} />
                  <div className="tag-group-main">
                    <div className="tag-group-head">
                      <strong>未分组</strong>
                    </div>
                    <div className="tag-list">
                      {node.tags
                        .filter((tag) => !tag.groupId)
                        .map((tag) => (
                          <TagChip
                            key={tag.id}
                            tag={tag}
                            color="#FFFFFF"
                            onRemove={() => deleteTag(tag)}
                          />
                        ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Section>

        <Section title="状态" description="只影响当前决策的随机状态，不改历史/统计。">
          <div className="row gap wrap">
            <button
              className="btn"
              onClick={() => {
                if (!window.confirm('清除当前节点及其子树的全部降温状态？')) return
                clearOwnedTreePenalties(node)
                touch()
                store.toast('已清除降温状态')
              }}
            >
              重置降温状态
            </button>
          </div>
        </Section>
      </div>

      {iconOpen && isRoot ? (
        <IconPicker
          value={top.icon}
          onChange={(icon) => {
            top.icon = icon
            touch()
          }}
          onClose={() => setIconOpen(false)}
        />
      ) : null}

      {tagPrompt ? (
        <PromptDialog
          title={tagPrompt.kind === 'group' ? '新建标签分组' : '新建标签'}
          label={
            tagPrompt.kind === 'group'
              ? '分组名称'
              : `标签名称（${tagPrompt.group.name}）`
          }
          placeholder={tagPrompt.kind === 'group' ? '例如：口味' : '例如：微辣'}
          confirmText="创建"
          onSubmit={submitTagPrompt}
          onClose={() => setTagPrompt(null)}
        />
      ) : null}

      {tagResult ? (
        <Modal
          title={`给“${tagResult.name}”选标签`}
          onClose={() => setTagResultId(null)}
          footer={
            <button className="btn" onClick={() => setTagResultId(null)}>
              完成
            </button>
          }
        >
          {node.tagGroups.length === 0 && node.tags.length === 0 ? (
            <p className="muted">还没有标签，请先在下方标签管理里创建。</p>
          ) : (
            <div className="stack">
              {node.tagGroups.map((group) => (
                <div key={group.id}>
                  <div className="tag-group-head">
                    <span className="color-dot" style={{ background: group.color }} />
                    <strong>{group.name}</strong>
                  </div>
                  <div className="tag-list">
                    {node.tags
                      .filter((tag) => tag.groupId === group.id)
                      .map((tag) => {
                        const active = tagResult.tagIds.includes(tag.id)
                        return (
                          <TagChip
                            key={tag.id}
                            tag={tag}
                            color={group.color}
                            active={active}
                            onClick={() => {
                              toggleResultTag(tagResult, tag.id)
                              touch()
                            }}
                          />
                        )
                      })}
                  </div>
                </div>
              ))}
              {node.tags.filter((tag) => !tag.groupId).length > 0 ? (
                <div>
                  <div className="tag-group-head">
                    <span
                      className="color-dot"
                      style={{ background: '#FFFFFF', border: '1px solid #CBD5E1' }}
                    />
                    <strong>未分组</strong>
                  </div>
                  <div className="tag-list">
                    {node.tags
                      .filter((tag) => !tag.groupId)
                      .map((tag) => (
                        <TagChip
                          key={tag.id}
                          tag={tag}
                          color="#FFFFFF"
                          active={tagResult.tagIds.includes(tag.id)}
                          onClick={() => {
                            toggleResultTag(tagResult, tag.id)
                            touch()
                          }}
                        />
                      ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Modal>
      ) : null}

      {presetOpen ? (
        <Modal
          title="保存为标签预设"
          onClose={() => setPresetOpen(false)}
          wide
          footer={
            <div className="row gap">
              <button className="btn" onClick={() => setPresetOpen(false)}>
                取消
              </button>
              <button className="btn primary" onClick={savePreset}>
                保存
              </button>
            </div>
          }
        >
          <label className="field">
            <span>预设名称</span>
            <input
              value={presetName}
              maxLength={32}
              placeholder="例如：餐饮分类"
              onChange={(event) => setPresetName(event.target.value)}
            />
          </label>
          <p className="muted small">
            选择要放进预设的标签（已选 {presetTagIds.length} 个）
          </p>
          <div className="stack">
            {node.tagGroups.map((group) => {
              const tags = node.tags.filter((tag) => tag.groupId === group.id)
              if (tags.length === 0) return null
              return (
                <div key={group.id}>
                  <div className="tag-group-head">
                    <span className="color-dot" style={{ background: group.color }} />
                    <strong>{group.name}</strong>
                  </div>
                  <div className="tag-list">
                    {tags.map((tag) => (
                      <TagChip
                        key={tag.id}
                        tag={tag}
                        color={group.color}
                        active={presetTagIds.includes(tag.id)}
                        onClick={() => togglePresetTag(tag.id)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
            {node.tags.filter((tag) => !tag.groupId).length > 0 ? (
              <div>
                <div className="tag-group-head">
                  <span
                    className="color-dot"
                    style={{ background: '#FFFFFF', border: '1px solid #CBD5E1' }}
                  />
                  <strong>未分组</strong>
                </div>
                <div className="tag-list">
                  {node.tags
                    .filter((tag) => !tag.groupId)
                    .map((tag) => (
                      <TagChip
                        key={tag.id}
                        tag={tag}
                        color="#FFFFFF"
                        active={presetTagIds.includes(tag.id)}
                        onClick={() => togglePresetTag(tag.id)}
                      />
                    ))}
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {groupColor ? (
        <ColorPickerModal
          value={groupColor.color}
          onApply={(hex) => {
            groupColor.color = hex
            touch()
            setGroupColor(null)
          }}
          onClose={() => setGroupColor(null)}
        />
      ) : null}

      {applyOpen && applyTarget ? (
        <Modal
          title="应用全局预设"
          onClose={() => setApplyOpen(false)}
          wide
          footer={
            <div className="row gap">
              <button className="btn" onClick={() => setApplyOpen(false)}>
                取消
              </button>
              <button
                className="btn primary"
                disabled={applyTagIds.length === 0}
                onClick={confirmApplyPreset}
              >
                应用选中的 {applyTagIds.length} 个标签
              </button>
            </div>
          }
        >
          <label className="field">
            <span>选择预设</span>
            <select
              value={applyPresetId}
              onChange={(event) => chooseApplyPreset(event.target.value)}
            >
              {state.data.tagPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <div className="row gap wrap" style={{ marginTop: '0.6rem' }}>
            <button
              className="btn small"
              onClick={() => setApplyTagIds(applyTarget.tags.map((tag) => tag.id))}
            >
              全选
            </button>
            <button className="btn small" onClick={() => setApplyTagIds([])}>
              清空
            </button>
            <span className="muted small">
              已选 {applyTagIds.length} / {applyTarget.tags.length}
            </span>
          </div>
          <div className="stack" style={{ marginTop: '0.7rem' }}>
            {applyTarget.groups.map((group) => {
              const tags = applyTarget.tags.filter((tag) => tag.groupId === group.id)
              if (tags.length === 0) return null
              return (
                <div key={group.id}>
                  <div className="tag-group-head">
                    <span className="color-dot" style={{ background: group.color }} />
                    <strong>{group.name}</strong>
                  </div>
                  <div className="tag-list">
                    {tags.map((tag) => (
                      <TagChip
                        key={tag.id}
                        tag={tag}
                        color={group.color}
                        active={applyTagIds.includes(tag.id)}
                        onClick={() => toggleApplyTag(tag.id)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
            {applyTarget.tags.filter((tag) => !tag.groupId).length > 0 ? (
              <div>
                <div className="tag-group-head">
                  <span
                    className="color-dot"
                    style={{ background: '#FFFFFF', border: '1px solid #CBD5E1' }}
                  />
                  <strong>未分组</strong>
                </div>
                <div className="tag-list">
                  {applyTarget.tags
                    .filter((tag) => !tag.groupId)
                    .map((tag) => (
                      <TagChip
                        key={tag.id}
                        tag={tag}
                        color="#FFFFFF"
                        active={applyTagIds.includes(tag.id)}
                        onClick={() => toggleApplyTag(tag.id)}
                      />
                    ))}
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {batchOpen ? (
        <Modal
          title="批量粘贴结果"
          onClose={() => setBatchOpen(false)}
          wide
          footer={
            <div className="row gap">
              <button className="btn" onClick={() => setBatchOpen(false)}>
                取消
              </button>
              <button className="btn primary" onClick={applyBatch}>
                添加
              </button>
            </div>
          }
        >
          <p className="muted">一行一个；重名自动加序号；名称超过 32 字会截断；最多 100 个。</p>
          <textarea
            className="batch-textarea"
            rows={10}
            value={batchText}
            onChange={(event) => setBatchText(event.target.value)}
            placeholder={'火锅\n烧烤\n面条'}
          />
        </Modal>
      ) : null}

      {childPicker ? (
        <Modal
          title={`“${childPicker.name}”的子决策`}
          onClose={() => setChildPicker(null)}
        >
          <p className="muted">子决策需要在抽取前建好；最多 10 级。</p>
          <div className="stack">
            <button className="btn primary" onClick={() => createOwnedChild(childPicker)}>
              创建自有子决策
            </button>
            <button
              className="btn"
              onClick={() => {
                setReferencePicker(childPicker)
                setChildPicker(null)
              }}
            >
              引用已有决策
            </button>
          </div>
        </Modal>
      ) : null}

      {referencePicker ? (
        <Modal
          title="引用已有决策"
          onClose={() => setReferencePicker(null)}
          wide
        >
          <p className="muted">
            只能引用主界面的顶级决策；同一条链内不能重复引用；引用会共享内容、统计和历史。
          </p>
          <div className="stack">
            {referenceCandidates(
              state.data,
              collectUsed(state.data, top, route.path),
              parentLevel,
            ).map((option) => (
              <button
                key={option.decision.id}
                className="list-row"
                onClick={() => setReference(referencePicker, option.decision.id)}
              >
                <span className="list-row-icon">{option.decision.icon || '🎲'}</span>
                <span className="list-row-main">
                  <strong>{option.decision.name}</strong>
                  <small className="muted">
                    深度 {option.depth} · {option.decision.results.length} 个结果
                  </small>
                </span>
                <span>›</span>
              </button>
            ))}
            {referenceCandidates(
              state.data,
              collectUsed(state.data, top, route.path),
              parentLevel,
            ).length === 0 ? (
              <p className="muted">没有可引用的决策（可能都已在链上，或层级会超限）。</p>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
