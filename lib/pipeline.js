'use strict';
// 邮件 → 事件 流水线编排：拉取 → LLM 批量解析 → 入库
// 仅 LLM 解析（决策）：
//   - fetchMails(markSeen=false)：先拿回一批新邮件，不标 seen
//   - 按批（≤BATCH_SIZE 封）发给 LLM；某批解析失败 → 该批 key 不标 seen，下次刷新自动重试
//   - 解析成功的邮件 key 统一 updateSync 落水位线

const store = require('./store');
const imap = require('./imapFetch');
const llm = require('./llm');
const logger = require('./logger');

// 单批邮件数。推理模型会先输出思维链，批越大越容易在 JSON 写完前被截断 → 整批解析失败。
// 从 10 降到 5，牺牲一点请求次数换取成功率。
const BATCH_SIZE = 5;

// 本地时区 ISO（不带 Z）。lastSyncAt 必须用它：
// 旧代码用 toISOString() 存 UTC，前端直接字符串切片显示 → 北京时间比它快 8 小时（用户看到"早上10:15"）。
function localIso(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 把原始 mail 对象转成前端事件形态（id 由 key+type 保证同邮件同类型去重）
function toEvent(mail, item) {
  const id = `${mail.key}-${item.type}`;
  const meta = llm.TYPE_META[item.type] || llm.TYPE_META.other;
  return {
    id,
    type: item.type,
    company: String(item.company || mail.fromName || (mail.from || '').split('@')[0] || '未知公司'),
    name: String(item.name || meta.label),
    receivedAt: mail.date,
    examAt: item.examAt || null,
    durMin: item.durMin || 0,
    deadline: item.deadline || null,
    link: String(item.link || (mail.links && mail.links[0]) || ''),
    source: mail.from || '',
    sourceKey: mail.key,
    parsedBy: 'llm',
    rawSubject: mail.subject || '',
    status: 'pending',
    createdAt: localIso(new Date())
  };
}

// 主入口：拉取 → 分批 LLM → 入库；返回 {ok, added, mailCount, failedBatch, error}
async function run({ force } = {}) {
  const cfg = imap.loadConfig();
  if (!cfg || !cfg.user || !cfg.auth) {
    return { ok: false, needConfig: true, added: 0, mailCount: 0, failedBatch: 0, error: '请先到「设置」填写 QQ 邮箱地址和授权码' };
  }
  if (!cfg.llmKey) {
    return { ok: false, added: 0, mailCount: 0, failedBatch: 0, error: '请先到「设置」填写解析服务密钥（仅走大模型解析）' };
  }

  const db = store.load();
  // force=深度重扫：忽略水位线与已消费列表，重新拉取并重新解析近期全部邮件。
  // 用途：换了识别规则（如本次扩充了简历完善/网申/AI面试等类型）后，让历史邮件重跑一遍。
  if (force) {
    const before = (db.events || []).length;
    // 只清「邮件解析出来的、且未完成」的事件，手动添加和已完成的都保留，避免误伤
    db.events = (db.events || []).filter(e => !(e.parsedBy === 'llm' && e.status !== 'done'));
    store.save(db);
    logger.log('pipeline', `深度重扫：清理旧解析事件 ${before - db.events.length} 条，重新解析近期全部邮件`);
  }
  logger.log('pipeline', `开始增量拉取：lastUid=${db.lastUid || 0} seenCount=${(db.seenUids || []).length} force=${!!force}`);
  const r = await imap.fetchMails(force ? [] : (db.seenUids || []), {
    lastUid: force ? 0 : (db.lastUid || 0),
    recentDays: cfg.recentDays || 45,
    markSeen: false // 解析成功才标 seen
  });
  if (!r.ok) {
    logger.log('pipeline', '拉取失败：' + r.error);
    return { ok: false, added: 0, mailCount: 0, failedBatch: 0, error: r.error };
  }
  logger.log('pipeline', `拉取成功：新邮件 ${r.mails.length} 封，maxUid=${r.maxUid}`);
  if (!r.mails.length) {
    // 一封都没拉到：只刷新同步时间，水位线保持原值。
    // （fetchMails 已把 r.maxUid 限制在第一个"拉不到"的邮件之前，这里再显式不推进，双保险）
    store.updateSync(db, [], db.lastUid || 0, localIso(new Date()));
    return { ok: true, added: 0, mailCount: 0, failedBatch: 0, error: null };
  }

  // 分批：LLM 单批上限 BATCH_SIZE；分批循环，批与批独立
  const batches = [];
  for (let i = 0; i < r.mails.length; i += BATCH_SIZE) {
    batches.push(r.mails.slice(i, i + BATCH_SIZE));
  }

  let added = 0;
  let failedBatch = 0;
  const consumedKeys = []; // 解析成功的邮件 key（含"判定无关"的）
  for (const batch of batches) {
    const res = await llm.parseMailBatch(cfg, batch);
    logger.log('pipeline', `批次 ${batch.length} 封：ok=${res.ok} 事件数=${res.events.length}${res.error ? ' error=' + res.error : ''}`);
    if (!res.ok) { failedBatch++; continue; } // 这批不标 seen → 下次刷新重试
    // 无论 LLM 判为哪类，只要正常返回就算"消费过"，防重复解析
    batch.forEach(m => consumedKeys.push(m.key));
    // 按 key 对齐（关键）：每条解析结果携带来源 key，必须找到对应原邮件
    const events = res.events.map(it => {
      const mail = batch.find(m => m.key === it.key);
      return mail ? toEvent(mail, it) : null;
    }).filter(Boolean);
    added += store.mergeEvents(db, events);
    store.save(db);
  }

  // 水位线推进规则：seenUids 记录"已成功解析过"的邮件 key；
  // lastUid 只有在全部批次成功时才能顶到 r.maxUid——
  // 若存在失败批次，必须保留旧 lastUid，否则下次按 uid>lastUid 增量会跳过失败邮件
  const safeMaxUid = failedBatch === 0 ? r.maxUid : (db.lastUid || 0);
  store.updateSync(db, consumedKeys, safeMaxUid, localIso(new Date()));
  logger.log('pipeline', `完成：新增事件 ${added}，消费邮件 ${consumedKeys.length}，失败批 ${failedBatch}，lastUid 推进到 ${safeMaxUid}`);
  return { ok: true, added, mailCount: r.mails.length, failedBatch, error: failedBatch ? `有 ${failedBatch} 批解析失败（已保留，下次刷新重试）` : null };
}

module.exports = { run, BATCH_SIZE };