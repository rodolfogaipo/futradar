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
    dateFrom: dateStr(-9),
    dateTo: dateStr(0),
    status: 'FINISHED',
  });
  return (data.matches || []).map(mapMatch);
}

// Retorna a tabela completa (com campo "form" cru da API, não convertido
// ainda) e também já monta a versão formatada pra exibição no app.
async function collectStandingsRaw(code, season) {
  const data = await apiGet(`/competitions/${code}/standings`, season ? { season } : undefined);
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
    golsPro: row.goalsFor,
    golsContra: row.goalsAgainst,
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

// Busca a linha da tabela de um time dentro do "banco" de tabelas já
// coletadas (sem gastar requisição nova). Se a temporada atual ainda
// não começou (0 jogos pra todo mundo — abertura de campeonato), usa a
// tabela FINAL da temporada passada como referência de nível do time,
// em vez de tratar como "sem dado nenhum". Sempre inclui a média de
// gols marcados/sofridos por jogo, usada no modelo de gols esperados.
function findTeamRow(standingsByComp, standingsAnterioresByComp, competitionCode, teamId) {
  const table = standingsByComp[competitionCode];
  if (!table) return null;
  const totalTeams = table.length;
  const row = table.find((r) => r.team.id === teamId);
  if (!row) return null;

  const temporadaComecou = table.some((r) => r.playedGames > 0);

  if (!temporadaComecou) {
    const tabelaAnterior = standingsAnterioresByComp[competitionCode];
    const rowAnterior = tabelaAnterior?.find((r) => r.team.id === teamId);
    if (rowAnterior && rowAnterior.playedGames > 0) {
      return {
        posicao: rowAnterior.position,
        totalTeams: tabelaAnterior.length,
        formScore: formScoreFromString(rowAnterior.form),
        golsProMedia: rowAnterior.goalsFor / rowAnterior.playedGames,
        golsContraMedia: rowAnterior.goalsAgainst / rowAnterior.playedGames,
        jogos: rowAnterior.playedGames,
        deTemporadaAnterior: true,
      };
    }
    // Time subiu de divisão / não disputou a competição na temporada
    // anterior — não tem posição de referência ainda.
    return null;
  }

  if (row.playedGames === 0) return null; // time específico ainda não estreou nessa competição

  return {
    posicao: row.position,
    totalTeams,
    formScore: formScoreFromString(row.form),
    golsProMedia: row.goalsFor / row.playedGames,
    golsContraMedia: row.goalsAgainst / row.playedGames,
    jogos: row.playedGames,
    pontosPorJogo: row.points / row.playedGames,
  };
}

// Média de gols marcados por jogo em toda a competição — usada como
// referência ("liga média") no modelo de gols esperados. Times acima
// disso têm ataque acima da média; abaixo disso, ataque fraco (e o
// mesmo racional pra defesa, invertido).
function calcularMediaGolsLiga(rawTable) {
  const validos = (rawTable || []).filter((r) => r.playedGames > 0);
  if (validos.length === 0) return null;
  const totalGols = validos.reduce((s, r) => s + (r.goalsFor || 0), 0);
  const totalJogos = validos.reduce((s, r) => s + r.playedGames, 0);
  return totalJogos > 0 ? totalGols / totalJogos : null;
}

// Procura, em QUALQUER das 12 tabelas já coletadas, a posição desse time
// no campeonato dele (mesmo que não seja o campeonato do jogo analisado).
// Serve como indicador do nível geral do time, sem gastar requisição.
function encontrarPosicaoEmQualquerCompeticao(standingsByComp, teamId) {
  for (const table of Object.values(standingsByComp)) {
    const row = table.find((r) => r.team.id === teamId);
    if (row && row.playedGames > 0) {
      return {
        posicao: row.position,
        totalTeams: table.length,
        formScore: formScoreFromString(row.form),
        golsProMedia: row.goalsFor / row.playedGames,
        golsContraMedia: row.goalsAgainst / row.playedGames,
        jogos: row.playedGames,
      };
    }
  }
  return null;
}

// Nível geral do time: aproveitamento recente em QUALQUER competição
// (não só na que está sendo analisada), pra usar quando o time nunca
// jogou a fase/competição específica antes. Também extrai a média de
// gols marcados/sofridos desses jogos, pro modelo de gols esperados.
async function collectNivelGeralDoTime(teamId, standingsByComp) {
  const daTabela = encontrarPosicaoEmQualquerCompeticao(standingsByComp, teamId);

  let formaGeral = null;
  let amostra = 0;
  let golsProMedia = null;
  let golsContraMedia = null;

  try {
    const data = await apiGet('/teams/' + teamId + '/matches', { status: 'FINISHED', limit: 10 });
    const matches = data.matches || [];
    amostra = matches.length;
    if (matches.length > 0) {
      let pontos = 0;
      let somaGolsPro = 0;
      let somaGolsContra = 0;
      for (const m of matches) {
        const isHome = m.homeTeam.id === teamId;
        const gf = isHome ? m.score.fullTime.home : m.score.fullTime.away;
        const ga = isHome ? m.score.fullTime.away : m.score.fullTime.home;
        if (gf > ga) pontos += 3;
        else if (gf === ga) pontos += 1;
        somaGolsPro += gf ?? 0;
        somaGolsContra += ga ?? 0;
      }
      formaGeral = pontos / (matches.length * 3);
      golsProMedia = somaGolsPro / matches.length;
      golsContraMedia = somaGolsContra / matches.length;
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
    golsProMedia: golsProMedia ?? daTabela?.golsProMedia ?? null,
    golsContraMedia: golsContraMedia ?? daTabela?.golsContraMedia ?? null,
    jogos: amostra || daTabela?.jogos || 0,
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
// (e a média de gols) em fase de grupos x mata-mata — porque tem time
// que rende bem numa fase e mal na outra. Usa a fase certa dependendo
// do jogo analisado.
async function collectDesempenhoNaCompeticao(teamId, competitionCode, faseDoJogo) {
  const data = await apiGet('/teams/' + teamId + '/matches', {
    competitions: competitionCode,
    status: 'FINISHED',
    limit: 60, // busca mais fundo no histórico pra achar jogos da fase específica
  });
  const matches = data.matches || [];
  if (matches.length === 0) return null;

  function calcularBloco(filtro) {
    const subset = matches.filter(filtro);
    if (subset.length === 0) return null;
    let pontos = 0;
    let somaGolsPro = 0;
    let somaGolsContra = 0;
    for (const m of subset) {
      const isHome = m.homeTeam.id === teamId;
      const gf = isHome ? m.score.fullTime.home : m.score.fullTime.away;
      const ga = isHome ? m.score.fullTime.away : m.score.fullTime.home;
      if (gf > ga) pontos += 3;
      else if (gf === ga) pontos += 1;
      somaGolsPro += gf ?? 0;
      somaGolsContra += ga ?? 0;
    }
    return {
      formScore: pontos / (subset.length * 3),
      golsProMedia: somaGolsPro / subset.length,
      golsContraMedia: somaGolsContra / subset.length,
      jogos: subset.length,
    };
  }

  const blocoMataMata = calcularBloco((m) => ETAPAS_MATA_MATA.has(m.stage));
  const blocoGrupos = calcularBloco((m) => ETAPAS_FASE_DE_GRUPOS.has(m.stage));
  const blocoGeral = calcularBloco(() => true);

  const ehMataMata = faseDoJogo && ETAPAS_MATA_MATA.has(faseDoJogo);
  const bloco = ehMataMata ? (blocoMataMata ?? blocoGeral) : (blocoGrupos ?? blocoGeral);

  return {
    ...bloco,
    faseAnalisada: ehMataMata ? 'mata-mata' : 'fase de grupos',
    temDadosDaFaseEspecifica: ehMataMata ? blocoMataMata !== null : blocoGrupos !== null,
  };
}

// ============ MODELO ESTATÍSTICO: gols esperados + Poisson ============
//
// 1) Estima a força de ataque e defesa de cada time comparando a média
//    de gols marcados/sofridos dele com a média da competição.
// 2) Calcula os gols esperados de cada time no confronto (ataque de um
//    time x fraqueza defensiva do outro x média da liga x mando de campo).
// 3) Usa distribuição de Poisson pra calcular a probabilidade de cada
//    placar possível (0x0, 1x0, 2x1...) e soma os placares certos pra
//    virar Vitória do mandante / Empate / Vitória do visitante.
// 4) Funde com o histórico de confrontos diretos (peso menor), quando
//    existir amostra suficiente.

const MEDIA_GOLS_PADRAO = 1.35; // média global de gols por time por jogo (referência quando não há dado de liga)
const FATOR_ATAQUE_MANDANTE = 1.15; // times marcam mais em casa
const FATOR_ATAQUE_VISITANTE = 0.90; // e menos fora
const MAX_GOLS_MODELO = 8; // captura praticamente toda a massa de probabilidade
const PESO_H2H = 0.3; // quanto o histórico direto pesa sobre o modelo de gols

function fatorial(n) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonPMF(k, lambda) {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fatorial(k);
}

function distribuicaoGols(lambda) {
  const arr = [];
  for (let k = 0; k <= MAX_GOLS_MODELO; k++) arr.push(poissonPMF(k, lambda));
  const soma = arr.reduce((a, b) => a + b, 0);
  return arr.map((p) => p / soma);
}

function calcularForcaAtaqueDefesa(info, mediaGolsLiga) {
  if (!info || info.golsProMedia == null || info.golsContraMedia == null) return null;
  const media = mediaGolsLiga || MEDIA_GOLS_PADRAO;
  return {
    ataque: clamp(info.golsProMedia / media, 0.3, 2.5),
    defesa: clamp(info.golsContraMedia / media, 0.3, 2.5),
  };
}

function calcularGolsEsperados(mandanteInfo, visitanteInfo, mediaGolsLiga) {
  const media = mediaGolsLiga || MEDIA_GOLS_PADRAO;
  const forcaMandante = calcularForcaAtaqueDefesa(mandanteInfo, media);
  const forcaVisitante = calcularForcaAtaqueDefesa(visitanteInfo, media);

  const ataqueMandante = forcaMandante?.ataque ?? 1;
  const defesaMandante = forcaMandante?.defesa ?? 1;
  const ataqueVisitante = forcaVisitante?.ataque ?? 1;
  const defesaVisitante = forcaVisitante?.defesa ?? 1;

  const lambdaMandante = clamp(media * ataqueMandante * defesaVisitante * FATOR_ATAQUE_MANDANTE, 0.2, 4.5);
  const lambdaVisitante = clamp(media * ataqueVisitante * defesaMandante * FATOR_ATAQUE_VISITANTE, 0.2, 4.5);

  return { lambdaMandante, lambdaVisitante, temDadosReais: !!(forcaMandante && forcaVisitante) };
}

function probabilidadesPoisson(lambdaMandante, lambdaVisitante) {
  const distM = distribuicaoGols(lambdaMandante);
  const distV = distribuicaoGols(lambdaVisitante);

  let pMandante = 0;
  let pEmpate = 0;
  let pVisitante = 0;
  const placares = [];

  for (let i = 0; i <= MAX_GOLS_MODELO; i++) {
    for (let j = 0; j <= MAX_GOLS_MODELO; j++) {
      const p = distM[i] * distV[j];
      if (i > j) pMandante += p;
      else if (i === j) pEmpate += p;
      else pVisitante += p;
      placares.push({ mandante: i, visitante: j, prob: p });
    }
  }

  placares.sort((a, b) => b.prob - a.prob);
  return { pMandante, pEmpate, pVisitante, topPlacares: placares.slice(0, 3) };
}

function calcularProbabilidade({ mandanteInfo, visitanteInfo, h2h, mediaGolsLiga }) {
  const { lambdaMandante, lambdaVisitante, temDadosReais } = calcularGolsEsperados(
    mandanteInfo,
    visitanteInfo,
    mediaGolsLiga
  );
  const poisson = probabilidadesPoisson(lambdaMandante, lambdaVisitante);

  let pMandante = poisson.pMandante;
  let pEmpate = poisson.pEmpate;
  let pVisitante = poisson.pVisitante;

  const temHistorico = h2h && h2h.totalConfrontos >= 3;
  if (temHistorico) {
    pMandante = pMandante * (1 - PESO_H2H) + h2h.mandanteWinRate * PESO_H2H;
    pEmpate = pEmpate * (1 - PESO_H2H) + h2h.empateRate * PESO_H2H;
    pVisitante = pVisitante * (1 - PESO_H2H) + h2h.visitanteWinRate * PESO_H2H;
  }

  const total = pMandante + pEmpate + pVisitante;
  const probabilidades = {
    mandante: Math.round((pMandante / total) * 100),
    empate: Math.round((pEmpate / total) * 100),
    visitante: Math.round((pVisitante / total) * 100),
  };

  // Corrige eventual erro de arredondamento pra somar exatamente 100.
  const soma = probabilidades.mandante + probabilidades.empate + probabilidades.visitante;
  if (soma !== 100) {
    const chaveDoMaior = Object.entries(probabilidades).sort((a, b) => b[1] - a[1])[0][0];
    probabilidades[chaveDoMaior] += 100 - soma;
  }

  const jogosMandante = mandanteInfo?.jogos ?? 0;
  const jogosVisitante = visitanteInfo?.jogos ?? 0;
  let confianca = 'baixa';
  if (temDadosReais && jogosMandante >= 5 && jogosVisitante >= 5 && temHistorico) confianca = 'alta';
  else if (temDadosReais && (jogosMandante >= 3 || jogosVisitante >= 3)) confianca = 'média';

  return {
    probabilidades,
    golsEsperados: {
      mandante: Math.round(lambdaMandante * 100) / 100,
      visitante: Math.round(lambdaVisitante * 100) / 100,
    },
    placarMaisProvavel: `${poisson.topPlacares[0].mandante}x${poisson.topPlacares[0].visitante}`,
    confianca,
    temHistorico,
  };
}

function montarObservacao({ mandanteInfo, visitanteInfo, h2h, resultado }) {
  const partes = [];
  if (mandanteInfo?.posicao && !mandanteInfo?.ehNivelGeral) {
    partes.push(`mandante em ${mandanteInfo.posicao}º lugar${mandanteInfo.deTemporadaAnterior ? ' na temporada passada (atual ainda não começou)' : ' na competição'}`);
  } else if (mandanteInfo?.ehNivelGeral) {
    partes.push(`mandante estreando nessa fase/competição — usado o nível geral do time (${mandanteInfo.jogos} jogo(s) analisados)`);
  } else if (mandanteInfo?.faseAnalisada) {
    partes.push(`mandante avaliado pelo aproveitamento em ${mandanteInfo.faseAnalisada} nessa competição (${mandanteInfo.jogos} jogo(s) no histórico)`);
  }
  if (visitanteInfo?.posicao && !visitanteInfo?.ehNivelGeral) {
    partes.push(`visitante em ${visitanteInfo.posicao}º lugar${visitanteInfo.deTemporadaAnterior ? ' na temporada passada (atual ainda não começou)' : ''}`);
  } else if (visitanteInfo?.ehNivelGeral) {
    partes.push(`visitante estreando nessa fase/competição — usado o nível geral do time (${visitanteInfo.jogos} jogo(s) analisados)`);
  } else if (visitanteInfo?.faseAnalisada) {
    partes.push(`visitante avaliado pelo aproveitamento em ${visitanteInfo.faseAnalisada} nessa competição (${visitanteInfo.jogos} jogo(s) no histórico)`);
  }
  partes.push(
    h2h && h2h.totalConfrontos > 0
      ? `${h2h.totalConfrontos} confronto(s) direto(s) considerado(s)`
      : 'sem confrontos diretos no histórico'
  );

  return (
    `Modelo de Poisson sobre gols esperados (${resultado.golsEsperados.mandante} x ${resultado.golsEsperados.visitante}). ` +
    `Placar mais provável: ${resultado.placarMaisProvavel}. Confiança: ${resultado.confianca}. ` +
    `Baseado em: ${partes.join(', ')}.`
  );
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
  const standingsAnterioresByComp = {};
  const mediaGolsLigaByComp = {};
  const anoAtual = new Date().getFullYear();

  for (const comp of COMPETITIONS) {
    try {
      console.log(`Buscando tabela: ${comp.nome}...`);
      const rawTable = await collectStandingsRaw(comp.code);
      if (rawTable) {
        standingsByComp[comp.code] = rawTable;
        result.competicoes.push({ codigo: comp.code, nome: comp.nome, tabela: formatStandingsForApp(rawTable) });

        // Abertura de temporada (ninguém jogou ainda)? Busca a tabela
        // FINAL da temporada passada como referência de nível dos times
        // (e da média de gols da liga, pro modelo de gols esperados).
        const temporadaComecou = rawTable.some((r) => r.playedGames > 0);
        if (!temporadaComecou) {
          try {
            console.log(`  Temporada de ${comp.nome} ainda não começou — buscando temporada anterior como referência...`);
            await sleep(6500);
            const tabelaAnterior = await collectStandingsRaw(comp.code, anoAtual - 1);
            if (tabelaAnterior) {
              standingsAnterioresByComp[comp.code] = tabelaAnterior;
              mediaGolsLigaByComp[comp.code] = calcularMediaGolsLiga(tabelaAnterior);
            }
          } catch (e) {
            console.warn(`  Falha ao buscar temporada anterior de ${comp.nome}: ${e.message}`);
          }
        } else {
          mediaGolsLigaByComp[comp.code] = calcularMediaGolsLiga(rawTable);
        }
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

      let mandanteInfo = findTeamRow(standingsByComp, standingsAnterioresByComp, match.competicaoCodigo, match.mandanteId);
      let visitanteInfo = findTeamRow(standingsByComp, standingsAnterioresByComp, match.competicaoCodigo, match.visitanteId);

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

      // Time estreando na competição/fase (nunca jogou antes)? Busca o
      // nível geral dele (gols marcados/sofridos recentes + posição no
      // campeonato nacional) — só substitui se achar algo melhor, nunca
      // descarta um dado válido que já tínhamos.
      if (!mandanteInfo || mandanteInfo.golsProMedia == null) {
        const fallback = await collectNivelGeralDoTime(match.mandanteId, standingsByComp);
        if (fallback) mandanteInfo = fallback;
        await sleep(6500);
      }
      if (!visitanteInfo || visitanteInfo.golsProMedia == null) {
        const fallback = await collectNivelGeralDoTime(match.visitanteId, standingsByComp);
        if (fallback) visitanteInfo = fallback;
        await sleep(6500);
      }

      const mediaGolsLiga = mediaGolsLigaByComp[match.competicaoCodigo] || null;
      const resultado = calcularProbabilidade({ mandanteInfo, visitanteInfo, h2h, mediaGolsLiga });
      const obs = montarObservacao({ mandanteInfo, visitanteInfo, h2h, resultado });
      novasAnalises.push({
        ...match,
        probabilidades: resultado.probabilidades,
        golsEsperados: resultado.golsEsperados,
        placarMaisProvavel: resultado.placarMaisProvavel,
        confianca: resultado.confianca,
        obs,
      });
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
