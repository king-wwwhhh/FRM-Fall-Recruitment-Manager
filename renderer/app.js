'use strict';
// 秋招笔试工作台 渲染层（前端演示版）
// 架构约定：数据层(state/localStorage) -> 计算层 -> 渲染层 -> refreshAll 统一调度，渲染函数互不调用
// 邮件解析/持久化 IPC 为占位调用，稍后接入主进程逻辑

const now = new Date();
const D = (dayOffset, h, m) => {
  const d = new Date(); d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m === undefined ? 0 : m, 0, 0);
  return toISO(d);
};
function toISO(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}
const fmtMD = iso => { const d = new Date(iso); return `${d.getMonth()+1}/${d.getDate()}`; };
const fmtHM = iso => { const d = new Date(iso); const p=n=>String(n).padStart(2,'0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; };
const fmtDT = iso => iso ? `${fmtMD(iso)} ${fmtHM(iso)}` : '—';
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ===== 招聘事件类型表（与主进程 lib/llm.js TYPE_META 保持一致）=====
// 老版本只有 笔试/测评/面试 三类，简历完善、网申、AI面试、offer、宣讲会都无法归类显示。
// 所有类型相关的文案/颜色统一从这里取，避免散落各处的三元表达式漏改。
const TYPE_META = {
  exam:       { label: '笔试',      short: '笔试',   color: '#A32D2D', cls: 'tag-exam' },
  assessment: { label: '测评',      short: '测评',   color: '#EF9F27', cls: 'tag-asmt' },
  interview:  { label: '面试',      short: '面试',   color: '#378ADD', cls: 'tag-intv' },
  resume:     { label: '简历完善',  short: '简历',   color: '#639922', cls: 'tag-resume' },
  apply:      { label: '网申投递',  short: '网申',   color: '#7F77DD', cls: 'tag-apply' },
  offer:      { label: 'offer',     short: 'offer',  color: '#1D9E75', cls: 'tag-offer' },
  campus:     { label: '宣讲会',    short: '宣讲',   color: '#BA7517', cls: 'tag-campus' },
  other:      { label: '招聘相关',  short: '招聘',   color: '#888780', cls: 'tag-other' }
};
function typeMeta(t) { return TYPE_META[t] || TYPE_META.other; }

// 本地时间格式化：兼容 "2026-09-10T18:30:00"（本地，无 Z）与 "2026-09-10T10:30:00.000Z"（UTC）。
// 旧代码对 lastSyncAt 直接字符串切片显示 UTC，导致北京时间慢 8 小时（用户看到"早上10:15"）。
function fmtLocal(iso, withSec) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).replace('T', ' ').slice(0, 16);
  const p = n => String(n).padStart(2, '0');
  const s = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return withSec ? s + ':' + p(d.getSeconds()) : s;
}

const seed = []; // 浏览器预览兜底才用（见 loadEvents）；Electron 内从主进程 store 读真实数据

const store = {
  events: [],
  selectedDate: ymd(new Date()),
  viewYear: now.getFullYear(),
  viewMonth: now.getMonth(),
  loaded: false,
  syncInfo: null
};

// Electron 内：从主进程 store.json 读真实事件；纯浏览器预览：localStorage 兜底（可临时塞 seed 演示）
function loadEvents() {
  if (window.api && window.api.listEvents) {
    return window.api.listEvents().then(r => {
      if (r && r.ok) {
        store.events = r.events || [];
        store.syncInfo = r.sync || null;
      }
      store.loaded = true;
      refreshAll();
      return store.events;
    }).catch(() => { store.loaded = true; refreshAll(); return []; });
  }
  try {
    const raw = localStorage.getItem('wb_examcal_events');
    if (raw) { store.events = JSON.parse(raw); store.loaded = true; refreshAll(); return Promise.resolve(store.events); }
  } catch (e) {}
  store.events = JSON.parse(JSON.stringify(seed));
  store.loaded = true;
  refreshAll();
  return Promise.resolve(store.events);
}
// 保存（Task 4/5）：Electron 内按操作类型走精细 IPC 写主进程 store.json；
// 无 window.api（浏览器预览）时退回 localStorage 整表兜底
function persist(op, id, patch) {
  if (window.api) {
    let job = null;
    if (op === 'status') job = () => window.api.saveEventStatus(id, patch);
    else if (op === 'remove') job = () => window.api.removeEvent(id);
    else if (op === 'patch') job = () => window.api.patchEvent(id, patch);
    else if (op === 'add') job = () => window.api.addEvent(patch);
    if (job) { try { const p = job(); if (p && p.catch) p.catch(() => {}); } catch (e) {} return; }
  }
  try { localStorage.setItem('wb_examcal_events', JSON.stringify(store.events)); } catch (e) {}
}
function getEvent(id) { return store.events.find(e => e.id === id); }

// ===== 计算层 =====
function pending() { return store.events.filter(e => e.status === 'pending'); }
function doneOnes() { return store.events.filter(e => e.status === 'done'); }
function anchorOf(e) { return e.examAt || e.deadline || e.receivedAt; }
// 事件的"最终时限"：固定笔试=窗口结束(开考+时长)；限时任务=deadline；面试=开考时刻
function endTsOf(e) {
  if (e.examAt && e.durMin > 0) return new Date(e.examAt).getTime() + e.durMin * 6e4;
  if (e.deadline) return new Date(e.deadline).getTime();
  if (e.examAt) return new Date(e.examAt).getTime();
  return null;
}
function inWindow(e) {
  if (!e.examAt || !(e.durMin > 0)) return false;
  const s = new Date(e.examAt).getTime();
  const nowT = Date.now();
  return nowT >= s && nowT < s + e.durMin * 6e4;
}
function isOverdue(e) {
  const a = endTsOf(e);
  return a != null && a < Date.now();
}
// 今天要处理：仅「逾期」或「今天到期/今天开考」的事件；非今天的只留在日历
function todoList() {
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const limit = endToday.getTime();
  return pending()
    .filter(e => {
      const a = e.deadline || e.examAt;
      if (!a) return false;
      return new Date(a).getTime() <= limit;
    })
    .sort((x, y) => {
      const px = x.type === 'exam' ? 0 : 1, py = y.type === 'exam' ? 0 : 1;
      if (px !== py) return px - py;
      return new Date(anchorOf(x)) - new Date(anchorOf(y));
    });
}
// 横幅：今天有「开始时刻」的事项都值得顶到最上面（笔试开考、面试、宣讲会…），
// 旧逻辑只认 exam，导致今天的 AI 面试 / 宣讲会明明最紧急却完全不显示。
function bannerExam() {
  const today = ymd(new Date());
  const list = pending()
    .filter(e => e.examAt && e.examAt.slice(0, 10) === today)
    .sort((a, b) => new Date(a.examAt) - new Date(b.examAt));
  return list[0] || null;
}
function eventsOn(dateStr) {
  return pending().filter(e => {
    const days = new Set();
    if (e.examAt) days.add(e.examAt.slice(0, 10));
    if (e.deadline) days.add(e.deadline.slice(0, 10));
    // 邮件里没写时间的事件：挂在「收信日」那一格，避免直接消失
    if (!e.examAt && !e.deadline && e.receivedAt) {
      const d = localDay(e.receivedAt);
      if (d) days.add(d);
    }
    return days.has(dateStr);
  });
}
// 取某个时间串在本地时区对应的日期（receivedAt 是 UTC ISO，直接切片会差一天）
function localDay(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : ymd(d);
}
// ===== 倒计时：全应用唯一目标语义 =====
// 任何位置的倒计时只准调 cdInfo() 取目标，保证同一事件各处剩余时间一致。
// 固定笔试(exam)：开考前 → 指向「开考」；开考后(且有时长) → 指向「收卷」。
// 无固定开考时段(限时测评等) → 指向 deadline。
function cdInfo(e) {
  if (!e) return null;
  if (e.examAt) {
    const start = new Date(e.examAt).getTime();
    if (Date.now() < start) return { phase: '距开考', target: start };
    if (e.durMin > 0) return { phase: '距收卷', target: start + e.durMin * 6e4 };
    return null; // 已开考且无时长：不再倒计时
  }
  if (e.deadline) return { phase: '距截止', target: new Date(e.deadline).getTime() };
  return null;
}
// 剩余时长的文字（不带阶段前缀），如「还剩 2 小时 41 分」
function remainBody(t) {
  const p = n => String(n).padStart(2, '0');
  const d = Math.floor(t / 864e5), h = Math.floor(t % 864e5 / 36e5), m = Math.floor(t % 36e5 / 6e4);
  if (d >= 1) return `还剩 ${d} 天 ${h} 小时`;
  if (h >= 1) return `还剩 ${h} 小时 ${p(m)} 分`;
  if (m >= 1) return `还剩 ${m} 分钟`;
  return `还剩 ${Math.max(1, Math.ceil(t / 1e3))} 秒`;
}
// 横幅大字/详情带共用：超过 1 小时走人性化文字，1 小时内走 HH:MM:SS 秒跳
function bigCdText(info) {
  const t = info.target - Date.now();
  if (t <= 0) return '已到时间';
  const p = n => String(n).padStart(2, '0');
  if (t > 36e5) {
    const d = Math.floor(t / 864e5), h = Math.floor(t % 864e5 / 36e5), m = Math.floor(t % 36e5 / 6e4);
    return d >= 1 ? `还剩 ${d} 天 ${h} 小时 ${m} 分` : `还剩 ${h} 小时 ${p(m)} 分`;
  }
  return `${p(Math.floor(t / 36e5))}:${p(Math.floor(t % 36e5 / 6e4))}:${p(Math.floor(t % 6e4 / 1e3))}`;
}
// 列表等紧凑位置的完整文案：自带阶段前缀，如「距开考 还剩 2 小时 41 分」
function humanCd(e) {
  const info = cdInfo(e);
  if (!info) return '';
  const t = info.target - Date.now();
  return t <= 0 ? `${info.phase} · 已到时间` : `${info.phase} ${remainBody(t)}`;
}
function cdText(e) { return humanCd(e); }

