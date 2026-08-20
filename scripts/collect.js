// scripts/collect.js
//
// Coletor de dados do FUT RADAR.
// Roda dentro do GitHub Actions (não no navegador), então não tem
// problema de CORS nem de bloqueio de acesso. Usa a API gratuita
// API-Football (https://www.api-football.com/) — plano free dá 100
// requisições por dia, o que é mais que suficiente pra rodar esse
// coletor a cada poucas horas.
//
// A chave da API fica guardada como "secret" no GitHub
// (API_FOOTBALL_KEY), nunca aparece no código nem no navegador do usuário.

const fs = require('fs');
const path = require('path');

const API_HOST = 'v3.football.api-sports.io';
const API_BASE = `https://${API_HOST}`;
const API_KEY = process.env.API_FOOTBALL_KEY;

const CONFIG_PATH = path.join(__dirname, 'config-ids.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'data.json');

// Times que o Rodolfo acompanha, em ordem de prioridade.
// (Atlético-MG é a prioridade máxima)
const TEAMS = [
  { key: 'atletico-mg', name: 'Atlético Mineiro', country: 'Brazil' },
  { key: 'america-mg', name: 'America Mineiro', country: 'Brazil' },
  { key: 'cruzeiro', name: 'Cruzeiro', country: 'Brazil' },
];

const LEAGUE_NAME = 'Serie A';
const LEAGUE_COUNTRY = 'Brazil';

if (!API_KEY) {
  console.error('ERRO: variável de ambiente API_FOOTBALL_KEY não foi definida.');
  console.error('No GitHub, isso vem do secret configurado no repositório.');
  process.exit(1);
}

async function apiGet(endpoint, params) {
  const url = new URL(API_BASE + endpoint);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  const res = await fetch(url, {
    headers: {
      'x-apisports-key': API_KEY,
    },
  });

  if (!res.ok) {
    throw new Error(`Falha na API (${res.status}) em ${endpoint}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`API retornou erro em ${endpoint}: ${JSON.stringify(json.errors)}`);
  }
  return json.response;
}

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
  return {};
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Resolve e guarda em cache o ID da liga (Brasileirão Série A) e o ID
// de cada time, pra não precisar adivinhar números nem gastar
// requisições procurando isso toda vez.
async function resolveIds(config) {
  let changed = false;

  if (!config.leagueId) {
    console.log('Buscando ID da liga (Brasileirão Série A)...');
    const leagues = await apiGet('/leagues', { name: LEAGUE_NAME, country: LEAGUE_COUNTRY });
    const match = leagues.find((l) => l.league.type === 'League') || leagues[0];
    if (!match) throw new Error('Não encontrei a liga Brasileirão Série A na API.');
    config.leagueId = match.league.id;
    console.log(`  -> league_id = ${config.leagueId}`);
    changed = true;
  }

  config.teamIds = config.teamIds || {};
  for (const team of TEAMS) {
    if (!config.teamIds[team.key]) {
      console.log(`Buscando ID do time: ${team.name}...`);
      const teams = await apiGet('/teams', { name: team.name, country: team.country });
      if (!teams || teams.length === 0) {
        console.warn(`  -> AVISO: não encontrei "${team.name}" na API. Vou pular esse time.`);
        continue;
      }
      config.teamIds[team.key] = teams[0].team.id;
      console.log(`  -> team_id = ${config.teamIds[team.key]}`);
      changed = true;
    }
  }

  if (changed) saveConfig(config);
  return config;
}

// Descobre a temporada correta (a API usa o ano de início da temporada).
async function resolveSeason(leagueId) {
  const info = await apiGet('/leagues', { id: leagueId });
  const seasons = info[0]?.seasons || [];
  const current = seasons.find((s) => s.current);
  return current ? current.year : new Date().getFullYear();
}

// Estimativa simples e transparente baseada só na forma recente
// (últimos 5 jogos). NÃO é odds de casa de aposta, é só uma leitura
// estatística de momento de cada time, deixada bem clara na interface.
function formScore(recentFixtures, teamId) {
  if (!recentFixtures || recentFixtures.length === 0) return null;
  let points = 0;
  let count = 0;
  for (const f of recentFixtures) {
    const isHome = f.teams.home.id === teamId;
    const homeGoals = f.goals.home;
    const awayGoals = f.goals.away;
    if (homeGoals === null || awayGoals === null) continue;
    count++;
    const teamGoals = isHome ? homeGoals : awayGoals;
    const oppGoals = isHome ? awayGoals : homeGoals;
    if (teamGoals > oppGoals) points += 3;
    else if (teamGoals === oppGoals) points += 1;
  }
  if (count === 0) return null;
  return points / (count * 3); // 0..1
}

function estimateProbabilities(formA, formB) {
  // Se só temos a forma de um dos lados, usa ela sozinha como referência.
  const a = formA === null ? 0.45 : formA;
  const b = formB === null ? 0.45 : formB;

  const total = a + b;
  let winA = total > 0 ? a / total : 0.4;
  let winB = total > 0 ? b / total : 0.4;

  // Empate: quanto mais parecida a forma dos dois times, maior a
  // chance de empate (heurística simples, não é modelo estatístico real).
  const closeness = 1 - Math.abs(a - b);
  const drawShare = 0.18 + closeness * 0.14; // entre ~18% e ~32%

  const remaining = 1 - drawShare;
  winA = winA * remaining;
  winB = winB * remaining;
  const draw = 1 - winA - winB;

  return {
    vitoria: Math.round(winA * 100),
    empate: Math.round(draw * 100),
    derrota: Math.round(winB * 100),
  };
}

function formLetters(recentFixtures, teamId) {
  return recentFixtures
    .filter((f) => f.goals.home !== null && f.goals.away !== null)
    .map((f) => {
      const isHome = f.teams.home.id === teamId;
      const teamGoals = isHome ? f.goals.home : f.goals.away;
      const oppGoals = isHome ? f.goals.away : f.goals.home;
      if (teamGoals > oppGoals) return 'V';
      if (teamGoals === oppGoals) return 'E';
      return 'D';
    });
}

async function collectTeamData(team, teamId, season) {
  console.log(`Coletando dados de ${team.name}...`);

  const [nextFixtures, lastFixtures] = await Promise.all([
    apiGet('/fixtures', { team: teamId, next: 3 }),
    apiGet('/fixtures', { team: teamId, last: 5 }),
  ]);

  const form = formScore(lastFixtures, teamId);
  const letters = formLetters(lastFixtures, teamId);

  const upcoming = [];
  for (const fixture of nextFixtures) {
    const isHome = fixture.teams.home.id === teamId;
    const opponent = isHome ? fixture.teams.away : fixture.teams.home;

    // Tenta pegar a forma recente do adversário também, se ele for
    // um time conhecido nosso; senão usa só a forma do nosso time.
    let opponentForm = null;
    try {
      const oppLast = await apiGet('/fixtures', { team: opponent.id, last: 5 });
      opponentForm = formScore(oppLast, opponent.id);
    } catch (e) {
      console.warn(`  Não consegui pegar forma do adversário (${opponent.name}): ${e.message}`);
    }

    const probabilidades = estimateProbabilities(
      isHome ? form : opponentForm,
      isHome ? opponentForm : form
    );

    upcoming.push({
      data: fixture.fixture.date,
      local: isHome ? 'casa' : 'fora',
      adversario: opponent.name,
      adversarioEscudo: opponent.logo,
      competicao: fixture.league.name,
      estadio: fixture.fixture.venue?.name || null,
      probabilidades,
    });
  }

  return {
    nome: team.name,
    forma: letters, // ex: ["V","V","E","D","V"]
    proximosJogos: upcoming,
  };
}

async function collectStandings(leagueId, season) {
  const data = await apiGet('/standings', { league: leagueId, season });
  const table = data[0]?.league?.standings?.[0] || [];
  return table.map((row) => ({
    posicao: row.rank,
    time: row.team.name,
    escudo: row.team.logo,
    pontos: row.points,
    jogos: row.all.played,
    vitorias: row.all.win,
    empates: row.all.draw,
    derrotas: row.all.lose,
    saldoGols: row.goalsDiff,
  }));
}

async function main() {
  console.log('=== FUT RADAR — coleta de dados ===');
  let config = loadConfig();
  config = await resolveIds(config);

  const season = await resolveSeason(config.leagueId);
  console.log(`Temporada atual: ${season}`);

  const result = {
    geradoEm: new Date().toISOString(),
    temporada: season,
    fonte: 'API-Football (api-sports.io)',
    times: {},
    tabela: [],
    avisos: [],
  };

  try {
    result.tabela = await collectStandings(config.leagueId, season);
  } catch (e) {
    console.warn(`Falha ao coletar a tabela: ${e.message}`);
    result.avisos.push('Não foi possível atualizar a tabela do Brasileirão nesta coleta.');
  }

  for (const team of TEAMS) {
    const teamId = config.teamIds[team.key];
    if (!teamId) {
      result.avisos.push(`Time "${team.name}" não encontrado na API — verifique o nome.`);
      continue;
    }
    try {
      result.times[team.key] = await collectTeamData(team, teamId, season);
    } catch (e) {
      console.warn(`Falha ao coletar dados de ${team.name}: ${e.message}`);
      result.avisos.push(`Não foi possível atualizar os dados de ${team.name} nesta coleta.`);
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

  // Se a coleta inteira falhou (times vazio) mantém o arquivo antigo
  // em vez de sobrescrever com dado vazio.
  const hasAnyData = Object.keys(result.times).length > 0 || result.tabela.length > 0;
  if (!hasAnyData && fs.existsSync(OUTPUT_PATH)) {
    console.warn('Nenhum dado novo coletado — mantendo o data.json anterior.');
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`Dados salvos em ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Erro fatal na coleta:', err);
  process.exit(1);
});
