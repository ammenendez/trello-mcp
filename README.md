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

## Ferramentas disponíveis

- `trello_list_boards`: lista seus boards
- `trello_get_board`: busca detalhes de um board
- `trello_list_lists`: lista listas de um board
- `trello_create_list`: cria uma lista em um board
- `trello_list_cards`: lista cards de um board ou lista
- `trello_get_card`: busca detalhes de um card
- `trello_create_card`: cria um card
- `trello_update_card`: atualiza nome, descrição, lista, vencimento ou status de um card
- `trello_move_card`: move um card para outra lista
- `trello_add_comment`: adiciona comentário a um card
- `trello_archive_card`: arquiva ou desarquiva um card

## Segurança

O servidor usa apenas credenciais vindas de variáveis de ambiente. Não coloque `TRELLO_API_KEY` ou `TRELLO_TOKEN` no repositório.
