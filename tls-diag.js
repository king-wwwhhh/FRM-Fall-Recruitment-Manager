'use strict';
// TLS 诊断工具：排查 "self signed certificate in certificate chain"（自签名证书 / 中间人代理）
// 用法：在项目根目录执行  node tls-diag.js
// 分别对 IMAP 与 HTTPS 做「严格校验」和「跳过校验」两次探测，
// 若严格失败而跳过成功，即可确认是网络出口存在中间人代理。

const fs = require('fs');
const path = require('path');

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch (e) {
  console.log('读取 config.json 失败：', String(e && e.message || e));
  process.exit(1);
}

// IMAP 探测：insecure=true 时跳过证书校验
async function probeImap(insecure) {
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({
    host: cfg.host || 'imap.qq.com',
    port: cfg.port || 993,
    secure: true,
    auth: { user: cfg.user, pass: cfg.auth },
    logger: false,
    socketTimeout: 20000,
    ...(insecure ? { tls: { rejectUnauthorized: false } } : {})
  });
  const tag = insecure ? 'IMAP  [跳过证书校验]' : 'IMAP  [严格校验]  ';
  try {
    await client.connect();
    console.log(tag + ' => 连接成功');
    await client.logout();
  } catch (e) {
    console.log(tag + ' => 失败: ' + String((e && e.message) || e));
  }
}

// HTTPS 探测：insecure=true 时通过环境变量跳过校验（影响 Node 原生 fetch）
async function probeHttps(insecure) {
  const base = (cfg.llmBase || '').replace(/\/+$/, '');
  if (!base) {
    console.log('LLM 端点未配置，跳过 HTTPS 探测');
    return;
  }
  if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const tag = insecure ? 'HTTPS [跳过证书校验]' : 'HTTPS [严格校验]  ';
  try {
    const res = await fetch(base + '/models', {
      headers: { Authorization: 'Bearer ' + (cfg.llmKey || '') }
    });
    console.log(tag + ' => HTTP ' + res.status + '（有响应即代表 TLS 握手成功）');
  } catch (e) {
    console.log(tag + ' => 失败: ' + String((e && e.message) || e));
  }
}

(async () => {
  console.log('=== TLS 诊断：自签名证书 / 中间人代理排查 ===');
  console.log('邮箱账号: ' + (cfg.user || '(未配置)'));
  console.log('LLM 端点: ' + (cfg.llmBase || '(未配置)'));
  console.log('');
  await probeImap(false);
  await probeImap(true);
  console.log('');
  await probeHttps(false);
  await probeHttps(true);
  console.log('');
  console.log('结论：若「严格校验」失败、而「跳过校验」成功，说明网络出口存在中间人代理。');
  console.log('      此时保持 config.json 中的 "tlsInsecure": true 即可正常使用。');
})();
