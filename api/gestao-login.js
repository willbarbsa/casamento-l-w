// POST /api/gestao-login  { senha }  -> define cookie de sessão
// DELETE /api/gestao-login           -> logout
// Env: GESTAO_PASS_CASAL, GESTAO_PASS_DANI, SESSION_SECRET
var S = require('./_gestao-session');

var tentativas = {}; // limitador simples por IP (por instância)

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  var secret = process.env.SESSION_SECRET;

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', S.cookie('', 0));
    res.status(200).json({ ok: true });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  if (!secret || !process.env.GESTAO_PASS_CASAL || !process.env.GESTAO_PASS_DANI) {
    res.status(500).json({ ok: false, erro: 'não configurado' });
    return;
  }

  var ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  var t = tentativas[ip] || { n: 0, ate: 0 };
  if (t.ate > Date.now()) { res.status(429).json({ ok: false, erro: 'Muitas tentativas. Aguarde alguns minutos.' }); return; }

  var senha = String((req.body && req.body.senha) || '');
  var perfil = null;
  if (S.safeEq(senha, process.env.GESTAO_PASS_CASAL)) perfil = 'casal';
  else if (S.safeEq(senha, process.env.GESTAO_PASS_DANI)) perfil = 'dani';

  if (!perfil) {
    t.n++;
    if (t.n >= 5) { t.n = 0; t.ate = Date.now() + 10 * 60 * 1000; }
    tentativas[ip] = t;
    res.status(401).json({ ok: false, erro: 'Senha incorreta.' });
    return;
  }
  tentativas[ip] = { n: 0, ate: 0 };
  res.setHeader('Set-Cookie', S.cookie(S.criar(perfil, secret), S.TTL_S));
  res.status(200).json({ ok: true, perfil: perfil });
};
