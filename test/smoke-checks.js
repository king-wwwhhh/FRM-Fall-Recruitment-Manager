'use strict';
// E2E 冒烟：渲染层断言（在真实 Electron 渲染进程里执行，经 executeJavaScript 调用）
// 返回 Promise<[{task, name, pass, msg}]>；window.__SMOKE_ONLY 为空数组时跑全部
(async function () {
  const only = Array.isArray(window.__SMOKE_ONLY) ? window.__SMOKE_ONLY : [];
  const want = t => only.length === 0 || only.includes(t);
  const results = [];
  const T = (task, name) => async (fn) => {
    if (!want(task)) return;
    try { await fn(); results.push({ task, name, pass: true }); }
    catch (e) { results.push({ task, name, pass: false, msg: e.message }); }
  };
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || '断言失败'); };
  const click = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  // ================= Task 1：入口按钮 + 视图切换 =================
  await T(1, '入口按钮 #btnDelivery 存在且带紫色样式类')(async () => {
    const b = $('btnDelivery');
    assert(b, '缺少 #btnDelivery');
    assert(b.classList.contains('btn-delivery'), '缺少 .btn-delivery 样式类');
  });
  await T(1, '默认显示日历视图，投递视图隐藏')(async () => {
    assert(!$('view-calendar').hidden, '日历视图应可见');
    assert($('view-delivery').hidden, '投递视图应隐藏');
    assert(!$('btnDelivery').classList.contains('active'), '按钮不应有选中态');
  });
  await T(1, '点击入口 → 切到投递视图 + 按钮选中态')(async () => {
    click($('btnDelivery'));
    assert(!$('view-delivery').hidden, '投递视图应显示');
    assert($('view-calendar').hidden, '日历视图应隐藏');
    assert($('btnDelivery').classList.contains('active'), '按钮应有选中态');
  });
  await T(1, '再次点击入口 → 切回日历')(async () => {
    click($('btnDelivery'));
    assert($('view-delivery').hidden, '投递视图应回到隐藏');
    assert(!$('btnDelivery').classList.contains('active'), '按钮应去选中态');
  });
  await T(1, '工具栏五个置灰按钮存在且不可用')(async () => {
    const disabled = document.querySelectorAll('#view-delivery .tv-tb.tv-disabled');
    assert(disabled.length === 5, '置灰按钮应为 5 个，实际 ' + disabled.length);
  });

  // ================= Task 2：数据层 IPC =================
  await T(2, 'deliveries:get 返回 9 个默认字段且「要求」为图片类型')(async () => {
    assert(window.api && window.api.deliveriesGet, 'preload 未暴露 deliveriesGet');
    const r = await window.api.deliveriesGet();
    assert(r && r.ok, 'deliveries:get 失败');
    assert(r.data.fields.length === 9, '默认字段应 9 个，实际 ' + r.data.fields.length);
    const req = r.data.fields.find(f => f.id === 'req');
    assert(req && req.type === 'image', '「要求」字段应为 image 类型');
    assert(Array.isArray(r.data.rows), 'rows 应为数组');
  });
  await T(2, 'deliveries:save 写入后 get 读回一致（IPC 往返）')(async () => {
    const r0 = await window.api.deliveriesGet();
    const db = r0.data;
    db.rows.push({ id: 'e2e-t2', cells: { company: 'E2E测试公司' } });
    db.fields[0].visible = false;
    const w = await window.api.deliveriesSave(db);
    assert(w && w.ok, 'deliveries:save 失败: ' + ((w && w.error) || ''));
    const r1 = await window.api.deliveriesGet();
    assert(r1.data.rows.length === 1 && r1.data.rows[0].cells.company === 'E2E测试公司', '行数据往返不一致');
    assert(r1.data.fields[0].visible === false, '字段可见性往返不一致');
    assert(r1.data.fields.length === 9, '字段数量不应变化');
  });
  await T(2, 'deliveries:save 拒绝非法结构')(async () => {
    const w = await window.api.deliveriesSave({ foo: 1 });
    assert(w && w.ok === false, '非法结构应返回 ok:false');
  });

  // ================= Task 3：添加/删除行 =================
  await T(3, '进入投递视图后空表展示引导文案')(async () => {
    click($('btnDelivery'));
    await sleep(120);
    assert($('dTbody').textContent.includes('添加一行'), '空表应有引导文案');
  });
  await T(3, '点击「添加一行」→ 末尾追加空行，行号递增')(async () => {
    click($('dAddRow'));
    await sleep(50);
    const trs = $('dTbody').querySelectorAll('tr');
    assert(trs.length === 1, '应有 1 行，实际 ' + trs.length);
    assert(trs[0].querySelector('.tv-num').textContent === '1', '行号应为 1');
    click($('dAddRow'));
    await sleep(50);
    assert($('dTbody').querySelectorAll('tr').length === 2, '应有 2 行');
  });
  await T(3, '新行图片字段为「+」占位、文本字段为空')(async () => {
    const lastRow = $('dTbody').querySelector('tr:last-child');
    assert(lastRow.querySelector('.tv-imgadd'), '图片列应有 + 占位');
    const companyCell = lastRow.querySelector('[data-dcell$="|company"]');
    assert(companyCell && companyCell.textContent === '', '公司单元格应为空');
  });
  await T(3, '行尾 × 确认后删行（confirm 拦截验证）')(async () => {
    const before = $('dTbody').querySelectorAll('tr').length;
    window.confirm = () => false; // 取消：不应删
    const delBtn = $('dTbody').querySelector('tr:first-child [data-drow]');
    click(delBtn);
    await sleep(30);
    assert($('dTbody').querySelectorAll('tr').length === before, '取消时行数不应变化');
    window.confirm = () => true;
    click(delBtn);
    await sleep(30);
    assert($('dTbody').querySelectorAll('tr').length === before - 1, '确认后应少一行');
  });
  await T(3, '行操作防抖落盘：flush 后 IPC 读回一致')(async () => {
    click($('dAddRow'));
    await sleep(30);
    window.__delivery.flushSave();
    await sleep(80);
    const r = await window.api.deliveriesGet();
    assert(r.ok && r.data.rows.length === 2, '落盘后应为 2 行，实际 ' + (r.data ? r.data.rows.length : 'null'));
    // 清场：删到只剩空表，供后续任务从干净状态开始
    window.confirm = () => true;
    document.querySelectorAll('#dTbody [data-drow]').forEach(b => click(b));
    window.__delivery.flushSave();
    await sleep(80);
  });

  // ================= Task 4：字段管理 =================
  await T(4, '点击「字段管理」→ 面板弹出并列出全部字段与开关')(async () => {
    click($('dFieldsBtn'));
    await sleep(50);
    assert(!$('dFieldPanel').hidden, '面板应弹出');
    assert($('dFieldPanel').querySelectorAll('.fi').length === 9, '面板应列 9 个字段');
    assert($('dFieldPanel').querySelector('#dFieldName'), '缺少新增字段输入框');
  });
  await T(4, '点击面板外自动收起，再点按钮可再开')(async () => {
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(30);
    assert($('dFieldPanel').hidden, '点击外部应收起');
    click($('dFieldsBtn'));
    await sleep(30);
    assert(!$('dFieldPanel').hidden, '再次点击应弹出');
  });
  await T(4, '开关切换 → 表头列数实时增减，数据保留')(async () => {
    const before = $('dThead').querySelectorAll('th').length; // # + 9 + 操作列 = 11
    const sw = $('dFieldPanel').querySelector('[data-dsw="ref"]');
    click(sw);
    await sleep(50);
    assert($('dThead').querySelectorAll('th').length === before - 1, '关开关后表头应少一列');
    assert(!$('dThead').textContent.includes('内推码'), '表头不应再有「内推码」');
    click($('dFieldPanel').querySelector('[data-dsw="ref"]'));
    await sleep(50);
    assert($('dThead').textContent.includes('内推码'), '重开后「内推码」应恢复');
  });
  await T(4, '拖拽调序 → 表头列序实时跟随（经 moveField 同一管线）')(async () => {
    window.__delivery.move(0, 2); // 公司 移到第 3 位
    await sleep(50);
    const firstTh = $('dThead').querySelectorAll('th')[1]; // [0] 是 # 列
    assert(firstTh.textContent === '岗位类别', '第一数据列应为「岗位类别」，实际 ' + firstTh.textContent);
    window.__delivery.move(2, 0); // 还原
    await sleep(50);
    assert($('dThead').querySelectorAll('th')[1].textContent === '公司', '还原失败');
  });
  await T(4, '新增字段：合法名回车后表头多一列；重名被拒')(async () => {
    const inp = $('dFieldName');
    inp.value = '薪资范围';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(50);
    assert($('dThead').textContent.includes('薪资范围'), '表头应出现「薪资范围」');
    const cnt = window.__delivery.state.fields.length;
    inp.value = '薪资范围';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(30);
    assert(window.__delivery.state.fields.length === cnt, '重名不应新增');
  });
  await T(4, '字段变更防抖落盘：flush 后 IPC 读回列序与新增一致')(async () => {
    window.__delivery.flushSave();
    await sleep(80);
    const r = await window.api.deliveriesGet();
    const names = r.data.fields.map(f => f.name);
    assert(names.indexOf('薪资范围') > 0, '落盘应含新增字段');
    assert(names[0] === '公司' && names[2] === '要求', '还原后的列序应与界面一致');
    // 清场：移除测试字段，恢复默认 9 字段
    window.__delivery.state.fields = window.__delivery.state.fields.filter(f => f.name !== '薪资范围');
    window.__delivery.flushSave();
    await sleep(60);
  });

  // ================= Task 5：图片上传 + 缩略图 + 详情浮层 =================
  const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await T(5, '「+」选图管线：缩略图出现在对应图片单元格内')(async () => {
    click($('dAddRow')); // 造一行
    await sleep(50);
    const rowId = window.__delivery.state.rows[0].id;
    await window.__delivery.addImageForTest(rowId, 'req', TINY_PNG);
    await sleep(60);
    const img = $('dTbody').querySelector(`.tv-thumb img[data-dview^="${rowId}|req|"]`);
    assert(img, '单元格内应有缩略图');
    assert(img.src.startsWith('data:image/'), '缩略图 src 应为 dataURL');
  });
  await T(5, '点击缩略图 → 详情浮层显示同一张图')(async () => {
    const img = $('dTbody').querySelector('.tv-thumb img[data-dview]');
    click(img);
    await sleep(50);
    assert(!$('dImgMask').hidden, '浮层应打开');
    const big = $('dImgModal').querySelector('img');
    assert(big && big.src === img.src, '浮层大图应与缩略图同源');
    assert($('dImgClose'), '浮层应有 × 关闭按钮');
  });
  await T(5, '× / 遮罩 / Esc 三种方式均可关闭浮层')(async () => {
    click($('dImgClose'));
    await sleep(30);
    assert($('dImgMask').hidden, '× 应关闭浮层');
    click($('dTbody').querySelector('.tv-thumb img[data-dview]'));
    await sleep(30);
    $('dImgMask').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(30);
    assert($('dImgMask').hidden, '点遮罩应关闭浮层');
    click($('dTbody').querySelector('.tv-thumb img[data-dview]'));
    await sleep(30);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(30);
    assert($('dImgMask').hidden, 'Esc 应关闭浮层');
  });
  await T(5, '缩略图 hover × → 删除该图，数据同步')(async () => {
    const rowId = window.__delivery.state.rows[0].id;
    const delBtn = $('dTbody').querySelector(`[data-dimgdel="${rowId}|req|0"]`);
    assert(delBtn, '应存在删图角标');
    click(delBtn);
    await sleep(50);
    assert(!$('dTbody').querySelector('.tv-thumb img'), '删除后缩略图应消失');
    window.__delivery.flushSave();
    await sleep(80);
    const r = await window.api.deliveriesGet();
    const row = r.data.rows.find(x => x.id === rowId);
    assert(JSON.stringify(row.cells.req) === '[]', '落盘后该行图片数组应为空，实际 ' + JSON.stringify(row.cells.req));
    // 清场
    dstateClean();
  });
  function dstateClean() {
    window.__delivery.state.rows = [];
    window.__delivery.flushSave();
  }

  // ================= Task 6：就地编辑 =================
  await T(6, '添加一行后焦点自动落在新行第一个文本格')(async () => {
    if ($('view-delivery').hidden) click($('btnDelivery')); // 隐藏容器内元素不可聚焦，先进投递视图
    await sleep(60);
    click($('dAddRow'));
    await sleep(60);
    const lastRow = $('dTbody').querySelector('tr:last-child');
    const firstInput = lastRow.querySelector('input.cell');
    assert(document.activeElement === firstInput, '焦点应在新行第一格，实际 ' + (document.activeElement && document.activeElement.tagName));
    // 清理本检查产生的行，供下一检查从干净状态开始
    window.confirm = () => true;
    click(lastRow.querySelector('[data-drow]'));
    await sleep(30);
  });
  await T(6, '输入 → 失焦 → 落盘：值经 IPC 读回一致')(async () => {
    click($('dAddRow'));
    await sleep(50);
    const rowId = window.__delivery.state.rows[0].id;
    const inp = $('dTbody').querySelector(`input.cell[data-dcell="${rowId}|company"]`);
    inp.value = '华为';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('blur'));
    window.__delivery.flushSave();
    await sleep(80);
    const r = await window.api.deliveriesGet();
    const row = r.data.rows.find(x => x.id === rowId);
    assert(row && row.cells.company === '华为', '落盘值应为「华为」，实际 ' + (row && row.cells.company));
  });
  await T(6, '特殊字符（引号/尖括号）输入 → 重渲染后原样显示（防截断/XSS）')(async () => {
    const rowId = window.__delivery.state.rows[0].id;
    const raw = '华为"2027"<后端>';
    const inp = $('dTbody').querySelector(`input.cell[data-dcell="${rowId}|company"]`);
    inp.value = raw;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    window.__delivery.move(0, 1); // 触发一次全表重渲染（与拖拽同管线）
    window.__delivery.move(1, 0);
    await sleep(50);
    const inp2 = $('dTbody').querySelector(`input.cell[data-dcell="${rowId}|company"]`);
    assert(inp2.value === raw, '重渲染后应原样显示，实际 ' + inp2.value);
    window.__delivery.flushSave();
    await sleep(80);
    const r = await window.api.deliveriesGet();
    assert(r.data.rows[0].cells.company === raw, '落盘值应原样保存');
    // 清场：恢复空表
    window.__delivery.state.rows = [];
    window.__delivery.flushSave();
    await sleep(60);
  });

  // ================= Task A：单选字段 / 字段删除 / 单图粘贴 =================
  await T('A', '默认字段含 select 类型「进度」，预置 11 个选项')(async () => {
    const f = window.__delivery.state.fields.find(x => x.id === 'progress');
    assert(f, '缺少 progress 字段');
    assert(f.type === 'select', 'progress 应为 select 类型');
    assert(f.options.length >= 11, '应预置 ≥11 选项，实际 ' + f.options.length);
    assert(f.options.some(o => o.label === '已投递'), '应含「已投递」');
  });
  await T('A', 'select 单元格渲染为彩色胶囊；点击弹选项列表')(async () => {
    click($('dAddRow'));
    await sleep(50);
    const rowId = window.__delivery.state.rows[0].id;
    const pill = $('dTbody').querySelector(`[data-selopen="${rowId}|progress"]`);
    assert(pill, '应存在选择入口');
    click(pill);
    await sleep(50);
    const pop = document.getElementById('dSelPop');
    assert(pop, '应弹出选项列表');
    assert(pop.querySelectorAll('[data-selpick]').length >= 11, '弹层应列出全部选项');
    const target = Array.from(pop.querySelectorAll('[data-selpick]')).find(el => el.textContent.includes('已投递'));
    click(target);
    await sleep(50);
    const pill2 = $('dTbody').querySelector(`[data-selopen="${rowId}|progress"]`);
    assert(pill2 && pill2.textContent.includes('已投递'), '选择后单元格应显示「已投递」胶囊');
    assert(pill2.style.background, '胶囊应带颜色');
    window.__delivery.flushSave();
    await sleep(80);
    const r = await window.api.deliveriesGet();
    const savedRow = r.data.rows.find(x => x.id === rowId);
    assert(savedRow && savedRow.cells.progress, '选项 id 应落盘');
  });
  await T('A', '选项管理：添加选项/减号删除/色块换色')(async () => {
    const rowId = window.__delivery.state.rows[0].id;
    window.__delivery.openSelPop(rowId, 'progress');
    await sleep(30);
    let pop = document.getElementById('dSelPop');
    click(pop.querySelector('[data-selmanage]'));
    await sleep(30);
    pop = document.getElementById('dSelPop');
    const before = pop.querySelectorAll('[data-optrow]').length;
    const inp = pop.querySelector('#dSelOptName');
    inp.value = '人才计划';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(30);
    pop = document.getElementById('dSelPop');
    assert(pop.querySelectorAll('[data-optrow]').length === before + 1, '添加后应多一个选项行');
    const colorBtn = pop.querySelector('[data-selcolor]');
    const idx0 = window.__delivery.state.fields.find(x => x.id === 'progress').options[0].colorIdx;
    click(colorBtn);
    await sleep(30);
    const idx1 = window.__delivery.state.fields.find(x => x.id === 'progress').options[0].colorIdx;
    assert(idx1 === idx0 + 1, '点色块应 colorIdx+1');
    const delBtn = pop.querySelector('[data-seldelopt]');
    window.confirm = () => true;
    click(delBtn);
    await sleep(30);
    pop = document.getElementById('dSelPop');
    assert(pop.querySelectorAll('[data-optrow]').length === before, '删除后应回到原数量');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(20);
    window.__delivery.state.rows = [];
    window.__delivery.flushSave();
    await sleep(60);
  });
  await T('A', '字段管理面板：删除字段带确认，字段与列同步消失')(async () => {
    window.__delivery.addFieldByName('临时字段');
    await sleep(30);
    click($('dFieldsBtn'));
    await sleep(30);
    const f = window.__delivery.state.fields.find(x => x.name === '临时字段');
    const delBtn = $('dFieldPanel').querySelector(`[data-dfieldel="${f.id}"]`);
    assert(delBtn, '面板应含删除按钮');
    window.confirm = () => false;
    click(delBtn);
    await sleep(30);
    assert(window.__delivery.state.fields.some(x => x.id === f.id), '取消时不应删除');
    window.confirm = () => true;
    click(delBtn);
    await sleep(30);
    assert(!window.__delivery.state.fields.some(x => x.id === f.id), '确认后字段应删除');
    assert(!$('dThead').textContent.includes('临时字段'), '表头应同步移除');
    click($('dFieldsBtn'));
    await sleep(20);
  });
  await T('A', '单图上限：满 1 张后「+」消失，再贴图走替换管线')(async () => {
    click($('dAddRow'));
    await sleep(50);
    const rowId = window.__delivery.state.rows[0].id;
    const TINY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await window.__delivery.addImageForTest(rowId, 'req', TINY + 'a');
    await sleep(60);
    const cell = $('dTbody').querySelector(`[data-dimgcell="${rowId}|req"]`);
    assert(cell.querySelector('.tv-thumb img'), '应有缩略图');
    assert(!cell.querySelector('.tv-imgadd'), '满 1 张后「+」应消失');
    await window.__delivery.addImageForTest(rowId, 'req', TINY + 'b');
    await sleep(60);
    const imgs = window.__delivery.state.rows.find(r => r.id === rowId).cells.req;
    assert(imgs.length === 1, '仍应为 1 张（替换而非追加），实际 ' + imgs.length);
    assert(imgs[0].endsWith('b'), '应为替换后的新图');
    window.__delivery.state.rows = [];
    window.__delivery.flushSave();
    await sleep(60);
  });
  await T('A', '表格列间竖线：td 均有右边框（末列除外）')(async () => {
    click($('dAddRow'));
    await sleep(50);
    const tds = $('dTbody').querySelectorAll('td');
    const first = getComputedStyle(tds[0]);
    assert(first.borderRightWidth !== '0px' && first.borderRightStyle !== 'none', '首格应有右边框');
    const last = getComputedStyle(tds[tds.length - 1]);
    assert(last.borderRightWidth === '0px' || last.borderRightStyle === 'none', '末列（操作列）不应有右边框');
    window.__delivery.state.rows = [];
    window.__delivery.flushSave();
    await sleep(50);
  });

  return results;
})();
