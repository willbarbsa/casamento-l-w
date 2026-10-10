// Sessão assinada (HMAC) para a área logada /gestao. Arquivos com "_" não viram rota na Vercel.
var crypto = require('crypto');

var COOKIE = 'gestao_sess';
var TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 dias

function b64(s) { return Buffer.from(s).toString('base64url'); }
function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEq(a, b) {
  var ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function criar(perfil, secret) {
  var payload = b64(JSON.stringify({ p: perfil, exp: Date.now() + TTL_MS }));
  return payload + '.' + sign(payload, secret);
}

function ler(req, secret) {
  var raw = (req.headers.cookie || '').split(';').map(function (c) { return c.trim(); })
    .filter(function (c) { return c.indexOf(COOKIE + '=') === 0; })[0];
  if (!raw || !secret) return null;
  var tok = raw.substring(COOKIE.length + 1);
  var partes = tok.split('.');
  if (partes.length !== 2 || !safeEq(sign(partes[0], secret), partes[1])) return null;
  try {
    var d = JSON.parse(Buffer.from(partes[0], 'base64url').toString());
    if (!d.exp || d.exp < Date.now()) return null;
    return d.p;
  } catch (e) { return null; }
}

function cookie(valor, maxAge) {
  return COOKIE + '=' + valor + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + maxAge;
}

module.exports = { criar: criar, ler: ler, cookie: cookie, safeEq: safeEq, TTL_S: TTL_MS / 1000 };
