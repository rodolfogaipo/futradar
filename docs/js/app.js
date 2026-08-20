// docs/js/app.js
// Lê docs/data/data.json (gerado pelo coletor via GitHub Actions) e
// desenha o painel. Não faz nenhuma chamada externa — todo o trabalho
// de buscar dados na internet acontece antes, no GitHub Actions.

const DATA_URL = 'data/data.json';

const TEAM_ORDER = ['atletico-mg', 'america-mg', 'cruzeiro'];
const PRIORITY_TEAM_NAMES = ['Atlético Mineiro', 'America Mineiro', 'Cruzeiro'];

const loadingEl = document.getElementById('loading');
const contentEl = document.getElementById('content');
const freshnessEl = document.getElementById('freshness');
const refreshBtn = document.getElementById('refresh-btn');

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffH = diffMs / 1000 / 60 / 60;
  if (diffH < 1) return 'há menos de 1 hora';
  if (diffH < 24) return `há ${Math.floor(diffH)}h`;
  return `há ${Math.floor(diffH / 24)} dia(s)`;
}

function renderFormLetters(letters) {
  if (!letters || letters.length === 0) {
    return '<span style="color:var(--text-dim);font-size:12px;">sem dados recentes</span>';
  }
  return `<div class="form-letters">${letters
    .map((l) => `<span class="form-letter ${l.toLowerCase()}">${l}</span>`)
    .join('')}</div>`;
}

function renderProbBars(p) {
  if (!p) return '';
  return `
    <div class="prob-bars">
      <div class="prob-row">
        <span class="prob-label">Vitória</span>
        <div class="prob-track"><div class="prob-fill vitoria" style="width:${p.vitoria}%"></div></div>
        <span class="prob-value">${p.vitoria}%</span>
      </div>
      <div class="prob-row">
        <span class="prob-label">Empate</span>
        <div class="prob-track"><div class="prob-fill empate" style="width:${p.empate}%"></div></div>
        <span class="prob-value">${p.empate}%</span>
      </div>
      <div class="prob-row">
        <span class="prob-label">Derrota</span>
        <div class="prob-track"><div class="prob-fill derrota" style="width:${p.derrota}%"></div></div>
        <span class="prob-value">${p.derrota}%</span>
      </div>
    </div>`;
}

function renderMatchCard(match) {
  return `
    <div class="match-card">
      <div class="match-teams">
        <span>${match.local === 'casa' ? 'Casa' : 'Fora'} vs ${match.adversario}</span>
        <span>${formatDate(match.data)}</span>
      </div>
      <div class="match-meta">${match.competicao}${match.estadio ? ' · ' + match.estadio : ''}</div>
      ${renderProbBars(match.probabilidades)}
    </div>`;
}

function renderTeamBlock(key, team) {
  const matches = (team.proximosJogos || [])
    .map(renderMatchCard)
    .join('') || '<p style="color:var(--text-dim);font-size:13px;">Nenhum jogo agendado encontrado.</p>';

  return `
    <div class="team-block">
      <div class="team-block-header">
        <span class="team-name">${team.nome}</span>
        ${renderFormLetters(team.forma)}
      </div>
      ${matches}
    </div>`;
}

function renderStandings(tabela) {
  if (!tabela || tabela.length === 0) return '';
  const rows = tabela
    .map((row) => {
      const isPriority = PRIORITY_TEAM_NAMES.some((n) =>
        row.time.toLowerCase().includes(n.toLowerCase().split(' ')[0])
      );
      return `
        <tr class="${isPriority ? 'highlight' : ''}">
          <td>${row.posicao}</td>
          <td class="team-cell">${row.time}</td>
          <td>${row.pontos}</td>
          <td>${row.jogos}</td>
          <td>${row.saldoGols > 0 ? '+' : ''}${row.saldoGols}</td>
        </tr>`;
    })
    .join('');

  return `
    <h2 class="section-title">Tabela — Brasileirão Série A</h2>
    <table class="standings-table">
      <thead>
        <tr><th>#</th><th>Time</th><th>Pts</th><th>J</th><th>SG</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function render(data) {
  let html = '';

  if (data.avisos && data.avisos.length > 0) {
    html += `<div class="warning-box">${data.avisos.join('<br>')}</div>`;
  }

  html += '<h2 class="section-title">Próximos jogos</h2>';
  for (const key of TEAM_ORDER) {
    const team = data.times[key];
    if (team) html += renderTeamBlock(key, team);
  }

  html += renderStandings(data.tabela);

  contentEl.innerHTML = html;
  loadingEl.hidden = true;
  contentEl.hidden = false;

  freshnessEl.textContent = `Atualizado ${timeAgo(data.geradoEm)} (${formatDate(data.geradoEm)}) · Temporada ${data.temporada}`;
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
