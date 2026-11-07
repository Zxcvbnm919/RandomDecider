import type { AppData } from '../core/types'

const DB_NAME = 'random-decider'
const DB_VERSION = 1
const STORE_NAME = 'kv'
const KEY_DATA = 'appData'
const KEY_BACKGROUND = 'background'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开本地存储'))
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('本地存储操作失败'))
  })
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_NAME, 'readonly')
    return await requestToPromise<T | undefined>(tx.objectStore(STORE_NAME).get(key))
  } finally {
    db.close()
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    await requestToPromise(tx.objectStore(STORE_NAME).put(value, key))
  } finally {
    db.close()
  }
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    await requestToPromise(tx.objectStore(STORE_NAME).delete(key))
  } finally {
    db.close()
  }
}

export interface StorageAdapter {
  load(): Promise<AppData | null>
  save(data: AppData): Promise<void>
  loadBackgroundUrl(): Promise<string | null>
  saveBackground(file: File): Promise<string | null>
  clearBackground(): Promise<void>
  exportJson(filename: string, payload: unknown): Promise<void>
  pickJson(): Promise<unknown | null>
  pickImage(): Promise<File | null>
  dataPath(): Promise<string | null>
}

let currentBackgroundUrl: string | null = null

function revokeBackgroundUrl(): void {
  if (currentBackgroundUrl) {
    URL.revokeObjectURL(currentBackgroundUrl)
    currentBackgroundUrl = null
  }
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    // 移动端 PWA/Chrome 对未挂载到 DOM 的 input 可能不弹选择器。
    input.style.position = 'fixed'
    input.style.left = '-10000px'
    input.style.top = '0'
    input.style.opacity = '0'
    document.body.appendChild(input)
    let settled = false
    const finish = (file: File | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => finish(null))
    input.click()
  })
}

export const browserStorage: StorageAdapter = {
  async load() {
    return (await idbGet<AppData>(KEY_DATA)) ?? null
  },
  async save(data) {
    // structured clone 不能包含 undefined 之外的奇怪对象；AppData 是纯数据。
    await idbSet(KEY_DATA, data)
  },
  async loadBackgroundUrl() {
    const blob = await idbGet<Blob>(KEY_BACKGROUND)
    if (!blob) return null
    revokeBackgroundUrl()
    currentBackgroundUrl = URL.createObjectURL(blob)
    return currentBackgroundUrl
  },
  async saveBackground(file) {
    if (file.size > 10 * 1024 * 1024) throw new Error('背景图不能超过 10MB')
    if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('背景图仅支持 PNG/JPG')
    await idbSet(KEY_BACKGROUND, file)
    revokeBackgroundUrl()
    currentBackgroundUrl = URL.createObjectURL(file)
    return currentBackgroundUrl
  },
  async clearBackground() {
    await idbDelete(KEY_BACKGROUND)
    revokeBackgroundUrl()
  },
  async exportJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
  async pickJson() {
    const file = await pickFile('application/json,.json')
    if (!file) return null
    try {
      return JSON.parse(await file.text())
    } catch {
      return null
    }
  },
  async pickImage() {
    return pickFile('image/png,image/jpeg')
  },
  async dataPath() {
    return '浏览器本地存储（IndexedDB）'
  },
}

const desktopBridge = typeof window !== 'undefined' ? window.desktop : undefined

const desktopStorage: StorageAdapter | null = desktopBridge
  ? {
      async load() {
        const data = await desktopBridge!.load()
        return (data as AppData | null) ?? null
      },
      async save(data) {
        await desktopBridge!.save(data)
      },
      async loadBackgroundUrl() {
        return desktopBridge!.loadBackground()
      },
      async saveBackground(file) {
        if (file.size > 10 * 1024 * 1024) throw new Error('背景图不能超过 10MB')
        if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('背景图仅支持 PNG/JPG')
        const buffer = await file.arrayBuffer()
        return desktopBridge!.saveBackground(buffer, file.type === 'image/png' ? 'png' : 'jpg')
      },
      async clearBackground() {
        await desktopBridge!.clearBackground()
      },
      async exportJson(filename, payload) {
        await desktopBridge!.exportFile(filename, JSON.stringify(payload, null, 2))
      },
      async pickJson() {
        const text = await desktopBridge!.importFile()
        if (!text) return null
        try {
          return JSON.parse(text)
        } catch {
          return null
        }
      },
      async pickImage() {
        return pickFile('image/png,image/jpeg')
      },
      async dataPath() {
        return desktopBridge!.getDataPath()
      },
    }
  : null

export const storage: StorageAdapter = desktopStorage ?? browserStorage

export function timestampForFile(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
