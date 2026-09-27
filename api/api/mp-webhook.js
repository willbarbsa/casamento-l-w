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
    var paymentId = req.body && req.body.data && req.body.data.id;
    if (!paymentId) {
      // Mercado Pago também manda notificações de outros tipos — ignoramos.
      res.status(200).end();
      return;
    }

    var mpResp = await fetch('https://api.mercadopago.com/v1/payments/' + paymentId, {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    var payment = await mpResp.json();

    if (payment.status === 'approved' && appsScriptUrl) {
      await fetch(appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'presente',
          segredo: appsScriptSecret,
          item: payment.external_reference,
          valor: payment.transaction_amount,
          paymentId: payment.id
        })
      });
    }

    res.status(200).end();
  } catch (err) {
    // Sempre responde 200 pro Mercado Pago não ficar retentando indefinidamente.
    res.status(200).end();
  }
};
