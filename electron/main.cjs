const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = fs.promises

const isPackaged = app.isPackaged
const appRoot = path.join(__dirname, '..')
let dataDir = null
let mainWindow = null
let saveCounter = 0
let saveQueue = Promise.resolve()

async function initDataDir() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  const base = portableDir || (isPackaged ? path.dirname(app.getPath('exe')) : appRoot)
  const preferred = path.join(base, 'data')
  try {
    await fsp.mkdir(preferred, { recursive: true })
    dataDir = preferred
  } catch {
    dataDir = path.join(app.getPath('userData'), 'data')
    await fsp.mkdir(dataDir, { recursive: true })
  }
  return dataDir
}

async function ensureDataDir() {
  if (!dataDir) await initDataDir()
  await fsp.mkdir(dataDir, { recursive: true })
  return dataDir
}

function dataFile() {
  return path.join(dataDir, 'app-data.json')
}

function backupFile() {
  return path.join(dataDir, 'app-data.bak.json')
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function writeAtomic(file, text) {
  const temp = `${file}.${process.pid}.${Date.now()}.${++saveCounter}.tmp`
  await fsp.writeFile(temp, text, 'utf8')
  try {
    await fsp.copyFile(file, backupFile())
  } catch {
    // 第一次保存没有旧文件
  }
  await fsp.rename(temp, file)
}

function backgroundDataUrl(buffer, ext) {
  const mime = ext === 'jpg' ? 'image/jpeg' : 'image/png'
  return `data:${mime};base64,${buffer.toString('base64')}`
}

ipcMain.handle('app:load', async () => {
  await ensureDataDir()
  return readJson(dataFile())
})

ipcMain.handle('app:save', async (_event, data) => {
  await ensureDataDir()
  const text = JSON.stringify(data, null, 2)
  // 串行化写入：取色器等高频保存不能同时抢同一个临时文件。
  const task = saveQueue.then(() => writeAtomic(dataFile(), text))
  saveQueue = task.catch(() => {})
  await task
  return true
})

ipcMain.handle('background:load', async () => {
  await ensureDataDir()
  for (const ext of ['png', 'jpg']) {
    try {
      const buffer = await fsp.readFile(path.join(dataDir, `background.${ext}`))
      return backgroundDataUrl(buffer, ext)
    } catch {
      // 尝试另一种扩展名
    }
  }
  return null
})

ipcMain.handle('background:save', async (_event, arrayBuffer, ext) => {
  await ensureDataDir()
  const clean = ext === 'png' ? 'png' : 'jpg'
  const buffer = Buffer.from(arrayBuffer)
  for (const item of ['png', 'jpg']) {
    try {
      await fsp.unlink(path.join(dataDir, `background.${item}`))
    } catch {
      // 文件不存在
    }
  }
  await fsp.writeFile(path.join(dataDir, `background.${clean}`), buffer)
  return backgroundDataUrl(buffer, clean)
})

ipcMain.handle('background:clear', async () => {
  await ensureDataDir()
  for (const ext of ['png', 'jpg']) {
    try {
      await fsp.unlink(path.join(dataDir, `background.${ext}`))
    } catch {
      // 文件不存在
    }
  }
  return true
})

ipcMain.handle('file:export', async (_event, name, content) => {
  const win = mainWindow ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), name),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return false
  await fsp.writeFile(result.filePath, content, 'utf8')
  return true
})

ipcMain.handle('file:import', async () => {
  const win = mainWindow ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return fsp.readFile(result.filePaths[0], 'utf8')
})

ipcMain.handle('app:dataPath', async () => {
  await ensureDataDir()
  return dataDir
})

ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
  return true
})

ipcMain.handle('window:toggle-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return win.isMaximized()
})

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
  return true
})

ipcMain.handle('window:is-maximized', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '随机决策工具',
    frame: false,
    backgroundColor: '#eaf4fd',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  mainWindow.setMenuBarVisibility(false)

  const devUrl = process.env.VITE_DEV_SERVER_URL
  const indexFile = path.join(appRoot, 'dist', 'index.html')
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else if (fs.existsSync(indexFile)) {
    void mainWindow.loadFile(indexFile)
  } else {
    void mainWindow.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent('<h2 style="font-family:sans-serif">请先运行构建（dist 不存在）</h2>'),
    )
  }

  if (process.env.DSH_CAPTURE_PATH) {
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500))
      try {
        const image = await mainWindow.webContents.capturePage()
        fs.writeFileSync(process.env.DSH_CAPTURE_PATH, image.toPNG())
      } catch (error) {
        console.error('capture failed', error)
      }
      app.quit()
    })
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.randomdecider.tool')
    await initDataDir()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
