/**
 * Gestão do Casamento — Lais & Willian
 * Apps Script vinculado à planilha "Gestão do Casamento".
 *
 * Funções:
 *  1. doGet: devolve os dados em JSON para o painel (dozedoze.net/gestao), protegido por SECRET.
 *  2. registrarEdicao (onEdit instalável): grava "Atualizado em/por" na aba Tarefas.
 *  3. lembretes: e-mail terça e sexta com pendências, prazos e pagamentos + link wa.me.
 *  4. instalarGatilhos: roda UMA vez para criar os gatilhos.
 *
 * ANTES DE IMPLANTAR: troque SECRET por uma frase longa e aleatória
 * (a mesma vai na variável GESTAO_APPS_SCRIPT_SECRET da Vercel).
 */
var SECRET = 'TROQUE-ESTA-FRASE-POR-ALGO-LONGO-E-ALEATORIO';

var ABA_TAREFAS = 'Tarefas';
var ABA_CRONO = 'Cronograma';
var ABA_PAG = 'Pagamentos';
var ABA_FORN = 'Fornecedores';
var ABA_ORC = 'Orçamento';
var ABA_CFG = 'Config';

// ---------- utilidades ----------
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function tabela_(nome, ate) {
  var sh = ss_().getSheetByName(nome);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var cols = ate || sh.getLastColumn();
  var vals = sh.getRange(1, 1, last, cols).getValues();
  var head = vals[0];
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var row = vals[i];
    if (row.join('') === '') continue;
    var o = {};
    for (var j = 0; j < head.length; j++) {
      var v = row[j];
      if (v instanceof Date) v = Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd');
      o[String(head[j])] = v;
    }
    out.push(o);
  }
  return out;
}

function config_() {
  var sh = ss_().getSheetByName(ABA_CFG);
  var vals = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
  var c = {};
  vals.forEach(function (r) { if (r[0]) c[String(r[0]).trim()] = r[1]; });
  return c;
}

function cfg_(c, parte) {
  for (var k in c) if (k.toLowerCase().indexOf(parte.toLowerCase()) === 0) return c[k];
  return '';
}

function dataStr_(d) {
  if (!(d instanceof Date)) return '';
  return Utilities.formatDate(d, 'America/Sao_Paulo', 'dd/MM');
}

function brl_(n) {
  n = Number(n) || 0;
  return 'R$ ' + n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function hoje_() {
  var d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dias_(d) {
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - hoje_()) / 86400000);
}

