// docs/js/bets.js
//
// Aba "Apostas": registro PESSOAL das apostas feitas em casa externa.
// O usuário escolhe um jogo dentre os que o FUT RADAR já analisou
// (com escudo, competição e as probabilidades calculadas), escolhe em
// que resultado apostou (mandante / empate / visitante), e informa
// valor + odd. Quando o placar final do jogo estiver disponível nos
// dados coletados, o próprio app decide automaticamente se a aposta
// foi ganha ou perdida e calcula o lucro — sem o usuário precisar
// marcar nada manualmente.
//
// Tudo fica salvo em localStorage, só no navegador do usuário.

const STORAGE_KEY = 'futradar_apostas_v2';

let painelData = null;
let jogoSelecionado = null; // jogo escolhido no seletor, antes de salvar
let tipoApostaSelecionado = null; // mandante / empate / visitante

async function carregarPainelData() {
  try {
    const res = await fetch('data/data.json', { cache: 'no-store' });
    painelData = await res.json();
  } catch (e) {
    painelData = null;
  }
}

function carregarApostas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function salvarApostas(apostas) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(apostas));
}

function novoId() {
  return 'ap_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
}

function formatMoeda(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDataCurta(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// Procura, nos resultados recentes já coletados, o placar final do jogo
// vinculado a uma aposta pendente. Se achar, decide automaticamente se
// a aposta bateu com o resultado e calcula o lucro.
function tentarGraduarAutomaticamente(aposta) {
  if (aposta.resultado !== 'pendente' || !painelData) return aposta;

  const jogoFinal = (painelData.resultadosRecentes || []).find((m) => m.id === aposta.matchId);
  if (!jogoFinal || jogoFinal.placarMandante == null || jogoFinal.placarVisitante == null) {
    return aposta; // ainda não temos o resultado
  }

  let vencedor;
  if (jogoFinal.placarMandante > jogoFinal.placarVisitante) vencedor = 'mandante';
  else if (jogoFinal.placarMandante < jogoFinal.placarVisitante) vencedor = 'visitante';
  else vencedor = 'empate';

  const acertou = vencedor === aposta.tipoAposta;

  return {
    ...aposta,
    resultado: acertou ? 'ganhou' : 'perdeu',
    placarFinal: `${jogoFinal.placarMandante} x ${jogoFinal.placarVisitante}`,
    graduadaEm: new Date().toISOString(),
  };
}

function graduarTodasPendentes() {
  const apostas = carregarApostas();
  let mudou = false;
  const atualizadas = apostas.map((a) => {
    const g = tentarGraduarAutomaticamente(a);
    if (g.resultado !== a.resultado) mudou = true;
    return g;
  });
  if (mudou) salvarApostas(atualizadas);
  return atualizadas;
}

function exportarApostas() {
  const apostas = carregarApostas();
  const blob = new Blob([JSON.stringify(apostas, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const hoje = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `fut-radar-apostas-${hoje}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importarApostasDeArquivo(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const importadas = JSON.parse(e.target.result);
      if (!Array.isArray(importadas)) throw new Error('formato inválido');

      const atuais = carregarApostas();
      const idsAtuais = new Set(atuais.map((a) => a.id));
      let novas = 0;

      for (const imp of importadas) {
        if (imp && imp.id && !idsAtuais.has(imp.id)) {
          atuais.push(imp);
          idsAtuais.add(imp.id);
          novas++;
        }
      }

      salvarApostas(atuais);
      alert(`Importação concluída: ${novas} aposta(s) nova(s) adicionada(s) (as que já existiam foram ignoradas, sem duplicar).`);
      renderApostas();
    } catch (err) {
      alert('Não foi possível ler esse arquivo. Confirme que é um .json exportado pelo próprio FUT RADAR.');
    }
  };
  reader.readAsText(file);
}

function renderBotoesExportImport() {
  return `
    <div class="export-import-row">
      <button type="button" id="btn-exportar" class="btn-secundario btn-metade">⬇ Exportar</button>
      <label class="btn-secundario btn-metade btn-arquivo">
        ⬆ Importar
        <input type="file" id="input-importar" accept="application/json,.json" hidden>
      </label>
    </div>`;
}

function calcularEstatisticas(apostas) {
  const resolvidas = apostas.filter((a) => a.resultado === 'ganhou' || a.resultado === 'perdeu');
  const pendentes = apostas.filter((a) => a.resultado === 'pendente').length;

  let totalApostado = 0;
  let totalRetornado = 0;
  let ganhas = 0;
  let perdidas = 0;

  for (const a of resolvidas) {
    totalApostado += a.valor;
    if (a.resultado === 'ganhou') {
      totalRetornado += a.valor * a.odd;
      ganhas++;
    } else {
      perdidas++;
    }
  }

  const saldo = totalRetornado - totalApostado;
  const roi = totalApostado > 0 ? (saldo / totalApostado) * 100 : 0;
  const taxaAcerto = ganhas + perdidas > 0 ? (ganhas / (ganhas + perdidas)) * 100 : 0;

  return { totalApostado, totalRetornado, saldo, roi, ganhas, perdidas, taxaAcerto, pendentes };
}

function renderGraficoSaldo(apostas) {
  const resolvidas = [...apostas]
    .filter((a) => a.resultado === 'ganhou' || a.resultado === 'perdeu')
    .sort((a, b) => new Date(a.data) - new Date(b.data));

  if (resolvidas.length === 0) {
    return '<p class="empty-msg">O gráfico aparece assim que você tiver apostas com resultado definido.</p>';
  }

  let acumulado = 0;
  const pontos = resolvidas.map((a) => {
    const lucro = a.resultado === 'ganhou' ? a.valor * a.odd - a.valor : -a.valor;
    acumulado += lucro;
    return acumulado;
  });

  const w = 600;
  const h = 160;
  const pad = 10;
  const min = Math.min(0, ...pontos);
  const max = Math.max(0, ...pontos);
  const range = max - min || 1;

  const stepX = pontos.length > 1 ? (w - pad * 2) / (pontos.length - 1) : 0;
  const coords = pontos.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const zeroY = h - pad - ((0 - min) / range) * (h - pad * 2);
  const corLinha = acumulado >= 0 ? 'var(--green)' : 'var(--red)';

  return `
    <svg class="saldo-chart" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${pad}" y1="${zeroY.toFixed(1)}" x2="${w - pad}" y2="${zeroY.toFixed(1)}" stroke="var(--border)" stroke-dasharray="4 4" />
      <polyline points="${coords.join(' ')}" fill="none" stroke="${corLinha}" stroke-width="2.5" />
    </svg>`;
}

function renderStatsCards(stats) {
  return `
    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-label">Saldo</span>
        <span class="stat-value ${stats.saldo >= 0 ? 'positivo' : 'negativo'}">${formatMoeda(stats.saldo)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">ROI</span>
        <span class="stat-value ${stats.roi >= 0 ? 'positivo' : 'negativo'}">${stats.roi.toFixed(1)}%</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Taxa de acerto</span>
        <span class="stat-value">${stats.taxaAcerto.toFixed(0)}%</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Ganhas / Perdidas</span>
        <span class="stat-value">${stats.ganhas} / ${stats.perdidas}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Total apostado</span>
        <span class="stat-value">${formatMoeda(stats.totalApostado)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Pendentes</span>
        <span class="stat-value">${stats.pendentes}</span>
      </div>
    </div>`;
}

function crestImg(url) {
  return url ? `<img class="team-crest" src="${url}" alt="" loading="lazy">` : '';
}

function renderSeletorDeJogo() {
  const analises = painelData?.analises || [];

  if (analises.length === 0) {
    return '<p class="empty-msg">Nenhum jogo analisado disponível ainda no Painel. Espere a próxima coleta.</p>';
  }

  const itens = analises
    .map(
      (a) => `
      <button type="button" class="jogo-opcao" data-id="${a.id}">
        <span class="jogo-opcao-times">
          ${crestImg(a.mandanteEscudo)} ${a.mandante} x ${a.visitante} ${crestImg(a.visitanteEscudo)}
        </span>
        <span class="jogo-opcao-meta">${a.competicao} · ${formatDataCurta(a.data)}</span>
      </button>`
    )
    .join('');

  return `<div class="jogo-seletor-lista">${itens}</div>`;
}

function renderJogoSelecionadoResumo(jogo) {
  if (!jogo) return '<p class="empty-msg">Nenhum jogo escolhido ainda.</p>';
  return `
    <div class="jogo-escolhido">
      <span class="jogo-opcao-times">
        ${crestImg(jogo.mandanteEscudo)} ${jogo.mandante} x ${jogo.visitante} ${crestImg(jogo.visitanteEscudo)}
      </span>
      <span class="jogo-opcao-meta">${jogo.competicao} · ${formatDataCurta(jogo.data)}</span>
    </div>`;
}

// Time com maior chance de vencer, pra destacar em verde. Se o empate
// for a maior probabilidade das três, não destaca nenhum time.
function calcularFavorito(p) {
  const maior = Math.max(p.mandante, p.empate, p.visitante);
  if (p.empate === maior) return null;
  return p.mandante > p.visitante ? 'mandante' : 'visitante';
}

function renderOpcoesTipoAposta(jogo) {
  if (!jogo) {
    return `
      <div class="tipo-aposta-opcoes">
        <button type="button" class="tipo-opcao" disabled>Mandante</button>
        <button type="button" class="tipo-opcao" disabled>Empate</button>
        <button type="button" class="tipo-opcao" disabled>Visitante</button>
      </div>`;
  }
  const favorito = calcularFavorito(jogo.probabilidades);
  const opcoes = [
    { tipo: 'mandante', label: jogo.mandante },
    { tipo: 'empate', label: 'Empate' },
    { tipo: 'visitante', label: jogo.visitante },
  ];
  return `
    <div class="tipo-aposta-opcoes">
      ${opcoes
        .map(
          (o) => `
        <button type="button"
          class="tipo-opcao ${favorito === o.tipo ? 'favorito' : ''} ${tipoApostaSelecionado === o.tipo ? 'active' : ''}"
          data-tipo="${o.tipo}">
          ${o.label}
        </button>`
        )
        .join('')}
    </div>`;
}

function renderFormNovaAposta() {
  const jogo = jogoSelecionado;
  const podeSubmeter = !!(jogo && tipoApostaSelecionado);
  return `
    <div class="app-card aposta-form">
      <h3 class="section-title" style="margin-top:0">Nova aposta</h3>

      <label class="campo-label">Jogo</label>
      <button type="button" id="btn-escolher-jogo" class="btn-secundario">
        ${jogo ? 'Trocar jogo escolhido' : 'Escolher jogo analisado pelo app'}
      </button>
      <div id="resumo-jogo-escolhido">${renderJogoSelecionadoResumo(jogo)}</div>
      <div id="seletor-jogo-wrap" hidden>${renderSeletorDeJogo()}</div>

      <form id="form-nova-aposta" style="margin-top:14px">
        <label class="campo-label">Aposta em</label>
        ${renderOpcoesTipoAposta(jogo)}
        <div class="form-row" style="margin-top:12px">
          <label class="campo-form">Valor apostado (R$)<input type="number" name="valor" step="0.01" min="0.01" required></label>
          <label class="campo-form">Odd<input type="number" name="odd" step="0.01" min="1.01" required></label>
        </div>
        <button type="submit" id="btn-salvar-aposta" class="btn-primary" ${!podeSubmeter ? 'disabled' : ''}>Adicionar aposta</button>
      </form>
    </div>`;
}

// Se o jogo já devia ter acabado (mais de 3h desde o início) e a
// coleta ainda não trouxe o placar, libera marcar manualmente — pra
// não ficar pendente pra sempre esperando a próxima coleta.
function jogoProvavelmenteFinalizado(dataIso) {
  const kickoff = new Date(dataIso).getTime();
  return Date.now() - kickoff > 3 * 60 * 60 * 1000;
}

function renderListaApostas(apostas) {
  if (apostas.length === 0) {
    return '<p class="empty-msg">Nenhuma aposta registrada ainda.</p>';
  }
  const ordenadas = [...apostas].sort((a, b) => new Date(b.data) - new Date(a.data));

  function rotuloDaAposta(a) {
    if (a.tipoAposta === 'mandante') return a.mandante;
    if (a.tipoAposta === 'visitante') return a.visitante;
    return 'Empate';
  }

  const linhas = ordenadas
    .map((a) => {
      const retorno = a.valor * a.odd;
      const lucro = a.resultado === 'ganhou' ? retorno - a.valor : a.resultado === 'perdeu' ? -a.valor : null;
      const lucroTxt = lucro === null ? 'Pendente' : formatMoeda(lucro);
      const lucroClasse = lucro === null ? '' : lucro >= 0 ? 'positivo' : 'negativo';

      const podeMarcarManual = a.resultado === 'pendente';
      const jaDeveriaTerAcabado = jogoProvavelmenteFinalizado(a.data);
      const marcarManualHtml = podeMarcarManual
        ? `
        <div class="marcar-manual" data-id="${a.id}">
          <span class="marcar-manual-label">${jaDeveriaTerAcabado ? 'Jogo já deve ter acabado. Marcar:' : 'Marcar resultado manualmente:'}</span>
          <div class="marcar-manual-btns">
            <button type="button" class="btn-mini btn-mini-ganhou" data-id="${a.id}" data-resultado="ganhou">Ganhou</button>
            <button type="button" class="btn-mini btn-mini-perdeu" data-id="${a.id}" data-resultado="perdeu">Perdeu</button>
            <button type="button" class="btn-mini" data-id="${a.id}" data-resultado="anulada">Anulada</button>
          </div>
        </div>`
        : '';

      return `
        <div class="app-card aposta-row">
          <div class="aposta-info">
            <div class="aposta-titulo">
              ${crestImg(a.mandanteEscudo)} ${a.mandante} x ${a.visitante} ${crestImg(a.visitanteEscudo)}
            </div>
            <div class="aposta-meta">${formatDataCurta(a.data)} · ${a.competicao} · apostou em: ${rotuloDaAposta(a)}</div>
            <div class="aposta-meta">Valor: ${formatMoeda(a.valor)} · Odd: ${a.odd.toFixed(2)} · Retorno possível: ${formatMoeda(retorno)}${a.placarFinal ? ' · Placar final: ' + a.placarFinal : ''}</div>
            ${marcarManualHtml}
          </div>
          <div class="aposta-acoes">
            <span class="lucro-tag ${lucroClasse}">${lucroTxt}</span>
            <button class="btn-excluir" data-id="${a.id}" title="Excluir">🗑</button>
          </div>
        </div>`;
    })
    .join('');

  return `<div class="aposta-lista">${linhas}</div>`;
}

async function renderApostas() {
  const root = document.getElementById('apostas-root');
  if (!root) return;

  root.innerHTML = '<p class="loading">Carregando...</p>';
  await carregarPainelData();
  const apostas = graduarTodasPendentes();
  const stats = calcularEstatisticas(apostas);

  root.innerHTML = `
    <h2 class="section-title" style="margin-top:0">Seu desempenho</h2>
    ${renderBotoesExportImport()}
    ${renderStatsCards(stats)}
    ${renderGraficoSaldo(apostas)}
    ${renderFormNovaAposta()}
    <h2 class="section-title">Histórico</h2>
    ${renderListaApostas(apostas)}
    <p class="apostas-legal">FUT RADAR não tem qualquer relação com casas de apostas — esta aba é só um registro
      pessoal do que você apostou em outro lugar, guardado apenas neste navegador. Use "Exportar" de vez em
      quando pra não perder o histórico se trocar de celular ou limpar os dados do navegador.</p>
  `;

  document.getElementById('btn-exportar')?.addEventListener('click', exportarApostas);
  document.getElementById('input-importar')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importarApostasDeArquivo(file);
    e.target.value = '';
  });

  const btnEscolher = document.getElementById('btn-escolher-jogo');
  const wrapSeletor = document.getElementById('seletor-jogo-wrap');
  if (btnEscolher) {
    btnEscolher.addEventListener('click', () => {
      wrapSeletor.hidden = !wrapSeletor.hidden;
    });
  }

  root.querySelectorAll('.jogo-opcao').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      jogoSelecionado = (painelData.analises || []).find((a) => String(a.id) === String(id)) || null;
      tipoApostaSelecionado = null; // troca de jogo reseta a escolha de tipo
      renderApostas();
    });
  });

  root.querySelectorAll('.tipo-opcao').forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      tipoApostaSelecionado = btn.dataset.tipo;
      root.querySelectorAll('.tipo-opcao').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const btnSalvar = document.getElementById('btn-salvar-aposta');
      if (btnSalvar) btnSalvar.disabled = !(jogoSelecionado && tipoApostaSelecionado);
    });
  });

  const form = document.getElementById('form-nova-aposta');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!jogoSelecionado || !tipoApostaSelecionado) return;
      const fd = new FormData(e.target);
      const jogo = jogoSelecionado;
      const nova = {
        id: novoId(),
        matchId: jogo.id,
        data: jogo.data,
        competicao: jogo.competicao,
        mandante: jogo.mandante,
        visitante: jogo.visitante,
        mandanteEscudo: jogo.mandanteEscudo,
        visitanteEscudo: jogo.visitanteEscudo,
        tipoAposta: tipoApostaSelecionado,
        valor: parseFloat(fd.get('valor')),
        odd: parseFloat(fd.get('odd')),
        resultado: 'pendente',
        criadoEm: new Date().toISOString(),
      };
      const atuais = carregarApostas();
      atuais.push(nova);
      salvarApostas(atuais);
      jogoSelecionado = null;
      tipoApostaSelecionado = null;
      renderApostas();
    });
  }

  root.querySelectorAll('.btn-excluir').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      if (!confirm('Excluir essa aposta do histórico?')) return;
      const atuais = carregarApostas().filter((a) => a.id !== id);
      salvarApostas(atuais);
      renderApostas();
    });
  });

  root.querySelectorAll('[data-resultado]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const resultado = btn.dataset.resultado;
      const atuais = carregarApostas();
      const idx = atuais.findIndex((a) => a.id === id);
      if (idx >= 0) {
        atuais[idx].resultado = resultado;
        atuais[idx].marcadoManualmente = true;
        salvarApostas(atuais);
        renderApostas();
      }
    });
  });
}

window.renderApostas = renderApostas;
