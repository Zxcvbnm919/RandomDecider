import type { BackgroundFit, Settings } from '../core/types'
import type { CSSProperties } from 'react'

export function hexToRgb(hex: string): [number, number, number] {
  let value = hex.replace('#', '').trim()
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return [19, 119, 219]
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')}`
}

export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  return rgbToHex([
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
  ])
}

export function lighten(color: string, t: number): string {
  return mix(color, '#FFFFFF', t)
}

export function darken(color: string, t: number): string {
  return mix(color, '#000000', t)
}

export function luminance(color: string): number {
  const [r, g, b] = hexToRgb(color).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function onColor(color: string): string {
  return luminance(color) > 0.55 ? '#1F2937' : '#FFFFFF'
}

export function resolveThemeMode(
  mode: Settings['themeMode'] | undefined,
): 'light' | 'dark' {
  if (mode === 'dark') return 'dark'
  if (
    mode === 'system' &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

export function applyTheme(settings: Settings): void {
  const root = document.documentElement
  const primary = settings.themeColor || '#1377DB'
  const mode = resolveThemeMode(settings.themeMode)
  root.dataset.theme = mode
  root.style.setProperty('--primary', primary)
  root.style.setProperty('--on-primary', onColor(primary))
  root.style.setProperty('--primary-dark', darken(primary, 0.14))
  if (mode === 'dark') {
    root.style.setProperty('--primary-soft', mix(primary, '#0f172a', 0.72))
    root.style.setProperty('--primary-faint', mix(primary, '#0f172a', 0.86))
    root.style.setProperty('--bg-start', '#0b1220')
    root.style.setProperty('--bg-end', mix(primary, '#0b1220', 0.9))
    root.style.setProperty('--border', mix(primary, '#0f172a', 0.62))
  } else {
    root.style.setProperty('--primary-soft', lighten(primary, 0.82))
    root.style.setProperty('--primary-faint', lighten(primary, 0.92))
    root.style.setProperty('--bg-start', lighten(primary, 0.92))
    root.style.setProperty('--bg-end', lighten(primary, 0.82))
    root.style.setProperty('--border', lighten(primary, 0.58))
  }
  root.style.fontSize = `${(16 * settings.fontScale) / 100}px`
}

export function fitToCss(fit: BackgroundFit): {
  size: string
  position: string
  repeat: string
} {
  switch (fit) {
    case 'tile':
      return { size: 'auto', position: 'left top', repeat: 'repeat' }
    case 'center':
      return { size: 'auto', position: 'center', repeat: 'no-repeat' }
    case 'stretch':
      return { size: '100% 100%', position: 'center', repeat: 'no-repeat' }
    case 'left-top':
      return { size: 'cover', position: 'left top', repeat: 'no-repeat' }
    case 'left-center':
      return { size: 'cover', position: 'left center', repeat: 'no-repeat' }
    case 'left-bottom':
      return { size: 'cover', position: 'left bottom', repeat: 'no-repeat' }
    case 'center-top':
      return { size: 'cover', position: 'center top', repeat: 'no-repeat' }
    case 'center-center':
      return { size: 'cover', position: 'center', repeat: 'no-repeat' }
    case 'center-bottom':
      return { size: 'cover', position: 'center bottom', repeat: 'no-repeat' }
    case 'right-top':
      return { size: 'cover', position: 'right top', repeat: 'no-repeat' }
    case 'right-center':
      return { size: 'cover', position: 'right center', repeat: 'no-repeat' }
    case 'right-bottom':
      return { size: 'cover', position: 'right bottom', repeat: 'no-repeat' }
    case 'auto':
    default:
      return { size: 'cover', position: 'center', repeat: 'no-repeat' }
  }
}

export function backgroundLayerStyle(
  settings: Settings,
  url: string | null,
): CSSProperties | null {
  if (!url) return null
  const fit = fitToCss(settings.backgroundFit)
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: fit.size,
    backgroundPosition: fit.position,
    backgroundRepeat: fit.repeat,
    opacity: Math.max(0, Math.min(100, settings.backgroundOpacity)) / 100,
    filter: settings.backgroundBlur > 0 ? `blur(${settings.backgroundBlur}px)` : undefined,
    transform: settings.backgroundBlur > 0 ? 'scale(1.03)' : undefined,
  }
}