// ===== 渲染层 =====
function refreshAll() {
  if (store.events.length === 0) renderGuide(); else renderBanner();
  renderTodo();
  renderCalendar();
  renderDetail();
  renderDrawer();
  renderSyncInfo();
  document.getElementById('doneCount').textContent = `(${doneOnes().length})`;
}

function renderSyncInfo() {
  const el = document.getElementById('syncInfo');
  const n = store.events.length;
  const s = store.syncInfo;
  if (s && s.lastSyncAt) {
    // 用 fmtLocal 转本地时区显示（旧代码直接切 UTC 字符串，慢了 8 小时）
    el.innerHTML = `<span class="dot"></span>已同步 ${fmtLocal(s.lastSyncAt, true)} · 事件 ${n} 条 · 水位 INBOX:${s.lastUid || 0}`;
  } else if (n > 0) {
    el.innerHTML = `<span class="dot" style="background:#BA7517"></span>事件 ${n} 条 · 尚未拉取过邮箱`;
  } else {
    el.innerHTML = `<span class="dot" style="background:#E24B4A"></span>未配置邮箱 · 事件 0 条 · 请点「设置」`;
  }
}

// 空态引导（没配置过邮箱且没有任何事件时）
function renderGuide() {
  const host = document.getElementById('bannerHost');
  if (store.events.length > 0) { host.innerHTML = ''; return; }
  host.innerHTML = `
  <div class="banner" style="border-left-color:var(--accent)">
    <span class="badge gray">开始使用</span>
    <div>
      <div class="banner-title">还没有任何招聘事件</div>
      <div class="banner-sub">你点上方「设置」→ 填入 QQ 邮箱地址和授权码 → 保存后点「刷新邮件」，笔试 / 测评 / 面试 / AI面试 / 简历完善 / 网申 / 宣讲会等招聘邮件都会自动解析成日历事件；也可以现在就用「+ 手动添加」录入。</div>
    </div>
  </div>`;
}

function renderBanner() {
  const host = document.getElementById('bannerHost');
  const e = bannerExam();
  if (!e) { host.innerHTML = ''; return; }
  const info = cdInfo(e);
  const meta = typeMeta(e.type);
  const verb = e.type === 'exam' ? '开考' : '开始';
  host.innerHTML = `
  <div class="banner">
    <span class="badge">今天${meta.short}</span>
    <div>
      <div class="banner-title">${esc(e.company)} · ${esc(e.name)}</div>
      <div class="banner-sub">${fmtHM(e.examAt)} ${verb}${e.durMin ? ` · 预计时长 ${e.durMin} 分钟` : ''}${e.link ? ' · 已完成后可点右侧按钮移除' : ''}</div>
    </div>
    <div class="banner-cd">
      <div class="cd-big" data-cd="${e.id}">${info ? bigCdText(info) : '--:--:--'}</div>
      <div class="cd-label">${info ? info.phase : ''}</div>
    </div>
    <div class="banner-actions">
      ${e.link ? `<button class="btn btn-primary" data-open="${e.id}">打开${meta.label}链接</button>` : ''}
      <button class="btn" data-done="${e.id}">完成并移除</button>
    </div>
  </div>`;
}

function renderTodo() {
  const list = todoList();
  const host = document.getElementById('todoList');
  if (!list.length) { host.innerHTML = '<p class="empty-line">今天没有到期或开考的事项，可以安心刷题。未来的安排看下方日历。</p>'; return; }
  host.innerHTML = list.map(e => {
    const overdue = isOverdue(e);
    const meta = typeMeta(e.type);
    const label = meta.label;
    const cls = meta.cls;
    const endIso = e.examAt && e.durMin > 0 ? toISO(new Date(endTsOf(e))) : null;
    const timeNote = overdue
      ? `已逾期（${endIso ? '窗口结束' : '截止'} ${fmtDT(endIso || e.deadline || e.examAt)}）· 自动顺延`
      : inWindow(e) ? `${label}进行中 · ${fmtHM(endIso)} 结束`
      : e.examAt ? `${fmtMD(e.examAt)} ${fmtHM(e.examAt)} ${e.type === 'exam' ? '开考' : '开始'}` : `截止 ${fmtDT(e.deadline)}`;
    const guessTag = '';
    return `
    <div class="item ${e.type === 'exam' ? 'exam' : ''}">
      <span class="tag ${cls}">${label}</span>
      <span class="item-name">${esc(e.company)} · ${esc(e.name)}</span>
      <span class="item-note ${overdue ? 'warn' : ''}">${timeNote}${guessTag}</span>
      ${overdue ? '' : `<span class="item-cd" data-cdrow="${e.id}">${cdText(e) || ''}</span>`}
      <span class="item-actions">
        ${e.link ? `<button class="mini-btn" data-open="${e.id}">打开链接</button>` : ''}
        <button class="mini-btn" data-done="${e.id}">完成并移除</button>
      </span>
    </div>`;
  }).join('');
}

