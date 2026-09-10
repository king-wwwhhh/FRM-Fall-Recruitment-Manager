'use strict';
// QQ 邮箱 IMAP 增量拉取
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { parseMail } = require('./rules');

const CONFIG_FILE = require('path').join(__dirname, '..', 'config.json');
const fs = require('fs');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

// 拉取最近 recentDays 天的邮件并解析为事件
// 增量策略（对应"记住上次刷新的位置"）：
//   1) 持久化 lastUid —— 上次同步到的最大邮件 UID，下次只处理 UID > lastUid 的邮件
//   2) seenUids 作为二级兜底，防止同一封邮件因改期等被重复解析成事件
//   3) IMAP SEARCH 本身只按 SINCE 日期粗筛最近 N 天，不做全量拉取
function newClient(cfg) {
  // TLS 兼容：网络出口若有中间人代理（自签名证书），需关闭证书链校验才能握手成功
  const insecure = cfg.tlsInsecure === true || process.env.RM_TLS_INSECURE === '1';
  return new ImapFlow({
    host: cfg.host || 'imap.qq.com',
    port: cfg.port || 993,
    secure: true,
    auth: { user: cfg.user, pass: cfg.auth },
    logger: false,
    socketTimeout: 30000,
    ...(insecure ? { tls: { rejectUnauthorized: false } } : {})
  });
}

function niceError(e) {
  const msg = String((e && e.message) || e);
  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication/i.test(msg)) {
    return '授权码错误或未开启 IMAP 服务：请到设置检查授权码，并在 QQ 邮箱 → 设置 → 账号 → 开启 IMAP/SMTP 服务';
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timeout/i.test(msg)) {
    return '无法连接 imap.qq.com:993，请检查网络或代理设置';
  }
  if (/self.signed|self.signed certificate|certificate chain|UNABLE_TO_VERIFY|DEPTH_ZERO_SELF_SIGNED|CERT_HAS_EXPIRED/i.test(msg)) {
    return 'TLS 证书校验失败（多为代理/网关对 HTTPS 做了中间人）：请在 config.json 中设置 "tlsInsecure": true';
  }
  return msg;
}

// 纯增量拉取：只返回「上次水位线之后」的新邮件原始信息，不解析不入库
// 增量策略：lastUid 水位线（UID > lastUid 才算新）
// 水位线是"消费式"的：只有真正拿到内容、进入 mails[] 的邮件才推进 lastUid。
// 搜索到了但拉不下来的邮件（fetchOne 失败/无 source/解析异常）会形成 gap，
// 水位线必须停在第一个 gap 之前，否则下次 SEARCH UID (lastUid+1):* 会永久跳过它（丢邮件）。
// markSeen=true：成功拉到的邮件记入 newSeen，由调用方决定用途
// markSeen=false：newSeen 只记录 mails 里实际取到的 key，由调用方决定哪些标 seen（解析失败的邮件可重试）
async function fetchMails(seenUids, opts = {}) {
  const cfg = loadConfig();
  if (!cfg || !cfg.user || !cfg.auth) {
    return { ok: false, needConfig: true, mails: [], newSeen: [], maxUid: opts.lastUid || 0, error: '尚未配置邮箱账号（请到设置填写）' };
  }
  const recentDays = opts.recentDays || cfg.recentDays || 45;
  const maxMails = opts.maxMails || cfg.maxMails || 300;
  const lastUid = opts.lastUid || 0;
  const since = new Date(Date.now() - recentDays * 864e5);
  const markSeen = opts.markSeen !== false;

  const client = newClient(cfg);
  const mails = [];
  const newSeen = [];
  let maxUid = lastUid;
  try {
    await client.connect();
    await client.mailboxOpen('INBOX');
    // 服务端按 UID 区间粗筛：只搜上次位置之后的邮件（增量点）
    const crit = { since: since.toISOString().slice(0, 10) };
    if (lastUid > 0) crit.uid = (lastUid + 1) + ':*';
    const uids = await client.search(crit, { uid: true });
    let list = Array.isArray(uids) ? uids : (uids.uid || Object.values(uids));
    list = list.map(Number).filter(u => u > lastUid).sort((a, b) => a - b);
    if (list.length > maxMails) list = list.slice(-maxMails);

    let gapAt = null; // 第一个"搜索到了但拉不下来"的 UID，水位线不得越过它
    for (const uid of list) {
      const key = 'INBOX:' + uid;
      if (seenUids.includes(key)) continue; // 已消费过，直接跳过
      let msg = null;
      try {
        msg = await client.fetchOne(uid, { uid: true, source: true });
        if (msg && msg.source) {
          const parsed = await simpleParser(msg.source);
          // QQ 邮箱招聘邮件多为纯 HTML：parsed.text 常为空，必须从 html 提取正文才能喂给 LLM
          let text = (parsed.text || '').trim();
          if (!text && parsed.html) text = htmlToText(parsed.html);
          mails.push({
            key,
            subject: parsed.subject || '(无主题)',
            fromName: parsed.from && parsed.from.value && parsed.from.value[0] ? parsed.from.value[0].name : '',
            from: parsed.from && parsed.from.value && parsed.from.value[0] ? parsed.from.value[0].address : '',
            date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
            text: text.slice(0, 1500),
            linkCount: extractLinks(parsed.html || '').length,
            links: extractLinks(parsed.html || '').slice(0, 3)
          });
          // 消费式水位线：只有真正拿到内容、进入解析队列的邮件才推进
          if (uid > maxUid) maxUid = uid;
          if (markSeen) newSeen.push(key);
          continue;
        }
      } catch (_) {
        // 单封拉取/解析异常：按"未消费"处理，不 abort 整轮；下轮刷新重试
      }
      // 到这 = 搜索到了但拉不下来 → 记录 gap，水位线不得越过它
      if (gapAt === null) gapAt = uid;
    }
    // 保护：水位线不得超过第一个拉不到的邮件（否则下次 SEARCH 会永久跳过它的 UID 区间）
    if (gapAt !== null && maxUid >= gapAt) maxUid = gapAt - 1;
    await client.logout();
    return { ok: true, mails, newSeen, maxUid, gapAt, error: null };
  } catch (e) {
    try { await client.logout(); } catch (_) {}
    return { ok: false, mails: [], newSeen: [], maxUid, error: niceError(e) };
  }
}

