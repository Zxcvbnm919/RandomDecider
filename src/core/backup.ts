import { createSettings } from './defaults'
import { nowIso } from './ids'
import type { AppData } from './types'

export interface BackupJson {
  格式版本: number
  类型: '全量备份'
  导出时间: string
  设置: AppData['settings']
  文件夹: AppData['folders']
  决策: AppData['decisions']
  标签预设: AppData['tagPresets']
  统计: AppData['stats']
  历史: AppData['history']
}

export function toBackupJson(data: AppData): BackupJson {
  return {
    格式版本: data.schemaVersion,
    类型: '全量备份',
    导出时间: nowIso(),
    设置: { ...data.settings, backgroundImage: null },
    文件夹: data.folders,
    决策: data.decisions,
    标签预设: data.tagPresets,
    统计: data.stats,
    历史: data.history,
  }
}

export function fromBackupJson(value: unknown): AppData {
  if (!value || typeof value !== 'object') throw new Error('不是有效的备份文件')
  const raw = value as Partial<BackupJson> & Record<string, unknown>
  if (raw.类型 !== '全量备份') throw new Error('不是全量备份文件')
  if (!Array.isArray(raw.决策)) throw new Error('备份缺少决策数据')
  return {
    schemaVersion: typeof raw.格式版本 === 'number' ? raw.格式版本 : 1,
    settings: {
      ...createSettings(),
      ...(raw.设置 && typeof raw.设置 === 'object' ? raw.设置 : {}),
      backgroundImage: null,
    },
    folders: Array.isArray(raw.文件夹) ? raw.文件夹 : [],
    decisions: raw.决策,
    tagPresets: Array.isArray(raw.标签预设) ? raw.标签预设 : [],
    stats: Array.isArray(raw.统计) ? raw.统计 : [],
    history: Array.isArray(raw.历史) ? raw.历史 : [],
  }
}
