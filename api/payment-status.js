// GET /api/payment-status?id=123  -> { status }
// Usado pelo site para saber se o PIX do presente foi pago e mostrar o "obrigado".
// Devolve apenas o status (nada de nome, valor ou mensagem).
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  var id = String((req.query && req.query.id) || '');
  if (!/^\d{5,20}$/.test(id)) { res.status(400).json({ error: 'id inválido' }); return; }
  var token = process.env.MP_ACCESS_TOKEN;
  if (!token) { res.status(500).json({ error: 'não configurado' }); return; }
  try {
    var r = await fetch('https://api.mercadopago.com/v1/payments/' + id, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    var p = await r.json();
    // só aceita pagamentos criados pelo nosso fluxo de presentes
    if (!r.ok || !p.description || p.description.indexOf('Presente de casamento') !== 0) {
      res.status(404).json({ status: 'unknown' });
      return;
    }
    res.status(200).json({ status: p.status });
  } catch (e) {
    res.status(502).json({ status: 'error' });
  }
};
