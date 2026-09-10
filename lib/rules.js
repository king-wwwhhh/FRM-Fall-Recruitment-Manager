'use strict';
// 邮件 -> 结构化日历事件 的纯函数解析规则
// 输入: { subject, from, fromName, date(ISO), text, htmlLinks:[{href,text}] }
// 输出: 事件数组（一封邮件可能产出多个事件，如 笔试+确认截止）

const TYPE_EXAM = 'exam';          // 固定时间笔试
const TYPE_ASSESSMENT = 'assessment'; // 测评
const TYPE_INTERVIEW = 'interview';   // 面试

const EXAM_KW = /笔试|集中笔试|在线考试|统一考试|线上考试|考试通知|编程测试|在线笔试/;
const ASMT_KW = /测评|性格测试|人才测评|认知能力|能力测试|北森|beisen|牛客测评|SHL|iMentor|综合测试|在线评估|心理测验/;
const INTV_KW = /面试|约面|邀约|interview/i;

// 已知发件域名/名称 -> 公司
const COMPANY_MAP = [
  [/(huawei|华为)/i, '华为'],
  [/(tencent|腾讯)/i, '腾讯'],
  [/(bytedance|字节|tiktok|抖音)/i, '字节跳动'],
  [/(alibaba|阿里|aliyun|阿里云|taobao|alimail)/i, '阿里巴巴'],
  [/(meituan|美团)/i, '美团'],
  [/(jd\.com|京东)/i, '京东'],
  [/(netease|网易)/i, '网易'],
  [/(xiaomi|小米)/i, '小米'],
  [/(oppo|vivo)/i, 'OPPO/vivo'],
  [/(baidu|百度)/i, '百度'],
  [/(kuaishou|快手)/i, '快手'],
  [/(didi|滴滴)/i, '滴滴'],
  [/(ctrip|trip\.com|携程)/i, '携程'],
  [/(miHoYo|米哈游|hoyoverse)/i, '米哈游'],
  [/(lixiang|理想汽车)/i, '理想汽车'],
  [/(nio|蔚来)/i, '蔚来'],
  [/(byd|比亚迪)/i, '比亚迪'],
  [/(zte|中兴)/i, '中兴'],
  [/(lenovo|联想)/i, '联想'],
  [/(haikang|海康)/i, '海康威视'],
  [/(dahua|大华)/i, '大华'],
  [/(suning|苏宁)/i, '苏宁'],
  [/(pinduoduo|拼多多|yangkeduo)/i, '拼多多'],
  [/(shopee)/i, 'Shopee'],
  [/(nowcoder|牛客)/i, null],   // 平台代发，公司从主题猜
  [/(beisen|北森)/i, null],
  [/(seamoy|赛码)/i, null],
];

// 主题里 【公司】/ [公司] / (公司) 前缀
function companyFromSubject(subject) {
  const m = subject.match(/[【\[（(]([^\]】）)]{1,12})[】\]）)]/);
  if (m) {
    const c = m[1].trim();
    if (!/笔试|测评|面试|考试|通知|邀约|提醒|招聘/.test(c)) return c;
  }
  return null;
}

function detectCompany(mail) {
  const s = companyFromSubject(mail.subject || '');
  if (s) return s;
  const hay = (mail.from || '') + ' ' + (mail.fromName || '');
  for (const [re, name] of COMPANY_MAP) {
    if (re.test(hay) && name) return name;
  }
  // 主题里直接出现公司名
  const subj = mail.subject || '';
  for (const [re, name] of COMPANY_MAP) {
    if (name && re.test(subj)) return name;
  }
  return mail.fromName || (mail.from || '').split('@')[0] || '未知公司';
}

function detectType(mail) {
  const hay = (mail.subject || '') + ' ' + (mail.text || '').slice(0, 2000);
  if (EXAM_KW.test(hay)) return TYPE_EXAM;
  if (ASMT_KW.test(hay)) return TYPE_ASSESSMENT;
  if (INTV_KW.test(hay)) return TYPE_INTERVIEW;
  return null;
}