// ---------- 1. API JSON ----------
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.secret !== SECRET) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, erro: 'nao autorizado' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var orcSh = ss_().getSheetByName(ABA_ORC);
  var orc = {};
  orcSh.getRange(1, 1, orcSh.getLastRow(), 2).getValues().forEach(function (r, i) {
    if (i > 0 && r[0]) orc[String(r[0])] = r[1];
  });
  var cfg = config_();
  var out = {
    ok: true,
    geradoEm: Utilities.formatDate(new Date(), 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss"),
    dataEvento: cfg_(cfg, 'Data') instanceof Date
      ? Utilities.formatDate(cfg_(cfg, 'Data'), 'America/Sao_Paulo', 'yyyy-MM-dd') : '2026-12-12',
    tarefas: tabela_(ABA_TAREFAS, 13),
    cronograma: tabela_(ABA_CRONO, 5),
    pagamentos: tabela_(ABA_PAG, 9),
    fornecedores: tabela_(ABA_FORN, 9),
    comunicacao: tabela_('Comunicação', 11),
    contatos: tabela_('Contatos RSVP', 24),
    metasRsvp: tabela_('Metas RSVP', 3),
    regras: tabela_('Regras', 2),
    orcamento: orc
  };
  try { out.extra = extras_(); } catch (x) { out.extra = { erro: String(x) }; }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- 2. Auditoria de edição (gatilho instalável) ----------
function registrarEdicao(e) {
  try {
    var sh = e.range.getSheet();
    if (sh.getName() !== ABA_TAREFAS) return;
    var r = e.range.getRow();
    var c = e.range.getColumn();
    if (r < 2 || c >= 11) return; // ignora cabeçalho e colunas K:M
    var quem = '';
    try { quem = Session.getActiveUser().getEmail() || e.user && e.user.email || ''; } catch (x) {}
    sh.getRange(r, 11).setValue(new Date());
    sh.getRange(r, 12).setValue(quem);
  } catch (err) { /* silencioso */ }
}

// ---------- 3. Lembretes ----------
function lembretes() {
  var cfg = config_();
  var enviar = String(cfg_(cfg, 'Enviar')).toLowerCase();
  if (enviar && enviar !== 'sim') return;

  var emails = [cfg_(cfg, 'E-mail do Willian'), cfg_(cfg, 'E-mail da Lais'), cfg_(cfg, 'E-mail do Dani')]
    .filter(function (x) { return x && String(x).indexOf('@') > 0; });
  if (!emails.length) return;

  var wppDani = String(cfg_(cfg, 'WhatsApp do Dani')).replace(/\D/g, '');
  var painel = cfg_(cfg, 'Endereço do painel') || 'https://dozedoze.net/gestao';
  var dow = new Date().getDay(); // 2 = terça, 5 = sexta
  var ehSexta = dow === 5;

  var tarefas = tabela_(ABA_TAREFAS, 13).filter(function (t) { return t['Status'] !== 'Feito'; });
  var pags = tabela_(ABA_PAG, 9);
  var evento = new Date(2026, 11, 12);
  var faltam = dias_(evento);

  var atrasadas = [], proximas = [];
  tarefas.forEach(function (t) {
    var d = t['Prazo'] ? new Date(t['Prazo'] + 'T12:00:00') : null;
    t._d = d;
    if (d && dias_(d) < 0) atrasadas.push(t);
    else if (d && dias_(d) <= 14) proximas.push(t);
  });
  var ordena = function (a, b) { return a._d - b._d; };
  atrasadas.sort(ordena); proximas.sort(ordena);

  var linhaT = function (t) {
    return '• [' + t['Responsável'] + '] ' + t['Tarefa'] +
      (t._d ? ' — prazo ' + dataStr_(t._d) : '') +
      (t['Status'] === 'Aguardando fornecedor' ? ' (aguardando fornecedor)' : '');
  };

  var corpo = [];
  corpo.push('Faltam ' + faltam + ' dias para o casamento (12/12).');
  corpo.push('');

  if (atrasadas.length) {
    corpo.push('ATRASADAS (' + atrasadas.length + '):');
    atrasadas.forEach(function (t) { corpo.push(linhaT(t)); });
    corpo.push('');
  }
  if (proximas.length) {
    corpo.push('VENCEM NOS PRÓXIMOS 14 DIAS (' + proximas.length + '):');
    proximas.forEach(function (t) { corpo.push(linhaT(t)); });
    corpo.push('');
  }

  // Pendências por responsável (terça)
  if (!ehSexta) {
    var porResp = {};
    tarefas.forEach(function (t) {
      var k = t['Responsável'] || 'Sem responsável';
      porResp[k] = (porResp[k] || 0) + 1;
    });
    corpo.push('PENDÊNCIAS ABERTAS POR RESPONSÁVEL:');
    Object.keys(porResp).forEach(function (k) { corpo.push('• ' + k + ': ' + porResp[k]); });
    corpo.push('');
  }

  // Pagamentos (sexta e terça: sempre mostra os próximos 14 dias)
  var pagProx = [], pagAtras = [];
  pags.forEach(function (p) {
    if (p['Status'] === 'Pago' || !p['Vencimento']) return;
    var d = new Date(p['Vencimento'] + 'T12:00:00');
    p._d = d;
    var n = dias_(d);
    if (n < 0) pagAtras.push(p);
    else if (n <= 14) pagProx.push(p);
  });
  pagProx.sort(ordena); pagAtras.sort(ordena);
  if (pagAtras.length) {
    corpo.push('PAGAMENTOS ATRASADOS:');
    pagAtras.forEach(function (p) {
      corpo.push('• ' + p['Fornecedor'] + ' — ' + p['Descrição'] + ' — ' + brl_(p['Valor (R$)']) + ' (venceu ' + dataStr_(p._d) + ')');
    });
    corpo.push('');
  }
  if (pagProx.length) {
    corpo.push('PAGAMENTOS NOS PRÓXIMOS 14 DIAS:');
    pagProx.forEach(function (p) {
      corpo.push('• ' + p['Fornecedor'] + ' — ' + p['Descrição'] + ' — ' + brl_(p['Valor (R$)']) + ' em ' + dataStr_(p._d) + ' (' + p['Forma'] + ')');
    });
    corpo.push('');
  }

  // Régua de comunicação: disparos dos próximos 7 dias (e os atrasados)
  var comms = tabela_('Comunicação', 10).filter(function (c) {
    return c['Data'] && c['Status'] !== 'Enviado' && c['Status'] !== 'Contínuo';
  });
  var commAtras = [], commProx = [];
  comms.forEach(function (c) {
    c._d = new Date(c['Data'] + 'T12:00:00');
    var n = dias_(c._d);
    if (n < 0) commAtras.push(c); else if (n <= 7) commProx.push(c);
  });
  commAtras.sort(ordena); commProx.sort(ordena);
  var linhaC = function (c) {
    return '• ' + dataStr_(c._d) + ' — ' + c['Ação'] + ' (quem envia: ' + c['Quem envia'] + (c['Público'] && c['Público'] !== '—' ? '; público: ' + c['Público'] : '') + ')';
  };
  if (commAtras.length) {
    corpo.push('COMUNICAÇÕES ATRASADAS:');
    commAtras.forEach(function (c) { corpo.push(linhaC(c)); });
    corpo.push('');
  }
  if (commProx.length) {
    corpo.push('COMUNICAÇÕES DOS PRÓXIMOS 7 DIAS:');
    commProx.forEach(function (c) { corpo.push(linhaC(c)); });
    corpo.push('');
  }

  // Sexta: concluídas na semana + projeção
  if (ehSexta) {
    var feitas = tabela_(ABA_TAREFAS, 13).filter(function (t) {
      if (t['Status'] !== 'Feito' || !t['Atualizado em']) return false;
      var d = new Date(String(t['Atualizado em']).substring(0, 10) + 'T12:00:00');
      return dias_(d) >= -7;
    });
    if (feitas.length) {
      corpo.push('CONCLUÍDAS NA SEMANA (' + feitas.length + '):');
      feitas.forEach(function (t) { corpo.push('✓ ' + t['Tarefa']); });
      corpo.push('');
    }
    var orcSh = ss_().getSheetByName(ABA_ORC);
    var v = orcSh.getRange(2, 2, 10, 1).getValues();
    corpo.push('ORÇAMENTO: previsto ' + brl_(v[1][0]) + ' · pago ' + brl_(v[2][0]) +
      ' · teto ' + brl_(v[0][0]) + ' · diferença ' + brl_(v[6][0]));
    corpo.push('');
  }

  if (!atrasadas.length && !proximas.length && !pagProx.length && !pagAtras.length && !commProx.length && !commAtras.length) {
    corpo.push('Nada urgente nos próximos 14 dias.');
    corpo.push('');
  }

  corpo.push('Painel: ' + painel);
  corpo.push('Planilha: ' + ss_().getUrl());

  // Link wa.me para cobrar o Dani
  if (wppDani) {
    var resumo = 'Oi Dani! Pendências da semana do casamento:\n';
    atrasadas.slice(0, 6).forEach(function (t) { resumo += '- (atrasada) ' + t['Tarefa'] + '\n'; });
    proximas.slice(0, 6).forEach(function (t) { resumo += '- ' + t['Tarefa'] + ' (até ' + dataStr_(t._d) + ')\n'; });
    resumo += 'Pode atualizar o status na planilha? ' + ss_().getUrl();
    corpo.push('');
    corpo.push('Cobrar o Dani no WhatsApp (toque para abrir): https://wa.me/' + wppDani + '?text=' + encodeURIComponent(resumo));
  }

  var assunto = (ehSexta ? 'Sexta' : 'Terça') + ' do casamento — ' + atrasadas.length + ' atrasadas, ' +
    proximas.length + ' a vencer · faltam ' + faltam + ' dias';
  MailApp.sendEmail({ to: emails.join(','), subject: assunto, body: corpo.join('\n') });
}

// ---------- 4. Instalação ----------
function instalarGatilhos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('registrarEdicao').forSpreadsheet(ss_()).onEdit().create();
  ScriptApp.newTrigger('lembretes').timeBased().onWeekDay(ScriptApp.WeekDay.TUESDAY).atHour(8).create();
  ScriptApp.newTrigger('lembretes').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(8).create();
}

