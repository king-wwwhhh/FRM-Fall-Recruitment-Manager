'use strict';
// 本地 JSON 数据仓库：事件 + 已处理邮件 uid + 同步时间
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');

// 导入/覆盖前自动备份当前 store.json → data/backup/store-YYYYMMDD-HHMMSS.json
function backupNow() {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) return null;
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dst = path.join(BACKUP_DIR, 'store-' + ts + '.json');
  fs.copyFileSync(DB_FILE, dst);
  return dst;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    return { events: [], seenUids: [], lastSyncAt: null, seeded: false };
  }
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.events = db.events || [];
    db.seenUids = db.seenUids || [];
    return db;
  } catch (e) {
    const bak = DB_FILE + '.bad-' + Date.now();
    try { fs.renameSync(DB_FILE, bak); } catch (_) {}
    return { events: [], seenUids: [], lastSyncAt: null, seeded: false, _backupFile: bak };
  }
}

function save(db) {
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

// 合并新解析出的事件：按 id 去重（同邮件同类型不重复入库）
function mergeEvents(db, newEvents) {
  const existing = new Set(db.events.map(e => e.id));
  let added = 0;
  for (const ev of newEvents) {
    if (!existing.has(ev.id)) {
      db.events.push(ev);
      existing.add(ev.id);
      added++;
    }
  }
  return added;
}

// 整表替换事件（前端操作后回写）
function replaceEvents(db, events) {
  db.events = Array.isArray(events) ? events : [];
  save(db);
  return db.events.length;
}

// 标记事件 id 的状态
function setStatus(db, id, status) {
  const ev = db.events.find(e => e.id === id);
  if (!ev) return false;
  ev.status = status;
  save(db);
  return true;
}

// 删除事件
function removeEvent(db, id) {
  const before = db.events.length;
  db.events = db.events.filter(e => e.id !== id);
  const after = db.events.length;
  if (after !== before) save(db);
  return after < before;
}

// 更新同步水位线：seenUids 增量累加 + lastUid 上移 + lastSyncAt
// 不变式（防丢邮件）：lastUid 永远不得超过"已消费/已见过的最大 UID"。
// 即 newSeen 与已有 seenUids 里都没有的 UID，不允许被水位线跨过——
// 否则下次 SEARCH UID (lastUid+1):* 会永久跳过这些没处理过的邮件。
function updateSync(db, newSeen, maxUid, nowIso) {
  const seen = new Set(db.seenUids || []);
  (newSeen || []).forEach(k => seen.add(k));
  db.seenUids = Array.from(seen);
  // 从 seenUids 推导"已消费的最大 UID"（key 形如 INBOX:123）
  let maxSeenUid = 0;
  for (const k of seen) {
    const m = /^INBOX:(\d+)$/.exec(k);
    if (m && +m[1] > maxSeenUid) maxSeenUid = +m[1];
  }
  const safeMax = Math.min(Number(maxUid) || 0, maxSeenUid);
  if (safeMax > (db.lastUid || 0)) db.lastUid = safeMax;
  if (nowIso) db.lastSyncAt = nowIso;
  save(db);
  return { lastUid: db.lastUid, maxSeenUid, clamped: (Number(maxUid) || 0) > maxSeenUid, lastSyncAt: db.lastSyncAt };
}

module.exports = { load, save, mergeEvents, replaceEvents, setStatus, removeEvent, updateSync, backupNow, DB_FILE, DATA_DIR };