function renderCalendar() {
  const y = store.viewYear, mo = store.viewMonth;
  document.getElementById('calTitle').textContent = `${y}年${mo + 1}月`;
  const first = new Date(y, mo, 1);
  let start = new Date(first);
  const dow = (first.getDay() + 6) % 7; // 周一开头
  start.setDate(first.getDate() - dow);
  let html = '<tr>' + ['一', '二', '三', '四', '五', '六', '日'].map(d => `<th>${d}</th>`).join('') + '</tr>';
  const todayStr = ymd(new Date());
  const cur = new Date(start);
  for (let w = 0; w < 6; w++) {
    html += '<tr>';
    for (let i = 0; i < 7; i++) {
      const ds = ymd(cur);
      const dim = cur.getMonth() !== mo;
      const dayEvents = eventsOn(ds);
      const hasExamToday = dayEvents.some(e => e.type === 'exam' && e.examAt && e.examAt.slice(0, 10) === ds);
      const cls = [dim ? 'dim' : '', hasExamToday ? 'examcell' : '', ds === store.selectedDate ? 'selected' : ''].filter(Boolean).join(' ');
      // 一个事件可能在同一天占两行（如上午开考、当天 23:59 截止），所以先摊平成行再截断
      const rows = [];
      dayEvents.forEach(e => {
        const meta = typeMeta(e.type);
        const sn = String(e.company || '').slice(0, 2);
        const onExam = e.examAt && e.examAt.slice(0, 10) === ds;
        const onDdl = e.deadline && e.deadline.slice(0, 10) === ds;
        // 邮件未写明时间：只挂收信日，显示「待定」，不编造时刻
        const onUnknown = !e.examAt && !e.deadline && localDay(e.receivedAt) === ds;
        if (onUnknown) {
          rows.push({
            color: meta.color,
            key: false,
            txt: `${sn}·${meta.short}（待定）`,
            title: `${e.company} · ${e.name || meta.label}｜邮件未写明时间，点开后可手动补填`
          });
        }
        if (onExam) {
          rows.push({
            color: meta.color,
            key: e.type === 'exam',
            txt: `${fmtHM(e.examAt)} ${sn}·${meta.short}`,
            title: `${e.company} · ${e.name || meta.label}｜${fmtLocal(e.examAt)} ${meta.label}`
          });
        }
        if (onDdl) {
          rows.push({
            color: meta.color,
            key: false,
            txt: `${fmtHM(e.deadline)} ${sn}·截止`,
            title: `${e.company} · ${e.name || meta.label}｜截止 ${fmtLocal(e.deadline)}`
          });
        }
      });
      const lines = rows.slice(0, 4).map(r =>
        `<div class="evline ${r.key ? 'key' : ''}" title="${esc(r.title)}"><i style="background:${r.color}"></i>${esc(r.txt)}</div>`
      ).join('');
      const todayTag = ds === todayStr ? '<div class="evline" style="color:var(--accent)">今天</div>' : '';
      html += `<td class="${cls}" data-day="${ds}"><span class="dnum">${cur.getMonth() + 1}/${cur.getDate()}</span>${lines}${todayTag}</td>`;
      cur.setDate(cur.getDate() + 1);
    }
    html += '</tr>';
    if (w === 5 && cur.getMonth() !== mo) break;
  }
  document.getElementById('calTable').innerHTML = html;
}

function renderDetail() {
  const host = document.getElementById('detailBody');
  const ds = store.selectedDate;
  const evs = eventsOn(ds);
  if (!evs.length) { host.innerHTML = `<p class="muted">${ds} 没有事件</p>`; return; }
  host.innerHTML = evs.map(e => {
    const meta = typeMeta(e.type);
    const label = meta.label;
    const cls = meta.cls;
    const timeName = e.type === 'exam' ? '考试时段' : e.type === 'interview' ? '面试时间' : e.type === 'campus' ? '活动时段' : '开始时间';
    return `
    <div class="detail-tagline"><span class="tag ${cls}">${label}</span><b>${esc(e.company)} · ${esc(e.name)}</b></div>
    <div class="kv"><span>收信时间</span><span>${fmtDT(e.receivedAt)}</span></div>
    ${e.examAt ? `<div class="kv"><span>${timeName}</span><span class="em">${fmtMD(e.examAt)} ${fmtHM(e.examAt)}–${e.durMin ? fmtHM(toISO(new Date(new Date(e.examAt).getTime() + e.durMin * 6e4))) : ''}</span></div>` : ''}
    ${e.deadline ? `<div class="kv"><span>截止时间</span><span class="em">${fmtLocal(e.deadline)}</span></div>` : ''}
    ${!e.examAt && !e.deadline ? `<div class="kv"><span>时间</span><span style="color:#BA7517">邮件未写明 · 请在下方补填或用「编辑」修正</span></div>` : ''}
    <div class="kv"><span>邮件主题</span><span>${esc(e.rawSubject || '')}</span></div>
    <div class="kv"><span>来源邮件</span><span>${esc(e.source || '手动添加')}</span></div>
    ${e.examAt || e.deadline ? `<div class="cd-band" data-cd="${e.id}">--</div>` : ''}
    ${e.link ? `<button class="link-btn" data-open="${e.id}">进入笔试系统 ↗</button>` : '<p class="muted" style="margin-top:8px">该事件无链接（邮件里未解析到或手动添加未填）</p>'}
    <button class="btn-full btn-done" data-done="${e.id}">完成并移除</button>
    <button class="btn-full btn-del" data-del="${e.id}">删除事件</button>`;
  }).join('<hr style="border:none;border-top:1px solid var(--border);margin:14px 0">');
}

function renderDrawer() {
  const host = document.getElementById('doneList');
  const list = doneOnes().sort((a, b) => new Date(b.examAt || b.deadline) - new Date(a.examAt || a.deadline));
  if (!list.length) { host.innerHTML = '<p class="empty-line">还没有已完成的事件</p>'; return; }
  host.innerHTML = list.map(e => `
    <div class="item done-item">
      <span class="item-name">${esc(e.company)} · ${esc(e.name)}</span>
      <span class="item-note">${fmtDT(e.examAt || e.deadline)}</span>
      <span class="item-actions">
        <button class="mini-btn" data-revert="${e.id}">恢复</button>
        <button class="mini-btn danger" data-del="${e.id}">删除</button>
      </span>
    </div>`).join('');
}

// ===== 倒计时（软件运行期间）=====
function tick() {
  document.querySelectorAll('[data-cd]').forEach(el => {
    const e = getEvent(el.dataset.cd);
    if (!e || e.status !== 'pending') return;
    const info = cdInfo(e);
    // 横幅大字的旁边有 .cd-label 小字（阶段放小字里）；详情带没有，则直接把阶段拼进文字
    const lb = el.parentElement ? el.parentElement.querySelector('.cd-label') : null;
    if (!info) { el.textContent = '--:--:--'; if (lb) lb.textContent = ''; return; }
    el.textContent = (lb ? '' : info.phase + ' ') + bigCdText(info);
    if (lb) lb.textContent = info.phase;
  });
  document.querySelectorAll('[data-cdrow]').forEach(el => {
    const e = getEvent(el.dataset.cdrow);
    if (!e) return;
    const s = cdText(e);
    if (s) el.textContent = s;
  });
}

// ===== 交互（事件委托，单向调用）=====
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('button, td[data-day], .link-btn');
  if (!t) return;
  if (t.dataset.done) { const e = getEvent(t.dataset.done); if (e) { e.status = 'done'; persist('status', e.id, 'done'); refreshAll(); } return; }
  if (t.dataset.revert) { const e = getEvent(t.dataset.revert); if (e) { e.status = 'pending'; persist('status', e.id, 'pending'); refreshAll(); } return; }
  if (t.dataset.del) {
    const e = getEvent(t.dataset.del);
    if (e && confirm(`彻底删除「${e.company} ${e.name}」？此操作不可恢复`)) {
      store.events = store.events.filter(x => x.id !== t.dataset.del);
      persist('remove', t.dataset.del);
      refreshAll();
    }
    return;
  }
  if (t.dataset.open) {
    const e = getEvent(t.dataset.open);
    if (e && e.link) {
      if (window.api) window.api.openLink(e.link); else window.open(e.link, '_blank');
    }
    return;
  }
  if (t.tagName === 'TD' && t.dataset.day) { store.selectedDate = t.dataset.day; refreshAll(); return; }
  switch (t.id) {
    case 'btnRefresh': doRefreshMail(); break;
    case 'btnDeepScan':
      if (confirm('深度重扫会忽略水位线，重新解析近期全部邮件，并清掉旧的、未完成的解析结果（手动添加和已完成的事件会保留）。\n\n识别规则升级后用它补回历史邮件。耗时较长，确定继续？')) doRefreshMail(true);
      break;
    case 'btnAddOpen': document.getElementById('addModal').hidden = false; break;
    case 'btnAddCancel': document.getElementById('addModal').hidden = true; break;
    case 'btnAddSave': doAddSave(); break;
    case 'btnDrawer': document.getElementById('doneDrawer').classList.toggle('open'); break;
    case 'btnDrawerClose': document.getElementById('doneDrawer').classList.remove('open'); break;
    case 'btnMailClose': document.getElementById('mailDrawer').classList.remove('open'); break;
    case 'btnPrevM': store.viewMonth--; if (store.viewMonth < 0) { store.viewMonth = 11; store.viewYear--; } renderCalendar(); break;
    case 'btnNextM': store.viewMonth++; if (store.viewMonth > 11) { store.viewMonth = 0; store.viewYear++; } renderCalendar(); break;
    case 'btnToday': store.selectedDate = ymd(new Date()); store.viewYear = new Date().getFullYear(); store.viewMonth = new Date().getMonth(); refreshAll(); break;
    case 'btnExport': doExport(); break;
    case 'btnImport': document.getElementById('importModal').hidden = false; break;
    case 'btnImpCancel': document.getElementById('importModal').hidden = true; break;
    case 'btnImpMerge': doImport('merge'); break;
    case 'btnImpOverwrite': doImport('overwrite'); break;
    case 'btnSettings': openSettings(); break;
    case 'btnCfgCancel': document.getElementById('settingsModal').hidden = true; break;
    case 'btnCfgSave': saveSettings(); break;
    case 'btnOpenGuide': { const m = document.getElementById('setupGuideModal'); if (m) m.hidden = false; break; }
    case 'btnTestMail': testMailConn(); break;
    case 'btnTestLLM': testLlmConn(); break;
    case 'btnAuthEye': toggleEye('cfgAuth', 'btnAuthEye'); break;
    case 'btnLlmEye': toggleEye('cfgLlmKey', 'btnLlmEye'); break;
    case 'btnDelivery': toggleDeliveryView(); break;
  }
});

