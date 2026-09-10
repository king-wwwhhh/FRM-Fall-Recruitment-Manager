'use strict';
// 全量单测入口：node test/run-all.js（顺序跑全部 *test*.js，任一失败即非零退出）
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const files = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.test.js'))
  .sort();
let failed = 0;
for (const f of files) {
  console.log('===== ' + f + ' =====');
  try {
    execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  } catch (e) { failed++; }
}
console.log(failed === 0 ? '[run-all] ' + files.length + ' 个测试文件全部通过' : '[run-all] ' + failed + ' 个测试文件失败');
process.exit(failed === 0 ? 0 : 1);
