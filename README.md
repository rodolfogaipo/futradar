# FUT RADAR

Painel informativo de futebol (Atlético-MG, América-MG, Cruzeiro + tabela do
Brasileirão Série A). Sem apostas, sem odds — só estatísticas.

## Como os dados chegam no app

Testamos duas fontes até achar uma que funciona de verdade com dados atuais:
- Scraping direto de sites (Globo Esporte etc.): **bloqueado**, não dá.
- API-Football (primeira tentativa): o plano gratuito só libera temporadas
  antigas (2022-2024), não a atual — inútil pro nosso caso.
- **football-data.org** (versão atual): plano gratuito de verdade, com dados
  da temporada corrente do Brasileirão Série A. É essa que o app usa.

O fluxo é o mesmo do Trem de Notícias:
1. Um robô (GitHub Actions) roda a cada 3 horas, busca os dados na API e salva
   em `docs/data/data.json`.
2. O app (PWA estático) só lê esse arquivo — não faz nenhuma chamada externa
   pelo celular do usuário.

## Passo a passo pra deixar funcionando (uma vez só)

### 1. Pegar o token gratuito da football-data.org
1. Acesse **https://www.football-data.org/client/register**
2. Preenche o cadastro (nome, e-mail, senha) — é grátis, sem cartão.
3. Confirma o e-mail se pedir.
4. No painel (`football-data.org/client/dashboard`), copia o **"Your API
   Token"** (uma sequência de letras e números).

### 2. Adicionar o token como "secret" no repositório
1. No GitHub, entre no repositório → **Settings** → **Secrets and variables** → **Actions**.
2. Clique em **New repository secret**.
3. Nome: `FOOTBALL_DATA_TOKEN`
4. Valor: cole o token copiado no passo 1.
5. Salve.

(Se você já tinha criado um secret chamado `API_FOOTBALL_KEY` da tentativa
anterior, pode deixar ou apagar — ele não é mais usado.)

### 3. Habilitar permissão de escrita para o Actions
1. **Settings** → **Actions** → **General**.
2. Em "Workflow permissions", marque **Read and write permissions**.
3. Salve.
(Se você já fez isso antes, não precisa repetir.)

### 4. Subir/atualizar os arquivos
Suba todo o conteúdo desta pasta para o repositório. Se o repositório já
existe, é só subir os arquivos de novo — o GitHub substitui os que mudaram
(o `scripts/collect.js` é o principal que mudou nesta versão).

### 5. Habilitar o GitHub Pages (se ainda não fez)
1. **Settings** → **Pages**.
2. Em "Source", selecione **Deploy from a branch**.
3. Branch: `main`, pasta: **/docs**.
4. Salve.

### 6. Rodar a primeira coleta manualmente
1. Vá na aba **Actions** do repositório.
2. Clique no workflow **"Coletar dados do FUT RADAR"**.
3. Clique em **Run workflow** → **Run workflow** de novo pra confirmar.
4. Espere terminar (ícone verde ✔️).

Depois disso, ele roda sozinho a cada 3 horas — não precisa mexer em nada.

## Estrutura

```
fut-radar/
├── docs/                  ← isso vira o site (GitHub Pages)
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── css/style.css
│   ├── js/app.js
│   ├── icons/             ← ícones já prontos, gerados a partir da sua logo
│   └── data/data.json     ← gerado automaticamente, não mexer manualmente
├── scripts/
│   ├── collect.js         ← coletor que roda no GitHub Actions
│   └── config-ids.json    ← criado automaticamente na primeira execução
└── .github/workflows/collect.yml
```

## Sobre as porcentagens exibidas

São uma estimativa simples baseada na forma recente de cada time (últimos
5 jogos). Não é odds de casa de aposta, não usa dinheiro real e não deve ser
usada como orientação de aposta — é só uma leitura estatística de momento,
deixado bem claro na própria tela do app.