// ===== 投递记录 · 视图切换（Task 1）=====
// 决策树：点击 #btnDelivery → 目标视图与当前显示视图互斥切换，按钮同步选中态
function showView(v) {
  document.getElementById('view-calendar').hidden = v !== 'calendar';
  document.getElementById('view-delivery').hidden = v !== 'delivery';
  document.getElementById('btnDelivery').classList.toggle('active', v === 'delivery');
}
function toggleDeliveryView() {
  showView(document.getElementById('view-delivery').hidden ? 'delivery' : 'calendar');
}

// ===== 投递记录 · 数据与渲染（Task 3 起）=====
// 数据流：loadDeliveries(IPC) → dstate → renderDelivery() 纯渲染
//         用户操作 → 改 dstate（走 lib/deliveryLogic 纯函数）→ scheduleSave 防抖500ms 落盘 → renderDelivery()
const dstate = { fields: [], rows: [], loaded: false, saveTimer: null, pendingImg: null };

// 预览模式（无 window.api）兜底字段，与 lib/deliveryStore.js 的默认字段保持一致
function dvDefaultFields() {
  return [
    { id: 'company', name: '公司', type: 'text', visible: true },
    { id: 'jobtype', name: '岗位类别', type: 'text', visible: true },
    { id: 'req', name: '要求', type: 'image', visible: true },
    { id: 'progress', name: '进度', type: 'select', visible: true, options: DLogic.defaultOptions() },
    { id: 'link', name: '链接', type: 'text', visible: true },
    { id: 'ref', name: '内推码', type: 'text', visible: true },
    { id: 'time', name: '投递时间', type: 'text', visible: true },
    { id: 'itime', name: '预期面试时间', type: 'text', visible: true },
    { id: 'tested', name: '已测评', type: 'text', visible: true }
  ];
}

async function loadDeliveries() {
  if (window.api && window.api.deliveriesGet) {
    try {
      const r = await window.api.deliveriesGet();
      if (r && r.ok && r.data) { dstate.fields = r.data.fields; dstate.rows = r.data.rows; }
    } catch (e) {}
  } else {
    try {
      const raw = localStorage.getItem('wb_deliveries');
      if (raw) { const d = JSON.parse(raw); dstate.fields = d.fields; dstate.rows = d.rows; }
    } catch (e) {}
  }
  if (!dstate.fields.length) dstate.fields = dvDefaultFields();
  dstate.loaded = true;
  renderDelivery();
}

// 防抖落盘：500ms 内的连续操作只写一次盘
function scheduleSave() {
  clearTimeout(dstate.saveTimer);
  dstate.saveTimer = setTimeout(flushSave, 500);
}
function flushSave() {
  clearTimeout(dstate.saveTimer);
  dstate.saveTimer = null;
  const db = { fields: dstate.fields, rows: dstate.rows };
  if (window.api && window.api.deliveriesSave) {
    window.api.deliveriesSave(db).catch(() => {});
  } else {
    try { localStorage.setItem('wb_deliveries', JSON.stringify(db)); } catch (e) {}
  }
}

function dvVisibleFields() { return dstate.fields.filter(f => f.visible); }

function renderDelivery() {
  renderDeliveryHead();
  renderDeliveryBody();
  renderFieldPanel();
}

// ----- Task 4：字段管理面板 -----
// 决策树：
// 点击「字段管理」→ 面板开/关（点击面板外自动收起）
// 面板内：
//  ├─ 拖拽 ⠿ → dragover 目标行 → moveField(from,to) → scheduleSave → 面板+表头实时重排
//  ├─ 点击开关 → toggleField(id) → visible 取反（隐藏仅不渲染列，数据保留）→ scheduleSave → render
//  └─ 输入框 Enter → 空名/重名 → toast 提示，不动数据；合法 → addField → scheduleSave → 表头多一列
function renderFieldPanel() {
  const panel = document.getElementById('dFieldPanel');
  if (panel.hidden) return;
  panel.innerHTML = '<div class="tv-panel-h">字段管理</div>'
    + dstate.fields.map((f, i) => `
      <div class="fi" draggable="true" data-fi="${i}">
        <span class="grip">⠿</span>
        <span class="fname" title="${esc(f.name)}">${esc(f.name)}</span>
        <span class="ftype">${f.type === 'image' ? '图片' : f.type === 'select' ? '单选' : '文本'}</span>
        <button class="tv-sw${f.visible ? '' : ' off'}" title="${f.visible ? '点击隐藏' : '点击显示'}" data-dsw="${f.id}"><i></i></button>
        <button class="fdel" title="删除字段（含各行数据）" data-dfieldel="${f.id}">×</button>
      </div>`).join('')
    + '<div class="fadd"><span>⊕</span><input id="dFieldName" placeholder="新增字段，回车确认" autocomplete="off"></div>';
}

function renderDeliveryHead() {
  const tr = document.getElementById('dThead');
  tr.innerHTML = '<th class="tv-num">#</th>'
    + dvVisibleFields().map(f => `<th title="${esc(f.name)}">${esc(f.name)}</th>`).join('')
    + '<th class="tv-op"></th>';
}

