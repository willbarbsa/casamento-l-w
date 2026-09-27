// POST /api/create-charge
// Recebe { item, valor } do site e cria uma cobrança PIX dinâmica no Mercado
// Pago (QR code + copia-e-cola vinculados a esse valor exato).
//
// Requer a variável de ambiente MP_ACCESS_TOKEN no Vercel (Settings >
// Environment Variables) com o Access Token de produção da conta Mercado
// Pago do casal. NUNCA coloque o token direto no código.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  var accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado no Vercel' });
    return;
  }

  var body = req.body || {};
  var item = (body.item || 'Presente').toString().slice(0, 120);
  var valor = parseFloat(body.valor);
  if (!valor || valor <= 0) {
    res.status(400).json({ error: 'valor inválido' });
    return;
  }

  try {
    var mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': item + '-' + Date.now()
      },
      body: JSON.stringify({
        transaction_amount: valor,
        description: 'Presente de casamento — ' + item,
        payment_method_id: 'pix',
        external_reference: item,
        // Mercado Pago exige um e-mail de pagador — não coletamos isso no
        // site, então usamos um e-mail fixo do casal. Ajustar aqui se
        // quiserem coletar o e-mail de quem está presenteando.
        payer: { email: 'presente-casamento@laiswillian.com' }
      })
    });

    var data = await mpResponse.json();
    if (!mpResponse.ok) {
      res.status(502).json({ error: 'erro ao criar cobrança', detalhe: data });
      return;
    }

    var txData = data.point_of_interaction && data.point_of_interaction.transaction_data;
    res.status(200).json({
      paymentId: data.id,
      qrCodeBase64: txData ? txData.qr_code_base64 : null,
      copiaECola: txData ? txData.qr_code : null
    });
  } catch (err) {
    res.status(500).json({ error: 'falha ao conectar ao Mercado Pago' });
  }
};
