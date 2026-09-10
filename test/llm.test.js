'use strict';
// Task 3 链路自测：模拟三封秋招邮件 → LLM 解析 → 打印事件
// 用法: LLM_KEY=sk-xxx node test/llm.test.js
const llm = require('../lib/llm');

const cfg = {
  llmBase: process.env.LLM_BASE || 'https://opencode.ai/zen/go/v1',
  llmKey: process.env.LLM_KEY || '',
  llmModel: process.env.LLM_MODEL || 'deepseek-v4-flash'
};

const mails = [
  {
    key: 'INBOX:100',
    subject: '【华为】2027届校园招聘在线笔试邀请',
    fromName: '华为招聘',
    from: 'careers@huawei.com',
    date: '2026-09-03T10:24:00+08:00',
    text: '同学你好，邀请您参加华为2027届校园招聘集中笔试。\n笔试时间：2026年9月8日（周二）19:00-21:00，请提前30分钟登录调试设备。\n下载入口：https://career.huawei.com/exam/demo',
    links: ['https://career.huawei.com/exam/demo']
  },
  {
    key: 'INBOX:101',
    subject: '【腾讯】人才测评邀请',
    fromName: '腾讯校招',
    from: 'campus@tencent.com',
    date: '2026-09-05T09:00:00+08:00',
    text: '请于2026年9月12日24:00前完成性格测评，逾期视为放弃。\n测评链接：https://campus.tencent.com/assessment/demo',
    links: ['https://campus.tencent.com/assessment/demo']
  },
  {
    key: 'INBOX:102',
    subject: '本周促销：开学季笔记本直降500元',
    fromName: '京东商城',
    from: 'promo@jd.com',
    date: '2026-09-05T11:00:00+08:00',
    text: '点击查看详情 https://promo.jd.com/xxx',
    links: ['https://promo.jd.com/xxx']
  }
];

(async () => {
  if (!cfg.llmKey) { console.log('SKIP: 未提供 LLM_KEY 环境变量，跳过 LLM 联网测试（用法: LLM_KEY=sk-xxx node test/llm.test.js）'); process.exit(0); }
  const t0 = Date.now();
  const r = await llm.parseMailBatch(cfg, mails);
  console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!r.ok) { console.log('FAIL: ' + r.error); process.exit(1); }
  console.log('解析事件数:', r.events.length);
  console.log(JSON.stringify(r.events, null, 2));
  const huawei = r.events.find(e => e.company && String(e.company).includes('华为'));
  if (!huawei || huawei.type !== 'exam' || !huawei.examAt) {
    console.log('FAIL: 华为笔试事件缺失或字段不全（type/examAt）');
    process.exit(1);
  }
  if (r.events.some(e => !e.type || !['exam', 'assessment', 'interview'].includes(e.type))) {
    console.log('FAIL: 存在非法 type');
    process.exit(1);
  }
  console.log('PASS ✅');
})();