function renderDeliveryBody() {
  const tb = document.getElementById('dTbody');
  if (!dstate.rows.length) {
    tb.innerHTML = '<tr><td colspan="99" style="text-align:center;color:var(--text2);padding:26px 0">还没有投递记录，点上方「⊞ 添加一行」开始记录</td></tr>';
    return;
  }
  tb.innerHTML = dstate.rows.map((r, i) => {
    const cells = dvVisibleFields().map(f => {
      if (f.type === 'image') {
        const imgs = Array.isArray(r.cells[f.id]) ? r.cells[f.id] : [];
        // 单图字段（IMAGE_LIMIT=1）：满员后「+」消失，粘贴/选图即替换
        const atLimit = imgs.length >= (DLogic.IMAGE_LIMIT || 1);
        const thumbs = imgs.map((src, j) =>
          `<span class="tv-thumb"><img src="${src}" data-dview="${r.id}|${f.id}|${j}" alt=""><button class="tv-imgdel" title="删除图片" data-dimgdel="${r.id}|${f.id}|${j}">×</button></span>`
        ).join('');
        const addBtn = atLimit ? '' : `<button class="tv-imgadd" title="点击上传，或直接 Ctrl+V 粘贴截图" data-dimgadd="${r.id}|${f.id}">+</button>`;
        return `<td class="imgcell" data-dimgcell="${r.id}|${f.id}">${thumbs}${addBtn}</td>`;
      }
      if (f.type === 'select') {
        // 单选字段：单元格显示彩色胶囊；点击弹选项列表（色块点击换色，见 sel-pop 交互）
        const optId = r.cells[f.id] || '';
        const opt = (f.options || []).find(o => o.id === optId);
        const inner = opt
          ? (() => { const c = DLogic.paletteColor(opt.colorIdx); return `<span class="sel-pill" style="background:${c.bg};color:${c.fg}" data-selopen="${r.id}|${f.id}">${DLogic.escapeHtml(opt.label)}</span>`; })()
          : `<span class="sel-empty" style="color:var(--text3);cursor:pointer;font-size:12px" data-selopen="${r.id}|${f.id}">○ 选择</span>`;
        return `<td class="sel-cell">${inner}</td>`;
      }
      return `<td><input class="cell" data-dcell="${r.id}|${f.id}" value="${DLogic.escapeHtml(r.cells[f.id] || '')}" autocomplete="off"></td>`;
    }).join('');
    return `<tr><td class="tv-num">${i + 1}</td>${cells}<td><button class="tv-del" title="删除该行" data-drow="${r.id}">×</button></td></tr>`;
  }).join('');
}

// ----- Task 3：行操作交互（事件委托在 #view-delivery 上） -----
// 决策树：
// 点击「添加一行」→ addRow → scheduleSave → render → 新行进入视野
// 点击行尾 × → confirm
//   ├─ 取消 → 中止
//   └─ 确认 → removeRow → scheduleSave → render
document.getElementById('view-delivery').addEventListener('click', (ev) => {
  const t = ev.target.closest('button, img');
  if (!t) return;
  if (t.id === 'dAddRow') {
    dstate.rows = DLogic.addRow(dstate.rows, dstate.fields);
    scheduleSave(); renderDelivery();
    const tb = document.getElementById('dTbody');
    const last = tb.querySelector('tr:last-child');
    if (last) {
      last.scrollIntoView({ block: 'nearest' });
      const firstInput = last.querySelector('input.cell'); // 焦点直达新行第一格，可直接打字
      if (firstInput) firstInput.focus();
    }
    return;
  }
  const delBtn = t.closest('[data-drow]');
  if (delBtn) {
    const id = delBtn.dataset.drow;
    if (confirm('删除该行投递记录？')) {
      dstate.rows = DLogic.removeRow(dstate.rows, id);
      scheduleSave(); renderDelivery();
    }
    return;
  }
  if (t.id === 'dFieldsBtn') {
    const panel = document.getElementById('dFieldPanel');
    panel.hidden = !panel.hidden;
    renderFieldPanel();
    return;
  }
  const sw = t.closest('[data-dsw]');
  if (sw) {
    dstate.fields = DLogic.toggleField(dstate.fields, sw.dataset.dsw);
    scheduleSave(); renderDelivery();
    return;
  }
  // 删除字段：确认后连同各行数据一起清除
  const fdel = t.closest('[data-dfieldel]');
  if (fdel) {
    const f = dstate.fields.find(x => x.id === fdel.dataset.dfieldel);
    if (!f) return;
    if (!confirm(`删除字段「${f.name}」？该列所有数据（含图片）将被清除，不可恢复。`)) return;
    dstate.fields = DLogic.removeFieldById(dstate.fields, f.id);
    dstate.rows = DLogic.stripCellKey(dstate.rows, f.id);
    scheduleSave(); renderDelivery();
    toast(`已删除字段「${f.name}」`);
    return;
  }
});

// 字段新增：输入框 Enter 提交（空名/重名被纯函数拒绝后 toast 提示）
document.getElementById('dFieldPanel').addEventListener('keydown', (ev) => {
  if (ev.target.id !== 'dFieldName' || ev.key !== 'Enter') return;
  const r = DLogic.addField(dstate.fields, ev.target.value);
  if (!r.ok) { toast(r.error || '无法新增字段'); return; }
  dstate.fields = r.fields;
  scheduleSave(); renderDelivery();
  toast('已新增字段「' + r.field.name + '」');
});

// 面板拖拽调序：dragstart 记起点，dragover 到目标行即实时 moveField（表头同步重排）
let dDragFrom = null;
document.getElementById('dFieldPanel').addEventListener('dragstart', (ev) => {
  const fi = ev.target.closest('.fi');
  if (!fi) return;
  dDragFrom = parseInt(fi.dataset.fi, 10);
  fi.classList.add('tv-dragging');
  ev.dataTransfer.effectAllowed = 'move';
});
document.getElementById('dFieldPanel').addEventListener('dragover', (ev) => {
  const fi = ev.target.closest('.fi');
  if (!fi || dDragFrom === null) return;
  ev.preventDefault();
  const to = parseInt(fi.dataset.fi, 10);
  if (to === dDragFrom) return;
  dstate.fields = DLogic.moveField(dstate.fields, dDragFrom, to);
  dDragFrom = to;
  renderDelivery();
  const now = document.querySelector(`#dFieldPanel .fi[data-fi="${to}"]`);
  if (now) now.classList.add('tv-dragging');
});
document.getElementById('dFieldPanel').addEventListener('dragend', () => {
  dDragFrom = null;
  scheduleSave();
  renderFieldPanel();
});

// 点击面板外部自动收起字段面板
document.addEventListener('click', (ev) => {
  const panel = document.getElementById('dFieldPanel');
  if (panel.hidden) return;
  if (!ev.target.closest('.tv-pm')) {
    panel.hidden = true;
    renderFieldPanel();
  }
}, true);

// Esc 统一收口：图片浮层 > 单选弹层 > 字段面板
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  const mask = document.getElementById('dImgMask');
  if (!mask.hidden) { mask.hidden = true; return; }
  if (selPop.open) { closeSelPop(); return; }
  const panel = document.getElementById('dFieldPanel');
  if (!panel.hidden) { panel.hidden = true; renderFieldPanel(); }
});

// ----- Task 5：图片上传 / 缩略图 / 详情浮层 -----
// 决策树：
// 「+」→ pendingImg={rowId,fieldId} → 系统选图
//  └─ change → FileReader → needCompress? 压缩 : 直存 → addImage → scheduleSave → render
// 缩略图点击 → parseImgTarget → 浮层(src=该图)；×/遮罩/Esc 关闭
// 缩略图 hover × → parseImgTarget → removeImage → scheduleSave → render
function compressImage(dataUrl, maxEdge) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      if (Math.max(img.width, img.height) <= maxEdge) { resolve(dataUrl); return; }
      const sc = maxEdge / Math.max(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * sc);
      c.height = Math.round(img.height * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl); // 读不出的图原样入库，不阻塞
    img.src = dataUrl;
  });
}
function openImgModal(src) {
  const mask = document.getElementById('dImgMask');
  document.getElementById('dImgModal').innerHTML =
    '<button class="tv-close" id="dImgClose" title="关闭">×</button>' +
    '<img src="' + src + '" alt="图片详情">';
  mask.hidden = false;
}
document.getElementById('view-delivery').addEventListener('click', (ev) => {
  const t = ev.target.closest('button, img');
  if (!t) return;
  if (t.dataset.dview) {
    const p = DLogic.parseImgTarget(t.dataset.dview);
    if (p) {
      const row = dstate.rows.find(r => r.id === p.rowId);
      const src = row && Array.isArray(row.cells[p.fieldId]) ? row.cells[p.fieldId][p.index] : null;
      if (src) openImgModal(src);
    }
    return;
  }
  const imgDel = t.closest('[data-dimgdel]');
  if (imgDel) {
    const p = DLogic.parseImgTarget(imgDel.dataset.dimgdel);
    if (p) {
      dstate.rows = DLogic.removeImage(dstate.rows, p.rowId, p.fieldId, p.index);
      scheduleSave(); renderDelivery();
    }
    return;
  }
  const imgAdd = t.closest('[data-dimgadd]');
  if (imgAdd) {
    const parts = imgAdd.dataset.dimgadd.split('|');
    dstate.pendingImg = { rowId: parts[0], fieldId: parts[1] };
    document.getElementById('dFileInput').click();
    return;
  }
  if (t.id === 'dImgClose' || t.id === 'dImgMask') {
    document.getElementById('dImgMask').hidden = true;
  }
});
// 点遮罩空白处关闭（点在 modal 内容上不关）
document.getElementById('dImgMask').addEventListener('click', (ev) => {
  if (ev.target.id === 'dImgMask') document.getElementById('dImgMask').hidden = true;
});
// 选图完成：读文件 → 视大小决定是否压缩 → 入行数据
document.getElementById('dFileInput').addEventListener('change', async (ev) => {
  const f = ev.target.files && ev.target.files[0];
  ev.target.value = ''; // 允许重复选同一文件
  const p = dstate.pendingImg;
  dstate.pendingImg = null;
  if (!f || !p) return;
  if (!/^image\//.test(f.type)) { toast('只能上传图片文件'); return; }
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(f);
  }).catch(() => null);
  if (!dataUrl) { toast('图片读取失败'); return; }
  const finalUrl = DLogic.needCompress(dataUrl.length) ? await compressImage(dataUrl, 1600) : dataUrl;
  // 单图字段：已有图 → 替换第一张；否则新增
  const row = dstate.rows.find(r => r.id === p.rowId);
  const imgs = row && Array.isArray(row.cells[p.fieldId]) ? row.cells[p.fieldId] : [];
  const limit = DLogic.IMAGE_LIMIT || 1;
  if (imgs.length >= limit) {
    dstate.rows = DLogic.replaceImage(dstate.rows, p.rowId, p.fieldId, 0, finalUrl);
  } else {
    dstate.rows = DLogic.addImage(dstate.rows, p.rowId, p.fieldId, finalUrl);
  }
  scheduleSave(); renderDelivery();
  toast('图片已添加');
});

