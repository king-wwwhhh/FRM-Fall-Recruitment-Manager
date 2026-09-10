'use strict';
// 命令行深度重扫：用最新识别规则重新解析近期全部邮件。
// 用途：识别规则升级后（如本次扩充简历完善/网申/AI面试/宣讲会等类型），
// 旧邮件已被旧规则判为「无关」并消费掉，必须重扫才能补回来。
// 用法：node deep-scan.js
const pipeline = require('./lib/pipeline');

(async () => {
  console.log('=== 深度重扫开始 ' + new Date().toLocaleString() + ' ===');
  const r = await pipeline.run({ force: true });
  console.log('=== 结束 ===');
  console.log(JSON.stringify(r, null, 2));
  if (r.ok) {
    const store = require('./lib/store');
    const db = store.load();
    const byType = {};
    (db.events || []).forEach(e => { byType[e.type] = (byType[e.type] || 0) + 1; });
    console.log('事件总数：', (db.events || []).length);
    console.log('类型分布：', JSON.stringify(byType));
    console.log('最后同步：', db.lastSyncAt, '（本地时间）');
  }
})();
