import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
  type Display,
} from 'electron';
import path from 'node:path';

import { IPC_CHANNELS } from '../shared/ipc';
import {
  defaultPointerPassthrough,
  isWindowMode,
  type AppCommand,
  type DisplayInfo,
  type WindowLayer,
  type WindowMode,
  type WindowState,
} from '../shared/window';

const DEBUG_WINDOW_SIZE = { width: 900, height: 600 };
const TRAY_ICON_DATA_URL =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="17" r="12" fill="#78a98d"/><path d="M9 10C7 3 12 1 14 10M18 10c2-7 7-7 5 1" fill="#b9d8c3" stroke="#416c58" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1.5" fill="#203c30"/><circle cx="20" cy="16" r="1.5" fill="#203c30"/><path d="M14 21c1.5 1 2.5 1 4 0" fill="none" stroke="#203c30" stroke-width="1.5" stroke-linecap="round"/></svg>',
  );

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let currentMode: WindowMode = 'life';
let currentLayer: WindowLayer = 'overlay';
let pointerPassthrough = true;
let isQuitting = false;

const debugWindow =
  !app.isPackaged && process.env['DESK_HABITAT_DESKTOP_WINDOW'] !== '1';

function toDisplayInfo(display: Display): DisplayInfo {
  return {
    id: display.id,
    label: display.label || `显示器 ${display.id}`,
    scaleFactor: display.scaleFactor,
    bounds: { ...display.bounds },
    workArea: { ...display.workArea },
  };
}

function getDisplayInfo(): DisplayInfo {
  const display = mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  return toDisplayInfo(display);
}

function getWindowState(): WindowState {
  return {
    mode: currentMode,
    layer: currentLayer,
    pointerPassthrough,
    display: getDisplayInfo(),
    debugWindow,
  };
}

function sendCommand(command: AppCommand): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.events.command, command);
  }
}

function broadcastState(): void {
  sendCommand({ type: 'state-changed', state: getWindowState() });
}

function setPointerPassthrough(enabled: boolean): WindowState {
  pointerPassthrough = enabled;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(enabled, { forward: true });
    mainWindow.setFocusable(!enabled);
  }
  rebuildTrayMenu();
  broadcastState();
  return getWindowState();
}

function setMode(mode: WindowMode): WindowState {
  currentMode = mode;
  setPointerPassthrough(defaultPointerPassthrough(mode));

  if (mode === 'build' && mainWindow) {
    mainWindow.showInactive();
    mainWindow.focus();
  }

  console.info(`DeskHabitat mode changed to ${mode}.`);
  return getWindowState();
}

function applyLayer(): void {
  if (!mainWindow) return;
  mainWindow.setAlwaysOnTop(currentLayer === 'overlay', 'floating');
}

function setLayer(layer: WindowLayer): void {
  currentLayer = layer;
  applyLayer();
  rebuildTrayMenu();
  broadcastState();
}

function updateWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (debugWindow) {
    const { workArea } = screen.getPrimaryDisplay();
    mainWindow.setBounds({
      x: workArea.x + Math.round((workArea.width - DEBUG_WINDOW_SIZE.width) / 2),
      y: workArea.y + Math.round((workArea.height - DEBUG_WINDOW_SIZE.height) / 2),
      ...DEBUG_WINDOW_SIZE,
    });
  } else {
    mainWindow.setBounds(screen.getPrimaryDisplay().workArea);
  }

  const display = getDisplayInfo();
  sendCommand({ type: 'display-changed', display });
  console.info(
    `DeskHabitat display updated: ${display.label}, ${display.workArea.width}x${display.workArea.height} @ ${display.scaleFactor}.`,
  );
}

