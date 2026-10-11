// POST /api/gestao-marcar  { aba, id, feito }
// Marca uma tarefa como Feito (ou uma comunicação como Enviado) na planilha de Gestão.
// Exige sessão válida. Só altera o campo Status — nenhum valor financeiro é editável por aqui.
var S = require('./_gestao-session');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  var perfil = S.ler(req, process.env.SESSION_SECRET);
  if (!perfil) { res.status(401).json({ ok: false, erro: 'login' }); return; }

  var b = req.body || {};
  var aba = String(b.aba || ''), id = String(b.id || '');
  if (['Tarefas', 'Comunicação'].indexOf(aba) === -1 || !/^[A-Za-z0-9_-]{1,20}$/.test(id)) {
    res.status(400).json({ ok: false, erro: 'dados inválidos' }); return;
  }
  var url = process.env.GESTAO_APPS_SCRIPT_URL, seg = process.env.GESTAO_APPS_SCRIPT_SECRET;
  if (!url || !seg) { res.status(500).json({ ok: false, erro: 'não configurado' }); return; }

  try {
    var r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: seg, action: 'marcar', aba: aba, id: id, feito: !!b.feito, perfil: perfil }),
      redirect: 'follow'
    });
    var d = await r.json();
    res.status(d.ok ? 200 : 502).json({ ok: !!d.ok, status: d.status, erro: d.ok ? undefined : (d.erro || 'planilha') });
  } catch (e) {
    res.status(502).json({ ok: false, erro: 'falha ao gravar na planilha' });
  }
};
