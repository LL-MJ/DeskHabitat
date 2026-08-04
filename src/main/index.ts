import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  Tray,
  type Display,
} from 'electron';
import path from 'node:path';

import { IPC_CHANNELS } from '../shared/ipc';
import { isSaveSnapshot, type AppSettings } from '../shared/save';
import {
  defaultPointerPassthrough,
  isWindowMode,
  type AppCommand,
  type DisplayInfo,
  type WindowLayer,
  type WindowMode,
  type WindowState,
} from '../shared/window';
import { PersistenceService } from './persistence';
import { AppLogger, type LogLevel } from './logger';

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
let targetDisplayId: number | null = null;
let currentMaxFps: 30 | 60 = 30;
let pointerPassthrough = true;
let isQuitting = false;
let persistence: PersistenceService | null = null;
let logger: AppLogger | null = null;
let quitSaveTimer: NodeJS.Timeout | null = null;
let quitSavePending = false;
let rendererRecoveryAttempts = 0;
let rendererRecoveryTimer: NodeJS.Timeout | null = null;

const debugWindow =
  !app.isPackaged && process.env['DESK_HABITAT_DESKTOP_WINDOW'] !== '1';

function report(level: LogLevel, message: string, details?: unknown): void {
  if (level === 'error') console.error(message, details ?? '');
  else if (level === 'warn') console.warn(message, details ?? '');
  else console.info(message, details ?? '');
  logger?.write(level, message, details);
}

function toDisplayInfo(display: Display): DisplayInfo {
  return {
    id: display.id,
    label: display.label || `显示器 ${display.id}`,
    scaleFactor: display.scaleFactor,
    bounds: { ...display.bounds },
    workArea: { ...display.workArea },
  };
}

function getTargetDisplay(): Display {
  return (
    screen.getAllDisplays().find((display) => display.id === targetDisplayId) ??
    screen.getPrimaryDisplay()
  );
}

function getDisplayInfo(): DisplayInfo {
  const display = mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : getTargetDisplay();
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
    try {
      mainWindow.webContents.send(IPC_CHANNELS.events.command, command);
    } catch (error: unknown) {
      report('warn', 'DeskHabitat could not deliver a renderer command.', error);
    }
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

  report('info', `DeskHabitat mode changed to ${mode}.`);
  return getWindowState();
}

function applyLayer(): void {
  if (!mainWindow) return;
  mainWindow.setAlwaysOnTop(
    !debugWindow && currentLayer === 'overlay',
    'floating',
  );
}

function finishApplicationQuit(): void {
  if (quitSaveTimer) clearTimeout(quitSaveTimer);
  quitSaveTimer = null;
  quitSavePending = false;
  isQuitting = true;
  app.quit();
}

function requestApplicationQuit(): void {
  if (quitSavePending || isQuitting) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    finishApplicationQuit();
    return;
  }
  quitSavePending = true;
  sendCommand({ type: 'save-requested' });
  quitSaveTimer = setTimeout(() => {
    report('warn', 'DeskHabitat quit save timed out; continuing shutdown.');
    finishApplicationQuit();
  }, 1_500);
}

function setLayer(layer: WindowLayer): void {
  currentLayer = layer;
  applyLayer();
  rebuildTrayMenu();
  broadcastState();
  void persistence?.updateSettings({ layer }).catch((error: unknown) => {
    report('warn', 'DeskHabitat failed to persist window layer.', error);
  });
}

function updateWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (debugWindow) {
    const { workArea } = getTargetDisplay();
    mainWindow.setBounds({
      x: workArea.x + Math.round((workArea.width - DEBUG_WINDOW_SIZE.width) / 2),
      y: workArea.y + Math.round((workArea.height - DEBUG_WINDOW_SIZE.height) / 2),
      ...DEBUG_WINDOW_SIZE,
    });
  } else {
    mainWindow.setBounds(getTargetDisplay().workArea);
  }

  const display = getDisplayInfo();
  sendCommand({ type: 'display-changed', display });
  report(
    'info',
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
      label: '目标显示器',
      submenu: screen.getAllDisplays().map((display) => ({
        label: toDisplayInfo(display).label,
        type: 'radio' as const,
        checked: getTargetDisplay().id === display.id,
        click: () => setTargetDisplay(display.id),
      })),
    },
    {
      label: '置于普通窗口上方',
      type: 'checkbox',
      checked: currentLayer === 'overlay',
      click: (item) => setLayer(item.checked ? 'overlay' : 'desktop'),
    },
    {
      label: '生活模式帧率',
      submenu: ([30, 60] as const).map((maxFps) => ({
        label: `${maxFps} FPS`,
        type: 'radio' as const,
        checked: currentMaxFps === maxFps,
        click: () => setMaxFps(maxFps),
      })),
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
    {
      label: '使用提示',
      click: showGettingStarted,
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
      click: requestApplicationQuit,
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
  ipcMain.handle(IPC_CHANNELS.save.load, async () => {
    if (!persistence) throw new Error('Persistence service is not ready.');
    const result = await persistence.loadSave();
    report(
      result.source === 'primary' ? 'info' : 'warn',
      `DeskHabitat save loaded from ${result.source}.`,
    );
    return result;
  });
  ipcMain.handle(
    IPC_CHANNELS.save.write,
    async (_event, snapshot: unknown) => {
      if (!persistence) throw new Error('Persistence service is not ready.');
      if (!isSaveSnapshot(snapshot)) {
        throw new TypeError('Invalid DeskHabitat save snapshot.');
      }
      const result = await persistence.writeSave(snapshot, app.getVersion());
      report('info', `DeskHabitat save completed at ${result.savedAt}.`);
      return result;
    },
  );
  ipcMain.handle(IPC_CHANNELS.settings.load, async () => {
    if (!persistence) throw new Error('Persistence service is not ready.');
    return persistence.loadSettings();
  });
  ipcMain.handle(
    IPC_CHANNELS.settings.update,
    async (_event, patch: unknown) => {
      if (!persistence) throw new Error('Persistence service is not ready.');
      if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
        throw new TypeError('Invalid DeskHabitat settings patch.');
      }
      return persistence.updateSettings(
        patch as Partial<Omit<AppSettings, 'schemaVersion'>>,
      );
    },
  );
  ipcMain.on(
    IPC_CHANNELS.diagnostics.log,
    (_event, level: unknown, message: unknown) => {
      if (
        (level !== 'warn' && level !== 'error') ||
        typeof message !== 'string'
      ) {
        report('warn', 'DeskHabitat rejected an invalid diagnostic message.');
        return;
      }
      report(level, 'Renderer diagnostic', message.slice(0, 6_000));
    },
  );
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
    report('info', 'DeskHabitat renderer ready.');
    broadcastState();
  });
  ipcMain.on(IPC_CHANNELS.lifecycle.saveComplete, () => {
    if (quitSavePending) finishApplicationQuit();
  });
}

function setMaxFps(maxFps: 30 | 60): void {
  currentMaxFps = maxFps;
  sendCommand({ type: 'performance-settings-changed', maxFps });
  rebuildTrayMenu();
  void persistence?.updateSettings({ maxFps }).catch((error: unknown) => {
    report('warn', 'DeskHabitat failed to persist the frame-rate limit.', error);
  });
}

function showGettingStarted(): void {
  tray?.displayBalloon({
    iconType: 'info',
    title: 'DeskHabitat 已在桌面运行',
    content: '右键托盘图标可进入布置模式；遇到输入问题可选择“强制恢复鼠标穿透”。',
  });
}

function setTargetDisplay(displayId: number): void {
  if (!screen.getAllDisplays().some((display) => display.id === displayId)) return;
  targetDisplayId = displayId;
  void persistence
    ?.updateSettings({ targetDisplayId: displayId })
    .catch((error: unknown) => {
      report('warn', 'DeskHabitat failed to persist target display.', error);
    });
  updateWindowBounds();
  rebuildTrayMenu();
}

function registerDisplayListeners(): void {
  const handleDisplayChange = () => {
    if (
      targetDisplayId !== null &&
      !screen.getAllDisplays().some((display) => display.id === targetDisplayId)
    ) {
      targetDisplayId = null;
      void persistence
        ?.updateSettings({ targetDisplayId: null })
        .catch((error: unknown) => {
          report('warn', 'DeskHabitat failed to reset a missing display.', error);
        });
    }
    if (currentMode === 'build') setMode('life');
    else setPointerPassthrough(true);
    updateWindowBounds();
    rebuildTrayMenu();
  };
  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
  screen.on('display-metrics-changed', handleDisplayChange);
}

function registerPowerListeners(): void {
  const enterSafeState = () => {
    setPointerPassthrough(true);
    sendCommand({ type: 'save-requested' });
  };
  const restoreAfterResume = () => {
    setMode('life');
    updateWindowBounds();
    sendCommand({ type: 'system-resumed' });
    report('info', 'DeskHabitat restored after system resume.');
  };
  powerMonitor.on('suspend', enterSafeState);
  powerMonitor.on('lock-screen', enterSafeState);
  powerMonitor.on('resume', restoreAfterResume);
  powerMonitor.on('unlock-screen', restoreAfterResume);
}

