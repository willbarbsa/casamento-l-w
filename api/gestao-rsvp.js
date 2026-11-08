// POST /api/gestao-rsvp  { id, resposta?, adultos?, c712?, c06?, obs?, enviado?, desfazer? }
// Grava o andamento da reconfirmação de presença na aba "Contatos RSVP" da planilha de Gestão.
// Exige sessão válida. Só altera resposta, quantidades, observação e a marca de envio:
// nome, telefone e perfil nunca são editáveis por aqui.
var S = require('./_gestao-session');

var RESPOSTAS = ['', 'Confirmou', 'Não vai', 'Sem certeza', 'Caixa postal', 'Tel. errado', 'Sem WhatsApp'];

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  var perfil = S.ler(req, process.env.SESSION_SECRET);
  if (!perfil) { res.status(401).json({ ok: false, erro: 'login' }); return; }

  var b = req.body || {};
  var id = String(b.id || '');
  if (!/^R[0-9]{3,4}$/.test(id)) { res.status(400).json({ ok: false, erro: 'dados inválidos' }); return; }

  var out = { secret: process.env.GESTAO_APPS_SCRIPT_SECRET, action: 'rsvp', id: id, perfil: perfil };
  if (b.resposta !== undefined) {
    if (RESPOSTAS.indexOf(String(b.resposta)) < 0) { res.status(400).json({ ok: false, erro: 'resposta inválida' }); return; }
    out.resposta = String(b.resposta);
  }
  ['adultos', 'c712', 'c06'].forEach(function (k) {
    if (b[k] !== undefined) {
      var n = parseInt(b[k], 10);
      out[k] = (b[k] === '' || isNaN(n) || n < 0 || n > 30) ? '' : n;
    }
  });
  if (b.obs !== undefined) out.obs = String(b.obs).substring(0, 300);
  if (b.enviado !== undefined) {
    if (['2a', 'guia'].indexOf(String(b.enviado)) < 0) { res.status(400).json({ ok: false, erro: 'rodada inválida' }); return; }
    out.enviado = String(b.enviado);
    out.desfazer = !!b.desfazer;
  }

  var url = process.env.GESTAO_APPS_SCRIPT_URL;
  if (!url || !out.secret) { res.status(500).json({ ok: false, erro: 'não configurado' }); return; }
  try {
    var r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(out),
      redirect: 'follow'
    });
    var d = await r.json();
    res.status(d.ok ? 200 : 502).json({ ok: !!d.ok, erro: d.ok ? undefined : (d.erro || 'planilha') });
  } catch (e) {
    res.status(502).json({ ok: false, erro: 'falha ao gravar na planilha' });
  }
};
