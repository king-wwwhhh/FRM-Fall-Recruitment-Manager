'use strict';
// 极简滚动日志：追加写 data/run.log（10KB 上限，超了裁尾部）
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'data', 'run.log');
const MAX = 64 * 1024;

function log(tag, msg) {
  try {
    const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] [${tag}] ${msg}\n`;
    let old = '';
    if (fs.existsSync(LOG_FILE)) old = fs.readFileSync(LOG_FILE, 'utf8');
    const out = old + line;
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.writeFileSync(LOG_FILE, out.length > MAX ? out.slice(-MAX) : out, 'utf8');
  } catch (_) { /* 日志失败不阻塞主流程 */ }
}

module.exports = { log };