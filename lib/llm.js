'use strict';
// 大模型解析服务（OpenAI 兼容 chat 接口）
// Task 1 先提供 ping；Task 3 追加批量解析 chatForEvents

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_BASE = 'https://opencode.ai/zen/go/v1';
const DEFAULT_MODEL = 'deepseek-v4-flash';

// [2026-09-07] OpenCode Go 网关要求（https://opencode.ai/docs/go）：
//   ① 每个会话带稳定 x-opencode-session（用于路由优化 + prompt cache）；
//   ② 自定义 User-Agent 标识自身（不能用 Node 默认 'node'，会被网关拒绝/标记）。
// ID 首启 randomUUID 落盘 data/ 目录（与 store.json 同区，本项目数据全在项目内，不碰 C 盘），
// 之后每次启动复用 → 进程内/跨启动都稳定；与 shot-mvp / cheating-daddy 的会话 ID 各自独立互不串 cache。
const OPENCODE_SESSION_FILE = path.join(__dirname, '..', 'data', 'opencode-session.txt');
function getOpenCodeSessionId() {
  try {
    const s = fs.readFileSync(OPENCODE_SESSION_FILE, 'utf8').trim();
    if (s) return s;
  } catch (e) { /* 首次运行：文件不存在，走生成分支 */ }
  const id = crypto.randomUUID();
  try {
    fs.mkdirSync(path.dirname(OPENCODE_SESSION_FILE), { recursive: true });
    fs.writeFileSync(OPENCODE_SESSION_FILE, id, 'utf8');
  } catch (e) { /* 落盘失败不阻断请求 */ }
  return id;
}

async function chatRaw(cfg, messages, opts = {}) {
  const base = (cfg.llmBase || DEFAULT_BASE).replace(/\/+$/, '');
  const url = base + '/chat/completions';
  const body = {
    model: cfg.llmModel || DEFAULT_MODEL,
    messages,
    temperature: opts.temperature ?? 0,
    max_tokens: opts.maxTokens || 4096,
    stream: false
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 60000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (cfg.llmKey || ''),
        // [2026-09-07] OpenCode Go：明确标识自身 + 稳定会话 ID（缺则 400 MissingSessionID）
        'User-Agent': 'interview-calendar/1.0',
        'x-opencode-session': getOpenCodeSessionId()
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 200)}` };
    }
    const data = await res.json();
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    // [2026-09-15] deepseek-flash 等推理模型把最终答案放在 reasoning_content，content 常为空白。
    // 只读 content 会导致"API 被调用但解析失败、事件加不进日历"，故此处兜底读取 reasoning_content。
    const content = (msg && (msg.content || msg.reasoning_content)) || '';
    if (!content) return { ok: false, error: '响应中没有 content/reasoning_content（检查模型名是否正确）' };
    return { ok: true, content };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).includes('abort') ? '请求超时' : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

// 最小请求：验证接口/密钥/模型可用
async function ping(cfg) {
  const r = await chatRaw(cfg, [{ role: 'user', content: 'reply ok' }], { maxTokens: 8, timeoutMs: 20000 });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, model: cfg.llmModel || DEFAULT_MODEL, sample: (r.content || '').slice(0, 40) };
}

// 从模型输出里抠出 JSON（容忍 ```json 代码块包裹 / 前后废话）
function extractJson(content) {
  let s = String(content || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try { return JSON.parse(s); } catch (e) { /* 走到抢救分支 */ }
  // 抢救分支：推理模型（如 deepseek-flash）会先写思维链，输出常在数组写完前被 max_tokens 截断，
  // 整批失败 = 该批邮件永不消费、反复重试，表现为「很多邮件识别不出来」。
  // 这里把已完整输出的对象逐个抠出来，能救回几封是几封。
  return salvageObjects(s);
}
// 从残缺 JSON 文本里逐个抠出完整的 {…} 对象
function salvageObjects(s) {
  const out = [];
  const re = /\{[^{}]*\}/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    try {
      const o = JSON.parse(m[0]);
      if (o && typeof o === 'object' && o.key) out.push(o);
    } catch (_) { /* 单个对象残缺，跳过 */ }
  }
  return out.length ? out : null;
}