function rebuildTrayMenu(): void {
  if (!tray) return;

  const menu = Menu.buildFromTemplate([
    {
      label: '生活模式',
      type: 'radio',
      checked: currentMode === 'life',
      click: () => setMode('life'),
    },
    {
      label: '布置模式',
      type: 'radio',
      checked: currentMode === 'build',
      click: () => setMode('build'),
    },
    {
      label: currentMode === 'paused' ? '继续生活' : '暂停',
      type: 'checkbox',
      checked: currentMode === 'paused',
      click: () => setMode(currentMode === 'paused' ? 'life' : 'paused'),
    },
    { type: 'separator' },
    {
      label: '置于普通窗口上方',
      type: 'checkbox',
      checked: currentLayer === 'overlay',
      click: (item) => setLayer(item.checked ? 'overlay' : 'desktop'),
    },
    {
      label: '强制恢复鼠标穿透',
      enabled: !pointerPassthrough,
      click: () => setPointerPassthrough(true),
    },
    {
      label: '重置窗口位置',
      click: updateWindowBounds,
    },
    ...(debugWindow
      ? [
          { type: 'separator' as const },
          {
            label: '打开开发者工具',
            click: () => mainWindow?.webContents.openDevTools({ mode: 'detach' }),
          },
        ]
      : []),
    { type: 'separator' },
    {
      label: '退出 DeskHabitat',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
}

function createTray(): void {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL).resize({
    width: 16,
    height: 16,
  });
  tray = new Tray(icon);
  tray.setToolTip('DeskHabitat');
  tray.on('click', () => tray?.popUpContextMenu());
  rebuildTrayMenu();
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.app.getVersion, () => app.getVersion());
  ipcMain.handle(IPC_CHANNELS.window.getState, () => getWindowState());
  ipcMain.handle(IPC_CHANNELS.window.getDisplayInfo, () => getDisplayInfo());
  ipcMain.handle(IPC_CHANNELS.window.setMode, (_event, mode: unknown) => {
    if (!isWindowMode(mode)) throw new TypeError('Invalid DeskHabitat window mode.');
    return setMode(mode);
  });
  ipcMain.handle(
    IPC_CHANNELS.window.setPointerPassthrough,
    (_event, enabled: unknown) => {
      if (typeof enabled !== 'boolean') {
        throw new TypeError('Pointer passthrough must be a boolean.');
      }
      return setPointerPassthrough(enabled);
    },
  );
  ipcMain.on(IPC_CHANNELS.lifecycle.rendererReady, () => {
    console.info('DeskHabitat renderer ready.');
    broadcastState();
  });
}

function registerDisplayListeners(): void {
  const handleDisplayChange = () => updateWindowBounds();
  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
  screen.on('display-metrics-changed', handleDisplayChange);
}

async function createMainWindow(): Promise<BrowserWindow> {
  const initialBounds = debugWindow
    ? DEBUG_WINDOW_SIZE
    : screen.getPrimaryDisplay().workArea;
  const window = new BrowserWindow({
    ...initialBounds,
    ...(debugWindow ? { minWidth: 640, minHeight: 480 } : {}),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    resizable: debugWindow,
    movable: debugWindow,
    hasShadow: debugWindow,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = window;
  updateWindowBounds();
  applyLayer();
  window.setIgnoreMouseEvents(true, { forward: true });

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`DeskHabitat preload failed: ${preloadPath}`, error);
  });
  window.webContents.on('render-process-gone', () => {
    setPointerPassthrough(true);
  });
  window.on('blur', () => {
    if (currentMode !== 'build') setPointerPassthrough(true);
  });
  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.once('ready-to-show', () => window.showInactive());

  await window.loadFile(path.join(__dirname, '../renderer/index.html'));
  return window;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.showInactive();
      updateWindowBounds();
    }
  });

  app
    .whenReady()
    .then(async () => {
      registerIpcHandlers();
      registerDisplayListeners();
      createTray();
      await createMainWindow();

      if (debugWindow) {
        globalShortcut.register('CommandOrControl+Shift+P', () => {
          setPointerPassthrough(true);
        });
      }
    })
    .catch((error: unknown) => {
      console.error('DeskHabitat failed to start.', error);
      app.quit();
    });
}

app.on('activate', () => {
  if (mainWindow) mainWindow.showInactive();
});
app.on('window-all-closed', () => {
  // The tray owns the application lifecycle on Windows.
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