async function createMainWindow(): Promise<BrowserWindow> {
  const initialBounds = debugWindow
    ? DEBUG_WINDOW_SIZE
    : getTargetDisplay().workArea;
  const window = new BrowserWindow({
    ...initialBounds,
    ...(debugWindow ? { minWidth: 640, minHeight: 480 } : {}),
    show: false,
    // The development window deliberately keeps the native frame so M2
    // resize behaviour can be tested with ordinary Windows resize handles.
    // The real desktop habitat remains transparent and frameless.
    frame: debugWindow,
    transparent: !debugWindow,
    backgroundColor: debugWindow ? '#20262a' : '#00000000',
    skipTaskbar: !debugWindow,
    resizable: debugWindow,
    movable: debugWindow,
    hasShadow: debugWindow,
    focusable: debugWindow,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = window;
  if (!debugWindow) {
    // Windows may retain an opaque DWM backdrop for a frameless window even
    // when Chromium's guest page is transparent. Disable that backdrop and
    // explicitly keep the native surface transparent.
    try {
      window.setBackgroundMaterial('none');
    } catch (error: unknown) {
      report('warn', 'DeskHabitat could not disable the Windows backdrop.', error);
    }
    window.setBackgroundColor('rgba(0, 0, 0, 0)');
  }
  updateWindowBounds();
  applyLayer();
  window.setIgnoreMouseEvents(true, { forward: true });

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    report('error', `DeskHabitat preload failed: ${preloadPath}`, error);
  });
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      report('error', 'DeskHabitat renderer console error.', details.message);
    } else if (details.level === 'warning') {
      report('warn', 'DeskHabitat renderer console warning.', details.message);
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    setPointerPassthrough(true);
    report('error', `DeskHabitat renderer exited: ${details.reason}.`, details);
    if (isQuitting || rendererRecoveryAttempts >= 2) return;
    rendererRecoveryAttempts += 1;
    if (rendererRecoveryTimer) clearTimeout(rendererRecoveryTimer);
    rendererRecoveryTimer = setTimeout(() => {
      rendererRecoveryTimer = null;
      if (!window.isDestroyed()) window.webContents.reload();
    }, 500);
  });
  window.on('unresponsive', () => {
    setPointerPassthrough(true);
    report('warn', 'DeskHabitat renderer became unresponsive.');
  });
  window.on('responsive', () => {
    report('info', 'DeskHabitat renderer recovered responsiveness.');
  });
  window.on('blur', () => {
    if (currentMode === 'build') setMode('life');
    else setPointerPassthrough(true);
  });
  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
    if (rendererRecoveryTimer) clearTimeout(rendererRecoveryTimer);
    rendererRecoveryTimer = null;
  });
  window.once('ready-to-show', () => {
    if (!debugWindow) window.setBackgroundColor('rgba(0, 0, 0, 0)');
    window.showInactive();
  });

  await window.loadFile(path.join(__dirname, '../renderer/index.html'));
  return window;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

process.on('unhandledRejection', (reason: unknown) => {
  if (app.isReady()) setPointerPassthrough(true);
  else pointerPassthrough = true;
  report('error', 'DeskHabitat main process rejected a promise.', reason);
});

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
      logger = new AppLogger(app.getPath('userData'));
      await logger.initialize().catch((error: unknown) => {
        console.warn('DeskHabitat logger initialization failed.', error);
      });
      report('info', `DeskHabitat ${app.getVersion()} starting.`);
      persistence = new PersistenceService(app.getPath('userData'));
      const settings = await persistence.loadSettings();
      currentLayer = settings.layer;
      targetDisplayId = settings.targetDisplayId;
      currentMaxFps = settings.maxFps;
      registerIpcHandlers();
      registerDisplayListeners();
      registerPowerListeners();
      createTray();
      if (!settings.onboardingComplete) {
        showGettingStarted();
        await persistence.updateSettings({ onboardingComplete: true });
      }
      await createMainWindow();

      if (debugWindow) {
        globalShortcut.register('CommandOrControl+Shift+P', () => {
          setPointerPassthrough(true);
        });
      }
    })
    .catch((error: unknown) => {
      report('error', 'DeskHabitat failed to start.', error);
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
  if (rendererRecoveryTimer) clearTimeout(rendererRecoveryTimer);
  void logger?.flush();
});
