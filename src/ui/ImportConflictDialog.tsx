import { useEffect, useState } from 'react'
import type { DecisionConflictAction, DecisionConflictResolution } from '../core/merge'
import { Modal } from './components'
import { store, useStore } from './store'

interface Choice {
  action: DecisionConflictAction
  name: string
}

export default function ImportConflictDialog() {
  const state = useStore()
  const pending = state.pendingImport
  const [choices, setChoices] = useState<Record<string, Choice>>({})

  useEffect(() => {
    if (!pending) {
      setChoices({})
      return
    }
    const next: Record<string, Choice> = {}
    for (const conflict of pending.conflicts) {
      next[conflict.incomingId] = {
        action: 'skip',
        name: `${conflict.name} (导入)`,
      }
    }
    setChoices(next)
  }, [pending])

  if (!pending) return null

  const update = (id: string, patch: Partial<Choice>) => {
    setChoices((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? { action: 'skip', name: '' }),
        ...patch,
      },
    }))
  }

  const apply = () => {
    const resolutions = new Map<string, DecisionConflictResolution>()
    for (const conflict of pending.conflicts) {
      const choice = choices[conflict.incomingId] ?? {
        action: 'skip' as const,
        name: `${conflict.name} (导入)`,
      }
      resolutions.set(conflict.incomingId, {
        action: choice.action,
        name: choice.action === 'rename' ? choice.name : undefined,
      })
    }
    void store.applyPendingImport(resolutions)
  }

  return (
    <Modal
      title="导入冲突"
      onClose={() => store.cancelPendingImport()}
      wide
      footer={
        <div className="row gap">
          <button className="btn" onClick={() => store.cancelPendingImport()}>
            取消导入
          </button>
          <button className="btn primary" onClick={apply}>
            应用选择
          </button>
        </div>
      }
    >
      <p>
        备份中有 {pending.conflicts.length} 个顶级决策与当前同名，请逐项选择处理方式。
      </p>
      <div className="stack">
        {pending.conflicts.map((conflict) => {
          const choice = choices[conflict.incomingId] ?? {
            action: 'skip' as const,
            name: `${conflict.name} (导入)`,
          }
          return (
            <div className="conflict-row" key={conflict.incomingId}>
              <div className="conflict-name">
                <strong>{conflict.name}</strong>
                <small className="muted">当前已存在同名决策</small>
              </div>
              <select
                value={choice.action}
                onChange={(event) =>
                  update(conflict.incomingId, {
                    action: event.target.value as DecisionConflictAction,
                  })
                }
              >
                <option value="skip">跳过</option>
                <option value="overwrite">覆盖现有</option>
                <option value="rename">重命名导入</option>
              </select>
              {choice.action === 'rename' ? (
                <input
                  value={choice.name}
                  onChange={(event) =>
                    update(conflict.incomingId, { name: event.target.value })
                  }
                  placeholder="新名称"
                />
              ) : null}
            </div>
          )
        })}
      </div>
      <p className="muted small">
        覆盖会替换现有决策的结果、标签和设置，但保留它的 ID、文件夹、收藏/置顶与引用位置；
        重命名会作为新决策导入。
      </p>
    </Modal>
  )
}
