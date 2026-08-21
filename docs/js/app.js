// docs/js/app.js
// Lê docs/data/data.json (gerado pelo coletor via GitHub Actions) e
// preenche as abas: Análises, Jogos, Resultados e Tabelas.

const DATA_URL = 'data/data.json';

const freshnessEl = document.getElementById('freshness');
const refreshBtn = document.getElementById('refresh-btn');

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function timeAgo(iso) {
  const diffH = (Date.now() - new Date(iso).getTime()) / 1000 / 60 / 60;
  if (diffH < 1) return 'agora há pouco';
  if (diffH < 24) return `há ${Math.floor(diffH)}h`;
  return `há ${Math.floor(diffH / 24)}d`;
}

function crestImg(url) {
  return url ? `<img class="team-crest" src="${url}" alt="" loading="lazy">` : '<span class="crest-ph"></span>';
}

// ---------- Análise de confrontos ----------

function renderProbBars(p, nomeMandante, nomeVisitante) {
  return `
    <div class="prob-bars">
      <div class="prob-row">
        <span class="prob-label" title="${nomeMandante}">${nomeMandante}</span>
        <div class="prob-track"><div class="prob-fill vitoria" style="width:${p.mandante}%"></div></div>
        <span class="prob-value">${p.mandante}%</span>
      </div>
      <div class="prob-row">
        <span class="prob-label">Empate</span>
        <div class="prob-track"><div class="prob-fill empate" style="width:${p.empate}%"></div></div>
        <span class="prob-value">${p.empate}%</span>
      </div>
      <div class="prob-row">
        <span class="prob-label" title="${nomeVisitante}">${nomeVisitante}</span>
        <div class="prob-track"><div class="prob-fill derrota" style="width:${p.visitante}%"></div></div>
        <span class="prob-value">${p.visitante}%</span>
      </div>
    </div>`;
}

function renderAnaliseCard(a) {
  return `
    <div class="app-card analise-card">
      <div class="card-top-row">
        <span class="comp-tag">${a.competicao}</span>
        <span class="match-time">${formatDateTime(a.data)}</span>
      </div>
      <div class="confronto-teams">
        <div class="confronto-team">
          ${crestImg(a.mandanteEscudo)}
          <span>${a.mandante}</span>
        </div>
        <span class="vs">×</span>
        <div class="confronto-team">
          ${crestImg(a.visitanteEscudo)}
          <span>${a.visitante}</span>
        </div>
      </div>
      ${renderProbBars(a.probabilidades, a.mandante, a.visitante)}
      <p class="analise-obs">${a.obs}</p>
    </div>`;
}

function renderAnalises(data) {
  const el = document.getElementById('content-analises');
  const loadingEl = document.getElementById('loading-analises');
  loadingEl.hidden = true;
  el.hidden = false;

  let html = '';
  if (data.avisos?.length) {
    html += `<div class="warning-box">${data.avisos.join('<br>')}</div>`;
  }
  const analises = data.analises || [];
  if (analises.length === 0) {
    html += '<p class="empty-msg">Nenhuma análise disponível ainda.</p>';
  } else {
    html += `<p class="view-intro">${analises.length} confronto(s) sendo acompanhado(s) — somem da lista quando o jogo termina.</p>`;
    html += analises.map(renderAnaliseCard).join('');
  }
  el.innerHTML = html;
}

// ---------- Próximos jogos / Resultados ----------

function renderMatchCard(m, showScore) {
  const right = showScore
    ? `<span class="score">${m.placarMandante ?? '-'} · ${m.placarVisitante ?? '-'}</span>`
    : `<span class="match-time">${formatDateTime(m.data)}</span>`;

  return `
    <div class="app-card jogo-card">
      <div class="card-top-row">
        <span class="comp-tag">${m.competicao}</span>
        ${!showScore ? '' : `<span class="match-time">${formatDateTime(m.data)}</span>`}
      </div>
      <div class="jogo-linha">
        <div class="jogo-time">${crestImg(m.mandanteEscudo)}<span>${m.mandante}</span></div>
        ${right}
        <div class="jogo-time jogo-time-right"><span>${m.visitante}</span>${crestImg(m.visitanteEscudo)}</div>
      </div>
    </div>`;
}

function groupByDate(matches) {
  const groups = {};
  for (const m of matches) {
    const day = new Date(m.data).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
    groups[day] = groups[day] || [];
    groups[day].push(m);
  }
  return groups;
}