// ===== 招聘事件类型表（覆盖校招全链路）=====
// 老版本只认 exam/assessment/interview 三类，导致「简历完善 / 网申截止 / AI面试 / offer / 宣讲会」
// 等大量招聘邮件被判为无关而静默丢弃 —— 这是用户反馈「只能识别测评类」的根因。
// 这里扩充到全链路，并对 LLM 可能吐出的各种别名（含中文）做归一化，避免因命名不一致被过滤。
const TYPE_META = {
  exam:       { label: '笔试',     short: '笔试',   color: '#A32D2D', cls: 'tag-exam' },
  assessment: { label: '测评',     short: '测评',   color: '#EF9F27', cls: 'tag-asmt' },
  interview:  { label: '面试',     short: '面试',   color: '#378ADD', cls: 'tag-intv' },
  resume:     { label: '简历完善', short: '简历',   color: '#639922', cls: 'tag-resume' },
  apply:      { label: '网申投递', short: '网申',   color: '#7F77DD', cls: 'tag-apply' },
  offer:      { label: 'offer',    short: 'offer',  color: '#1D9E75', cls: 'tag-offer' },
  campus:     { label: '宣讲会',   short: '宣讲',   color: '#BA7517', cls: 'tag-campus' },
  other:      { label: '招聘相关', short: '招聘',   color: '#888780', cls: 'tag-other' }
};
const TYPE_ALIAS = {
  written: 'exam', writtenexam: 'exam', onlineexam: 'exam', examtest: 'exam',
  assessmenttest: 'assessment', onlineassessment: 'assessment', test: 'assessment', evaluate: 'assessment',
  aiinterview: 'interview', ai: 'interview', videointerview: 'interview', groupinterview: 'interview', face2face: 'interview',
  resumeimprove: 'resume', cv: 'resume', resumeperfect: 'resume',
  application: 'apply', delivery: 'apply',投递: 'apply',
  offerletter: 'offer', hire: 'offer',
  careerfair: 'campus', openday: 'campus', 宣讲: 'campus',
  recruitment: 'other', 其他: 'other', 招聘: 'other', 校招: 'other'
};
// 类型归一化：命中不了就按中文关键词兜底，最大程度防止"识别得出但被过滤"
function normType(v) {
  if (!v) return null;
  const k = String(v).trim().toLowerCase().replace(/[\s_\-]/g, '');
  if (!k || k === 'null' || k === 'undefined') return null;
  if (TYPE_META[k]) return k;
  if (TYPE_ALIAS[k]) return TYPE_ALIAS[k];
  for (const key in TYPE_ALIAS) { if (k.indexOf(key) >= 0) return TYPE_ALIAS[key]; }
  const s = String(v);
  if (/笔试|在线考试|上机|编程测试/.test(s)) return 'exam';
  if (/测评|评估|性格测试|认知能力/.test(s)) return 'assessment';
  if (/面试/.test(s)) return 'interview';
  if (/简历/.test(s)) return 'resume';
  if (/网申|投递|申请/.test(s)) return 'apply';
  if (/offer|录用|意向书/i.test(s)) return 'offer';
  if (/宣讲|招聘会|空中宣讲/.test(s)) return 'campus';
  if (/招聘|校招|秋招|春招|实习|岗位/.test(s)) return 'other';
  return null;
}
// 本地时区 ISO（不带 Z）—— 全项目统一用它落时间，避免 UTC 偏移 8 小时
function localIso(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}
// 宽松时间解析：允许 "2026-09-08T19:00:00" / "2026-09-08 19:00" / "2026-09-08 19:00:00" / 纯日期
// 返回规范 ISO 或 null
function normalizeTime(v) {
  if (!v) return null;
  const s = String(v).trim().replace(/[：:—～]/g, ':').replace(/\s+/g, ' ');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${se ? se : '00'}`;
  }
  // 纯日期（邮件里对上日期即可，取当天 23:59 作为事件锚点）
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T23:59:00`;
  return null;
}

// 校验单条解析结果：合并字段缺失/非法值，返回 null 表示该邮件与招聘无关
function normalizeEvent(item, mail) {
  const type = normType(item && item.type);
  if (!type) return null;
  const meta = TYPE_META[type];
  const company = String((item.company || '').trim() || mail.fromName || (mail.from || '').split('@')[0] || '未知公司');
  const examAt = normalizeTime(item.examAt);
  const deadline = normalizeTime(item.deadline);
  // 邮件里没写时间就老老实实留空，绝不推算（用户要求）。
  // 这类事件仍会入库，日历按「收信日」那一格显示，标「待定」，由用户自己点开补时间。
  return {
    key: mail.key, // 关键：携带来源邮件 key，外层必须按 key 对齐，禁止按下标
    type,
    company,
    name: String((item.name || '').trim() || meta.label),
    examAt,
    durMin: parseInt(item.durationMin || item.durMin || 0, 10) || 0,
    deadline,
    link: String(item.link || (mail.links && mail.links[0]) || ''),
    rawSubject: mail.subject || '',
    from: mail.from || ''
  };
}