// ----- Task 6：就地编辑单元格 -----
// 决策树：
// input.cell 的 input 事件 → setCell 只改内存（打字不落盘不重渲，防卡顿）
// blur / Enter → blur → scheduleSave(防抖500ms) → 落盘
document.getElementById('dTbody').addEventListener('input', (ev) => {
  const inp = ev.target.closest('input.cell');
  if (!inp) return;
  const parts = inp.dataset.dcell.split('|');
  if (parts.length !== 2) return;
  dstate.rows = DLogic.setCell(dstate.rows, parts[0], parts[1], inp.value);
  scheduleSave();
});
document.getElementById('dTbody').addEventListener('keydown', (ev) => {
  if (ev.target.classList && ev.target.classList.contains('cell') && ev.key === 'Enter') {
    ev.target.blur(); // Enter = 确认并落盘（触发 blur 路径）
  }
});

// ----- Task A：单选字段（select）-----
// 决策树：
// 点击胶囊/「○ 选择」→ selopen 弹层，定位到单元格正下方
// 弹层内：
//  ├─ 点击选项行 → setCell(该格=选项id) → scheduleSave → render（胶囊变色）
//  ├─ 点击色块（不关弹层）→ cycleOptionColor → scheduleSave → render（当前弹层与表格同步换色）
//  ├─ 点击「⚙ 选项管理」→ 原地切换为管理视图（改名输入框/减号删项/⊕添加选项）
//  └─ 点击弹层外/Esc → 关闭
const selPop = { open: false, fieldId: null, managing: false };
function closeSelPop() {
  selPop.open = false;
  const el = document.getElementById('dSelPop');
  if (el) el.remove();
}
function optionRow(f, o, managing) {
  const c = DLogic.paletteColor(o.colorIdx);
  if (!managing) {
    return `<div class="sel-item" data-selpick="${o.id}"><span class="sel-pill" style="background:${c.bg};color:${c.fg}">${DLogic.escapeHtml(o.label)}</span></div>`;
  }
  return `<div class="opt-row" data-optrow="${o.id}">
    <span class="opt-color" title="点击换色" style="background:${c.bg}" data-selcolor="${o.id}"></span>
    <input class="opt-name" value="${DLogic.escapeHtml(o.label)}" data-selrename="${o.id}">
    <button class="opt-del" title="删除该选项" data-seldelopt="${o.id}">−</button>
  </div>`;
}
function renderSelPop(anchor) {
  closeSelPop();
  const f = dstate.fields.find(x => x.id === selPop.fieldId);
  if (!f) return;
  const pop = document.createElement('div');
  pop.id = 'dSelPop';
  pop.className = 'sel-pop';
  pop._anchor = anchor; // 记住打开者，重绘弹层时要复用
  if (selPop.managing) {
    pop.innerHTML = `<div class="tv-panel-h" style="border-bottom:none;padding-bottom:0">${DLogic.escapeHtml(f.name)} · 选项管理</div>
      <div class="opt-list">${(f.options || []).map(o => optionRow(f, o, true)).join('')}</div>
      <div class="opt-add"><span style="flex:none">⊕</span><input id="dSelOptName" placeholder="添加选项，回车确认" autocomplete="off"></div>`;
  } else {
    pop.innerHTML = (f.options || []).map(o => optionRow(f, o, false)).join('')
      + '<div class="sel-item" data-selmanage style="border-top:1px solid var(--border);margin-top:4px;color:var(--text2)">⚙ 选项管理</div>';
  }
  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  pop.style.left = Math.min(rect.left, window.innerWidth - pop.offsetWidth - 12) + 'px';
  pop.style.top = Math.min(rect.bottom + 4, window.innerHeight - pop.offsetHeight - 12) + 'px';
  selPop.open = true;
}
// 弹层挂在 body 上（不在 #view-delivery 内），因此弹层内交互用 document 级委托
document.addEventListener('click', (ev) => {
  // ② 弹层内交互（先于开关判断：弹层内部点击不会走到下面的开关分支）
  const pop = document.getElementById('dSelPop');
  if (pop && pop.contains(ev.target)) {
    const f = dstate.fields.find(x => x.id === selPop.fieldId);
    if (!f) { closeSelPop(); return; }
    const pick = ev.target.closest('[data-selpick]');
    if (pick) {
      dstate.rows = DLogic.setCell(dstate.rows, selPop.rowId, selPop.fieldId, pick.dataset.selpick);
      scheduleSave(); renderDelivery(); closeSelPop();
      return;
    }
    if (ev.target.closest('[data-selmanage]')) {
      selPop.managing = true;
      renderSelPop(pop._anchor);
      return;
    }
    const colorBtn = ev.target.closest('[data-selcolor]');
    if (colorBtn) {
      const r = DLogic.cycleOptionColor(f, colorBtn.dataset.selcolor);
      dstate.fields = dstate.fields.map(x => x.id === f.id ? r.field : x);
      scheduleSave(); renderDelivery(); renderSelPop(pop._anchor);
      return;
    }
    const delBtn = ev.target.closest('[data-seldelopt]');
    if (delBtn) {
      const optId = delBtn.dataset.seldelopt;
      // 删选项前确认：引用它的单元格会被清空
      const used = dstate.rows.some(r => r.cells[selPop.fieldId] === optId);
      if (used && !confirm('该选项正被某些行使用，删除后这些单元格将清空。继续？')) return;
      const r = DLogic.removeOptionById(f, optId);
      if (!r.ok) { toast(r.error || '删除失败'); return; }
      dstate.fields = dstate.fields.map(x => x.id === f.id ? r.field : x);
      if (used) dstate.rows = DLogic.stripOptionFromRows(dstate.rows, selPop.fieldId, optId);
      scheduleSave(); renderDelivery(); renderSelPop(pop._anchor);
      return;
    }
    if (ev.target.id === 'dSelOptName') ev.target.focus();
    return;
  }
  // ① 打开弹层：点胶囊/「○ 选择」（记住是哪一格开的，供选项回填）
  const opener = ev.target.closest('[data-selopen]');
  if (opener) {
    const parts = opener.dataset.selopen.split('|');
    selPop.rowId = parts[0];
    selPop.fieldId = parts[1];
    selPop.managing = false;
    renderSelPop(opener);
  }
});
// 选项改名/添加选项（回车提交）
document.addEventListener('keydown', (ev) => {
  const pop = document.getElementById('dSelPop');
  if (!pop) return;
  const f = dstate.fields.find(x => x.id === selPop.fieldId);
  if (!f) return;
  if (ev.target.id === 'dSelOptName' && ev.key === 'Enter') {
    const r = DLogic.addOption(f, ev.target.value);
    if (!r.ok) { toast(r.error || '无法添加'); return; }
    dstate.fields = dstate.fields.map(x => x.id === f.id ? r.field : x);
    scheduleSave(); renderDelivery(); renderSelPop(pop._anchor);
    return;
  }
  if (ev.target.dataset && ev.target.dataset.selrename && ev.key === 'Enter') {
    const r = DLogic.renameOption(f, ev.target.dataset.selrename, ev.target.value);
    if (!r.ok) { toast(r.error || '无法改名'); return; }
    dstate.fields = dstate.fields.map(x => x.id === f.id ? r.field : x);
    scheduleSave(); renderDelivery(); renderSelPop(pop._anchor);
  }
});
// 点击弹层外关闭（capture 捕获，避开弹层内部点击）
document.addEventListener('mousedown', (ev) => {
  if (!selPop.open) return;
  if (ev.target.closest('#dSelPop') || ev.target.closest('[data-selopen]')) return;
  closeSelPop();
}, true);

