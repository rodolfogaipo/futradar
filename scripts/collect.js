// scripts/collect.js
//
// Coletor de dados do FUT RADAR — versão 5.
//
// Cálculo de probabilidade combinando 3 fatores reais:
//  1) Forma atual do time na competição (últimos jogos: ganhando/perdendo)
//  2) Aproveitamento/posição do time NAQUELA competição específica
//  3) Histórico de confrontos diretos entre os dois times
// + uma pequena vantagem de mandante.
//
// Os fatores 1 e 2 vêm de graça da própria tabela de classificação
// (que já coletamos pras 12 competições), sem gastar requisição extra.
// Só o histórico de confrontos diretos precisa de uma chamada própria
// por partida sorteada.
//
// Limite do plano gratuito da football-data.org: 10 requisições/minuto.

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.football-data.org/v4';
const API_TOKEN = process.env.FOOTBALL_DATA_TOKEN;

const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'data.json');

const COMPETITIONS = [
  { code: 'WC', nome: 'Copa do Mundo' },
  { code: 'CL', nome: 'Champions League' },
  { code: 'BL1', nome: 'Bundesliga' },
  { code: 'DED', nome: 'Eredivisie' },
  { code: 'BSA', nome: 'Brasileirão Série A' },
  { code: 'PD', nome: 'La Liga' },
  { code: 'FL1', nome: 'Ligue 1' },
  { code: 'ELC', nome: 'Championship (Inglaterra)' },
  { code: 'PPL', nome: 'Primeira Liga (Portugal)' },
  { code: 'EC', nome: 'Eurocopa' },
  { code: 'SA', nome: 'Serie A (Itália)' },
  { code: 'PL', nome: 'Premier League' },
];

const QTD_PARTIDAS_SORTEADAS = 6;
const VANTAGEM_MANDANTE = 0.07; // pequeno bônus de jogar em casa

