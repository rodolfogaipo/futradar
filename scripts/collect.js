// scripts/collect.js
//
// Coletor de dados do FUT RADAR — versão 2.
//
// A primeira versão usava a API-Football, mas descobrimos (via erro real
// retornado pela própria API) que o plano gratuito dela só dá acesso a
// temporadas antigas (2022-2024) e bloqueia o parâmetro de "próximos
// jogos". Ou seja: não servia pra dados atuais.
//
// Trocamos para a football-data.org, que tem um plano gratuito de
// verdade com dados da temporada atual do Brasileirão Série A
// (competição "BSA"). Limite: 10 requisições por minuto.

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.football-data.org/v4';
const API_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const COMPETITION = 'BSA'; // Campeonato Brasileiro Série A

const CONFIG_PATH = path.join(__dirname, 'config-ids.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'data.json');

// Times que o Rodolfo acompanha, em ordem de prioridade.
// "match": trechos (sem acento, minúsculo) usados pra achar o time certo
// dentro da lista de times do Brasileirão vinda da API.
const TEAMS = [
  { key: 'atletico-mg', name: 'Atlético Mineiro', match: ['atletico mineiro', 'atletico-mg'] },
  { key: 'america-mg', name: 'América Mineiro', match: ['america mineiro', 'america-mg', 'america futebol clube'] },
  { key: 'cruzeiro', name: 'Cruzeiro', match: ['cruzeiro'] },
];

if (!API_TOKEN) {
  console.error('ERRO: variável de ambiente FOOTBALL_DATA_TOKEN não foi definida.');
  console.error('No GitHub, isso vem do secret configurado no repositório.');
  process.exit(1);
}

function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // remove acentos
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiGet(endpoint, params) {
  const url = new URL(API_BASE + endpoint);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  const res = await fetch(url, {
    headers: { 'X-Auth-Token': API_TOKEN },
  });

  if (res.status === 429) {
    console.warn('  Limite de requisições por minuto atingido, aguardando 20s...');
    await sleep(20000);
    return apiGet(endpoint, params);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Falha na API (${res.status}) em ${endpoint}: ${body}`);
  }

  return res.json();
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

// Resolve e guarda em cache o ID de cada time, buscando na lista oficial
// de times do Brasileirão (evita adivinhar número ou nome exato).
async function resolveTeamIds(config) {
  if (config.teamIds && Object.keys(config.teamIds).length === TEAMS.length) {
    return config;
  }

  console.log('Buscando lista de times do Brasileirão Série A...');
  const data = await apiGet(`/competitions/${COMPETITION}/teams`);
  const allTeams = data.teams || [];

  config.teamIds = config.teamIds || {};
  for (const team of TEAMS) {
    if (config.teamIds[team.key]) continue;
    const found = allTeams.find((t) => {
      const n = normalize(t.name);
      const short = normalize(t.shortName || '');
      return team.match.some((m) => n.includes(m) || short.includes(m));
    });
    if (!found) {
      console.warn(`  AVISO: não encontrei "${team.name}" na lista de times.`);
      continue;
    }
    config.teamIds[team.key] = found.id;
    console.log(`  -> ${team.name}: id ${found.id} (${found.name})`);
  }

  saveConfig(config);
  return config;
}

function formScore(matches, teamId) {
  const finished = matches.filter((m) => m.status === 'FINISHED');
  if (finished.length === 0) return null;
  let points = 0;
  for (const m of finished) {
    const isHome = m.homeTeam.id === teamId;
    const homeGoals = m.score.fullTime.home;
    const awayGoals = m.score.fullTime.away;
    const teamGoals = isHome ? homeGoals : awayGoals;
    const oppGoals = isHome ? awayGoals : homeGoals;
    if (teamGoals > oppGoals) points += 3;
    else if (teamGoals === oppGoals) points += 1;
  }
  return points / (finished.length * 3); // 0..1
}

function formLetters(matches, teamId) {
  return matches
    .filter((m) => m.status === 'FINISHED')
    .map((m) => {
      const isHome = m.homeTeam.id === teamId;
      const teamGoals = isHome ? m.score.fullTime.home : m.score.fullTime.away;
      const oppGoals = isHome ? m.score.fullTime.away : m.score.fullTime.home;
      if (teamGoals > oppGoals) return 'V';
      if (teamGoals === oppGoals) return 'E';
      return 'D';
    });
}

// Estimativa simples e transparente baseada na forma recente do time
// (últimos 5 jogos). NÃO é odds de casa de aposta.
function estimateProbabilities(form) {
  const f = form === null ? 0.45 : form; // 0.45 = neutro, sem dados suficientes
  let vitoria = 15 + f * 55; // 15% a 70%
  let derrota = 15 + (1 - f) * 40; // 15% a 55%
  let empate = 100 - vitoria - derrota;
  if (empate < 12) {
    const falta = 12 - empate;
    vitoria -= falta / 2;
    derrota -= falta / 2;
    empate = 12;
  }
  return {
    vitoria: Math.round(vitoria),
    empate: Math.round(empate),
    derrota: Math.round(derrota),
  };
}

async function collectTeamData(team, teamId) {
  console.log(`Coletando dados de ${team.name}...`);

  const [nextData, lastData] = await Promise.all([
    apiGet(`/teams/${teamId}/matches`, { status: 'SCHEDULED', limit: 3 }),
    apiGet(`/teams/${teamId}/matches`, { status: 'FINISHED', limit: 5 }),
  ]);

  const form = formScore(lastData.matches || [], teamId);
  const letters = formLetters(lastData.matches || [], teamId);
  const probabilidades = estimateProbabilities(form);

  const upcoming = (nextData.matches || []).map((m) => {
    const isHome = m.homeTeam.id === teamId;
    const opponent = isHome ? m.awayTeam : m.homeTeam;
    return {
      data: m.utcDate,
      local: isHome ? 'casa' : 'fora',
      adversario: opponent.name,
      adversarioEscudo: opponent.crest,
      competicao: m.competition?.name || 'Brasileirão Série A',
      estadio: m.venue || null,
      probabilidades,
    };
  });

  return {
    nome: team.name,
    forma: letters,
    proximosJogos: upcoming,
  };
}

async function collectStandings() {
  const data = await apiGet(`/competitions/${COMPETITION}/standings`);
  const table = data.standings?.find((s) => s.type === 'TOTAL')?.table || [];
  return table.map((row) => ({
    posicao: row.position,
    time: row.team.name,
    escudo: row.team.crest,
    pontos: row.points,
    jogos: row.playedGames,
    vitorias: row.won,
    empates: row.draw,
    derrotas: row.lost,
    saldoGols: row.goalDifference,
  }));
}

async function main() {
  console.log('=== FUT RADAR — coleta de dados (football-data.org) ===');
  let config = loadConfig();
  config = await resolveTeamIds(config);

  const result = {
    geradoEm: new Date().toISOString(),
    temporada: new Date().getFullYear(),
    fonte: 'football-data.org',
    times: {},
    tabela: [],
    avisos: [],
  };

  try {
    result.tabela = await collectStandings();
  } catch (e) {
    console.warn(`Falha ao coletar a tabela: ${e.message}`);
    result.avisos.push('Não foi possível atualizar a tabela do Brasileirão nesta coleta.');
  }

  await sleep(1500); // respeita o limite de requisições/minuto

  for (const team of TEAMS) {
    const teamId = config.teamIds[team.key];
    if (!teamId) {
      result.avisos.push(`Time "${team.name}" não encontrado na API.`);
      continue;
    }
    try {
      result.times[team.key] = await collectTeamData(team, teamId);
    } catch (e) {
      console.warn(`Falha ao coletar dados de ${team.name}: ${e.message}`);
      result.avisos.push(`Não foi possível atualizar os dados de ${team.name} nesta coleta.`);
    }
    await sleep(1500);
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

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
