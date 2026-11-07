import { useRef, useState } from 'react'
import { Modal } from './components'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function hexToRgb(hex: string): [number, number, number] | null {
  let value = hex.replace('#', '').trim()
  if (value.length === 3) {
    value = value
      .split('')
      .map((char) => char + char)
      .join('')
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase()
}

function rgbToHsv(rgb: [number, number, number]): { h: number; s: number; v: number } {
  const [r, g, b] = rgb.map((value) => value / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  return {
    h,
    s: max === 0 ? 0 : (delta / max) * 100,
    v: max * 100,
  }
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const saturation = clamp(s, 0, 100) / 100
  const value = clamp(v, 0, 100) / 100
  const c = value * saturation
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = value - c
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return rgb.map((channel) => (channel + m) * 255) as [number, number, number]
}

function hsvToHex(h: number, s: number, v: number): string {
  return rgbToHex(hsvToRgb(h, s, v))
}

function ColorSlider({
  label,
  value,
  max,
  gradient,
  suffix,
  onChange,
}: {
  label: string
  value: number
  max: number
  gradient: string
  suffix: string
  onChange: (value: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const percent = (value / max) * 100

  const update = (clientX: number) => {
    const element = trackRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
    onChange(Math.round(ratio * max))
  }

  return (
    <div className="color-slider">
      <div className="color-slider-head">
        <span>{label}</span>
        <span>
          {Math.round(value)}
          {suffix}
        </span>
      </div>
      <div
        ref={trackRef}
        className="color-track"
        style={{ background: gradient }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          update(event.clientX)
        }}
        onPointerMove={(event) => {
          if (event.buttons) update(event.clientX)
        }}
      >
        <span
          className="color-pointer"
          style={{ left: `clamp(6px, ${percent}%, calc(100% - 6px))` }}
        />
      </div>
    </div>
  )
}

export default function ColorPickerModal({
  value,
  onApply,
  onClose,
}: {
  value: string
  onApply: (hex: string) => void
  onClose: () => void
}) {
  const initial = rgbToHsv(hexToRgb(value) ?? [19, 119, 219])
  const [hue, setHue] = useState(initial.h)
  const [saturation, setSaturation] = useState(initial.s)
  const [brightness, setBrightness] = useState(initial.v)
  const [hexText, setHexText] = useState(value.toUpperCase())

  const hex = hsvToHex(hue, saturation, brightness)

  const setHsv = (nextHue: number, nextSat: number, nextVal: number) => {
    setHue(nextHue)
    setSaturation(nextSat)
    setBrightness(nextVal)
    setHexText(hsvToHex(nextHue, nextSat, nextVal))
  }

  const updateHex = (text: string) => {
    setHexText(text)
    const rgb = hexToRgb(text)
    if (!rgb) return
    const next = rgbToHsv(rgb)
    setHue(next.h)
    setSaturation(next.s)
    setBrightness(next.v)
  }

  return (
    <Modal
      title="自定义主题色"
      onClose={onClose}
      wide
      footer={
        <div className="row gap">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={() => onApply(hex)}>
            使用此颜色
          </button>
        </div>
      }
    >
      <ColorSlider
        label="色调"
        value={hue}
        max={360}
        suffix="°"
        gradient="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
        onChange={(next) => setHsv(next, saturation, brightness)}
      />
      <ColorSlider
        label="饱和度"
        value={saturation}
        max={100}
        suffix="%"
        gradient={`linear-gradient(to right, ${hsvToHex(hue, 0, brightness)}, ${hsvToHex(hue, 100, brightness)})`}
        onChange={(next) => setHsv(hue, next, brightness)}
      />
      <ColorSlider
        label="明度"
        value={brightness}
        max={100}
        suffix="%"
        gradient={`linear-gradient(to right, #000, ${hsvToHex(hue, saturation, 100)})`}
        onChange={(next) => setHsv(hue, saturation, next)}
      />
      <div className="color-preview-row">
        <span className="color-preview" style={{ background: hex }} />
        <label className="field color-hex-field">
          <span>颜色值</span>
          <input
            value={hexText}
            maxLength={7}
            onChange={(event) => updateHex(event.target.value)}
          />
        </label>
      </div>
      <p className="muted small">
        指针尖端位于色条底边；拖动色条或直接输入 HEX 颜色值。
      </p>
    </Modal>
  )
}
