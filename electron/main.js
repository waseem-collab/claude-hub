'use strict';
// Claude Hub desktop app: runs the hub server inside the app and shows it in a native window.

const { app, BrowserWindow, Menu, shell, nativeTheme, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = Number(process.env.PORT) || 4777;
const URL_BASE = `http://localhost:${PORT}`;
const ICON = path.join(__dirname, 'icons', '512.png');
const AUTOSTART_FILE = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'claude-hub.desktop');

app.setName('Claude Hub');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null;
let ownServer = null; // set when this app started the server (vs. reusing one already running)

// ------------------------------------------------------------------ server

function ping() {
  return new Promise(resolve => {
    const req = http.get(`${URL_BASE}/`, { timeout: 800 }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  if (await ping()) return; // a hub server is already running (e.g. started from a terminal): reuse it
  process.env.PORT = String(PORT);
  ownServer = require(path.join(__dirname, '..', 'server.js'));
  await ownServer.start();
}

// ------------------------------------------------------------------ window

const stateFile = () => path.join(app.getPath('userData'), 'window.json');

function loadBounds() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return { width: 1280, height: 860 }; }
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch { /* not critical */ }
}

function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    ...b,
    minWidth: 700,
    minHeight: 480,
    title: 'Claude Hub',
    icon: ICON,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#262624' : '#faf9f5',
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true },
  });
  if (b.maximized) win.maximize();
  win.loadURL(`${URL_BASE}/`);
  win.once('ready-to-show', () => {
    // HUB_CAPTURE=<file.png>: render once, save a screenshot and quit (used for testing)
    if (process.env.HUB_CAPTURE) {
      setTimeout(async () => {
        fs.writeFileSync(process.env.HUB_CAPTURE, (await win.webContents.capturePage()).toPNG());
        app.quit();
      }, 3500);
      return;
    }
    win.show();
  });
  win.on('close', saveBounds);
  win.on('closed', () => { win = null; });

  // Links leave the app: open them in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(URL_BASE)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  // The page may show notifications and write to the clipboard (Copy buttons); nothing else.
  const ALLOWED = new Set(['notifications', 'clipboard-sanitized-write']);
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED.has(permission)));
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission));
}

// ------------------------------------------------------------------ open at login (XDG autostart)

function launchCommand() {
  // Packaged: the app binary. From source: electron + this folder.
  if (process.env.APPIMAGE) return `"${process.env.APPIMAGE}"`;
  return app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${path.join(__dirname, '..')}"`;
}

const autostartEnabled = () => fs.existsSync(AUTOSTART_FILE);

function setAutostart(on) {
  if (!on) { fs.rmSync(AUTOSTART_FILE, { force: true }); return; }
  fs.mkdirSync(path.dirname(AUTOSTART_FILE), { recursive: true });
  fs.writeFileSync(AUTOSTART_FILE, [
    '[Desktop Entry]', 'Type=Application', 'Name=Claude Hub', 'Comment=All your Claude Code sessions in one window',
    `Exec=${launchCommand()}`, `Icon=${ICON}`, 'Terminal=false', 'X-GNOME-Autostart-enabled=true', '',
  ].join('\n'));
}

function buildMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Claude Hub',
      submenu: [
        { label: 'New chat', accelerator: 'CmdOrCtrl+N', click: () => win && win.webContents.executeJavaScript("location.hash = '#/new'") },
        { type: 'separator' },
        { label: 'Open at login', type: 'checkbox', checked: autostartEnabled(), click: item => setAutostart(item.checked) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

// ------------------------------------------------------------------ lifecycle

app.on('second-instance', () => {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(async () => {
  try {
    await ensureServer();
  } catch (e) {
    dialog.showErrorBox('Claude Hub could not start', `${e.message}\n\nPort ${PORT} may be used by another program.`);
    app.exit(1);
    return;
  }
  // First run: open at login by default (can be turned off from the menu).
  const flag = path.join(app.getPath('userData'), 'autostart-initialized');
  if (!fs.existsSync(flag)) { setAutostart(true); fs.writeFileSync(flag, ''); }
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { saveBounds(); if (ownServer) ownServer.stopHosts(); });