// ---------- 5. Marcar tarefa como feita / comunicação como enviada (pelo painel) ----------
// Só altera a coluna Status. Valores financeiros e textos não são editáveis por aqui.
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (x) {}
  if (body.secret !== SECRET) return json_({ ok: false, erro: 'nao autorizado' });
  if (body.action === 'marcar') return marcar_(body);
  if (body.action === 'rsvp') return rsvp_(body);
  return json_({ ok: false, erro: 'acao invalida' });
}

// ---------- 5b. Reconfirmação de presença (aba "Contatos RSVP") ----------
// Só altera: Resposta, Adultos, Crianças 7 a 12, Crianças 0 a 6, Observações,
// Hotel, Vans, "2ª confirmação enviada em" e "Guia enviado em". Nunca altera nome, telefone ou perfil.
var RESPOSTAS_ = ['', 'Confirmou', 'Não vai', 'Sem certeza', 'Caixa postal', 'Tel. errado', 'Sem WhatsApp'];
var HOTEIS_ = ['', 'Faro', 'Itapetinga', 'Hípica', 'Outro', 'Não vai se hospedar'];
var VANS_ = ['', 'Sim', 'Não'];

function rsvp_(b) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = ss_().getSheetByName('Contatos RSVP');
    if (!sh) return json_({ ok: false, erro: 'aba Contatos RSVP nao existe' });
    var n = sh.getLastRow() - 1;
    if (n < 1) return json_({ ok: false, erro: 'vazio' });
    var ids = sh.getRange(2, 1, n, 7).getValues();
    var row = -1;
    for (var i = 0; i < ids.length; i++) { if (String(ids[i][0]) === String(b.id)) { row = i + 2; break; } }
    if (row < 0) return json_({ ok: false, erro: 'id nao encontrado' });
    if (String(ids[row - 2][6]) !== 'Central') return json_({ ok: false, erro: 'so as centrais sao contatadas' });

    var quem = b.perfil === 'dani' ? 'Dani' : 'Casal';
    var acoes = [];
    if (b.resposta !== undefined) {
      if (RESPOSTAS_.indexOf(String(b.resposta)) < 0) return json_({ ok: false, erro: 'resposta invalida' });
      sh.getRange(row, 13).setValue(String(b.resposta));
      acoes.push('resposta=' + (b.resposta || '(vazio)'));
    }
    var num = function (v) { var x = parseInt(v, 10); return isNaN(x) || x < 0 || x > 30 ? '' : x; };
    if (b.adultos !== undefined) { sh.getRange(row, 14).setValue(num(b.adultos)); acoes.push('adultos'); }
    if (b.c712 !== undefined) { sh.getRange(row, 15).setValue(num(b.c712)); acoes.push('criancas 7-12'); }
    if (b.c06 !== undefined) { sh.getRange(row, 16).setValue(num(b.c06)); acoes.push('criancas 0-6'); }
    if (b.obs !== undefined) { sh.getRange(row, 17).setValue(String(b.obs).substring(0, 300)); acoes.push('obs'); }
    if (b.hotel !== undefined) {
      if (HOTEIS_.indexOf(String(b.hotel)) < 0) return json_({ ok: false, erro: 'hotel invalido' });
      sh.getRange(row, 22).setValue(String(b.hotel)); acoes.push('hotel=' + (b.hotel || '(vazio)'));
    }
    if (b.vans !== undefined) {
      if (VANS_.indexOf(String(b.vans)) < 0) return json_({ ok: false, erro: 'vans invalido' });
      sh.getRange(row, 23).setValue(String(b.vans)); acoes.push('vans=' + (b.vans || '(vazio)'));
    }
    if (b.enviado) {
      var col = b.enviado === '2a' ? 18 : b.enviado === 'guia' ? 19 : b.enviado === 'fu' ? 24 : 0;
      if (!col) return json_({ ok: false, erro: 'rodada invalida' });
      // guarda data e hora como texto ("2026-11-10 10:42"), para calcular as 36 horas do lembrete
      var cel = sh.getRange(row, col);
      cel.setNumberFormat('@');
      cel.setValue(b.desfazer ? '' : Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm'));
      acoes.push((b.desfazer ? 'desmarcou' : 'marcou') + ' envio ' + b.enviado);
    }
    sh.getRange(row, 20).setValue(new Date());
    sh.getRange(row, 21).setValue('Painel · ' + quem);
    log_(quem, 'Contatos RSVP', b.id, String(ids[row - 2][1]), acoes.join(', '), 'OK');
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function marcar_(b) {
  var cfg = { 'Tarefas': { col: 6, feito: 'Feito' }, 'Comunicação': { col: 8, feito: 'Enviado' } };
  var c = cfg[b.aba];
  if (!c) return json_({ ok: false, erro: 'aba invalida' });
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = ss_().getSheetByName(b.aba);
    var n = sh.getLastRow() - 1;
    if (n < 1) return json_({ ok: false, erro: 'vazio' });
    var ids = sh.getRange(2, 1, n, 1).getValues();
    var row = -1;
    for (var i = 0; i < ids.length; i++) { if (String(ids[i][0]) === String(b.id)) { row = i + 2; break; } }
    if (row < 0) return json_({ ok: false, erro: 'id nao encontrado' });
    var atual = sh.getRange(row, c.col).getValue();
    if (atual === 'Contínuo') return json_({ ok: false, erro: 'item continuo' });
    var quem = b.perfil === 'dani' ? 'Dani' : 'Casal';
    var acao = b.feito ? 'Marcou' : 'Desmarcou';
    var dono = sh.getRange(row, b.aba === 'Tarefas' ? 4 : 7).getValue();
    var item = String(sh.getRange(row, b.aba === 'Tarefas' ? 3 : 4).getValue()).split('\n')[0];
    if (!permitido_(b.perfil, b.aba, dono)) {
      log_(quem, b.aba, b.id, item, acao, 'BLOQUEADO');
      return json_({ ok: false, erro: 'sem permissão: este item é de ' + (dono || 'outro responsável') });
    }
    var novo = b.feito ? c.feito : 'A fazer';
    sh.getRange(row, c.col).setValue(novo);
    if (b.aba === 'Tarefas') {
      sh.getRange(row, 11).setValue(new Date());
      sh.getRange(row, 12).setValue('Painel · ' + quem);
    }
    log_(quem, b.aba, b.id, item, acao, 'OK');
    return json_({ ok: true, status: novo });
  } finally {
    lock.releaseLock();
  }
}

