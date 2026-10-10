// POST /api/mp-webhook
// Configure esta URL como webhook de pagamentos no painel do Mercado Pago
// (Suas integrações > [app do casal] > Webhooks > URL de produção).
//
// Quando um PIX gerado pelo /api/create-charge é pago de verdade, o Mercado
// Pago chama esta URL. Aqui confirmamos o pagamento na API deles e avisamos
// o Apps Script pra registrar na planilha (aba "Presentes").
//
// Variáveis de ambiente necessárias no Vercel:
// - MP_ACCESS_TOKEN     (mesmo token usado em create-charge.js)
// - APPS_SCRIPT_URL     (URL do Web App do Apps Script, depois de implantado)
// - APPS_SCRIPT_SECRET  (a mesma senha definida em SEGREDO_PRESENTES no Code.gs)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  var accessToken = process.env.MP_ACCESS_TOKEN;
  var appsScriptUrl = process.env.APPS_SCRIPT_URL;
  var appsScriptSecret = process.env.APPS_SCRIPT_SECRET;

  try {
    var paymentId = (req.body && req.body.data && req.body.data.id) ||
      (req.query && (req.query['data.id'] || req.query.id));
    console.log('[mp-webhook] recebido', JSON.stringify({ tipo: req.body && (req.body.type || req.body.action), paymentId: paymentId || null,
      temToken: !!accessToken, temAppsScriptUrl: !!appsScriptUrl, temSegredo: !!appsScriptSecret }));
    if (!paymentId) {
      // Mercado Pago também manda notificações de outros tipos — ignoramos.
      res.status(200).end();
      return;
    }

    var mpResp = await fetch('https://api.mercadopago.com/v1/payments/' + paymentId, {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    var payment = await mpResp.json();
    console.log('[mp-webhook] pagamento', JSON.stringify({ http: mpResp.status, status: payment.status, valor: payment.transaction_amount }));

    if (payment.status === 'approved' && !appsScriptUrl) {
      console.log('[mp-webhook] ERRO: APPS_SCRIPT_URL não configurada na Vercel');
    }
    // Nome: vem do metadata; se o Mercado Pago não devolver, extrai da descrição
    // "Presente de casamento — Item (de Nome)".
    var ref = null;
    try { ref = JSON.parse(payment.external_reference); } catch (e) { ref = null; }
    var itemDoPagamento = (ref && ref.i) || payment.external_reference;
    var nomeDoPagamento = (payment.metadata && payment.metadata.nome) || (ref && ref.n) || '';
    var mensagemDoPagamento = (payment.metadata && payment.metadata.mensagem) || (ref && ref.m) || '';
    if (!nomeDoPagamento && payment.description) {
      var mm = /\(de (.*)\)\s*$/.exec(payment.description);
      if (mm) nomeDoPagamento = mm[1];
    }
    console.log('[mp-webhook] metadata', JSON.stringify(payment.metadata || null), 'nome:', nomeDoPagamento);

    if (payment.status === 'approved' && appsScriptUrl) {
      var asResp = await fetch(appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'presente',
          segredo: appsScriptSecret,
          item: itemDoPagamento,
          valor: payment.transaction_amount,
          nome: nomeDoPagamento,
          mensagem: mensagemDoPagamento,
          paymentId: payment.id
        })
      });
      var asTxt = await asResp.text();
      console.log('[mp-webhook] apps script', asResp.status, asTxt.slice(0, 200));
    }

    res.status(200).end();
  } catch (err) {
    console.log('[mp-webhook] ERRO', err && err.message);
    // Sempre responde 200 pro Mercado Pago não ficar retentando indefinidamente.
    res.status(200).end();
  }
};
