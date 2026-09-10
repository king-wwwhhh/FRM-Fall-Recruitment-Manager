'use strict';
// E2E 冒烟：主进程侧驱动器
// 用法：SMOKE_ONLY=1,2 npx electron smoke.js   （SMOKE_ONLY 缺省=跑全部）
// 数据沙箱：跑之前备份 data/deliveries.json，用默认空库跑断言，结束后还原
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const deliveryStore = require('./lib/deliveryStore');

// 无头/远程环境下 GPU 进程不可用会中断页面加载，冒烟只做 DOM 断言，强制软渲染
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('use-angle', 'swiftshader');

// 冒烟进程不跑 main.js，这里注册渲染层依赖的 IPC（逻辑与 main.js 保持一致）
ipcMain.handle('events:list', async () => ({ ok: true, events: [], sync: null }));
ipcMain.handle('deliveries:get', async () => ({ ok: true, data: deliveryStore.load() }));
ipcMain.handle('deliveries:save', async (_e, db) => {
  try {
    if (!db || !Array.isArray(db.fields) || !Array.isArray(db.rows)) throw new Error('投递数据结构非法');
    deliveryStore.save({ fields: db.fields, rows: db.rows });
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

const DB = path.join(__dirname, 'data', 'deliveries.json');
const checksPath = path.join(__dirname, 'test', 'smoke-checks.js');

app.whenReady().then(async () => {
  // ---- 数据沙箱：备份现库，写入空默认库 ----
  let backup = null, hadFile = false;
  try {
    if (fs.existsSync(DB)) { backup = fs.readFileSync(DB, 'utf8'); hadFile = true; }
  } catch (e) {}
  const def = deliveryStore.defaultDb(); // 沙箱库直接用默认结构（与 lib 保持单一来源）
  try { fs.mkdirSync(path.dirname(DB), { recursive: true }); fs.writeFileSync(DB, JSON.stringify(def, null, 2)); } catch (e) {}

  const win = new BrowserWindow({
    // 窗口需可见：隐藏窗口里 DOM 元素拿不到焦点，Task6 的 focus 断言会假失败
    show: true, width: 1280, height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // SMOKE_ONLY 白名单：保留原始字符串（支持 'A' 这类非数字任务号），同时提供数字比较
  const onlyRaw = (process.env.SMOKE_ONLY || '').split(',').filter(Boolean);
  const only = onlyRaw.map(v => /^\d+$/.test(v) ? Number(v) : v);
  const script = 'window.__SMOKE_ONLY=' + JSON.stringify(only) + ';\n' +
    fs.readFileSync(checksPath, 'utf8');
  let results;
  try {
    results = await win.webContents.executeJavaScript(script, true);
  } catch (e) {
    console.log('[smoke] 渲染层脚本执行异常: ' + e.message);
    results = [{ task: 0, name: '脚本可执行', pass: false, msg: e.message }];
  }

  // ---- 按任务分组输出 ----
  const byTask = {};
  let fails = 0;
  for (const r of results) {
    byTask[r.task] = byTask[r.task] || [];
    byTask[r.task].push(r);
    if (!r.pass) fails++;
  }
  for (const t of Object.keys(byTask).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))) {
    console.log('===== E2E Task ' + t + ' =====');
    for (const r of byTask[t]) {
      console.log((r.pass ? '  PASS ' : '  FAIL ') + r.name + (r.msg ? '  [msg] ' + r.msg : ''));
    }
  }
  console.log(fails === 0 ? '[smoke] E2E 全部通过' : '[smoke] E2E 有 ' + fails + ' 项失败');

  // ---- 还原数据 ----
  try {
    if (hadFile) fs.writeFileSync(DB, backup); else fs.unlinkSync(DB);
  } catch (e) {}

  app.exit(fails === 0 ? 0 : 1);
});
