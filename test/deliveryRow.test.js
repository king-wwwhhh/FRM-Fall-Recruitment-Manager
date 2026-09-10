'use strict';
// Task 3 行操作纯函数单测：makeEmptyRow / addRow / removeRow（先于实现编写，预期红）
const assert = require('assert');
let L;
try { L = require('../lib/deliveryLogic'); }
catch (e) { console.log('[Task3] FAIL 模块 lib/deliveryLogic.js 不存在 <- ' + e.message); process.exit(1); }

const FIELDS = [
  { id: 'company', name: '公司', type: 'text', visible: true },
  { id: 'req', name: '要求', type: 'image', visible: true },
  { id: 'ref', name: '内推码', type: 'text', visible: true }
];

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('  PASS ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '  <- ' + e.message); }
}

console.log('[Task3] 行操作纯函数');

check('makeEmptyRow：文本字段为空串、图片字段为空数组、带唯一 id', () => {
  const r = L.makeEmptyRow(FIELDS);
  assert(r.id, '缺少行 id');
  assert.strictEqual(r.cells.company, '', '文本字段应为空串');
  assert.deepStrictEqual(r.cells.req, [], '图片字段应为空数组');
  assert.strictEqual(r.cells.ref, '');
  const r2 = L.makeEmptyRow(FIELDS);
  assert.notStrictEqual(r.id, r2.id, '两次生成的行 id 不应重复');
});

check('addRow：追加到末尾、长度 +1、原数组不被修改（不可变）', () => {
  const rows = [{ id: 'r0', cells: { company: '腾讯', req: [], ref: '' } }];
  const snapshot = JSON.stringify(rows);
  const out = L.addRow(rows, FIELDS);
  assert.strictEqual(out.length, 2, '长度应 +1');
  assert.strictEqual(out[0].id, 'r0', '原行应保持在头部');
  assert(out[out.length - 1].id !== 'r0', '新行应在末尾');
  assert.strictEqual(JSON.stringify(rows), snapshot, '入参 rows 被修改，违反不可变约定');
  assert(!out.includes(rows[0]) || out[0] === rows[0], '未改动行可保持原引用');
});

check('removeRow：按 id 精确删除、长度 -1', () => {
  const rows = [
    { id: 'a', cells: {} }, { id: 'b', cells: {} }, { id: 'c', cells: {} }
  ];
  const out = L.removeRow(rows, 'b');
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out.map(r => r.id), ['a', 'c']);
});

check('removeRow：id 不存在时返回原内容（不误删）', () => {
  const rows = [{ id: 'a', cells: {} }];
  const out = L.removeRow(rows, 'nope');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'a');
});

console.log(failed === 0 ? '[Task3] 全部通过' : `[Task3] ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
