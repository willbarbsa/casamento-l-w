// GET /api/gestao-dados -> JSON da planilha (somente leitura), exige sessão válida.
// Env: GESTAO_APPS_SCRIPT_URL, GESTAO_APPS_SCRIPT_SECRET, SESSION_SECRET
var S = require('./_gestao-session');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  var perfil = S.ler(req, process.env.SESSION_SECRET);
  if (!perfil) { res.status(401).json({ ok: false, erro: 'login' }); return; }

  var url = process.env.GESTAO_APPS_SCRIPT_URL;
  var seg = process.env.GESTAO_APPS_SCRIPT_SECRET;
  if (!url || !seg) { res.status(500).json({ ok: false, erro: 'não configurado' }); return; }

  try {
    var r = await fetch(url + (url.indexOf('?') > -1 ? '&' : '?') + 'secret=' + encodeURIComponent(seg), { redirect: 'follow' });
    var d = await r.json();
    if (!d.ok) { res.status(502).json({ ok: false, erro: 'planilha' }); return; }
    d.perfil = perfil;
    res.status(200).json(d);
  } catch (e) {
    res.status(502).json({ ok: false, erro: 'falha ao ler a planilha' });
  }
};
