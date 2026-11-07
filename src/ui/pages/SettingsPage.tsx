import { useEffect, useState } from 'react'
import { THEME_PALETTE } from '../../core/defaults'
import type { BackgroundFit, FontScale, ThemeMode } from '../../core/types'
import { fitToCss } from '../theme'
import ColorPickerModal from '../ColorPickerModal'
import { Modal, Section } from '../components'
import { storage } from '../storage'
import { store, useStore } from '../store'

const FIT_OPTIONS: { value: BackgroundFit; label: string }[] = [
  { value: 'auto', label: '自动（铺满）' },
  { value: 'tile', label: '平铺' },
  { value: 'center', label: '居中' },
  { value: 'stretch', label: '拉伸' },
  { value: 'left-top', label: '左上（保持比例）' },
  { value: 'left-center', label: '左中（保持比例）' },
  { value: 'left-bottom', label: '左下（保持比例）' },
  { value: 'center-top', label: '中上（保持比例）' },
  { value: 'center-center', label: '居中（保持比例）' },
  { value: 'center-bottom', label: '中下（保持比例）' },
  { value: 'right-top', label: '右上（保持比例）' },
  { value: 'right-center', label: '右中（保持比例）' },
  { value: 'right-bottom', label: '右下（保持比例）' },
]