// 批量解析：把一批邮件一次发给 LLM，返回规范化后的事件（不含 id，由调用方本地生成）
// 单批建议 ≤30 封；返回 { ok, events, error }
async function parseMailBatch(cfg, mails) {
  if (!Array.isArray(mails) || !mails.length) return { ok: true, events: [], error: null };
  const payload = mails.map(m => ({
    key: m.key,
    subject: m.subject || '',
    fromName: m.fromName || '',
    from: m.from || '',
    date: m.date || '',
    text: (m.text || '').slice(0, 1200),
    links: (m.links || []).slice(0, 3)
  }));
  const sys = `你是秋招求职助手，负责把「招聘相关邮件」转成日历事件。
输入是一批邮件（数组），每封含 key/subject/fromName/from/date/text/links。你必须逐封判断，输出与输入一一对应、顺序一致的 JSON 数组。

【type 只能是这些取值之一】
exam       笔试 / 在线考试 / 编程测试 / 上机考试 / 机考
assessment 测评 / 在线评估 / 性格测试 / 认知能力测试 / 窗口期测评
interview  面试邀约 / AI面试 / 视频面试 / 电话面 / 群面 / 单面 / 复试
resume     简历完善 / 补充简历 / 上传附件简历 / 确认简历信息（如"请完善简历""请于X前提交简历"）
apply      网申 / 投递确认 / 岗位申请确认 / 内推确认 / 进入下一轮通知
offer      offer / 录用通知 / 意向书 / 签约通知
campus     宣讲会 / 空中宣讲 / 招聘会 / OpenDay / 线下见面会
other      其他明显与求职招聘相关、且有时间要求的邮件（资料提交、测评补做、背景调查等）

【必须识别，不许判为无关】
只要邮件来自招聘平台或企业招聘邮箱，或内容涉及 校招/秋招/春招/实习/岗位/笔试/测评/面试/简历/网申/offer/测评补做，
哪怕它只是「提醒完善简历」「邀请你投递」「恭喜进入下一轮」「请补充材料」，也必须识别。
特别注意：AI面试、视频面试、简历完善提醒，这些过去经常被漏掉，务必识别。

【判为无关（type 填空字符串，其余字段也填空）】
广告推广、电商订单、物流、验证码、账单、社交通知、新闻订阅、与求职完全无关的账号通知。

【时间提取（最关键，直接决定能否进日历）】
- examAt  ：笔试/面试/宣讲的「开始时刻」。有明确开始时间就填。
- deadline：截止时间 / 有效期 / 最晚完成时间。凡出现「请于…前」「…截止」「有效期至」「请在…之前完成」都要填。
- 只有日期没有时刻：deadline 补 23:59:00，examAt 补 09:00:00。
- 年份缺失时按该邮件 date 字段的年份补全。
- 时间一律转成 ISO 字符串 YYYY-MM-DDTHH:MM:SS，按北京时间理解。
- 如果正文里真的找不到任何日期：examAt 和 deadline 都留空，type 照填。
- 严禁编造或估算时间：宁可留空，也不要拿"收信日+几天"之类的推测值填充。

输出格式（纯 JSON 数组，不要 markdown 代码块，不要任何解释文字）：
[{"key":"邮件key","type":"exam|assessment|interview|resume|apply|offer|campus|other或空","company":"公司名","name":"事项名称","examAt":"","deadline":"","durationMin":0,"link":"入口链接"}]`;
  const user = JSON.stringify(payload);
  // maxTokens 从 8192 提到 20000：推理模型会先输出思维链，配额不足会把 JSON 截断在半路
  const r = await chatRaw(cfg, [
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], { maxTokens: 20000, timeoutMs: 120000 });
  if (!r.ok) return { ok: false, events: [], error: r.error };
  const arr = extractJson(r.content);
  if (!Array.isArray(arr)) {
    return { ok: false, events: [], error: 'LLM 返回内容无法解析为 JSON：' + String(r.content || '').slice(0, 120) };
  }
  // 按 key 对齐输入
  const byKey = {};
  mails.forEach(m => { byKey[m.key] = m; });
  const events = [];
  for (const it of arr) {
    const mail = it && it.key ? byKey[it.key] : null;
    if (!mail) continue;
    const ev = normalizeEvent(it, mail);
    if (ev) events.push(ev);
  }
  return { ok: true, events, error: null };
}

module.exports = { chatRaw, ping, parseMailBatch, extractJson, normalizeEvent, normType, localIso, TYPE_META, DEFAULT_BASE, DEFAULT_MODEL };