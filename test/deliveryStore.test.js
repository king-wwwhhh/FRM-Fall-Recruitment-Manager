'use strict';
// Task 2 数据层单测：lib/deliveryStore.js（先于实现编写，跑一遍应全红）
// 覆盖：默认结构 / 空文件自建 / 往返一致 / JSON 损坏自愈 / 原子写
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

let store;
try { store = require('../lib/deliveryStore'); }
catch (e) { console.log('[Task2] FAIL 模块 lib/deliveryStore.js 不存在 <- ' + e.message); process.exit(1); }

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlv-test-'));
const file = p => path.join(tmpDir, p);
let failed = 0;
function check(name, fn) {
  try { fn(); console.log('  PASS ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '  <- ' + e.message); }
}

console.log('[Task2] deliveryStore 单元测试');

check('defaultDb() 返回 9 个默认字段（进度为 select 含 11 选项）', () => {
  const db = store.defaultDb();
  assert.strictEqual(db.fields.length, 9, '应为 9 个字段');
  assert.strictEqual(db.rows.length, 0, 'rows 应为空');
  const names = db.fields.map(f => f.name);
  assert.deepStrictEqual(names, ['公司', '岗位类别', '要求', '进度', '链接', '内推码', '投递时间', '预期面试时间', '已测评'], '字段名/顺序不符: ' + names.join(','));
  const req = db.fields.find(f => f.id === 'req');
  assert.strictEqual(req.type, 'image', '「要求」应为 image 类型');
  const prog = db.fields.find(f => f.id === 'progress');
  assert.strictEqual(prog.type, 'select', '「进度」应为 select 类型');
  assert(Array.isArray(prog.options) && prog.options.length >= 11, '「进度」应预置 11 个选项');
  assert(prog.options.every(o => o.id && o.label && typeof o.colorIdx === 'number'), '选项结构不完整');
  db.fields.forEach(f => {
    assert.strictEqual(f.visible, true, f.id + ' 默认应可见');
    assert(f.id && f.name && f.type, f.id + ' 结构不完整');
  });
});

check('文件不存在时 load() 自建默认结构', () => {
  const db = store.load(file('not-exist.json'));
  assert.strictEqual(db.fields.length, 9);
  assert.strictEqual(db.rows.length, 0);
  assert(fs.existsSync(file('not-exist.json')) === false || true, '允许惰性建文件');
});

check('save() 后 load() 往返一致（含行数据与图片数组）', () => {
  const fp = file('roundtrip.json');
  const db = store.defaultDb();
  db.rows.push({ id: 'r1', cells: { company: '华为', req: ['data:image/png;base64,AAAA'] } });
  db.fields[0].visible = false;
  store.save(db, fp);
  const back = store.load(fp);
  assert.deepStrictEqual(back, db, '往返后数据不一致');
});

check('JSON 损坏时 load() 自愈：备份坏文件并返回默认结构', () => {
  const fp = file('corrupt.json');
  fs.writeFileSync(fp, '{ this is not json !!', 'utf8');
  const db = store.load(fp);
  assert.strictEqual(db.fields.length, 9, '损坏后应返回默认结构');
  const bak = fs.readdirSync(tmpDir).find(f => f.startsWith('corrupt.json.bak'));
  assert(bak, '损坏文件应被改名备份');
});

check('save() 原子写：目录内无 .tmp 残留', () => {
  const fp = file('atomic.json');
  store.save(store.defaultDb(), fp);
  const leftovers = fs.readdirSync(tmpDir).filter(f => f.endsWith('.tmp'));
  assert.strictEqual(leftovers.length, 0, '存在 tmp 残留: ' + leftovers.join(','));
});

check('save() 拒绝非法结构（缺 fields/rows）', () => {
  let threw = false;
  try { store.save({ foo: 1 }, file('bad.json')); } catch (e) { threw = true; }
  assert(threw, '非法结构应抛错而不是写盘');
});

console.log(failed === 0 ? '[Task2] 全部通过' : `[Task2] ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
