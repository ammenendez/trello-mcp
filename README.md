# Trello MCP

Servidor MCP para conectar assistentes compatíveis com MCP ao Trello via REST API.

## Requisitos

- Node.js 18+
- Uma API key e token do Trello

Crie suas credenciais em:

- API key: https://trello.com/app-key
- Token: use o link de token exibido na página da sua API key

## Instalação

```bash
npm install
npm run build
```

## Variáveis de ambiente

```bash
export TRELLO_API_KEY="..."
export TRELLO_TOKEN="..."
```

Opcionalmente, em um projeto consumidor, defina o board padrao:

```bash
export TRELLO_DEFAULT_BOARD_ID="..."
```

`TRELLO_DEFAULT_BOARD_ID` pode ser o `id` completo retornado por
`trello_list_boards` ou o shortLink da URL do quadro, como `abcDEF12` em
`https://trello.com/b/abcDEF12/nome-do-quadro`.

## Uso com cliente MCP

Exemplo de configuração:

```json
{
  "mcpServers": {
    "trello": {
      "command": "node",
      "args": ["/caminho/para/trello-mcp/dist/index.js"],
      "env": {
        "TRELLO_API_KEY": "sua_api_key",
        "TRELLO_TOKEN": "seu_token"
      }
    }
  }
}
```

## Uso com Codex

No Codex, configure o servidor em `~/.codex/config.toml`:

```toml
[mcp_servers.trello]
command = "node"
args = ["/caminho/para/trello-mcp/dist/index.js"]

[mcp_servers.trello.env]
TRELLO_API_KEY = "sua_api_key"
TRELLO_TOKEN = "seu_token"
```

Exemplo com caminho absoluto:

```toml
[mcp_servers.trello]
command = "node"
args = ["/Users/andres/Documents/projetos/trello-mcp/dist/index.js"]

[mcp_servers.trello.env]
TRELLO_API_KEY = "sua_api_key"
TRELLO_TOKEN = "seu_token"
```

Depois de alterar o `config.toml`, reinicie a sessao do Codex. O servidor fica
disponivel globalmente, inclusive quando voce abrir outro projeto no VS Code.

### Board padrao por projeto

Para usar um quadro diferente em cada projeto, deixe `TRELLO_API_KEY` e
`TRELLO_TOKEN` no `~/.codex/config.toml` e coloque apenas
`TRELLO_DEFAULT_BOARD_ID` no `.env` do projeto que voce abriu no VS Code:

```env
TRELLO_DEFAULT_BOARD_ID=abcDEF12
```

Quando uma ferramenta receber `boardId`, o valor informado na chamada tem
prioridade. Se `boardId` nao for informado, o MCP usa
`TRELLO_DEFAULT_BOARD_ID` do ambiente do projeto.

## Ferramentas disponíveis

### Trello básico

- `trello_list_boards`: lista seus boards
- `trello_get_board`: busca detalhes de um board; usa `TRELLO_DEFAULT_BOARD_ID` se `boardId` nao for informado
- `trello_list_lists`: lista listas de um board; usa `TRELLO_DEFAULT_BOARD_ID` se `boardId` nao for informado
- `trello_create_list`: cria uma lista em um board; usa `TRELLO_DEFAULT_BOARD_ID` se `boardId` nao for informado
- `trello_list_cards`: lista cards de um board ou lista; usa `TRELLO_DEFAULT_BOARD_ID` se `boardId` e `listId` nao forem informados
- `trello_get_card`: busca detalhes de um card
- `trello_create_card`: cria um card
- `trello_update_card`: atualiza nome, descrição, lista, vencimento ou status de um card
- `trello_move_card`: move um card para outra lista
- `trello_add_comment`: adiciona comentário a um card
- `trello_archive_card`: arquiva ou desarquiva um card

### Produto e sprint

- `calculate_priority`: calcula prioridade usando `impacto + urgencia - esforco`
- `enrich_card_metadata`: classifica um card existente, cria labels se necessario, adiciona labels ao card e comenta a justificativa
- `build_sprint`: sugere ou monta uma sprint a partir de cards existentes no backlog

O enriquecimento usa labels no formato:

- `modulo:financeiro`
- `tipo:feature`
- `impacto:alto`
- `esforco:medio`
- `urgencia:alta`
- `prioridade:P1`

`build_sprint` usa `dryRun: true` por padrao. Assim voce pode revisar quais cards
seriam selecionados antes de criar lista e mover cards. Para executar de fato,
chame com `dryRun: false`.

Use `priorityOverrides` para informar macro prioridades humanas. O MCP aplica
essas regras aos cards que contem o texto em `match` no titulo ou descricao, e
depois usa as regras automaticas para ordenar os cards dentro de cada grupo.

Por padrao, quando uma macro atividade tiver cards de mais de uma camada tecnica,
o MCP ordena assim:

1. backend / back / api
2. frontend / front / web
3. mobile / app
4. demais cards

Ou seja: se uma macro atividade tiver back e front, o back vem antes.

Campos aceitos em cada override:

- `match`: texto usado para encontrar cards
- `modulo`: modulo que deve ser aplicado
- `tipo`: `feature`, `bug`, `refactor`, `ux` ou `infra`
- `impacto`: `alto`, `medio` ou `baixo`
- `esforco`: `alto`, `medio` ou `baixo`
- `urgencia`: `alta`, `media` ou `baixa`
- `prioridade`: `P1`, `P2` ou `P3`
- `reason`: justificativa adicionada ao comentario do card

Exemplo de planejamento sem mover cards:

```json
{
  "boardId": "id_do_board",
  "sourceListNames": ["Backlog"],
  "sprintNumber": 2,
  "startDate": "2026-05-01",
  "endDate": "2026-05-15",
  "maxCards": 10,
  "manualContext": "Focar no modulo financeiro e evitar refactors nao criticos",
  "priorityOverrides": [
    {
      "match": "planilha",
      "modulo": "financeiro",
      "impacto": "alto",
      "urgencia": "alta",
      "prioridade": "P1",
      "reason": "Refazer planilhas e uma macro prioridade humana deste ciclo"
    },
    {
      "match": "garmin",
      "modulo": "integracoes",
      "impacto": "medio",
      "urgencia": "media",
      "prioridade": "P2",
      "reason": "Integracao Garmin e importante, mas nao bloqueia o ciclo atual"
    }
  ],
  "dryRun": true
}
```

Exemplo para montar a sprint:

```json
{
  "boardId": "id_do_board",
  "sourceListNames": ["Backlog"],
  "sprintListName": "Sprint 02 - 2026-05-01 a 2026-05-15",
  "maxCards": 10,
  "manualContext": "Focar no modulo financeiro e postergar integracoes externas",
  "dryRun": false
}
```

## Segurança

O servidor usa apenas credenciais vindas de variáveis de ambiente. Não coloque `TRELLO_API_KEY` ou `TRELLO_TOKEN` no repositório.