export default function SettingsPage() {
  const state = useStore()
  const settings = state.data.settings
  const [dataPath, setDataPath] = useState('读取中…')
  const [importOpen, setImportOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)

  useEffect(() => {
    void storage.dataPath().then((path) => setDataPath(path ?? '未知'))
  }, [])

  const chooseBackground = async () => {
    const file = await storage.pickImage()
    if (file) await store.setBackground(file)
  }

  return (
    <div className="focus-page">
      <header className="focus-head">
        <button className="icon-btn" onClick={() => store.navigate({ name: 'main' })}>
          ‹
        </button>
        <div className="focus-title">
          <h1>设置</h1>
          <p className="muted">主题、背景、字号与数据</p>
        </div>
      </header>

      <div className="scroll settings-scroll">
        <Section title="主题色" description="顶部栏、主按钮和强调色。">
          <div className="palette">
            {THEME_PALETTE.map((item) => (
              <button
                key={item.color}
                className={`swatch ${
                  settings.themeColor.toLowerCase() === item.color.toLowerCase() ? 'selected' : ''
                }`}
                style={{ background: item.color }}
                title={item.name}
                onClick={() => store.setSettings({ themeColor: item.color })}
              >
                {settings.themeColor.toLowerCase() === item.color.toLowerCase() ? '✓' : ''}
              </button>
            ))}
            <button
              type="button"
              className="custom-color"
              onClick={() => setColorOpen(true)}
            >
              <span
                className="custom-color-chip"
                style={{ background: settings.themeColor }}
              />
              <span>自定义</span>
            </button>
          </div>
          <div className="row gap wrap theme-mode-row">
            <span className="muted small">外观</span>
            <div className="segmented">
              {(
                [
                  ['light', '浅色'],
                  ['dark', '深色'],
                  ['system', '跟随系统'],
                ] as [ThemeMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  className={`seg ${
                    (settings.themeMode ?? 'light') === mode ? 'active' : ''
                  }`}
                  onClick={() => store.setSettings({ themeMode: mode })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="muted small">
            主题色只影响强调色；可切换浅色、深色或跟随系统。自定义色不校验对比度。
          </p>
        </Section>

        <Section title="背景图" description="图片会复制进应用数据，不随备份导出；换机后需重新选择。">
          <div
            className="bg-preview"
            style={
              state.backgroundUrl
                ? {
                    backgroundImage: `url("${state.backgroundUrl}")`,
                    backgroundSize: fitToCss(settings.backgroundFit).size,
                    backgroundPosition: fitToCss(settings.backgroundFit).position,
                    backgroundRepeat: fitToCss(settings.backgroundFit).repeat,
                  }
                : { background: 'linear-gradient(135deg, var(--bg-start), var(--bg-end))' }
            }
          >
            {!state.backgroundUrl ? <span className="muted">当前使用主题色背景</span> : null}
          </div>
          <div className="row gap wrap">
            <button className="btn" onClick={() => void chooseBackground()}>
              {state.backgroundUrl ? '更换图片' : '选择图片'}
            </button>
            <button
              className="btn"
              disabled={!state.backgroundUrl}
              onClick={() => void store.clearBackground()}
            >
              清除背景
            </button>
            <label className="field inline">
              <span>自适应</span>
              <select
                value={settings.backgroundFit}
                onChange={(event) =>
                  store.setSettings({ backgroundFit: event.target.value as BackgroundFit })
                }
              >
                {FIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>不透明度 {settings.backgroundOpacity}%</span>
              <input
                type="range"
                min={0}
                max={100}
                value={settings.backgroundOpacity}
                onChange={(event) =>
                  store.setSettings({ backgroundOpacity: Number(event.target.value) })
                }
              />
            </label>
            <label className="field">
              <span>背景模糊 {settings.backgroundBlur}px</span>
              <input
                type="range"
                min={0}
                max={20}
                value={settings.backgroundBlur}
                onChange={(event) =>
                  store.setSettings({ backgroundBlur: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <p className="muted small">支持 PNG/JPG，原文件不超过 10MB。</p>
        </Section>

        <Section title="字号" description="影响全部文字，100% = 16px。">
          <div className="segmented wide">
            {([70, 85, 100, 125, 150] as FontScale[]).map((scale) => (
              <button
                key={scale}
                className={`seg ${settings.fontScale === scale ? 'active' : ''}`}
                onClick={() => store.setSettings({ fontScale: scale })}
              >
                {scale}%
              </button>
            ))}
          </div>
        </Section>

        <Section
          title="标签预设"
          description="全局标签库；应用时复制到决策，之后互不影响。"
        >
          <button className="btn" onClick={() => store.navigate({ name: 'presets' })}>
            管理标签预设
          </button>
        </Section>

        <Section title="数据" description={`存储位置：${dataPath}`}>
          <div className="data-actions">
            <button className="btn" onClick={() => void store.exportFull()}>
              导出全量备份
            </button>
            <button className="btn" onClick={() => setImportOpen(true)}>
              导入全量备份
            </button>
            <button className="btn" onClick={() => void store.exportHistory()}>
              导出历史
            </button>
            <button className="btn" onClick={() => void store.importHistory()}>
              导入历史
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (!window.confirm('清空全部数据？此操作不可撤销。')) return
                if (!window.confirm('再次确认：决策、标签、历史、统计都会被删除。')) return
                void store.clearAllData()
              }}
            >
              清空全部数据
            </button>
          </div>
          <p className="muted small">
            数据只在本机。导入全量备份时可选择合并或覆盖。
          </p>
        </Section>

        <Section title="关于">
          <p className="muted small">
            随机决策工具 v1 · 离线、单机、无账号。Windows 便携版与 Android PWA 共用核心逻辑。
          </p>
        </Section>
      </div>

      {colorOpen ? (
        <ColorPickerModal
          value={settings.themeColor}
          onApply={(hex) => {
            store.setSettings({ themeColor: hex })
            setColorOpen(false)
          }}
          onClose={() => setColorOpen(false)}
        />
      ) : null}

      {importOpen ? (
        <Modal
          title="导入全量备份"
          onClose={() => setImportOpen(false)}
          footer={
            <button className="btn" onClick={() => setImportOpen(false)}>
              取消
            </button>
          }
        >
          <p>选择导入方式：</p>
          <div className="stack">
            <button
              className="btn primary"
              onClick={() => {
                setImportOpen(false)
                void store.prepareMergeImport()
              }}
            >
              合并导入（推荐）
            </button>
            <button
              className="btn danger"
              onClick={() => {
                setImportOpen(false)
                void store.importFull()
              }}
            >
              覆盖导入（清空当前数据）
            </button>
          </div>
          <p className="muted small">
            合并：保留现有数据，同名决策/文件夹/预设跳过，引用会按备份内的名称自动重指向。
            覆盖：用备份替换当前全部数据（背景图除外）。
          </p>
        </Modal>
      ) : null}
    </div>
  )
}
