'use strict';
// Task 1 结构断言：投递记录 UI 骨架（先于实现编写，跑一遍应全红）
// 断言对象是 index.html / style.css 的静态文本，不启动 Electron
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'renderer', 'style.css'), 'utf8');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('  PASS ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '  <- ' + e.message); }
}

console.log('[Task1] 结构断言：顶栏入口 + 投递记录视图骨架');

check('顶栏存在入口按钮 #btnDelivery', () => {
  assert(html.includes('id="btnDelivery"'), 'index.html 缺少 id="btnDelivery"');
});
check('入口按钮带表格图标与「投递记录」文案', () => {
  const m = html.match(/<button[^>]*id="btnDelivery"[\s\S]*?<\/button>/);
  assert(m, '未找到 btnDelivery 按钮标签');
  assert(m[0].includes('投递记录'), '按钮文案缺少「投递记录」');
  assert(m[0].includes('<svg'), '按钮内缺少 svg 图标');
});
check('日历视图容器 #view-calendar 存在（包裹原 main）', () => {
  assert(html.includes('id="view-calendar"'), '缺少 #view-calendar');
});
check('投递视图 #view-delivery 存在且默认隐藏', () => {
  assert(/<section[^>]*id="view-delivery"[^>]*hidden/.test(html), '#view-delivery 必须带 hidden 默认隐藏');
});
check('工具栏含「添加一行」#dAddRow 与「字段管理」#dFieldsBtn', () => {
  assert(html.includes('id="dAddRow"'), '缺少 #dAddRow');
  assert(html.includes('id="dFieldsBtn"'), '缺少 #dFieldsBtn');
  assert(html.includes('添加一行'), '缺少「添加一行」文案');
  assert(html.includes('字段管理'), '缺少「字段管理」文案');
});
check('置灰按钮：筛选/分组/排序/行高/填色 五个占位', () => {
  for (const t of ['筛选', '分组', '排序', '行高', '填色']) {
    assert(html.includes(t), '工具栏缺少占位按钮：' + t);
  }
});
check('表格骨架 #dThead / #dTbody 存在', () => {
  assert(html.includes('id="dThead"'), '缺少 #dThead');
  assert(html.includes('id="dTbody"'), '缺少 #dTbody');
});
check('字段面板 #dFieldPanel 与图片浮层 #dImgMask / #dImgModal 存在', () => {
  assert(html.includes('id="dFieldPanel"'), '缺少 #dFieldPanel');
  assert(html.includes('id="dImgMask"'), '缺少 #dImgMask');
  assert(html.includes('id="dImgModal"'), '缺少 #dImgModal');
});
check('样式：入口按钮 .btn-delivery 与选中态 .btn-delivery.active', () => {
  assert(css.includes('.btn-delivery'), 'style.css 缺少 .btn-delivery');
  assert(css.includes('.btn-delivery.active'), 'style.css 缺少 .btn-delivery.active');
});
check('样式：工具栏/表格/面板/浮层 tv- 前缀类齐备', () => {
  for (const c of ['.tv-toolbar', '.tv-tb', '.tv-table', '.tv-panel', '.tv-mask', '.tv-modal', '.tv-thumb', '.tv-imgadd', '.tv-sw']) {
    assert(css.includes(c), 'style.css 缺少 ' + c);
  }
});

console.log(failed === 0 ? '[Task1] 全部通过' : `[Task1] ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
