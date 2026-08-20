# FUT RADAR

Painel informativo de futebol (Atlético-MG, América-MG, Cruzeiro + tabela do
Brasileirão Série A). Sem apostas, sem odds — só estatísticas.

## Como os dados chegam no app (sem scraping quebrando toda hora)

Os sites de esportes (Globo Esporte, Flashscore etc.) bloqueiam esse tipo de
acesso automatizado e boa parte usa JavaScript pesado — por isso o app usa a
**API-Football**, que é gratuita (100 requisições por dia no plano free, mais
que suficiente pra esse projeto).

O fluxo é o mesmo do Trem de Notícias:
1. Um robô (GitHub Actions) roda a cada 3 horas, busca os dados na API e salva
   em `docs/data/data.json`.
2. O app (PWA estático) só lê esse arquivo — não faz nenhuma chamada externa
   pelo celular do usuário.

## Passo a passo pra deixar funcionando (uma vez só)

### 1. Pegar a chave gratuita da API-Football
1. Acesse **https://dashboard.api-football.com/register**
2. Crie uma conta gratuita (plano Free).
3. No painel, copie sua **API Key**.

### 2. Adicionar a chave como "secret" no repositório
1. No GitHub, entre no repositório → **Settings** → **Secrets and variables** → **Actions**.
2. Clique em **New repository secret**.
3. Nome: `API_FOOTBALL_KEY`
4. Valor: cole a chave copiada no passo 1.
5. Salve.

### 3. Habilitar permissão de escrita para o Actions
1. **Settings** → **Actions** → **General**.
2. Em "Workflow permissions", marque **Read and write permissions**.
3. Salve.

### 4. Subir os arquivos
Suba todo o conteúdo desta pasta para o repositório (upload direto pelo
GitHub, do jeito que você já faz nos outros projetos).

### 5. Habilitar o GitHub Pages
1. **Settings** → **Pages**.
2. Em "Source", selecione **Deploy from a branch**.
3. Branch: `main`, pasta: **/docs**.
4. Salve.

### 6. Rodar a primeira coleta manualmente
1. Vá na aba **Actions** do repositório.
2. Clique no workflow **"Coletar dados do FUT RADAR"**.
3. Clique em **Run workflow** → **Run workflow** de novo pra confirmar.
4. Espere terminar (ícone verde ✔️). Isso cria o `docs/data/data.json` com
   dados reais pela primeira vez.

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

São uma estimativa simples baseada na forma recente dos dois times (últimos
5 jogos). Não é odds de casa de aposta, não usa dinheiro real e não deve ser
usada como orientação de aposta — é só uma leitura estatística de momento,
deixado bem claro na própria tela do app.