// ----- Task A：Ctrl+V 粘贴图片进「要求」等图片字段 -----
// 决策树：
// 全局 paste → clipboardData 里找 image 项
//  ├─ 无 → 放行（不影响正常文本粘贴）
//  └─ 有 → 目标格 = 当前选中图片格（点过「+」或缩略图的格）；没点过就提示"先点一下目标格"
//       └─ 读文件 → needCompress? 压缩 : 直存 → 格内已有图? replaceImage(0) : addImage → scheduleSave → render
let pasteTarget = null; // {rowId, fieldId}
document.getElementById('view-delivery').addEventListener('click', (ev) => {
  const cell = ev.target.closest('[data-dimgcell]');
  if (cell) {
    const parts = cell.dataset.dimgcell.split('|');
    pasteTarget = { rowId: parts[0], fieldId: parts[1] };
  }
});
document.addEventListener('paste', async (ev) => {
  if (!$('view-delivery') || $('view-delivery').hidden) return;
  const items = ev.clipboardData && ev.clipboardData.items;
  if (!items) return;
  let imgItem = null;
  for (const it of items) { if (it.type && it.type.startsWith('image/')) { imgItem = it; break; } }
  if (!imgItem) return;
  if (!pasteTarget) { toast('先点一下「要求」格，再 Ctrl+V 粘贴'); return; }
  ev.preventDefault();
  const file = imgItem.getAsFile();
  if (!file) return;
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  }).catch(() => null);
  if (!dataUrl) { toast('剪贴板图片读取失败'); return; }
  const finalUrl = DLogic.needCompress(dataUrl.length) ? await compressImage(dataUrl, 1600) : dataUrl;
  const row = dstate.rows.find(r => r.id === pasteTarget.rowId);
  const imgs = row && Array.isArray(row.cells[pasteTarget.fieldId]) ? row.cells[pasteTarget.fieldId] : [];
  const limit = DLogic.IMAGE_LIMIT || 1;
  if (imgs.length >= limit) {
    dstate.rows = DLogic.replaceImage(dstate.rows, pasteTarget.rowId, pasteTarget.fieldId, 0, finalUrl); // 满员：替换第一张
  } else {
    dstate.rows = DLogic.addImage(dstate.rows, pasteTarget.rowId, pasteTarget.fieldId, finalUrl);
  }
  scheduleSave(); renderDelivery();
  toast('截图已粘贴');
});


// ===== 设置（Task 1）=====
function cfgEl(id) { return document.getElementById(id); }
function toggleEye(inputId, btnId) {
  const inp = cfgEl(inputId), btn = cfgEl(btnId);
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.textContent = show ? '隐藏' : '显示';
}
function setCfgResult(text, ok) {
  const el = cfgEl('cfgTestResult');
  el.textContent = text;
  el.style.color = ok ? '#3B6D11' : '#A32D2D';
}
function fillSettings(cfg) {
  cfg = cfg || {};
  cfgEl('cfgUser').value = cfg.user || '';
  cfgEl('cfgAuth').value = cfg.auth || '';
  cfgEl('cfgLlmBase').value = cfg.llmBase || '';
  cfgEl('cfgLlmKey').value = cfg.llmKey || '';
  cfgEl('cfgLlmModel').value = cfg.llmModel || '';
  cfgEl('cfgRecentDays').value = cfg.recentDays || 45;
  cfgEl('cfgAutoRefresh').checked = cfg.autoRefresh !== false;
  setCfgResult('', true);
}
function readSettings() {
  return {
    user: cfgEl('cfgUser').value.trim(),
    auth: cfgEl('cfgAuth').value.trim(),
    llmBase: cfgEl('cfgLlmBase').value.trim(),
    llmKey: cfgEl('cfgLlmKey').value.trim(),
    llmModel: cfgEl('cfgLlmModel').value.trim(),
    recentDays: parseInt(cfgEl('cfgRecentDays').value || '45', 10),
    autoRefresh: cfgEl('cfgAutoRefresh').checked
  };
}
function openSettings() {
  document.getElementById('settingsModal').hidden = false;
  setCfgResult('', true);
  if (window.api && window.api.configGet) {
    window.api.configGet().then(r => { if (r.ok) fillSettings(r.config); });
  } else {
    fillSettings(readFromLocalConfig());
  }
}
function saveSettings() {
  const cfg = readSettings();
  if (!cfg.user && !cfg.auth) { setCfgResult('请至少填写邮箱地址或授权码', false); return; }
  const save = () => {
    if (window.api && window.api.configSave) {
      window.api.configSave(cfg).then(r => {
        if (r.ok) { document.getElementById('settingsModal').hidden = true; toast('设置已保存'); renderSyncInfo(); }
        else setCfgResult(r.error || '保存失败', false);
      });
    } else {
      localStorage.setItem('wb_examcal_config', JSON.stringify(cfg));
      document.getElementById('settingsModal').hidden = true;
      toast('设置已保存（预览模式，仅存本地）');
      renderSyncInfo();
    }
  };
  save();
}
function readFromLocalConfig() {
  try { return JSON.parse(localStorage.getItem('wb_examcal_config') || '{}'); } catch (e) { return {}; }
}
function testMailConn() {
  const cfg = readSettings();
  if (!cfg.user || !cfg.auth) { setCfgResult('请先填写邮箱地址和授权码', false); return; }
  setCfgResult('正在连接 imap.qq.com:993…', true);
  // 直接用内存里的表单值测试，不落盘；只有点「保存」才写入 config.json
  if (window.api && window.api.configTestMail) {
    window.api.configTestMail(cfg).then(r => {
      if (r.ok) setCfgResult('✓ 邮箱连接成功，授权码有效', true);
      else setCfgResult('✗ ' + (r.error || '连接失败'), false);
    });
  } else { setCfgResult('预览模式下无法测试邮箱，请用 .bat 启动应用', false); }
}
function testLlmConn() {
  const cfg = readSettings();
  if (!cfg.llmKey) { setCfgResult('请先填写解析服务密钥', false); return; }
  setCfgResult('正在请求解析服务…', true);
  if (window.api && window.api.configTestLLM) {
    window.api.configTestLLM(cfg).then(r => {
      if (r.ok) setCfgResult(`✓ 解析服务可用（模型 ${r.model}）`, true);
      else setCfgResult('✗ ' + (r.error || '连接失败'), false);
    });
  } else { setCfgResult('预览模式下无法测试，请用 .bat 启动应用', false); }
}

