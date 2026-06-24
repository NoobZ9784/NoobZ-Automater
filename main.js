const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');

let nut = null;
try {
  nut = require('@nut-tree-fork/nut-js');
  nut.keyboard.config.autoDelayMs = 0;
  nut.mouse.config.autoDelayMs = 0;
} catch (err) {
  // Native module failed to load. Renderer will be told on play.
  console.error('Failed to load nut-js:', err.message);
}

let mainWindow = null;
let cancelRequested = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 560,
    minWidth: 300,
    minHeight: 420,
    frame: false,
    resizable: true,
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

// --- Window controls ---
ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window:toggle-pin', () => {
  if (!mainWindow) return false;
  const pinned = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(pinned);
  return pinned;
});

ipcMain.on('automation:cancel', () => {
  cancelRequested = true;
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Automation ---
ipcMain.handle('automation:play', async (event, opts) => {
  if (!nut) {
    return { ok: false, error: 'Native automation module (nut-js) is not available. Run "npm install".' };
  }
  const { keyboard, mouse, Key } = nut;

  const charDelay = Math.max(0, Number(opts.charDelay) || 0);
  const lineDelay = Math.max(0, Number(opts.lineDelay) || 0);
  const playDelay = Math.max(0, Number(opts.playDelay) || 0);
  const text = String(opts.text || '');

  cancelRequested = false;

  // Wait the play delay (seconds) so user can switch to target app.
  const totalMs = playDelay * 1000;
  const step = 100;
  for (let waited = 0; waited < totalMs; waited += step) {
    if (cancelRequested) return { ok: false, cancelled: true };
    const remaining = Math.ceil((totalMs - waited) / 1000);
    event.sender.send('automation:countdown', remaining);
    await sleep(Math.min(step, totalMs - waited));
  }
  event.sender.send('automation:countdown', 0);
  if (cancelRequested) return { ok: false, cancelled: true };

  // Click wherever the mouse currently is.
  try {
    await mouse.leftClick();
  } catch (e) {
    return { ok: false, error: 'Mouse click failed: ' + e.message };
  }

  await sleep(120);

  // Type character by character, preserving everything as-is.
  for (let i = 0; i < text.length; i++) {
    if (cancelRequested) return { ok: false, cancelled: true };

    const ch = text[i];

    // Handle CRLF / LF / CR as a single newline.
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++; // swallow paired LF
      await keyboard.type(Key.Enter);
      await sleep(lineDelay);
      continue;
    }
    if (ch === '\n') {
      await keyboard.type(Key.Enter);
      await sleep(lineDelay);
      continue;
    }
    if (ch === '\t') {
      await keyboard.type(Key.Tab);
      await sleep(charDelay);
      continue;
    }

    try {
      await keyboard.type(ch);
    } catch (e) {
      // Skip characters that can't be typed on the current layout.
    }
    await sleep(charDelay);
  }

  // Done -> native notification.
  if (Notification.isSupported()) {
    new Notification({
      title: 'NoobZ Automater',
      body: 'Task complete ✅'
    }).show();
  }

  return { ok: true };
});