if (!API_TOKEN) {
  console.error('ERRO: variável de ambiente FOOTBALL_DATA_TOKEN não foi definida.');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dateStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Prioriza os jogos de hoje; só completa com os dias seguintes (mais
// próximos primeiro) se não tiver jogos suficientes hoje. Dentro de um
// mesmo dia, sorteia quais entram (se tiver mais jogos que o necessário).
function selecionarPartidasProximas(matches, qtd) {
  const ordenados = [...matches].sort((a, b) => new Date(a.data) - new Date(b.data));

  const grupos = [];
  let diaAtual = null;
  for (const m of ordenados) {
    const dia = m.data.slice(0, 10);
    if (dia !== diaAtual) {
      grupos.push({ dia, itens: [] });
      diaAtual = dia;
    }
    grupos[grupos.length - 1].itens.push(m);
  }

  const selecionadas = [];
  for (const grupo of grupos) {
    if (selecionadas.length >= qtd) break;
    const faltam = qtd - selecionadas.length;
    if (grupo.itens.length <= faltam) {
      selecionadas.push(...grupo.itens);
    } else {
      selecionadas.push(...shuffle(grupo.itens).slice(0, faltam));
    }
  }
  return selecionadas;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
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
    console.warn('  Limite de requisições/minuto atingido, aguardando 20s...');
    await sleep(20000);
    return apiGet(endpoint, params);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API (${res.status}): ${body}`);
  }

  return res.json();
}

function mapMatch(m) {
  return {
    id: m.id,
    data: m.utcDate,
    status: m.status,
    stage: m.stage || null,
    competicao: m.competition?.name || '',
    competicaoCodigo: m.competition?.code || '',
    mandante: m.homeTeam?.name || '?',
    mandanteId: m.homeTeam?.id,
    mandanteEscudo: m.homeTeam?.crest || null,
    visitante: m.awayTeam?.name || '?',
    visitanteId: m.awayTeam?.id,
    visitanteEscudo: m.awayTeam?.crest || null,
    placarMandante: m.score?.fullTime?.home,
    placarVisitante: m.score?.fullTime?.away,
  };
}

async function collectUpcoming() {
  const data = await apiGet('/matches', {
    dateFrom: dateStr(0),
    dateTo: dateStr(6),
    status: 'SCHEDULED',
  });
  return (data.matches || []).map(mapMatch);
}

async function collectRecent() {
  const data = await apiGet('/matches', {
    dateFrom: dateStr(-6),
    dateTo: dateStr(0),
    status: 'FINISHED',
  });
  return (data.matches || []).map(mapMatch);
}

// Retorna a tabela completa (com campo "form" cru da API, não convertido
// ainda) e também já monta a versão formatada pra exibição no app.
async function collectStandingsRaw(code) {
  const data = await apiGet(`/competitions/${code}/standings`);
  const total = data.standings?.find((s) => s.type === 'TOTAL');
  if (!total) return null;
  return total.table; // linhas cruas da API: position, team, points, form, ...
}

function formatStandingsForApp(rawTable) {
  return rawTable.map((row) => ({
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

// Converte a string de forma da API ("W,D,L,W,W") num score 0..1.
function formScoreFromString(formStr) {
  if (!formStr) return null;
  const results = formStr.split(',').map((s) => s.trim()).filter(Boolean);
  if (results.length === 0) return null;
  let points = 0;
  for (const r of results) {
    if (r === 'W') points += 3;
    else if (r === 'D') points += 1;
  }
  return points / (results.length * 3);
}

// Posição relativa na tabela: 1 = líder, 0 = lanterna.
function standingScore(position, totalTeams) {
  if (!position || !totalTeams || totalTeams <= 1) return 0.5;
  return 1 - (position - 1) / (totalTeams - 1);
}

// Busca a linha da tabela de um time dentro do "banco" de tabelas já
// coletadas (sem gastar requisição nova).
function findTeamRow(standingsByComp, competitionCode, teamId) {
  const table = standingsByComp[competitionCode];
  if (!table) return null;
  const totalTeams = table.length;
  const row = table.find((r) => r.team.id === teamId);
  if (!row) return null;
  return {
    posicao: row.position,
    totalTeams,
    formScore: formScoreFromString(row.form),
    pontosPorJogo: row.playedGames > 0 ? row.points / row.playedGames : null,
  };
}

// Procura, em QUALQUER das 12 tabelas já coletadas, a posição desse time
// no campeonato dele (mesmo que não seja o campeonato do jogo analisado).
// Serve como indicador do nível geral do time, sem gastar requisição.
function encontrarPosicaoEmQualquerCompeticao(standingsByComp, teamId) {
  for (const table of Object.values(standingsByComp)) {
    const row = table.find((r) => r.team.id === teamId);
    if (row) {
      return { posicao: row.position, totalTeams: table.length, formScore: formScoreFromString(row.form) };
    }
  }
  return null;
}

// Nível geral do time: aproveitamento recente em QUALQUER competição
// (não só na que está sendo analisada), pra usar quando o time nunca
// jogou a fase/competição específica antes.
async function collectNivelGeralDoTime(teamId, standingsByComp) {
  const daTabela = encontrarPosicaoEmQualquerCompeticao(standingsByComp, teamId);

  let formaGeral = null;
  let amostra = 0;
  try {
    const data = await apiGet('/teams/' + teamId + '/matches', { status: 'FINISHED', limit: 10 });
    const matches = data.matches || [];
    amostra = matches.length;
    if (matches.length > 0) {
      let pontos = 0;
      for (const m of matches) {
        const isHome = m.homeTeam.id === teamId;
        const gf = isHome ? m.score.fullTime.home : m.score.fullTime.away;
        const ga = isHome ? m.score.fullTime.away : m.score.fullTime.home;
        if (gf > ga) pontos += 3;
        else if (gf === ga) pontos += 1;
      }
      formaGeral = pontos / (matches.length * 3);
    }
  } catch (e) {
    console.warn(`    Falha ao buscar nível geral do time ${teamId}: ${e.message}`);
  }

  if (formaGeral === null && !daTabela) return null; // sem nenhum dado em lugar nenhum (raríssimo)

  const formScore =
    formaGeral !== null && daTabela?.formScore != null
      ? (formaGeral + daTabela.formScore) / 2
      : formaGeral ?? daTabela?.formScore ?? null;

  return {
    posicao: daTabela?.posicao || null,
    totalTeams: daTabela?.totalTeams || null,
    formScore,
    amostra,
    faseAnalisada: 'nível geral do time (fora dessa competição/fase específica)',
    temDadosDaFaseEspecifica: false,
    ehNivelGeral: true,
  };
}

async function collectHeadToHead(match) {
  const data = await apiGet(`/matches/${match.id}/head2head`, { limit: 30 });
  const agg = data.aggregates;
  if (!agg || !agg.numberOfMatches || agg.numberOfMatches === 0) {
    return { totalConfrontos: 0, mandanteWinRate: null, visitanteWinRate: null, empateRate: null };
  }
  const homeIsAgHome = agg.homeTeam.id === match.mandanteId;
  const mandanteWins = homeIsAgHome ? agg.homeTeam.wins : agg.awayTeam.wins;
  const visitanteWins = homeIsAgHome ? agg.awayTeam.wins : agg.homeTeam.wins;
  const total = agg.numberOfMatches;
  const draws = total - mandanteWins - visitanteWins;
  return {
    totalConfrontos: total,
    mandanteWinRate: mandanteWins / total,
    visitanteWinRate: visitanteWins / total,
    empateRate: draws / total,
  };
}

const ETAPAS_MATA_MATA = new Set([
  'LAST_16', 'ROUND_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'FINAL',
  'THIRD_PLACE', 'PLAYOFFS', 'PRELIMINARY_ROUND',
]);
const ETAPAS_FASE_DE_GRUPOS = new Set(['GROUP_STAGE', 'LEAGUE_STAGE', 'REGULAR_SEASON']);

// Pra competições sem tabela única (Copa do Mundo, Champions, Eurocopa),
// busca o histórico do time NAQUELA competição e separa o aproveitamento
// em fase de grupos x mata-mata — porque tem time que rende bem numa
// fase e mal na outra. Usa a fase certa dependendo do jogo analisado.
async function collectDesempenhoNaCompeticao(teamId, competitionCode, faseDoJogo) {
  const data = await apiGet('/teams/' + teamId + '/matches', {
    competitions: competitionCode,
    status: 'FINISHED',
    limit: 60, // busca mais fundo no histórico pra achar jogos da fase específica
  });
  const matches = data.matches || [];
  if (matches.length === 0) return null;

  function taxaVitoria(filtro) {
    const subset = matches.filter(filtro);
    if (subset.length === 0) return null;
    let pontos = 0;
    for (const m of subset) {
      const isHome = m.homeTeam.id === teamId;
      const gf = isHome ? m.score.fullTime.home : m.score.fullTime.away;
      const ga = isHome ? m.score.fullTime.away : m.score.fullTime.home;
      if (gf > ga) pontos += 3;
      else if (gf === ga) pontos += 1;
    }
    return pontos / (subset.length * 3);
  }

  const taxaMataMata = taxaVitoria((m) => ETAPAS_MATA_MATA.has(m.stage));
  const taxaGrupos = taxaVitoria((m) => ETAPAS_FASE_DE_GRUPOS.has(m.stage));
  const taxaGeral = taxaVitoria(() => true);

  const ehMataMata = faseDoJogo && ETAPAS_MATA_MATA.has(faseDoJogo);
  const formScore = ehMataMata ? (taxaMataMata ?? taxaGeral) : (taxaGrupos ?? taxaGeral);

  return {
    formScore,
    amostra: matches.length,
    faseAnalisada: ehMataMata ? 'mata-mata' : 'fase de grupos',
    temDadosDaFaseEspecifica: ehMataMata ? taxaMataMata !== null : taxaGrupos !== null,
  };
}

// Combina forma atual + posição na competição + histórico de confrontos
// diretos + vantagem de mandante num cálculo único de probabilidade.
function calcularProbabilidade({ mandanteInfo, visitanteInfo, h2h }) {
  // Força de cada time (0..1): metade forma recente, metade
  // aproveitamento/posição na competição específica (ou aproveitamento
  // na fase certa da competição, pra copas com mata-mata).
  function forca(info) {
    if (!info || info.formScore == null) return 0.5; // sem NENHUM dado em lugar nenhum: neutro (raríssimo)
    const forma = info.formScore;
    if (info.posicao) {
      const posicao = standingScore(info.posicao, info.totalTeams);
      return forma * 0.5 + posicao * 0.5;
    }
    return forma;
  }

  let sMandante = clamp(forca(mandanteInfo) + VANTAGEM_MANDANTE, 0, 1);
  let sVisitante = clamp(forca(visitanteInfo), 0, 1);

  // Se tiver histórico de confrontos diretos suficiente (3+ jogos),
  // funde esse retrospecto no cálculo (peso de 40%).
  let temHistorico = h2h && h2h.totalConfrontos >= 3;
  if (temHistorico) {
    sMandante = sMandante * 0.6 + h2h.mandanteWinRate * 0.4;
    sVisitante = sVisitante * 0.6 + h2h.visitanteWinRate * 0.4;
  }

  const total = sMandante + sVisitante;
  const diferenca = Math.abs(sMandante - sVisitante);

  // Empate: quanto mais parecidas as forças, maior a chance de empate.
  let empate = 16 + (1 - diferenca) * 16; // 16% a 32%
  if (temHistorico) {
    empate = empate * 0.6 + h2h.empateRate * 100 * 0.4;
  }
  empate = clamp(empate, 10, 40);

  const restante = 100 - empate;
  const mandante = total > 0 ? (sMandante / total) * restante : restante / 2;
  const visitante = restante - mandante;

  return {
    mandante: Math.round(mandante),
    empate: Math.round(empate),
    visitante: Math.round(visitante),
  };
}

function montarObservacao({ mandanteInfo, visitanteInfo, h2h }) {
  const partes = [];
  if (mandanteInfo?.posicao && !mandanteInfo?.ehNivelGeral) {
    partes.push(`mandante em ${mandanteInfo.posicao}º lugar na competição`);
  } else if (mandanteInfo?.ehNivelGeral) {
    partes.push(`mandante estreando nessa fase/competição — usado o nível geral do time (últimos jogos e posição no campeonato nacional, ${mandanteInfo.amostra} jogo(s) analisados)`);
  } else if (mandanteInfo?.faseAnalisada) {
    const nota = mandanteInfo.temDadosDaFaseEspecifica
      ? `mandante avaliado pelo aproveitamento em ${mandanteInfo.faseAnalisada} nessa competição (${mandanteInfo.amostra} jogo(s) no histórico)`
      : `mandante nunca jogou essa fase antes nessa competição — usado o aproveitamento geral dele na competição como estimativa`;
    partes.push(nota);
  }
  if (visitanteInfo?.posicao && !visitanteInfo?.ehNivelGeral) {
    partes.push(`visitante em ${visitanteInfo.posicao}º lugar`);
  } else if (visitanteInfo?.ehNivelGeral) {
    partes.push(`visitante estreando nessa fase/competição — usado o nível geral do time (últimos jogos e posição no campeonato nacional, ${visitanteInfo.amostra} jogo(s) analisados)`);
  } else if (visitanteInfo?.faseAnalisada) {
    const nota = visitanteInfo.temDadosDaFaseEspecifica
      ? `visitante avaliado pelo aproveitamento em ${visitanteInfo.faseAnalisada} nessa competição (${visitanteInfo.amostra} jogo(s) no histórico)`
      : `visitante nunca jogou essa fase antes nessa competição — usado o aproveitamento geral dele na competição como estimativa`;
    partes.push(nota);
  }
  if (h2h && h2h.totalConfrontos > 0) {
    partes.push(`${h2h.totalConfrontos} confronto(s) direto(s) recente(s) considerado(s)`);
  } else {
    partes.push('sem confrontos diretos recentes no histórico');
  }
  return `Cálculo considerando forma atual, aproveitamento na competição e ${partes.join(', ')}.`;
}

// Carrega o data.json da coleta anterior, se existir — usado pra manter
// as análises já sorteadas até o jogo realmente acontecer.
function carregarDadosAnteriores() {
  if (!fs.existsSync(OUTPUT_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log('=== FUT RADAR — coleta de dados ===');

  const result = {
    geradoEm: new Date().toISOString(),
    fonte: 'football-data.org',
    proximosJogos: [],
    resultadosRecentes: [],
    competicoes: [],
    analises: [],
    avisos: [],
  };

  // 1) Tabelas primeiro — usadas tanto pra seção "Tabelas" quanto como
  // base gratuita de forma/posição pro cálculo de probabilidade.
  const standingsByComp = {};
  for (const comp of COMPETITIONS) {
    try {
      console.log(`Buscando tabela: ${comp.nome}...`);
      const rawTable = await collectStandingsRaw(comp.code);
      if (rawTable) {
        standingsByComp[comp.code] = rawTable;
        result.competicoes.push({ codigo: comp.code, nome: comp.nome, tabela: formatStandingsForApp(rawTable) });
      } else {
        result.competicoes.push({ codigo: comp.code, nome: comp.nome, tabela: [] });
      }
    } catch (e) {
      console.warn(`  Falha ao buscar tabela de ${comp.nome}: ${e.message}`);
      result.competicoes.push({ codigo: comp.code, nome: comp.nome, tabela: [] });
    }
    await sleep(6500);
  }

  // 2) Próximos jogos e resultados recentes.
  try {
    console.log('Buscando próximos jogos (7 dias)...');
    result.proximosJogos = await collectUpcoming();
  } catch (e) {
    console.warn(`Falha ao buscar próximos jogos: ${e.message}`);
    result.avisos.push('Não foi possível atualizar os próximos jogos nesta coleta.');
  }
  await sleep(6500);

  try {
    console.log('Buscando resultados recentes (7 dias)...');
    result.resultadosRecentes = await collectRecent();
  } catch (e) {
    console.warn(`Falha ao buscar resultados recentes: ${e.message}`);
    result.avisos.push('Não foi possível atualizar os resultados recentes nesta coleta.');
  }
  await sleep(6500);

  // 3) Acumula análises: mantém as anteriores que ainda não terminaram
  // (considerando o horário estimado de término, não só o de início) e
  // sempre sorteia mais 6 jogos NOVOS a cada rodada, priorizando os mais
  // próximos — a lista só cresce, pra ter o máximo de comparações
  // possível. Teto de segurança pra não crescer pra sempre.
  const MAX_ANALISES_ACUMULADAS = 150;
  const DURACAO_ESTIMADA_JOGO_MS = 2.5 * 60 * 60 * 1000; // 2h30 (jogo + acréscimos + margem)

  const anterior = carregarDadosAnteriores();
  const agora = new Date();

  const analisesPersistidas = (anterior?.analises || []).filter((a) => {
    const estimativaFim = new Date(new Date(a.data).getTime() + DURACAO_ESTIMADA_JOGO_MS);
    return estimativaFim > agora;
  });
  const idsJaAnalisados = new Set(analisesPersistidas.map((a) => a.id));

  console.log(`Análises mantidas da coleta anterior (ainda não terminaram): ${analisesPersistidas.length}`);

  const candidatos = result.proximosJogos.filter((m) => !idsJaAnalisados.has(m.id));
  const sorteadas = selecionarPartidasProximas(candidatos, QTD_PARTIDAS_SORTEADAS);

  const novasAnalises = [];
  for (const match of sorteadas) {
    try {
      console.log(`Analisando: ${match.mandante} x ${match.visitante}...`);
      const h2h = await collectHeadToHead(match);

      let mandanteInfo = findTeamRow(standingsByComp, match.competicaoCodigo, match.mandanteId);
      let visitanteInfo = findTeamRow(standingsByComp, match.competicaoCodigo, match.visitanteId);

      // Sem tabela única (Copa do Mundo, Champions, Eurocopa)? Busca o
      // aproveitamento do time na fase certa (grupos ou mata-mata).
      if (!mandanteInfo) {
        mandanteInfo = await collectDesempenhoNaCompeticao(match.mandanteId, match.competicaoCodigo, match.stage);
        await sleep(6500);
      }
      if (!visitanteInfo) {
        visitanteInfo = await collectDesempenhoNaCompeticao(match.visitanteId, match.competicaoCodigo, match.stage);
        await sleep(6500);
      }

      // Time estreando na competição/fase (nunca jogou antes)? Usa o
      // nível geral dele (aproveitamento recente em qualquer competição
      // + posição no campeonato nacional dele, se disponível).
      if (!mandanteInfo || mandanteInfo.formScore === null) {
        mandanteInfo = await collectNivelGeralDoTime(match.mandanteId, standingsByComp);
        await sleep(6500);
      }
      if (!visitanteInfo || visitanteInfo.formScore === null) {
        visitanteInfo = await collectNivelGeralDoTime(match.visitanteId, standingsByComp);
        await sleep(6500);
      }

      const probabilidades = calcularProbabilidade({ mandanteInfo, visitanteInfo, h2h });
      const obs = montarObservacao({ mandanteInfo, visitanteInfo, h2h });
      novasAnalises.push({ ...match, probabilidades, obs });
    } catch (e) {
      console.warn(`  Falha ao analisar ${match.mandante} x ${match.visitante}: ${e.message}`);
    }
    await sleep(6500);
  }

  result.analises = [...analisesPersistidas, ...novasAnalises]
    .sort((a, b) => new Date(a.data) - new Date(b.data))
    .slice(0, MAX_ANALISES_ACUMULADAS);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

  const hasAnyData =
    result.proximosJogos.length > 0 ||
    result.resultadosRecentes.length > 0 ||
    result.competicoes.some((c) => c.tabela.length > 0);

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
