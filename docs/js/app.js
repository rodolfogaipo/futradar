// docs/js/app.js
// Lê docs/data/data.json (gerado pelo coletor via GitHub Actions) e
// desenha o painel: próximos jogos, resultados recentes e tabelas das
// 12 competições. Não faz nenhuma chamada externa.

const DATA_URL = 'data/data.json';

const loadingEl = document.getElementById('loading');
const contentEl = document.getElementById('content');
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
  if (diffH < 1) return 'há menos de 1 hora';
  if (diffH < 24) return `há ${Math.floor(diffH)}h`;
  return `há ${Math.floor(diffH / 24)} dia(s)`;
}

function renderMatchRow(m, showScore) {
  const score = showScore
    ? `<span class="score">${m.placarMandante ?? '-'} x ${m.placarVisitante ?? '-'}</span>`
    : `<span class="match-time">${formatDateTime(m.data)}</span>`;

  return `
    <div class="match-row">
      <span class="comp-tag">${m.competicao}</span>
      <div class="match-line">
        <span class="team">${m.mandante}</span>
        ${score}
        <span class="team">${m.visitante}</span>
      </div>
    </div>`;
}

function groupByDate(matches) {
  const groups = {};
  for (const m of matches) {
    const day = new Date(m.data).toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: '2-digit',
    });
    groups[day] = groups[day] || [];
    groups[day].push(m);
  }
  return groups;
}

function renderProbBars(p) {
  return `
    <div class="prob-bars">
      <div class="prob-row">
        <span class="prob-label">Mandante</span>
        <div class="prob-track"><div class="prob-fill vitoria" style="width:${p.mandante}%"></div></div>
        <span class="prob-value">${p.mandante}%</span>
      </div>
      <div class="prob-row">
        <span class="prob-label">Empate</span>
        <div class="prob-track"><div class="prob-fill empate" style="width:${p.empate}%"></div></div>
        <span class="prob-value">${p.empate}%</span>
      </div>
      <div class="prob-row">
        <span class="prob-label">Visitante</span>
        <div class="prob-track"><div class="prob-fill derrota" style="width:${p.visitante}%"></div></div>
        <span class="prob-value">${p.visitante}%</span>
      </div>
    </div>`;
}

function renderAnaliseCard(a) {
  return `
    <div class="team-block">
      <div class="team-block-header">
        <span class="team-name">${a.mandante} x ${a.visitante}</span>
        <span class="comp-tag">${a.competicao}</span>
      </div>
      <div class="match-meta">${formatDateTime(a.data)}</div>
      ${renderProbBars(a.probabilidades)}
      <p class="analise-obs">${a.obs}</p>
    </div>`;
}

function renderAnalisesSection(analises) {
  if (!analises || analises.length === 0) {
    return `<h2 class="section-title">Análise de confrontos</h2><p class="empty-msg">Nenhuma análise disponível ainda.</p>`;
  }
  return `
    <h2 class="section-title">Análise de confrontos (sorteio a cada coleta)</h2>
    ${analises.map(renderAnaliseCard).join('')}`;
}

function renderMatchesSection(title, matches, showScore) {
  if (!matches || matches.length === 0) {
    return `<h2 class="section-title">${title}</h2><p class="empty-msg">Nenhum jogo encontrado nesse período.</p>`;
  }
  const groups = groupByDate(matches);
  let html = `<h2 class="section-title">${title}</h2>`;
  for (const [day, dayMatches] of Object.entries(groups)) {
    html += `<div class="day-group"><div class="day-label">${day}</div>`;
    html += dayMatches.map((m) => renderMatchRow(m, showScore)).join('');
    html += `</div>`;
  }
  return html;
}

function renderStandingsTable(comp) {
  if (!comp.tabela || comp.tabela.length === 0) {
    return `<p class="empty-msg">Tabela não disponível no momento (competição pode estar fora de temporada ou em fase de grupos/mata-mata).</p>`;
  }
  const rows = comp.tabela
    .map(
      (row) => `
        <tr>
          <td>${row.posicao}</td>
          <td class="team-cell">${row.time}</td>
          <td>${row.pontos}</td>
          <td>${row.jogos}</td>
          <td>${row.saldoGols > 0 ? '+' : ''}${row.saldoGols}</td>
        </tr>`
    )
    .join('');

  return `
    <table class="standings-table">
      <thead><tr><th>#</th><th>Time</th><th>Pts</th><th>J</th><th>SG</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderCompetitionsAccordion(competicoes) {
  let html = '<h2 class="section-title">Tabelas</h2><div class="accordion">';
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
  return html;
}

function attachAccordionEvents() {
  document.querySelectorAll('.accordion-header').forEach((btn) => {
    btn.addEventListener('click', () => {
      const body = document.getElementById(`acc-body-${btn.dataset.idx}`);
      const isHidden = body.hidden;
      document.querySelectorAll('.accordion-body').forEach((b) => (b.hidden = true));
      document.querySelectorAll('.chevron').forEach((c) => (c.textContent = '▾'));
      if (isHidden) {
        body.hidden = false;
        btn.querySelector('.chevron').textContent = '▴';
      }
    });
  });
}

function render(data) {
  let html = '';

  if (data.avisos && data.avisos.length > 0) {
    html += `<div class="warning-box">${data.avisos.join('<br>')}</div>`;
  }

  html += renderAnalisesSection(data.analises);
  html += renderMatchesSection('Próximos jogos (7 dias)', data.proximosJogos, false);
  html += renderMatchesSection('Resultados recentes (7 dias)', data.resultadosRecentes, true);
  html += renderCompetitionsAccordion(data.competicoes || []);

  contentEl.innerHTML = html;
  loadingEl.hidden = true;
  contentEl.hidden = false;
  attachAccordionEvents();

  freshnessEl.textContent = `Atualizado ${timeAgo(data.geradoEm)} (${formatDateTime(data.geradoEm)})`;
}

async function load(forceFresh) {
  loadingEl.hidden = false;
  contentEl.hidden = true;
  try {
    const url = forceFresh ? `${DATA_URL}?t=${Date.now()}` : DATA_URL;
    const res = await fetch(url, { cache: forceFresh ? 'no-store' : 'default' });
    if (!res.ok) throw new Error('data.json não encontrado');
    const data = await res.json();
    render(data);
  } catch (err) {
    loadingEl.hidden = true;
    contentEl.hidden = false;
    contentEl.innerHTML = `
      <div class="warning-box">
        Ainda não há dados coletados. Isso é normal na primeira execução —
        o GitHub Actions precisa rodar pelo menos uma vez (veja o README
        do repositório para o passo a passo).
      </div>`;
  }
}

refreshBtn.addEventListener('click', () => load(true));

load(false);