// Regra: o Dani só marca itens dele; o casal marca os do casal (Lais, Willian, Casal), nunca os do Dani.
function permitido_(perfil, aba, dono) {
  var d = String(dono || '').toLowerCase();
  if (aba === 'Tarefas') return perfil === 'dani' ? d === 'dani' : d !== 'dani';
  if (!d || d === '—') return true;
  return perfil === 'dani' ? d.indexOf('dani') > -1 : d.indexOf('casal') > -1;
}

// Registra cada clique (feito ou bloqueado) na aba "Log de cliques".
function log_(quem, aba, id, item, acao, resultado) {
  try {
    var ss = ss_();
    var sh = ss.getSheetByName('Log de cliques');
    if (!sh) {
      sh = ss.insertSheet('Log de cliques');
      sh.appendRow(['Data/hora', 'Quem', 'Aba', 'ID', 'Item', 'Ação', 'Resultado']);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, 7).setFontWeight('bold');
    }
    sh.appendRow([new Date(), quem, aba, id, item, acao, resultado]);
  } catch (x) {}
}


// ---------- 6. Dados da planilha de convidados (presentes e RSVP) para o painel ----------
function extras_() {
  var ss = SpreadsheetApp.openById('1416CpLafF0nZjjoYZENsjo1_p93NfyiV4qWBXVjYwyU');
  var out = { presentes: [], conv: {} };
  var p = ss.getSheetByName('Presentes');
  if (p && p.getLastRow() > 1) {
    p.getRange(2, 1, p.getLastRow() - 1, 6).getValues().forEach(function (r) {
      if (!r[1] || String(r[1]).toLowerCase() === 'teste') return;
      out.presentes.push({
        data: r[0] instanceof Date ? Utilities.formatDate(r[0], 'America/Sao_Paulo', 'yyyy-MM-dd') : String(r[0]),
        item: String(r[1]), valor: Number(String(r[2]).replace(',', '.')) || 0,
        nome: String(r[4] || ''), msg: String(r[5] || '')
      });
    });
  }
  // Lê cada número pelo NOME do rótulo (não pela posição), para não quebrar se o layout mudar.
  var v = ss.getSheetByName('Convidados').getRange(1, 1, 8, 12).getValues();
  var achar = function (rotulo) {
    for (var i = 0; i < v.length; i++) {
      for (var j = 0; j < v[i].length - 1; j++) {
        if (String(v[i][j]).trim().toLowerCase() === rotulo) return Number(v[i][j + 1]) || 0;
      }
    }
    return 0;
  };
  var conf = achar('confirmados'), decl = achar('declinados'), pend = achar('pendentes');
  out.conv = { festa: achar('convidados festa'), pizzada: achar('convidados pizzada'),
               confirmados: conf, declinados: decl, pendentes: pend, total: conf + decl + pend };
  return out;
}
