import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

import { IPC_CHANNELS } from '../shared/ipc';

let mainWindow: BrowserWindow | null = null;

function registerIpcHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.app.getVersion);
  ipcMain.handle(IPC_CHANNELS.app.getVersion, () => app.getVersion());

  ipcMain.removeAllListeners(IPC_CHANNELS.lifecycle.rendererReady);
  ipcMain.on(IPC_CHANNELS.lifecycle.rendererReady, () => {
    console.info('DeskHabitat renderer ready.');
  });
}

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 640,
    minHeight: 480,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`DeskHabitat preload failed: ${preloadPath}`, error);
  });

  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      console.error(`DeskHabitat renderer: ${details.message}`);
    } else if (details.level === 'warning') {
      console.warn(`DeskHabitat renderer: ${details.message}`);
    }
  });

  window.webContents.on('did-finish-load', () => {
    console.info('DeskHabitat document loaded.');
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  const developmentUrl = process.env['VITE_DEV_SERVER_URL'];

  if (developmentUrl !== undefined) {
    await window.loadURL(developmentUrl);
  } else {
    await window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return window;
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  mainWindow = await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow().then((window) => {
        mainWindow = window;
      });
    }
  });
}).catch((error: unknown) => {
  console.error('DeskHabitat failed to start.', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
