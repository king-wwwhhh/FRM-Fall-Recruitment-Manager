'use strict';
// 增量 Task A 单测：单选字段纯函数（先于实现编写，预期红）
const assert = require('assert');
let L;
try { L = require('../lib/deliveryLogic'); }
catch (e) { console.log('[TaskA] FAIL 模块 lib/deliveryLogic.js 不存在 <- ' + e.message); process.exit(1); }

const mkField = () => ({ id: 'progress', name: '进度', type: 'select', visible: true, options: [
  { id: 'o1', label: '已投递', colorIdx: 0 },
  { id: 'o2', label: '已测评', colorIdx: 1 }
]});

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('  PASS ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '  <- ' + e.message); }
}

console.log('[TaskA] 单选字段纯函数');

check('paletteColor：按 colorIdx 取色，负数/越界自动循环', () => {
  assert.strictEqual(L.paletteColor(0).bg, '#1D9E75', '0 号应为绿色');
  assert(L.paletteColor(0).fg, '应带前景色');
  const n = L.SELECT_PALETTE.length;
  assert.strictEqual(JSON.stringify(L.paletteColor(n)), JSON.stringify(L.paletteColor(0)), '越界应循环回 0');
  assert.strictEqual(JSON.stringify(L.paletteColor(-1)), JSON.stringify(L.paletteColor(n - 1)), '负数应循环到最后');
});

check('addOption：末尾追加，colorIdx=当前选项数；空名/重名拒绝', () => {
  const f = mkField();
  const r = L.addOption(f, '一面');
  assert(r.ok, '合法添加应成功');
  assert.strictEqual(r.field.options.length, 3);
  assert.strictEqual(r.field.options[2].label, '一面');
  assert.strictEqual(r.field.options[2].colorIdx, 2, '新选项颜色索引应为 2');
  assert.strictEqual(f.options.length, 2, '入参 field 被修改，违反不可变约定');
  assert.strictEqual(L.addOption(f, '  ').ok, false, '空名拒绝');
  assert.strictEqual(L.addOption(f, '已投递').ok, false, '重名拒绝');
});

check('removeOptionById：按 id 删除选项；id 不存在安全返回', () => {
  const f = mkField();
  const r = L.removeOptionById(f, 'o1');
  assert(r.ok && r.field.options.length === 1 && r.field.options[0].id === 'o2');
  assert.strictEqual(L.removeOptionById(f, 'ghost').ok, false, '不存在应 ok:false');
});

check('renameOption：改选项名；空名/重名拒绝', () => {
  const f = mkField();
  const r = L.renameOption(f, 'o2', '笔试');
  assert(r.ok && r.field.options[1].label === '笔试');
  assert.strictEqual(L.renameOption(f, 'o2', '').ok, false, '空名拒绝');
  assert.strictEqual(L.renameOption(f, 'o2', '已投递').ok, false, '与其他选项重名拒绝');
});

check('cycleOptionColor：colorIdx +1 且按调色板长度循环，不可变', () => {
  const f = mkField();
  const r = L.cycleOptionColor(f, 'o1');
  assert.strictEqual(r.field.options[0].colorIdx, 1);
  assert.strictEqual(f.options[0].colorIdx, 0, '入参被修改');
  let cur = f;
  for (let i = 0; i < L.SELECT_PALETTE.length; i++) cur = L.cycleOptionColor(cur, 'o1').field;
  assert.strictEqual(
    JSON.stringify(L.paletteColor(cur.options[0].colorIdx)),
    JSON.stringify(L.paletteColor(0)),
    '循环一整圈应回到原色'
  );
});

check('stripOptionFromRows：删除选项后，引用它的单元格值清空，其他数据不动', () => {
  const rows = [
    { id: 'r1', cells: { progress: 'o1', company: '华为' } },
    { id: 'r2', cells: { progress: 'o2', company: '腾讯' } },
    { id: 'r3', cells: { company: '字节' } }
  ];
  const out = L.stripOptionFromRows(rows, 'progress', 'o1');
  assert.strictEqual(out[0].cells.progress, '', '引用被删选项的格应清空');
  assert.strictEqual(out[1].cells.progress, 'o2', '其他选项不受影响');
  assert.strictEqual(out[2].cells.company, '字节', '无关行不动');
});

check('IMAGE_LIMIT=1 且 replaceImage：按索引替换图片，越界安全', () => {
  assert.strictEqual(L.IMAGE_LIMIT, 1, '单图字段上限应为 1');
  const rows = [{ id: 'r1', cells: { req: ['data:old'] } }];
  const out = L.replaceImage(rows, 'r1', 'req', 0, 'data:new');
  assert.deepStrictEqual(out[0].cells.req, ['data:new']);
  assert.deepStrictEqual(L.replaceImage(rows, 'r1', 'req', 5, 'data:x')[0].cells.req, ['data:old'], '越界应原样');
});

console.log(failed === 0 ? '[TaskA] 全部通过' : `[TaskA] ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
