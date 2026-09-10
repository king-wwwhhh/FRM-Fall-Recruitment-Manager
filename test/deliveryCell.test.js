'use strict';
// Task 6 就地编辑纯函数单测：setCell / escapeHtml（先于实现，预期红）
const assert = require('assert');
let L;
try { L = require('../lib/deliveryLogic'); }
catch (e) { console.log('[Task6] FAIL 模块 lib/deliveryLogic.js 不存在 <- ' + e.message); process.exit(1); }

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('  PASS ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '  <- ' + e.message); }
}

console.log('[Task6] 就地编辑纯函数');

const mk = () => ([
  { id: 'a', cells: { company: '华为', ref: 'C1' } },
  { id: 'b', cells: { company: '腾讯', ref: '' } }
]);

check('setCell：只改目标格，返回新数组，其他行/格不动', () => {
  const rows = mk();
  const snap = JSON.stringify(rows);
  const out = L.setCell(rows, 'b', 'company', '字节跳动');
  assert.strictEqual(out[1].cells.company, '字节跳动');
  assert.strictEqual(out[1].cells.ref, '', '同行其他格不动');
  assert.strictEqual(out[0].cells.company, '华为', '其他行不动');
  assert.strictEqual(JSON.stringify(rows), snap, '入参被修改，违反不可变约定');
});

check('setCell：行 id 不存在 → 等价副本（不静默造数据）', () => {
  const rows = mk();
  const out = L.setCell(rows, 'ghost', 'company', 'x');
  assert.strictEqual(JSON.stringify(out), JSON.stringify(rows));
});

check('escapeHtml：引号/尖括号/与符号全转义（防 XSS 与属性截断）', () => {
  assert.strictEqual(L.escapeHtml('华为"2027"<后端>&\''), '华为&quot;2027&quot;&lt;后端&gt;&amp;&#39;');
  assert.strictEqual(L.escapeHtml(null), '', 'null 应转空串');
  assert.strictEqual(L.escapeHtml(123), '123', '数字应转字符串');
});

console.log(failed === 0 ? '[Task6] 全部通过' : `[Task6] ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
