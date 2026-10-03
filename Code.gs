/**
 * Backend do site de casamento — Lais & Willian
 * -------------------------------------------------
 * Cole este código inteiro no Apps Script da planilha "Lista de Convidados e
 * Hospedagem - Lais & Will" (Extensões > Apps Script, apague o que já estiver
 * lá e cole isto no lugar).
 *
 * Depois de colar: Implantar > Nova implantação > tipo "Aplicativo da Web" >
 * Executar como "Eu" > Quem tem acesso "Qualquer pessoa" > Implantar.
 * Autorize quando o Google pedir (Avançado > Acessar [nome do projeto], não seguro).
 * Copie a URL do Web App gerada e me envie — eu conecto ela no site.
 *
 * O que este código faz:
 * 1) Busca de nome (usado no RSVP para a pessoa encontrar o próprio nome).
 * 2) Grava cada confirmação de presença numa aba nova chamada "Confirmações".
 * 3) Tenta marcar "Confirmado" na aba "Convidados", na linha da pessoa (se
 *    não encontrar por algum motivo, não tem problema — o registro em
 *    "Confirmações" já é a fonte de verdade).
 * 4) Grava presentes confirmados numa aba nova chamada "Presentes", quando o
 *    Vercel avisar que um PIX foi pago de verdade (isso só entra em uso
 *    quando o Mercado Pago estiver conectado).
 */

var SHEET_CONVIDADOS = 'Convidados';
var SHEET_CONFIRMACOES = 'Confirmações';
var SHEET_PRESENTES = 'Presentes';

// Linha (contando a partir de 0) onde está o cabeçalho da aba Convidados —
// hoje é a linha 9 da planilha (#, Nome, Sobrenome, Classificação...), que
// vira índice 8 aqui. Se algum dia adicionarem/removerem linhas ANTES do
// cabeçalho, ajuste este número.
var HEADER_ROW_INDEX = 8;
var COL_NOME = 1;       // coluna B (Nome) — coluna A é o número "#"
var COL_SOBRENOME = 2;  // coluna C (Sobrenome)

// Remove acentos pra comparar nomes sem depender de digitar o acento certo
// (ex: "avila" tem que encontrar "Ávila").
function semAcento(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Compara nome digitado com nome completo por PALAVRA, não por substring livre.
// Isso evita que "ana" encontre "Juliana" (que só contém as mesmas letras no meio
// da palavra) — cada palavra digitada precisa ser o COMEÇO de alguma palavra do
// nome completo, não aparecer em qualquer lugar.
function nomeCombina(nomeCompleto, query) {
  var queryWords = semAcento(query.toLowerCase()).split(/\s+/).filter(Boolean);
  var nomeWords = semAcento(nomeCompleto.toLowerCase()).split(/\s+/).filter(Boolean);
  if (queryWords.length === 0) return false;
  return queryWords.every(function(qw) {
    return nomeWords.some(function(nw) { return nw.indexOf(qw) === 0; });
  });
}

// Troque por uma senha só sua (qualquer texto). O Vercel vai enviar essa
// mesma senha quando avisar sobre um presente pago — isso impede que
// qualquer pessoa na internet grave presentes falsos na planilha.
var SEGREDO_PRESENTES = 'TROQUE_ESTA_SENHA';

function doGet(e) {
  var query = ((e.parameter && e.parameter.q) || '').trim();
  if (query.length < 2) {
    return jsonResponse([]);
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONVIDADOS);
  var data = sheet.getDataRange().getValues();
  var results = [];
  for (var i = HEADER_ROW_INDEX + 1; i < data.length; i++) {
    var nome = (data[i][COL_NOME] || '').toString().trim();
    var sobrenome = (data[i][COL_SOBRENOME] || '').toString().trim();
    if (!nome) continue;
    var nomeCompleto = (nome + ' ' + sobrenome).trim();
    if (nomeCombina(nomeCompleto, query)) {
      results.push(nomeCompleto);
      if (results.length >= 10) break;
    }
  }
  return jsonResponse(results);
}

function doPost(e) {
  var isJson = e.postData && e.postData.type === 'application/json';
  var action = e.parameter && e.parameter.action;
  var body = {};
  if (isJson) {
    try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
    action = action || body.action;
  }

  if (action === 'presente') {
    return handlePresente(body);
  }
  return handleRsvp(e.parameter || {});
}

function handleRsvp(p) {
  var sheet = getOrCreateSheet(SHEET_CONFIRMACOES, [
    'Data/Hora', 'Nome', 'E-mail', 'WhatsApp', 'Presença', 'Acompanhantes', 'Restrição alimentar'
  ]);
  sheet.appendRow([
    new Date(),
    p.nome || '',
    p.email || '',
    p.whatsapp || '',
    p.presenca || '',
    p.acompanhantes || '',
    p.restricao || ''
  ]);
  tentarMarcarConfirmado(p.nome);
  return jsonResponse({ ok: true });
}

function tentarMarcarConfirmado(nomeCompleto) {
  if (!nomeCompleto) return;
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONVIDADOS);
    var data = sheet.getDataRange().getValues();
    var header = data[HEADER_ROW_INDEX];
    var idx = header.indexOf('Confirmado');
    if (idx === -1) {
      idx = header.length;
      sheet.getRange(HEADER_ROW_INDEX + 1, idx + 1).setValue('Confirmado');
    }
    for (var i = HEADER_ROW_INDEX + 1; i < data.length; i++) {
      var nome = (data[i][COL_NOME] || '').toString().trim();
      var sobrenome = (data[i][COL_SOBRENOME] || '').toString().trim();
      var nomeCompletoLinha = (nome + ' ' + sobrenome).trim();
      if (nomeCompletoLinha.toLowerCase() === nomeCompleto.toLowerCase()) {
        sheet.getRange(i + 1, idx + 1).setValue('Sim — ' + new Date().toLocaleDateString('pt-BR'));
        break;
      }
    }
  } catch (err) {
    // Se algo der errado aqui, o RSVP já foi salvo em "Confirmações" mesmo assim.
  }
}

function handlePresente(body) {
  if (body.segredo !== SEGREDO_PRESENTES) {
    return jsonResponse({ ok: false, erro: 'não autorizado' });
  }
  var sheet = getOrCreateSheet(SHEET_PRESENTES, [
    'Data/Hora', 'Item', 'Valor', 'ID do pagamento (Mercado Pago)'
  ]);
  sheet.appendRow([
    new Date(),
    body.item || '',
    body.valor || '',
    body.paymentId || ''
  ]);
  return jsonResponse({ ok: true });
}

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
