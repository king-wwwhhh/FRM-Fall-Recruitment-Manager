'use strict';
// 识别能力自测：造一批「过去常被漏掉」的招聘邮件，验证新 prompt + 新类型表能否识别。
// 用法：node test-parse.js
const llm = require('./lib/llm');

const cfg = require('./config.json');

const mails = [
  {
    key: 'INBOX:9001',
    subject: '【字节跳动】请于9月15日前完善你的简历信息',
    fromName: '字节跳动校园招聘',
    from: 'campus@bytedance.com',
    date: '2026-09-10T10:00:00',
    text: '同学你好，你已通过初筛。请在 9月15日 23:59 前登录校招系统完善简历信息（教育经历、项目经历、附件简历），逾期视为放弃。',
    links: ['https://jobs.bytedance.com/campus/resume/123']
  },
  {
    key: 'INBOX:9002',
    subject: '腾讯2027校园招聘 - AI面试邀请',
    fromName: '腾讯招聘',
    from: 'hr@tencent.com',
    date: '2026-09-10T11:00:00',
    text: '恭喜进入AI面试环节。AI面试时间：2026年9月12日 19:00，预计时长40分钟，请在9月12日18:50前进入面试间。链接有效期至 9月13日 12:00。',
    links: ['https://talent.qq.com/ai-interview/456']
  },
  {
    key: 'INBOX:9003',
    subject: '【美团】在线笔试通知',
    fromName: '美团招聘',
    from: 'campus@meituan.com',
    date: '2026-09-09T09:00:00',
    text: '笔试时间：2026年9月14日 19:00-21:00，时长120分钟。请提前10分钟进入考场。',
    links: ['https://campus.meituan.com/exam/789']
  },
  {
    key: 'INBOX:9004',
    subject: '你的网申已提交成功 - 京东2027校招',
    fromName: '京东招聘',
    from: 'zhaopin@jd.com',
    date: '2026-09-08T15:00:00',
    text: '感谢投递京东零售技术岗。简历将在7个工作日内完成评估，请留意后续通知。',
    links: ['https://campus.jd.com/apply/status/321']
  },
  {
    key: 'INBOX:9005',
    subject: '【拼多多】空中宣讲会邀请',
    fromName: '拼多多校园招聘',
    from: 'campus@pinduoduo.com',
    date: '2026-09-07T14:00:00',
    text: '诚邀参加拼多多技术专场空中宣讲会，时间：2026年9月11日 19:30，参与即可获得笔试直通卡。',
    links: ['https://careers.pinduoduo.com/live/1']
  },
  {
    key: 'INBOX:9006',
    subject: '您的快递已到达菜鸟驿站',
    fromName: '菜鸟',
    from: 'noreply@caoniao.com',
    date: '2026-09-10T08:00:00',
    text: '取件码 A-8823，请尽快前往菜鸟驿站取件。',
    links: ['https://www.cainiao.com/']
  }
];

(async () => {
  console.log('模型：', cfg.llmModel, '| 端点：', cfg.llmBase);
  console.log('发送 ' + mails.length + ' 封测试邮件（其中 1 封为无关广告，应被过滤）\n');
  const r = await llm.parseMailBatch(cfg, mails);
  if (!r.ok) {
    console.log('解析失败：', r.error);
    process.exit(1);
  }
  const want = {
    'INBOX:9001': 'resume   （简历完善，过去必漏）',
    'INBOX:9002': 'interview（AI面试，过去必漏）',
    'INBOX:9003': 'exam     （笔试）',
    'INBOX:9004': 'apply    （网申确认）',
    'INBOX:9005': 'campus   （宣讲会）',
    'INBOX:9006': '应被过滤（快递广告）'
  };
  console.log('解析结果 ' + r.events.length + ' 条：\n');
  r.events.forEach(ev => {
    const meta = llm.TYPE_META[ev.type] || {};
    console.log(`  [${ev.type.padEnd(10)}] ${ev.company} · ${ev.name}`);
    console.log(`     开始=${ev.examAt || '—'}  截止=${ev.deadline || '—'}  时长=${ev.durMin || 0}分  ${ev.timeGuessed ? '（时间推算）' : ''}`);
  });
  console.log('\n对照表：');
  Object.keys(want).forEach(k => {
    const hit = r.events.find(e => e.key === k);
    console.log(`  ${k}  期望=${want[k]}  实际=${hit ? hit.type : '未识别'}`);
  });
})();
