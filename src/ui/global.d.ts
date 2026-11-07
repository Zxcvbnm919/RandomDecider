export {}

declare global {
  interface Window {
    desktop?: {
      load: () => Promise<unknown>
      save: (data: unknown) => Promise<boolean>
      loadBackground: () => Promise<string | null>
      saveBackground: (buffer: ArrayBuffer, ext: string) => Promise<string | null>
      clearBackground: () => Promise<boolean>
      exportFile: (name: string, content: string) => Promise<boolean>
      importFile: () => Promise<string | null>
      getDataPath: () => Promise<string>
      windowMinimize: () => Promise<boolean>
      windowToggleMaximize: () => Promise<boolean>
      windowClose: () => Promise<boolean>
      windowIsMaximized: () => Promise<boolean>
    }
  }
}
