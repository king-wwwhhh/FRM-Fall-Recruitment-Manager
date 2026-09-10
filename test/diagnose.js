'use strict';
// 只读诊断：拉真实邮件 → 打印 subject + LLM 原始返回 + normalize 结果
// 不推进水位线、不写 store（谨慎只读）
const imap = require('../lib/imapFetch');
const llm = require('../lib/llm');
const store = require('../lib/store');

(async () => {
  const cfg = imap.loadConfig();
  const db = store.load();
  console.log('=== 诊断开始 ===');
  console.log('邮箱:', cfg.user, '| LLM:', cfg.llmModel);
  console.log('当前水位线 lastUid:', db.lastUid, 'seenCount:', (db.seenUids || []).length, '事件数:', db.events.length);

  const r = await imap.fetchMails([], { lastUid: 0, recentDays: cfg.recentDays || 45, markSeen: false, maxMails: 15 });
  console.log('\n拉取结果 ok=', r.ok, '| 邮件数=', r.mails.length, r.error ? ('| error=' + r.error) : '');
  if (!r.ok) { process.exit(1); }
  if (!r.mails.length) { console.log('没有拉到邮件（可能窗口内确实无新邮件）'); process.exit(0); }

  // 打印邮件清单（不含正文，防敏感信息刷屏）
  r.mails.forEach(m => console.log(`  [${m.key}] ${m.fromName || m.from || '?'} | ${m.subject} | 链接${m.linkCount}个`));

  // 只对前 10 封做 LLM 解析并打印原始返回
  const batch = r.mails.slice(0, 10);
  console.log(`\n=== LLM 解析前 ${batch.length} 封（真实调用）===`);
  const res = await llm.parseMailBatch(cfg, batch);
  console.log('LLM ok=', res.ok, res.error ? ('| error=' + res.error) : '');
  if (res.ok) {
    console.log('normalize 后事件数:', res.events.length);
    res.events.forEach(e => console.log('  ->', e.type, '|', e.company, '| examAt=', e.examAt, '| deadline=', e.deadline, '| link=', (e.link || '').slice(0, 40)));
  }
  console.log('\n=== 诊断结束（未动水位线/事件）===');
})();