'use strict';
// 投递记录本地数据仓库：data/deliveries.json（fields + rows）
//
// 决策树（Task 2）
// load(fp)
//  ├─ 文件不存在 → 返回 defaultDb()（不主动落盘，首次 save 才写）
//  ├─ 存在且 JSON 合法 → 补全缺省键后原样返回
//  └─ 存在但解析失败 → 坏文件改名 .bak-<时间戳> → 返回 defaultDb()
// save(db, fp)
//  ├─ db 缺 fields 或 rows（非数组）→ 抛错，不写盘
//  └─ 合法 → 序列化 → 写 fp.tmp → rename 覆盖 fp（原子写，断电不留半截文件）
const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'deliveries.json');

function defaultDb() {
  return {
    fields: [
      { id: 'company', name: '公司', type: 'text', visible: true },
      { id: 'jobtype', name: '岗位类别', type: 'text', visible: true },
      { id: 'req', name: '要求', type: 'image', visible: true },
      { id: 'progress', name: '进度', type: 'select', visible: true, options: [
        { id: 'o1', label: '已投递', colorIdx: 0 },
        { id: 'o2', label: '已测评', colorIdx: 1 },
        { id: 'o3', label: '笔试', colorIdx: 2 },
        { id: 'o4', label: '一面', colorIdx: 3 },
        { id: 'o5', label: '二面', colorIdx: 4 },
        { id: 'o6', label: '三面', colorIdx: 5 },
        { id: 'o7', label: 'HR面', colorIdx: 6 },
        { id: 'o8', label: 'Offer', colorIdx: 7 },
        { id: 'o9', label: '简历挂', colorIdx: 8 },
        { id: 'o10', label: '笔试挂', colorIdx: 9 },
        { id: 'o11', label: '面试挂', colorIdx: 10 }
      ] },
      { id: 'link', name: '链接', type: 'text', visible: true },
      { id: 'ref', name: '内推码', type: 'text', visible: true },
      { id: 'time', name: '投递时间', type: 'text', visible: true },
      { id: 'itime', name: '预期面试时间', type: 'text', visible: true },
      { id: 'tested', name: '已测评', type: 'text', visible: true }
    ],
    rows: []
  };
}

function load(fp) {
  fp = fp || DEFAULT_FILE;
  if (!fs.existsSync(fp)) return defaultDb();
  try {
    const db = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const def = defaultDb();
    db.fields = Array.isArray(db.fields) ? db.fields : def.fields;
    db.rows = Array.isArray(db.rows) ? db.rows : [];
    return db;
  } catch (e) {
    try { fs.renameSync(fp, fp + '.bak-' + Date.now()); } catch (_) {}
    return defaultDb();
  }
}

function save(db, fp) {
  fp = fp || DEFAULT_FILE;
  if (!db || !Array.isArray(db.fields) || !Array.isArray(db.rows)) {
    throw new Error('deliveries 数据结构非法：fields/rows 必须是数组');
  }
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

module.exports = { load, save, defaultDb, DEFAULT_FILE };
