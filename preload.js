'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// 前端通过 window.api 调用主进程
contextBridge.exposeInMainWorld('api', {
  // 配置（Task 1）
  configGet: () => ipcRenderer.invoke('config:get'),
  configSave: (cfg) => ipcRenderer.invoke('config:save', cfg),
  configTestMail: (cfg) => ipcRenderer.invoke('config:testMail', cfg),
  configTestLLM: (cfg) => ipcRenderer.invoke('config:testLLM', cfg),
  // 事件（Task 0）
  listEvents: () => ipcRenderer.invoke('events:list'),
  saveAllEvents: (events) => ipcRenderer.invoke('events:saveAll', events),
  // 事件精细操作（Task 4/5）
  saveEventStatus: (id, status) => ipcRenderer.invoke('events:setStatus', id, status),
  removeEvent: (id) => ipcRenderer.invoke('events:remove', id),
  patchEvent: (id, patch) => ipcRenderer.invoke('events:patch', id, patch),
  addEvent: (ev) => ipcRenderer.invoke('events:add', ev),
  // 备份（Task 6，系统对话框）
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: (mode) => ipcRenderer.invoke('backup:import', mode),
  // 邮件（Task 2/3）
  refreshMail: (opts) => ipcRenderer.invoke('mail:refresh', opts || {}),
  // 投递记录（Task 2）
  deliveriesGet: () => ipcRenderer.invoke('deliveries:get'),
  deliveriesSave: (db) => ipcRenderer.invoke('deliveries:save', db),
  // 通用
  openLink: (url) => ipcRenderer.invoke('link:open', url)
});