// ===== 配置教程弹窗：关闭（✕ 按钮 + 点击遮罩）=====
(function setupGuideModal() {
  const modal = document.getElementById('setupGuideModal');
  if (!modal) return;
  const close = () => { modal.hidden = true; };
  const btn = document.getElementById('btnGuideClose');
  if (btn) btn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
})();

function doRefreshMail(force) {
  const info = document.getElementById('syncInfo');
  info.innerHTML = '<span class="dot" style="background:#BA7517"></span>' + (force ? '深度重扫中：重新解析近期全部邮件…' : '正在拉取并解析邮件…');
  if (window.api && window.api.refreshMail) {
    window.api.refreshMail({ force: !!force }).then(r => {
      if (r && r.ok) {
        store.syncInfo = r.sync || store.syncInfo;
        renderSyncInfo();
        if (r.added > 0) {
          toast(`解析出 ${r.added} 条招聘事件（笔试/测评/面试/简历/网申等）`);
        } else if (r.failedBatch) {
          toast(`本轮 ${r.mailCount || 0} 封邮件，${r.failedBatch} 批解析失败，已保留待重试`);
        } else if (r.mailCount > 0) {
          toast(`拉取 ${r.mailCount} 封邮件，未识别出相关通知`);
        } else {
          toast(`没有新邮件（已是最新，水位线 INBOX:${(r.sync && r.sync.lastUid) || 0}）`);
        }
        reloadEvents().then(() => refreshAll());
      } else {
        info.innerHTML = `<span class="dot" style="background:#E24B4A"></span>${r.error || '拉取失败'} · ${new Date().toLocaleTimeString()}`;
        toast(r.error || '拉取失败');
      }
    });
  } else {
    info.innerHTML = '<span class="dot" style="background:#E24B4A"></span>请通过 .bat 启动应用使用邮件功能';
  }
}

// 刷新后从主进程重新拉事件列表（LLM 可能入库了新事件）
function reloadEvents() {
  if (!window.api || !window.api.listEvents) return Promise.resolve();
  return window.api.listEvents().then(r => {
    if (r && r.ok) {
      store.events = r.events || [];
      store.syncInfo = r.sync || store.syncInfo;
    }
    return store.events;
  }).catch(() => store.events);
}

// ===== 刷新详情：新邮件列表（Task 2）=====
function renderMailList(mails) {
  const host = document.getElementById('mailList');
  host.innerHTML = mails.map(m => `
    <div class="item">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <b class="item-name" style="max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.subject)}</b>
          <span class="tag tag-intv" style="flex:none">${m.linkCount || 0} 个链接</span>
        </div>
        <div class="item-note" style="margin-top:3px">${esc(m.fromName || m.from || '未知发件人')} · ${fmtDT(m.date)}</div>
        <div class="item-note" style="margin-top:4px;color:var(--text2);word-break:break-all;max-height:52px;overflow:hidden">${esc((m.text || '').replace(/\s+/g, ' ').slice(0, 200))}</div>
      </div>
    </div>`).join('') || '<p class="empty-line">本轮没有解析出邮件正文</p>';
}
function openMailList() { document.getElementById('mailDrawer').classList.add('open'); }

function doAddSave() {
  const g = id => document.getElementById(id).value;
  const type = g('fType');
  if (!g('fCompany').trim()) { toast('请填写公司名'); return; }
  const ev = {
    id: 'm' + Date.now(), type,
    company: g('fCompany').trim(),
    name: typeMeta(type).label,
    receivedAt: toISO(new Date()),
    examAt: g('fExamAt') ? g('fExamAt') + ':00' : null,
    durMin: parseInt(g('fDur') || '0', 10),
    deadline: g('fDeadline') ? g('fDeadline') + ':00' : null,
    link: g('fLink').trim(), source: '手动添加',
    status: 'pending'
  };
  const close = () => document.getElementById('addModal').hidden = true;
  const done = () => {
    store.selectedDate = (ev.examAt || ev.deadline || ev.receivedAt).slice(0, 10);
    refreshAll();
  };
  if (window.api && window.api.addEvent) {
    window.api.addEvent(ev).then(r => {
      if (r && r.ok) {
        store.events.push(ev);
        close(); done();
        toast('已添加');
      } else if (r && r.duplicate) {
        close();
        toast(`已存在相同考试（${r.duplicateOf.company} ${r.duplicateOf.name}），未重复添加`);
      } else {
        toast((r && r.error) || '添加失败');
      }
    });
    return;
  }
  // 预览模式兜底
  store.events.push(ev);
  persist('add', null, ev);
  close(); done();
  toast('已添加（预览模式）');
}

// Task 6：导出走系统保存对话框（主进程），预览模式退回浏览器下载
function doExport() {
  if (window.api && window.api.exportBackup) {
    window.api.exportBackup().then(r => {
      if (r && r.ok) toast(`已导出 ${r.count} 条事件`);
      else if (r && r.canceled) toast('已取消导出');
      else toast((r && r.error) || '导出失败');
    });
    return;
  }
  const blob = new Blob([JSON.stringify(store.events, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `笔试工作台备份-${ymd(new Date())}.json`;
  a.click();
  toast('已导出 JSON 备份（预览模式）');
}

// Task 6：导入走系统打开对话框；mode=merge 合并 | overwrite 覆盖
function doImport(mode) {
  document.getElementById('importModal').hidden = true;
  if (!window.api || !window.api.importBackup) { toast('预览模式不支持导入，请用 .bat 启动应用'); return; }
  window.api.importBackup(mode).then(r => {
    if (r && r.ok) {
      toast(`${r.modeName}导入 ${r.count} 条事件`);
      reloadEvents().then(() => refreshAll());
    } else if (r && r.canceled) {
      toast('已取消导入');
    } else {
      toast((r && r.error) || '导入失败，现有数据未受影响');
    }
  });
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// 详情面板 checkbox 需要单独 change 处理（见上），点击委托里跳过
document.addEventListener('DOMContentLoaded', () => {
  loadEvents();
  refreshAll();
  loadDeliveries();
  setInterval(tick, 1000);
});

// E2E 钩子：冒烟测试与调试用（不影响正常交互）
window.__delivery = {
  state: dstate,
  flushSave: () => { flushSave(); },
  move: (from, to) => { dstate.fields = DLogic.moveField(dstate.fields, from, to); renderDelivery(); scheduleSave(); },
  addFieldByName: (name) => {
    const r = DLogic.addField(dstate.fields, name);
    if (r.ok) { dstate.fields = r.fields; renderDelivery(); scheduleSave(); }
    return r;
  },
  // E2E 用：绕过系统文件对话框，从 addImage/replaceImage 走同一入库管线（含压缩与单图上限判断）
  addImageForTest: async (rowId, fieldId, dataUrl) => {
    const finalUrl = DLogic.needCompress(dataUrl.length) ? await compressImage(dataUrl, 1600) : dataUrl;
    const row = dstate.rows.find(r => r.id === rowId);
    const imgs = row && Array.isArray(row.cells[fieldId]) ? row.cells[fieldId] : [];
    const limit = DLogic.IMAGE_LIMIT || 1;
    if (imgs.length >= limit) {
      dstate.rows = DLogic.replaceImage(dstate.rows, rowId, fieldId, 0, finalUrl);
    } else {
      dstate.rows = DLogic.addImage(dstate.rows, rowId, fieldId, finalUrl);
    }
    scheduleSave(); renderDelivery();
  },
  removeImage: (rowId, fieldId, index) => {
    dstate.rows = DLogic.removeImage(dstate.rows, rowId, fieldId, index);
    scheduleSave(); renderDelivery();
  },
  openSelPop: (rowId, fieldId) => {
    selPop.rowId = rowId; selPop.fieldId = fieldId; selPop.managing = false;
    const anchor = document.querySelector(`[data-selopen="${rowId}|${fieldId}"]`) || document.getElementById('dTbody');
    renderSelPop(anchor);
  },
  manageSelPop: () => {
    selPop.managing = true;
    const pop = document.getElementById('dSelPop');
    renderSelPop(pop && pop._anchor ? pop._anchor : document.getElementById('dTbody'));
  }
};
