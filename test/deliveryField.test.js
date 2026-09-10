'use strict';
// Task 4 字段管理纯函数单测：moveField / toggleField / addField / visibleFields（先于实现，预期红）
const assert = require('assert');
let L;
try { L = require('../lib/deliveryLogic'); }
catch (e) { console.log('[Task4] FAIL 模块 lib/deliveryLogic.js 不存在 <- ' + e.message); process.exit(1); }

const F = () => ([
  { id: 'company', name: '公司', type: 'text', visible: true },
  { id: 'jobtype', name: '岗位类别', type: 'text', visible: true },
  { id: 'req', name: '要求', type: 'image', visible: true },
  { id: 'ref', name: '内推码', type: 'text', visible: true }
]);

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('  PASS ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '  <- ' + e.message); }
}

console.log('[Task4] 字段管理纯函数');

check('moveField：from→to 顺序重排正确、原数组不动', () => {
  const f = F();
  const snap = JSON.stringify(f);
  const out = L.moveField(f, 0, 2);
  assert.deepStrictEqual(out.map(x => x.id), ['jobtype', 'req', 'company', 'ref'], '顺序不符');
  assert.strictEqual(JSON.stringify(f), snap, '入参被修改，违反不可变约定');
});

check('moveField：from===to 无变化；越界钳制不抛错', () => {
  const f = F();
  assert.deepStrictEqual(L.moveField(f, 1, 1).map(x => x.id), f.map(x => x.id));
  assert.deepStrictEqual(L.moveField(f, -5, 99).map(x => x.id), f.map(x => x.id), '越界应原样返回');
});

check('toggleField：visible 取反、其他字段不动、不可变', () => {
  const f = F();
  const out = L.toggleField(f, 'req');
  assert.strictEqual(out.find(x => x.id === 'req').visible, false);
  assert.strictEqual(out.find(x => x.id === 'company').visible, true);
  assert.strictEqual(f.find(x => x.id === 'req').visible, true, '入参被修改');
  const back = L.toggleField(out, 'req');
  assert.strictEqual(back.find(x => x.id === 'req').visible, true, '再次切换应恢复');
});

check('addField：合法名称追加文本字段且默认可见', () => {
  const out = L.addField(F(), '备注');
  assert(out.ok, '合法添加应成功');
  const nf = out.fields[out.fields.length - 1];
  assert.strictEqual(nf.name, '备注');
  assert.strictEqual(nf.type, 'text');
  assert.strictEqual(nf.visible, true);
  assert(nf.id, '新字段应有 id');
});

check('addField：空名/重名拒绝', () => {
  assert.strictEqual(L.addField(F(), '  ').ok, false, '空名应拒绝');
  const r = L.addField(F(), '公司');
  assert.strictEqual(r.ok, false, '重名应拒绝');
  assert(r.error, '拒绝时应给错误信息');
  assert.strictEqual(r.fields.length, 4, '拒绝时字段数不变');
});

check('visibleFields：只留 visible，顺序稳定', () => {
  const f = F();
  f[2].visible = false;
  const out = L.visibleFields(f);
  assert.deepStrictEqual(out.map(x => x.id), ['company', 'jobtype', 'ref']);
});

check('隐藏列后行数据保留：removeFieldById 可彻底删除字段及其数据（供后续删除字段用）', () => {
  const f = F();
  const rows = [{ id: 'r1', cells: { company: '华为', req: ['x'], ref: 'C1' } }];
  const rf = L.removeFieldById(f, 'ref');
  assert.strictEqual(rf.length, 3, '字段应被删除');
  const rrows = L.stripCellKey(rows, 'ref');
  assert(!('ref' in rrows[0].cells), '行内数据应同步清除');
  assert.strictEqual(rrows[0].cells.company, '华为', '其他数据不动');
});

console.log(failed === 0 ? '[Task4] 全部通过' : `[Task4] ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