function renderMatchesInto(elId, matches, showScore, emptyMsg) {
  const el = document.getElementById(elId);
  if (!matches || matches.length === 0) {
    el.innerHTML = `<p class="empty-msg">${emptyMsg}</p>`;
    return;
  }
  const groups = groupByDate(matches);
  let html = '';
  for (const [day, dayMatches] of Object.entries(groups)) {
    html += `<div class="day-group"><div class="day-label">${day}</div>`;
    html += dayMatches.map((m) => renderMatchCard(m, showScore)).join('');
    html += `</div>`;
  }
  el.innerHTML = html;
}

// ---------- Tabelas ----------

function standingRowClass(row, total) {
  if (row.posicao <= 4) return 'zona-classificacao';
  if (row.posicao > total - 4) return 'zona-rebaixamento';
  return '';
}

function renderStandingsTable(comp) {
  if (!comp.tabela || comp.tabela.length === 0) {
    return `<p class="empty-msg">Tabela não disponível no momento (fora de temporada ou em fase de grupos/mata-mata).</p>`;
  }
  const total = comp.tabela.length;
  const rows = comp.tabela
    .map(
      (row) => `
        <tr class="${standingRowClass(row, total)}">
          <td>${row.posicao}</td>
          <td class="team-cell">${crestImg(row.escudo)}<span>${row.time}</span></td>
          <td>${row.pontos}</td>
          <td>${row.jogos}</td>
          <td>${row.saldoGols > 0 ? '+' : ''}${row.saldoGols}</td>
        </tr>`
    )
    .join('');

  return `
    <div class="table-scroll">
      <table class="standings-table">
        <thead><tr><th>#</th><th>Time</th><th>Pts</th><th>J</th><th>SG</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderTabelas(data) {
  const el = document.getElementById('content-tabelas');
  const competicoes = data.competicoes || [];
  let html = '<div class="accordion">';
  competicoes.forEach((comp, i) => {
    html += `
      <div class="accordion-item">
        <button class="accordion-header" data-idx="${i}">
          <span>${comp.nome}</span>
          <span class="chevron">▾</span>
        </button>
        <div class="accordion-body" id="acc-body-${i}" hidden>
          ${renderStandingsTable(comp)}
        </div>
      </div>`;
  });
  html += '</div>';
  el.innerHTML = html;

  el.querySelectorAll('.accordion-header').forEach((btn) => {
    btn.addEventListener('click', () => {
      const body = document.getElementById(`acc-body-${btn.dataset.idx}`);
      const isHidden = body.hidden;
      el.querySelectorAll('.accordion-body').forEach((b) => (b.hidden = true));
      el.querySelectorAll('.chevron').forEach((c) => (c.textContent = '▾'));
      if (isHidden) {
        body.hidden = false;
        btn.querySelector('.chevron').textContent = '▴';
      }
    });
  });
}

// ---------- Carregamento geral ----------

function renderAll(data) {
  renderAnalises(data);
  renderMatchesInto('content-proximos', data.proximosJogos, false, 'Nenhum jogo encontrado nos próximos dias.');
  renderMatchesInto('content-resultados', data.resultadosRecentes, true, 'Nenhum resultado recente encontrado.');
  renderTabelas(data);
  freshnessEl.textContent = `Atualizado ${timeAgo(data.geradoEm)}`;
}

async function load(forceFresh) {
  try {
    const url = forceFresh ? `${DATA_URL}?t=${Date.now()}` : DATA_URL;
    const res = await fetch(url, { cache: forceFresh ? 'no-store' : 'default' });
    if (!res.ok) throw new Error('data.json não encontrado');
    const data = await res.json();
    renderAll(data);
  } catch (err) {
    document.getElementById('loading-analises').hidden = true;
    const el = document.getElementById('content-analises');
    el.hidden = false;
    el.innerHTML = `
      <div class="warning-box">
        Ainda não há dados coletados. Isso é normal na primeira execução —
        o GitHub Actions precisa rodar pelo menos uma vez (veja o README
        do repositório para o passo a passo).
      </div>`;
    freshnessEl.textContent = 'Sem dados ainda';
  }
}

refreshBtn.addEventListener('click', () => {
  refreshBtn.classList.add('spinning');
  load(true).finally(() => setTimeout(() => refreshBtn.classList.remove('spinning'), 500));
});

load(false);
