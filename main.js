'use strict';
// 秋招管家 · 主进程

// ===== TLS 兼容开关（必须尽早执行，早于任何 HTTPS / IMAP 连接）=====
// 现象：网络出口存在中间人代理（公司网关 / 本地代理软件对 HTTPS 解密再加密）时，
// Node 侧的 IMAP 与 HTTPS 请求会报 "self signed certificate in certificate chain"。
// 处理：config.json 设 "tlsInsecure": true（或环境变量 RM_TLS_INSECURE=1）即跳过证书链校验。
// 代价：不再校验证书有效性，请仅在可信网络下开启。
(function applyTlsCompat() {
  const fs = require('fs');
  const path = require('path');
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    if (cfg.tlsInsecure === true) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  } catch (e) { /* config.json 不存在或格式异常：保持默认严格校验 */ }
  if (process.env.RM_TLS_INSECURE === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
})();

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./lib/store');
const imap = require('./lib/imapFetch');
const llm = require('./lib/llm');
const deliveryStore = require('./lib/deliveryStore');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: '秋招管家',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 前端 <a download> 触发时弹出系统保存对话框（Task 6 会用系统对话框，这里先兜底，避免导出静默失败）
  win.webContents.session.on('will-download', (_e, item) => {
    const p = dialog.showSaveDialogSync(win, { defaultPath: item.getFilename() });
    if (p) item.setSavePath(p);
    else item.cancel();
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ===== 配置 IPC（Task 1）=====
ipcMain.handle('config:get', async () => {
  const cfg = imap.loadConfig();
  return { ok: true, config: cfg || null };
});
ipcMain.handle('config:save', async (_e, cfg) => {
  try {
    if (!cfg || typeof cfg !== 'object') throw new Error('配置格式错误');
    // 只保存白名单字段，避免前端注入垃圾键
    const clean = {};
    ['user', 'auth', 'llmBase', 'llmKey', 'llmModel', 'recentDays', 'autoRefresh'].forEach(k => {
      if (cfg[k] !== undefined && cfg[k] !== null && cfg[k] !== '') clean[k] = cfg[k];
    });
    // 合并进现有配置（不清掉未提交的字段）
    const old = imap.loadConfig() || {};
    imap.saveConfig(Object.assign({}, old, clean));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});
// 测试：可选传入"内存中未保存的表单值"，测试不落盘（只有点保存才写 config.json）
ipcMain.handle('config:testMail', async (_e, cfgOverride) => imap.pingServer(cfgOverride));
ipcMain.handle('config:testLLM', async (_e, cfgOverride) => {
  const cfg = cfgOverride || imap.loadConfig();
  if (!cfg || !cfg.llmKey) return { ok: false, error: '请先在设置里填写解析服务密钥' };
  return llm.ping(cfg);
});

// ===== 事件 IPC（Task 0 起接真 store；Task 4/5 细化为按 id 操作）=====
ipcMain.handle('events:list', async () => {
  const db = store.load();
  return {
    ok: true,
    events: db.events || [],
    sync: { lastSyncAt: db.lastSyncAt || null, lastUid: db.lastUid || 0, seenCount: (db.seenUids || []).length }
  };
});
// 批量回写（前端兜底）：按 id 合并而不是整表覆盖，避免误伤 mail:refresh 流水线刚入库的新事件
ipcMain.handle('events:saveAll', async (_e, events) => {
  const db = store.load();
  if (Array.isArray(events)) {
    const byId = new Map(db.events.map(e => [e.id, e]));
    events.forEach(ev => { if (ev && ev.id != null) byId.set(ev.id, ev); });
    db.events = Array.from(byId.values());
    store.save(db);
  }
  return { ok: true, count: db.events.length };
});
// Task 4：完成(done)/恢复(revert) 共用一个状态接口
ipcMain.handle('events:setStatus', async (_e, id, status) => {
  const db = store.load();
  const ok = store.setStatus(db, id, status);
  return { ok, count: db.events.length };
});
// Task 4：彻底删除
ipcMain.handle('events:remove', async (_e, id) => {
  const db = store.load();
  const removed = store.removeEvent(db, id);
  return { ok: true, removed, count: db.events.length };
});
// Task 4：改事件字段（patch 只合并给定键，不动其它字段）
ipcMain.handle('events:patch', async (_e, id, patch) => {
  const db = store.load();
  const ev = db.events.find(e => e.id === id);
  if (!ev) return { ok: false, error: '事件不存在或已被删除' };
  if (patch && typeof patch === 'object') Object.assign(ev, patch);
  store.save(db);
  return { ok: true, count: db.events.length };
});
// Task 5：手动添加（按 id 去重；且同公司+同类型+同考试时间 未完成 → 视为重复不入库）
ipcMain.handle('events:add', async (_e, ev) => {
  const db = store.load();
  if (!ev || !ev.id) return { ok: false, error: '事件缺少 id' };
  // 去重：同公司 + 同类型 + 考试开始时间相同（或截止时间相同）且未完成 → 提示已存在
  const sameTime = (x, y) => !!(x && y && new Date(x).getTime() === new Date(y).getTime());
  const dup = (db.events || []).find(x =>
    x.status !== 'done'
    && x.type === ev.type
    && String(x.company || '') === String(ev.company || '')
    && (sameTime(x.examAt, ev.examAt) || sameTime(x.deadline, ev.deadline))
  );
  if (dup) {
    return { ok: false, duplicate: true, duplicateOf: { id: dup.id, company: dup.company, name: dup.name } };
  }
  const added = store.mergeEvents(db, [ev]);
  store.save(db); // mergeEvents 只改内存数组，必须显式落盘，否则重启后事件丢失
  return { ok: true, added, count: db.events.length };
});

// ===== 备份 导出/导入（Task 6，走系统文件对话框）=====
ipcMain.handle('backup:export', async () => {
  const db = store.load();
  const def = '笔试工作台备份-' + new Date().toISOString().slice(0, 10) + '.json';
  const p = dialog.showSaveDialogSync(win, {
    title: '导出备份',
    defaultPath: def,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (!p) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(p, JSON.stringify(db.events || [], null, 2), 'utf8');
    return { ok: true, canceled: false, path: p, count: (db.events || []).length };
  } catch (e) {
    return { ok: false, canceled: false, error: String((e && e.message) || e) };
  }
});
ipcMain.handle('backup:import', async (_e, mode) => {
  // mode: 'merge' 按 id 去重合并 | 'overwrite' 整体替换（导入前自动备份现有数据）
  const p = dialog.showOpenDialogSync(win, {
    title: '导入备份',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (!p || !p.length) return { ok: false, canceled: true };
  let arr;
  try {
    arr = JSON.parse(fs.readFileSync(p[0], 'utf8'));
  } catch (e) {
    return { ok: false, canceled: false, error: '文件不是有效的 JSON，现有数据未受影响' };
  }
  if (!Array.isArray(arr)) {
    return { ok: false, canceled: false, error: 'JSON 格式不对：应为事件数组，现有数据未受影响' };
  }
  const db = store.load();
  store.backupNow(); // 导入前自动备份
  let count, modeName;
  if (mode === 'overwrite') {
    db.events = arr;
    count = arr.length;
    modeName = '覆盖';
    store.save(db);
  } else {
    count = store.mergeEvents(db, arr); // 按 id 去重，重复事件不覆盖现有
    modeName = '合并';
    store.save(db);
  }
  return { ok: true, canceled: false, path: p[0], mode, modeName, count };
});

// 邮件增量拉取 + LLM 解析（Task 3 完整流水线）
ipcMain.handle('mail:refresh', async (_e, opts) => {
  const pipeline = require('./lib/pipeline');
  // force=true：深度重扫（忽略水位线，重新解析近期全部邮件）
  const r = await pipeline.run({ force: !!(opts && opts.force) });
  const db = store.load();
  const sync = { lastSyncAt: db.lastSyncAt || null, lastUid: db.lastUid || 0, seenCount: (db.seenUids || []).length };
  if (!r.ok) return { ok: false, added: 0, mails: [], needConfig: !!r.needConfig, sync, error: r.error };
  return { ok: true, added: r.added, mailCount: r.mailCount, failedBatch: r.failedBatch, mails: [], sync, error: r.error };
});

// ===== 投递记录 IPC（Task 2）=====
// 决策树：
// deliveries:get    → deliveryStore.load()（损坏/缺失由 store 自愈）→ { ok, data }
// deliveries:save   → 校验 fields/rows 为数组 → 白名单只取这两个键 → 原子写 → { ok }
ipcMain.handle('deliveries:get', async () => {
  try { return { ok: true, data: deliveryStore.load() }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('deliveries:save', async (_e, db) => {
  try {
    if (!db || !Array.isArray(db.fields) || !Array.isArray(db.rows)) {
      throw new Error('投递数据结构非法');
    }
    deliveryStore.save({ fields: db.fields, rows: db.rows }); // 白名单键，前端多余属性不入盘
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// 链接（已有）
ipcMain.handle('link:open', async (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  return { ok: true };
});

// 设置页「配置教程」按钮：应用内打开图文教程窗口（单例，避免重复打开）
let guideWin = null;
ipcMain.handle('app:open-setup-guide', () => {
  if (guideWin && !guideWin.isDestroyed()) { guideWin.focus(); return { ok: true }; }
  guideWin = new BrowserWindow({
    width: 880,
    height: 900,
    parent: win,
    title: '配置教程 · 秋招管家',
    resizable: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  guideWin.setMenuBarVisibility(false);
  guideWin.loadFile(path.join(__dirname, 'renderer', 'setup-guide.html'));
  guideWin.on('closed', () => { guideWin = null; });
  return { ok: true };
});
