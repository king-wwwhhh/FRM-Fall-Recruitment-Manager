'use strict';
// Task 5 图片纯函数单测：needCompress / addImage / removeImage / imgTarget 解析（先于实现，预期红）
const assert = require('assert');
let L;
try { L = require('../lib/deliveryLogic'); }
catch (e) { console.log('[Task5] FAIL 模块 lib/deliveryLogic.js 不存在 <- ' + e.message); process.exit(1); }

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('  PASS ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '  <- ' + e.message); }
}

console.log('[Task5] 图片纯函数');

check('needCompress：>2MB 为 true，≤2MB 为 false（含边界值）', () => {
  const MB = 1024 * 1024;
  assert.strictEqual(L.needCompress(2 * MB), false, '恰好 2MB 不压缩');
  assert.strictEqual(L.needCompress(2 * MB + 1), true, '超过 2MB 需压缩');
  assert.strictEqual(L.needCompress(100), false);
  assert.strictEqual(L.needCompress(0), false);
});

const mkRow = () => ({ id: 'r1', cells: { company: '华为', req: ['data:a', 'data:b'] } });

check('addImage：向指定行指定图片字段追加 dataURL，不可变', () => {
  const rows = [mkRow()];
  const snap = JSON.stringify(rows);
  const out = L.addImage(rows, 'r1', 'req', 'data:c');
  assert.deepStrictEqual(out[0].cells.req, ['data:a', 'data:b', 'data:c']);
  assert.strictEqual(JSON.stringify(rows), snap, '入参被修改');
});

check('addImage：行 id 不存在时安全返回原内容', () => {
  const rows = [mkRow()];
  const out = L.addImage(rows, 'ghost', 'req', 'data:c');
  assert.deepStrictEqual(out, rows);
});

check('removeImage：按索引删图，越界/非法索引不误删', () => {
  const rows = [mkRow()];
  assert.deepStrictEqual(L.removeImage(rows, 'r1', 'req', 0)[0].cells.req, ['data:b']);
  assert.deepStrictEqual(L.removeImage(rows, 'r1', 'req', 5)[0].cells.req, ['data:a', 'data:b'], '越界应原样');
  assert.deepStrictEqual(L.removeImage(rows, 'r1', 'req', -1)[0].cells.req, ['data:a', 'data:b'], '负索引应原样');
});

check('parseImgTarget： "rowId|fieldId|index" 解析为 {rowId, fieldId, index}', () => {
  assert.deepStrictEqual(L.parseImgTarget('r1|req|2'), { rowId: 'r1', fieldId: 'req', index: 2 });
  assert.strictEqual(L.parseImgTarget('bad'), null, '非法格式返回 null');
});

console.log(failed === 0 ? '[Task5] 全部通过' : `[Task5] ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
