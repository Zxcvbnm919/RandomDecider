import { useState } from 'react'
import { GROUP_COLORS, createGroup, createPreset, createTag } from '../../core/defaults'
import { validateGroupName, validateTagName } from '../../core/tags'
import type { TagGroup } from '../../core/types'
import ColorPickerModal from '../ColorPickerModal'
import { EmptyState, PromptDialog, TagChip } from '../components'
import { store, useStore } from '../store'

type PromptState =
  | { kind: 'preset-add' }
  | { kind: 'preset-rename'; presetId: string; value: string }
  | { kind: 'group-add'; presetId: string }
  | { kind: 'group-rename'; presetId: string; groupId: string; value: string }
  | { kind: 'tag-add'; presetId: string; groupId: string }
  | { kind: 'tag-rename'; presetId: string; tagId: string; value: string }

export default function TagPresetsPage() {
  const state = useStore()
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const [colorTarget, setColorTarget] = useState<{
    presetId: string
    groupId: string
    value: string
  } | null>(null)

  const touch = () => {
    store.updateData(() => undefined)
    void store.persist()
  }

  const promptConfig = (() => {
    if (!prompt) return null
    switch (prompt.kind) {
      case 'preset-add':
        return {
          title: '新建标签预设',
          label: '预设名称',
          defaultValue: '',
          confirmText: '创建',
        }
      case 'preset-rename':
        return {
          title: '重命名标签预设',
          label: '预设名称',
          defaultValue: prompt.value,
          confirmText: '保存',
        }
      case 'group-add':
        return {
          title: '新建标签分组',
          label: '分组名称',
          defaultValue: '',
          confirmText: '创建',
        }
      case 'group-rename':
        return {
          title: '重命名标签分组',
          label: '分组名称',
          defaultValue: prompt.value,
          confirmText: '保存',
        }
      case 'tag-add':
        return {
          title: '新建标签',
          label: '标签名称',
          defaultValue: '',
          confirmText: '创建',
        }
      case 'tag-rename':
        return {
          title: '重命名标签',
          label: '标签名称',
          defaultValue: prompt.value,
          confirmText: '保存',
        }
      default:
        return null
    }
  })()

  const submitPrompt = (name: string) => {
    if (!prompt) return
    const presets = state.data.tagPresets
    try {
      if (prompt.kind === 'preset-add') {
        if ([...name].length > 32) throw new Error('预设名称不能超过 32 字')
        if (presets.some((preset) => preset.name.toLowerCase() === name.toLowerCase())) {
          throw new Error('预设名称已存在')
        }
        if (presets.length >= 100) throw new Error('预设数量已达上限（100）')
        presets.push(createPreset(name))
      } else if (prompt.kind === 'preset-rename') {
        const preset = presets.find((item) => item.id === prompt.presetId)
        if (!preset) throw new Error('预设不存在')
        if ([...name].length > 32) throw new Error('预设名称不能超过 32 字')
        if (
          presets.some(
            (item) =>
              item.id !== preset.id && item.name.toLowerCase() === name.toLowerCase(),
          )
        ) {
          throw new Error('预设名称已存在')
        }
        preset.name = name
      } else if (prompt.kind === 'group-add') {
        const preset = presets.find((item) => item.id === prompt.presetId)
        if (!preset) throw new Error('预设不存在')
        const trimmed = validateGroupName(name)
        if (
          preset.groups.some(
            (group) => group.name.toLowerCase() === trimmed.toLowerCase(),
          )
        ) {
          throw new Error('同预设内分组名不能重复')
        }
        preset.groups.push(
          createGroup(
            trimmed,
            GROUP_COLORS[preset.groups.length % GROUP_COLORS.length]!,
            preset.groups.length,
          ),
        )
      } else if (prompt.kind === 'group-rename') {
        const preset = presets.find((item) => item.id === prompt.presetId)
        const group = preset?.groups.find((item) => item.id === prompt.groupId)
        if (!preset || !group) throw new Error('分组不存在')
        const trimmed = validateGroupName(name)
        if (
          preset.groups.some(
            (item) =>
              item.id !== group.id &&
              item.name.toLowerCase() === trimmed.toLowerCase(),
          )
        ) {
          throw new Error('同预设内分组名不能重复')
        }
        group.name = trimmed
      } else if (prompt.kind === 'tag-add') {
        const preset = presets.find((item) => item.id === prompt.presetId)
        const group = preset?.groups.find((item) => item.id === prompt.groupId)
        if (!preset || !group) throw new Error('分组不存在')
        const trimmed = validateTagName(name)
        if (
          preset.tags.some(
            (tag) =>
              tag.groupId === group.id &&
              tag.name.toLowerCase() === trimmed.toLowerCase(),
          )
        ) {
          throw new Error('同分组内标签名不能重复')
        }
        preset.tags.push(createTag(trimmed, group.id, preset.tags.length))
      } else {
        const preset = presets.find((item) => item.id === prompt.presetId)
        const tag = preset?.tags.find((item) => item.id === prompt.tagId)
        if (!preset || !tag) throw new Error('标签不存在')
        const trimmed = validateTagName(name)
        if (
          preset.tags.some(
            (item) =>
              item.id !== tag.id &&
              item.groupId === tag.groupId &&
              item.name.toLowerCase() === trimmed.toLowerCase(),
          )
        ) {
          throw new Error('同分组内标签名不能重复')
        }
        tag.name = trimmed
      }
      setPrompt(null)
      touch()
      store.toast('已更新标签预设')
    } catch (error) {
      store.toast(error instanceof Error ? error.message : String(error))
    }
  }

  const deletePreset = (presetId: string) => {
    const preset = state.data.tagPresets.find((item) => item.id === presetId)
    if (!preset) return
    if (!window.confirm(`删除预设“${preset.name}”？不会影响已经复制到决策里的标签。`)) {
      return
    }
    state.data.tagPresets = state.data.tagPresets.filter((item) => item.id !== presetId)
    touch()
    store.toast('已删除预设')
  }

  const deleteGroup = (presetId: string, group: TagGroup) => {
    const preset = state.data.tagPresets.find((item) => item.id === presetId)
    if (!preset) return
    if (!window.confirm(`删除分组“${group.name}”及组内标签？`)) return
    preset.groups = preset.groups.filter((item) => item.id !== group.id)
    preset.tags = preset.tags.filter((tag) => tag.groupId !== group.id)
    touch()
  }

  const renderGroup = (presetId: string, group: TagGroup) => {
    const preset = state.data.tagPresets.find((item) => item.id === presetId)
    if (!preset) return null
    const tags = preset.tags.filter((tag) => tag.groupId === group.id)
    return (
      <div className="tag-group-row" key={group.id}>
        <button
          type="button"
          className="group-color"
          style={{ background: group.color }}
          title="分组颜色"
          onClick={() =>
            setColorTarget({
              presetId,
              groupId: group.id,
              value: group.color,
            })
          }
        />
        <div className="tag-group-main">
          <div className="tag-group-head">
            <strong>{group.name}</strong>
            <button
              className="link-btn"
              onClick={() =>
                setPrompt({
                  kind: 'group-rename',
                  presetId,
                  groupId: group.id,
                  value: group.name,
                })
              }
            >
              重命名
            </button>
            <button
              className="link-btn"
              onClick={() => setPrompt({ kind: 'tag-add', presetId, groupId: group.id })}
            >
              ＋ 标签
            </button>
            <button
              className="link-btn danger-text"
              onClick={() => deleteGroup(presetId, group)}
            >
              删除组
            </button>
          </div>
          <div className="tag-list">
            {tags.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                color={group.color}
                onClick={() =>
                  setPrompt({
                    kind: 'tag-rename',
                    presetId,
                    tagId: tag.id,
                    value: tag.name,
                  })
                }
                onRemove={() => {
                  if (!window.confirm(`删除标签“${tag.name}”？`)) return
                  preset.tags = preset.tags.filter((item) => item.id !== tag.id)
                  touch()
                }}
              />
            ))}
            {tags.length === 0 ? <span className="muted small">还没有标签</span> : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="focus-page">
      <header className="focus-head">
        <button className="icon-btn" onClick={() => store.navigate({ name: 'settings' })}>
          ‹
        </button>
        <div className="focus-title">
          <h1>标签预设</h1>
          <p className="muted">{state.data.tagPresets.length} / 100 个预设</p>
        </div>
        <button className="btn primary" onClick={() => setPrompt({ kind: 'preset-add' })}>
          ＋ 新建预设
        </button>
      </header>

      <div className="scroll">
        <p className="muted small">
          全局标签库。应用到决策时会复制一份，之后修改预设不会影响已有决策；已有决策内的修改也不会改回预设。
        </p>
        {state.data.tagPresets.length === 0 ? (
          <EmptyState
            icon="🏷️"
            title="还没有标签预设"
            description="可以在决策编辑页把标签保存为预设，或在这里新建一个空预设。"
            action={
              <button className="btn primary" onClick={() => setPrompt({ kind: 'preset-add' })}>
                新建预设
              </button>
            }
          />
        ) : (
          <div className="stack">
            {state.data.tagPresets.map((preset) => (
              <section className="section" key={preset.id}>
                <div className="section-head">
                  <div>
                    <h2>{preset.name}</h2>
                    <p>
                      {preset.groups.length} 个分组 · {preset.tags.length} 个标签
                    </p>
                  </div>
                  <div className="section-actions">
                    <button
                      className="btn small"
                      onClick={() =>
                        setPrompt({
                          kind: 'preset-rename',
                          presetId: preset.id,
                          value: preset.name,
                        })
                      }
                    >
                      重命名
                    </button>
                    <button
                      className="btn small danger"
                      onClick={() => deletePreset(preset.id)}
                    >
                      删除
                    </button>
                    <button
                      className="btn small"
                      onClick={() => setPrompt({ kind: 'group-add', presetId: preset.id })}
                    >
                      ＋ 分组
                    </button>
                  </div>
                </div>
                <div className="tag-group-list">
                  {preset.groups.map((group) => renderGroup(preset.id, group))}
                  {preset.tags.filter((tag) => !tag.groupId).length > 0 ? (
                    <div className="tag-group-row">
                      <span
                        className="color-dot"
                        style={{ background: '#FFFFFF', border: '1px solid #CBD5E1' }}
                      />
                      <div className="tag-group-main">
                        <div className="tag-group-head">
                          <strong>未分组</strong>
                        </div>
                        <div className="tag-list">
                          {preset.tags
                            .filter((tag) => !tag.groupId)
                            .map((tag) => (
                              <TagChip
                                key={tag.id}
                                tag={tag}
                                color="#FFFFFF"
                                onClick={() =>
                                  setPrompt({
                                    kind: 'tag-rename',
                                    presetId: preset.id,
                                    tagId: tag.id,
                                    value: tag.name,
                                  })
                                }
                                onRemove={() => {
                                  if (!window.confirm(`删除标签“${tag.name}”？`)) return
                                  preset.tags = preset.tags.filter(
                                    (item) => item.id !== tag.id,
                                  )
                                  touch()
                                }}
                              />
                            ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {preset.groups.length === 0 &&
                  preset.tags.filter((tag) => !tag.groupId).length === 0 ? (
                    <p className="muted">还没有标签组。点“＋ 分组”创建。</p>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {prompt && promptConfig ? (
        <PromptDialog
          title={promptConfig.title}
          label={promptConfig.label}
          defaultValue={promptConfig.defaultValue}
          confirmText={promptConfig.confirmText}
          onSubmit={submitPrompt}
          onClose={() => setPrompt(null)}
        />
      ) : null}

      {colorTarget ? (
        <ColorPickerModal
          value={colorTarget.value}
          onApply={(hex) => {
            const preset = state.data.tagPresets.find(
              (item) => item.id === colorTarget.presetId,
            )
            const group = preset?.groups.find(
              (item) => item.id === colorTarget.groupId,
            )
            if (group) {
              group.color = hex
              touch()
            }
            setColorTarget(null)
          }}
          onClose={() => setColorTarget(null)}
        />
      ) : null}
    </div>
  )
}