async function fetchNewEvents(seenUids, opts = {}) {
  const r = await fetchMails(seenUids, opts);
  if (!r.ok) return { ok: false, events: [], newSeen: r.newSeen || [], maxUid: r.maxUid || 0, error: r.error };
  const events = [];
  for (const m of r.mails) {
    const mail = {
      uid: m.key,
      subject: m.subject,
      from: m.from,
      fromName: m.fromName,
      date: m.date,
      text: m.text,
      htmlLinks: m.links
    };
    events.push(...parseMail(mail));
  }
  return { ok: true, events, newSeen: r.newSeen, maxUid: r.maxUid, error: null };
}

// 从 HTML 提取 <a href> 链接
function extractLinks(html) {
  const out = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1].trim();
    href = href.replace(/&amp;/g, '&');
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (/^https?:\/\//i.test(href)) out.push({ href, text });
  }
  return out;
}

// HTML → 纯文本（去掉标签/样式/脚本，保留换行；招聘邮件多为 HTML-only）
function htmlToText(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|li|ul|ol|h[1-6]|table)>/gi, '\n');
  s = s.replace(/<td[^>]*>/gi, ' ');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#\d+;/g, ' ');
  s = s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return s;
}

// 测试邮箱连接：IMAP ping（登录即成功，不拉任何数据）
// cfgOverride：可传"内存中尚未保存的表单值"用于测试，不写盘；不传则读 config.json
async function pingServer(cfgOverride) {
  const cfg = (cfgOverride && cfgOverride.user && cfgOverride.auth) ? cfgOverride : loadConfig();
  if (!cfg || !cfg.user || !cfg.auth) {
    return { ok: false, error: '尚未配置邮箱：请先在设置里填写 QQ 邮箱地址和授权码' };
  }
  const client = new ImapFlow({
    host: cfg.host || 'imap.qq.com',
    port: cfg.port || 993,
    secure: true,
    auth: { user: cfg.user, pass: cfg.auth },
    logger: false,
    socketTimeout: 15000
  });
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (e) {
    const msg = String((e && e.message) || e);
    let error = msg;
    if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication/i.test(msg)) {
      error = '授权码错误或未开启 IMAP 服务：请检查授权码，并在 QQ 邮箱 → 设置 → 账号 → 开启 IMAP/SMTP 服务';
    } else if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timeout/i.test(msg)) {
      error = '无法连接 imap.qq.com:993，请检查网络或代理设置';
    }
    try { await client.logout(); } catch (_) {}
    return { ok: false, error };
  }
}

module.exports = { fetchNewEvents, fetchMails, loadConfig, saveConfig, pingServer, extractLinks, htmlToText };