// 中文/数字日期解析: 2026年9月10日24:00 | 9月10日 | 2026-09-10 | 10/9 18:00
// 返回 {iso, raw} 或 null。yearHint=邮件年份；若解析出的时间比邮件时间早超过180天，年份+1
function parseDateNear(text, keywordRe, yearHint, mailTime) {
  if (!text) return null;
  const km = text.match(keywordRe);
  let window = text;
  if (km) {
    const idx = text.indexOf(km[0]);
    window = text.slice(idx, idx + 120);
  }
  const re = /(20\d{2})?[年\-\/\.]?(\d{1,2})[月\-\/\.](\d{1,2})[日号]?(\s*(?:24|([01]?\d|2[0-3]))[:：点]([0-5]\d)?)?/;
  const m = window.match(re);
  if (!m) return null;
  const year = m[1] ? parseInt(m[1], 10) : (yearHint || new Date().getFullYear());
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let hour = 23, minute = 59;
  if (m[5] !== undefined && m[5] !== '') { hour = parseInt(m[5], 10); minute = parseInt(m[6], 10); }
  let d = new Date(year, month - 1, day, hour, minute);
  if (mailTime && d.getTime() < mailTime - 180 * 864e5) {
    d = new Date(year + 1, month - 1, day, hour, minute);
  }
  const raw = m[0].trim();
  return { iso: toLocalISO(d), raw, ts: d.getTime() };
}

// 时间段: 19:00-21:00 / 19：00~21：00
function parseTimeRange(text, keywordRe) {
  if (!text) return null;
  const km = text.match(keywordRe);
  if (!km) return null;
  const idx = text.indexOf(km[0]);
  const window = text.slice(idx, idx + 100);
  const m = window.match(/([01]?\d|2[0-3])[:：\.]([0-5]\d)\s*[-~—至到]+\s*([01]?\d|2[0-3])[:：\.]([0-5]\d)/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}-${m[3].padStart(2, '0')}:${m[4]}`;
}

function toLocalISO(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

const DEADLINE_KW = /(截止时间|截止日期|请于|请在|前完成|有效期至|截止|deadline|expire)/i;
const EXAMTIME_KW = /(考试时间|笔试时间|答题时间|考试时段|开始时间|开考时间|面试时间|测评时间)/i;

// 提取笔试/测评链接：优先含考试关键词的 URL
const EXAM_URL_RE = /(笔试|考试|exam|test|答题|作答|测评|评估|北森|beisen|赛码|nowcoder|牛客|shl|aitest|examdesk|aligo)/i;
function pickLinks(mail) {
  const links = (mail.htmlLinks || []).map(l => l.href).filter(h => /^https?:\/\//i.test(h));
  const seen = new Set();
  const uniq = links.filter(h => (seen.has(h) ? false : (seen.add(h), true)));
  const scored = uniq.filter(h => EXAM_URL_RE.test(h));
  return (scored.length ? scored : uniq).slice(0, 3);
}

function parseMail(mail) {
  const type = detectType(mail);
  if (!type) return [];
  const text = (mail.text || '') + ' ' + (mail.subject || '');
  const mailDate = mail.date ? new Date(mail.date) : new Date();
  const yearHint = mailDate.getFullYear();
  const mailTime = mailDate.getTime();

  const examAt = parseDateNear(text, EXAMTIME_KW, yearHint, mailTime);
  const deadline = parseDateNear(text, DEADLINE_KW, yearHint, mailTime);

  // 固定时间笔试若没抽到考试时间，但主题含笔试且正文有日期，退而用第一个日期
  let examTime = type === TYPE_EXAM ? examAt : null;
  if (type === TYPE_EXAM && !examTime) {
    const anyDate = parseDateNear(text, /(20\d{2}[年\-\/])?\d{1,2}[月\-\/]\d{1,2}[日号]?/, yearHint, mailTime);
    examTime = anyDate;
  }

  // 无考试时段且无截止且非面试 -> 不生成（避免误报）
  if (!examTime && !deadline && type !== TYPE_INTERVIEW) return [];

  const company = detectCompany(mail);
  const timeRange = parseTimeRange(text, EXAMTIME_KW);
  const ev = {
    id: `${mail.uid || mailTime}-${type}`,
    type,
    company,
    title: type === TYPE_EXAM ? '固定时间笔试' : type === TYPE_ASSESSMENT ? '测评' : '面试邀约',
    mailReceivedAt: toLocalISO(mailDate),
    examAt: examTime ? examTime.iso : null,
    examAtRaw: examTime ? examTime.raw : null,
    timeRange: timeRange || null,
    deadline: deadline ? deadline.iso : null,
    deadlineRaw: deadline ? deadline.raw : null,
    links: pickLinks(mail),
    subject: mail.subject || '',
    from: mail.from || '',
    source: 'email',
    status: 'pending',
    createdAt: toLocalISO(new Date())
  };
  // 日历锚点：优先考试时间，其次截止日，最后收信日
  ev.anchorDate = (ev.examAt || ev.deadline || ev.mailReceivedAt).slice(0, 10);
  return [ev];
}

module.exports = { parseMail, detectType, detectCompany, parseDateNear, parseTimeRange, pickLinks, TYPE_EXAM, TYPE_ASSESSMENT, TYPE_INTERVIEW };
