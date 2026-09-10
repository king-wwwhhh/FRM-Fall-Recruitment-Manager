'use strict';
// 投递记录纯逻辑层：所有数组变换均为纯函数（不可变，不改入参），可在 Node 里脱离 Electron 单测
// 双端加载：Node 测试走 module.exports；渲染层经 <script> 引入挂到 window.DLogic
//
// 决策树（Task 3 · 行操作）
// 点击「添加一行」
//  └─ makeEmptyRow(fields) → addRow(rows,…) → scheduleSave(防抖500ms) → render
//     新行 cells：<text>=''，<image>=[]，行 id 全局唯一
// 点击行尾 ×
//  ├─ confirm 取消 → 中止，不动数据
//  └─ 确认 → removeRow(rows,id) → scheduleSave → render
//
// 决策树（Task 4 · 字段管理）
// 面板拖拽（⠿ dragstart → dragover 目标行）
//  └─ moveField(fields, from, to) → scheduleSave → renderPanel + renderTable（列序实时跟随）
// 面板开关
//  └─ toggleField(fields, id) → visible 取反（隐藏仅不渲染列，数据保留）→ scheduleSave → render
// 新增字段输入框 + Enter
//  ├─ 空名 / 重名 → 拒绝（提示，不动数据）
//  └─ 合法 → addField(fields, name) → scheduleSave → 表头即时多一列
//
// 决策树（Task 5 · 图片字段）
// 点击「+」→ input[type=file].click()
//  └─ 选中文件
//       ├─ 非 image/* → 提示，中止
//       ├─ FileReader.readAsDataURL
//       │    ├─ needCompress(len) = false（≤2MB）→ dataURL 直存
//       │    └─ true → canvas 压到长边 1600px → dataURL 存
//       └─ addImage(rows,rowId,fieldId,src) → scheduleSave → render（格内出现缩略图）
// 点击缩略图 → parseImgTarget → 浮层显示该图（Esc/×/遮罩 关闭）
// hover 缩略图 → 角标 × → removeImage → scheduleSave → render
//
// 决策树（Task 6 · 就地编辑）
// input.cell
//  ├─ input 事件 → setCell 只改内存（不落盘，防打字卡顿）
//  ├─ blur / Enter → blur → scheduleSave(防抖500ms) 落盘
//  └─ 渲染时 value → escapeHtml → 防引号截断属性/XSS
const DLogic = (() => {
  let seq = 0;
  function uid(prefix) {
    seq = (seq + 1) % 1e6;
    return (prefix || 'r') + Date.now().toString(36) + '-' + seq + Math.random().toString(36).slice(2, 6);
  }

  // 按字段清单生成一条空行：text → ''，image → []
  function makeEmptyRow(fields) {
    const cells = {};
    (fields || []).forEach(f => { cells[f.id] = f.type === 'image' ? [] : ''; });
    return { id: uid('r'), cells };
  }

  // 末尾追加一条空行，返回新数组（原数组不动）
  function addRow(rows, fields) {
    return (rows || []).concat([makeEmptyRow(fields)]);
  }

  // 按 id 删除行，返回新数组；id 不存在时返回等价副本（不误删）
  function removeRow(rows, id) {
    return (rows || []).filter(r => r.id !== id);
  }

  // ===== Task 4 · 字段管理 =====

  // 把 from 位置的字段移动到 to 位置；from===to 或越界 → 原顺序副本
  function moveField(fields, from, to) {
    const arr = (fields || []).slice();
    if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
    const [m] = arr.splice(from, 1);
    arr.splice(to, 0, m);
    return arr;
  }

  // 按 id 切换字段可见性，返回新数组；id 不存在返回原顺序副本
  function toggleField(fields, id) {
    return (fields || []).map(f => f.id === id ? Object.assign({}, f, { visible: !f.visible }) : f);
  }

  // 末尾追加文本字段；空名/重名 → { ok:false, error, fields 原样 }
  function addField(fields, name) {
    const arr = (fields || []).slice();
    const nm = String(name || '').trim();
    if (!nm) return { ok: false, error: '字段名不能为空', fields: arr };
    if (arr.some(f => f.name === nm)) return { ok: false, error: '字段名已存在', fields: arr };
    const nf = { id: uid('f'), name: nm, type: 'text', visible: true };
    arr.push(nf);
    return { ok: true, fields: arr, field: nf };
  }

  // 只返回可见字段（表头/行渲染都用它，顺序 = fields 顺序）
  function visibleFields(fields) {
    return (fields || []).filter(f => f.visible);
  }

  // 彻底删除字段；行内数据用 stripCellKey 单独清除
  function removeFieldById(fields, id) {
    return (fields || []).filter(f => f.id !== id);
  }

  // 清除各行 cells 里指定 key（删除字段时同步清数据）
  function stripCellKey(rows, key) {
    return (rows || []).map(r => {
      if (!r.cells || !(key in r.cells)) return r;
      const cells = Object.assign({}, r.cells);
      delete cells[key];
      return Object.assign({}, r, { cells });
    });
  }

  // ===== Task 5 · 图片字段 =====

  // base64 长度阈值：超过 2MB（dataURL 字符数）需先压缩再入库，防止 JSON 膨胀
  const IMAGE_DATAURL_LIMIT = 2 * 1024 * 1024;
  function needCompress(dataUrlLen) {
    return dataUrlLen > IMAGE_DATAURL_LIMIT;
  }

  // 向指定行指定图片字段追加一张图；行不存在 → 原内容副本（不静默造数据）
  function addImage(rows, rowId, fieldId, dataUrl) {
    return (rows || []).map(r => {
      if (r.id !== rowId) return r;
      const imgs = Array.isArray(r.cells[fieldId]) ? r.cells[fieldId].slice() : [];
      imgs.push(dataUrl);
      return Object.assign({}, r, { cells: Object.assign({}, r.cells, { [fieldId]: imgs }) });
    });
  }

  // 按索引删图；索引越界/非法 → 等价副本（不误删）
  function removeImage(rows, rowId, fieldId, index) {
    return (rows || []).map(r => {
      if (r.id !== rowId) return r;
      const imgs = Array.isArray(r.cells[fieldId]) ? r.cells[fieldId] : [];
      if (!Number.isInteger(index) || index < 0 || index >= imgs.length) return r;
      const next = imgs.slice();
      next.splice(index, 1);
      return Object.assign({}, r, { cells: Object.assign({}, r.cells, { [fieldId]: next }) });
    });
  }

  // 缩略图/删图按钮的 data-* 目标解析："rowId|fieldId|index" → 对象；非法 → null
  function parseImgTarget(str) {
    if (typeof str !== 'string') return null;
    const parts = str.split('|');
    if (parts.length !== 3) return null;
    const index = Number(parts[2]);
    if (!Number.isInteger(index) || index < 0) return null;
    return { rowId: parts[0], fieldId: parts[1], index };
  }

  // ===== Task 6 · 就地编辑 =====

  // 修改指定行指定字段的值；行不存在 → 等价副本
  function setCell(rows, rowId, fieldId, value) {
    return (rows || []).map(r => {
      if (r.id !== rowId) return r;
      return Object.assign({}, r, { cells: Object.assign({}, r.cells, { [fieldId]: value }) });
    });
  }

  // HTML 转义：& < > " ' 全转，渲染单元格值时必经
  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ===== Task A · 单选字段（select）与单图上限 =====

  // 单元格图片上限：需求为"贴一张就够"，满员后「+」消失，粘贴/选图即替换
  const IMAGE_LIMIT = 1;

  // 选项色板（11 色，与参考图一致的色系）：点击色块循环换色
  const SELECT_PALETTE = [
    { bg: '#1D9E75', fg: '#FFFFFF' }, // 绿
    { bg: '#F5C4B3', fg: '#712B13' }, // 粉橙
    { bg: '#B4B2A9', fg: '#2C2C2A' }, // 灰
    { bg: '#FAC775', fg: '#633806' }, // 黄
    { bg: '#7F77DD', fg: '#FFFFFF' }, // 紫
    { bg: '#85B7EB', fg: '#042C53' }, // 蓝
    { bg: '#EF9F27', fg: '#412402' }, // 橙
    { bg: '#ED93B1', fg: '#72243E' }, // 粉
    { bg: '#97C459', fg: '#27500A' }, // 草绿
    { bg: '#378ADD', fg: '#FFFFFF' }, // 深蓝
    { bg: '#F09595', fg: '#501313' }  // 红
  ];
  function paletteColor(idx) {
    const n = SELECT_PALETTE.length;
    const i = ((Math.floor(idx) % n) + n) % n;
    return SELECT_PALETTE[i];
  }

  // 单选字段默认选项（进度字段初始态，与参考图一致）
  function defaultOptions() {
    return ['已投递', '已测评', '笔试', '一面', '二面', '三面', 'HR面', 'Offer', '简历挂', '笔试挂', '面试挂']
      .map((label, i) => ({ id: uid('o'), label, colorIdx: i % SELECT_PALETTE.length }));
  }

  // 追加选项；空名/重名拒绝；colorIdx 取当前选项数（自动循环色板）
  function addOption(field, label) {
    const nm = String(label || '').trim();
    const opts = (field && field.options) || [];
    if (!nm) return { ok: false, error: '选项名不能为空', field };
    if (opts.some(o => o.label === nm)) return { ok: false, error: '选项已存在', field };
    const nf = Object.assign({}, field, {
      options: opts.concat([{ id: uid('o'), label: nm, colorIdx: opts.length % SELECT_PALETTE.length }])
    });
    return { ok: true, field: nf, option: nf.options[nf.options.length - 1] };
  }

  // 按 id 删除选项；id 不存在 → ok:false 原样返回
  function removeOptionById(field, optId) {
    const opts = (field && field.options) || [];
    if (!opts.some(o => o.id === optId)) return { ok: false, error: '选项不存在', field };
    return { ok: true, field: Object.assign({}, field, { options: opts.filter(o => o.id !== optId) }) };
  }

  // 改选项名；空名/与其他选项重名拒绝
  function renameOption(field, optId, label) {
    const nm = String(label || '').trim();
    const opts = (field && field.options) || [];
    if (!nm) return { ok: false, error: '选项名不能为空', field };
    if (opts.some(o => o.id !== optId && o.label === nm)) return { ok: false, error: '选项已存在', field };
    const exists = opts.some(o => o.id === optId);
    return {
      ok: exists,
      error: exists ? undefined : '选项不存在',
      field: Object.assign({}, field, { options: opts.map(o => o.id === optId ? Object.assign({}, o, { label: nm }) : o) })
    };
  }

  // 点击色块 → colorIdx +1 循环换色；不可变
  function cycleOptionColor(field, optId) {
    const opts = (field && field.options) || [];
    return {
      field: Object.assign({}, field, {
        options: opts.map(o => o.id === optId ? Object.assign({}, o, { colorIdx: o.colorIdx + 1 }) : o)
      })
    };
  }

  // 删除选项后清洗行数据：引用该选项的单元格值清空，其他数据不动
  function stripOptionFromRows(rows, fieldId, optId) {
    return (rows || []).map(r => {
      if (!r.cells || r.cells[fieldId] !== optId) return r;
      return Object.assign({}, r, { cells: Object.assign({}, r.cells, { [fieldId]: '' }) });
    });
  }

  // 按索引替换图片（单图字段：粘贴/选图覆盖旧图）；越界安全
  function replaceImage(rows, rowId, fieldId, index, dataUrl) {
    return (rows || []).map(r => {
      if (r.id !== rowId) return r;
      const imgs = Array.isArray(r.cells[fieldId]) ? r.cells[fieldId] : [];
      if (!Number.isInteger(index) || index < 0 || index >= imgs.length) return r;
      const next = imgs.slice();
      next[index] = dataUrl;
      return Object.assign({}, r, { cells: Object.assign({}, r.cells, { [fieldId]: next }) });
    });
  }

  return { uid, makeEmptyRow, addRow, removeRow, moveField, toggleField, addField, visibleFields, removeFieldById, stripCellKey, needCompress, addImage, removeImage, parseImgTarget, setCell, escapeHtml, IMAGE_LIMIT, SELECT_PALETTE, paletteColor, defaultOptions, addOption, removeOptionById, renameOption, cycleOptionColor, stripOptionFromRows, replaceImage };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DLogic;
if (typeof window !== 'undefined') window.DLogic = DLogic;
