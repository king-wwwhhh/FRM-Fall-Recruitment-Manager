'use strict';
// UI 校验：无头加载真实页面，读取顶栏同步时间、日历格子、横幅的实际渲染内容。
// 用于验证「时间已按本地时区显示」「日历能看到各类型事件与截止时刻」。
// 用法：node_modules/electron/dist/electron.exe verify-ui.js --disable-gpu --use-angle=swiftshader
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const store = require('./lib/store');

// 本脚本是独立主进程，不会加载 main.js，因此要自己注册前端依赖的 IPC，
// 否则 events:list 无 handler → 渲染层拿到空数组（首版就踩了这个坑）。
ipcMain.handle('events:list', async () => {
  const db = store.load();
  return {
    ok: true,
    events: db.events || [],
    sync: { lastSyncAt: db.lastSyncAt || null, lastUid: db.lastUid || 0, seenCount: (db.seenUids || []).length }
  };
});

app.disableHardwareAcceleration();

function createWindow() {
  const win = new BrowserWindow({
    show: false,
    width: 1280, height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      const js = `(() => {
        const q = s => document.querySelector(s);
        const lines = [...document.querySelectorAll('#calTable .evline')].map(e => e.textContent.trim()).filter(Boolean);
        return {
          sync: (q('#syncInfo') || {}).textContent || '(无)',
          banner: (q('.banner-title') || {}).textContent || '(无横幅)',
          bannerSub: (q('.banner-sub') || {}).textContent || '',
          todoCount: document.querySelectorAll('#todoList .item').length,
          calLines: lines.slice(0, 14),
          calLineCount: lines.length,
          legend: [...document.querySelectorAll('.legend span')].map(s => s.textContent.trim())
        };
      })()`;
      win.webContents.executeJavaScript(js).then(r => {
        console.log('===== UI 实际渲染内容 =====');
        console.log('顶栏同步信息：', r.sync);
        console.log('顶部横幅    ：', r.banner, '|', r.bannerSub);
        console.log('今天要处理  ：', r.todoCount, '条');
        console.log('日历事件行  ：', r.calLineCount, '行');
        r.calLines.forEach(l => console.log('   ·', l));
        console.log('图例        ：', r.legend.join(' / '));
        app.quit();
      }).catch(e => { console.log('读取失败：', e.message); app.quit(); });
    }, 3500); // 等 listEvents IPC 返回并完成首屏渲染
  });
}

app.whenReady().then(createWindow);
