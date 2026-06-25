const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');

let nut = null;
try {
  nut = require('@nut-tree-fork/nut-js');
  // A small non-zero delay between key events is essential: with 0, keystrokes
  // fire faster than apps like VS Code can process, and they silently drop
  // characters (whole lines go missing). This is the minimum spacing between
  // key-down/up events; the per-character pacing is still controlled by the
  // user's Character delay on top of this.
  nut.keyboard.config.autoDelayMs = 8;
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
  const smartIndent = opts.smartIndent !== false; // VS Code auto-indent fix

  // After Enter, smart editors (e.g. VS Code) auto-insert indentation on the
  // new line. We remove it so our own leading whitespace doesn't stack on top.
  //
  // We are always typing at the END of the document, so a forward Delete can
  // never destroy text the user wrote — there is nothing to the right of the
  // cursor. So: select from the cursor back to column 0, then Delete.
  //   - Shift+Home is sent twice to defeat VS Code "smart home" (the first
  //     press can stop at the first non-whitespace column; the second always
  //     reaches column 0, selecting the whole auto-indent).
  //   - If the line has no auto-indent, the selection is empty and Delete is a
  //     no-op (nothing exists to the right at end-of-document).
  // Home/Shift+Home never cross a line boundary, so this can only ever affect
  // the freshly-created line, never the line above it.
  const clearAutoIndent = async () => {
    if (!smartIndent) return;
    try {
      // Hold Shift while pressing Home to actually select the auto-indent.
      // keyboard.type() presses & releases each key independently, so
      // type(Shift, Home) does NOT produce a Shift+Home combo — it just
      // presses Shift alone, then Home alone, selecting nothing.  Delete
      // then fires on an empty cursor at column 0 and joins the line with
      // the one above, which is why lines were being removed.
      await keyboard.pressKey(Key.LeftShift);
      await keyboard.type(Key.Home);
      await sleep(12);
      // Second Home to defeat VS Code "smart home" (first press may stop
      // at first non-whitespace column; second always reaches column 0).
      await keyboard.type(Key.Home);
      await keyboard.releaseKey(Key.LeftShift);
      await sleep(12);
      await keyboard.type(Key.Delete);
      await sleep(12);
    } catch (e) {}
  };

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

  // Give the target app time to receive focus before typing. Too short a
  // delay here causes the first line to be lost (the editor isn't ready yet).
  await sleep(350);

  // Characters that VS Code (and most editors) auto-close: when you type the
  // opening character, the editor inserts the closing one after the cursor.
  // We press Delete immediately to remove the ghost so it doesn't duplicate
  // when we type the real closing character later.
  const autoClosePairs = new Set(['(', '{', '[', '"', "'", '`']);

  // Type character by character, preserving everything as-is.
  for (let i = 0; i < text.length; i++) {
    if (cancelRequested) return { ok: false, cancelled: true };

    const ch = text[i];

    // Handle CRLF / LF / CR as a single newline.
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++; // swallow paired LF
      await keyboard.type(Key.Enter);
      await clearAutoIndent();
      await sleep(lineDelay);
      continue;
    }
    if (ch === '\n') {
      await keyboard.type(Key.Enter);
      await clearAutoIndent();
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

    // Remove the auto-closed character that the editor inserted.
    if (smartIndent && autoClosePairs.has(ch)) {
      await sleep(8);
      await keyboard.type(Key.Delete);
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
