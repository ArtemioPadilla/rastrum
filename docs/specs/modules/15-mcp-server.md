# Module 15 — MCP Server

**Status:** v1.0 (shipped 2026-04-26)
**Code:** `supabase/functions/mcp/index.ts`
**Endpoint:** `https://reppvlqejgoqvitturxp.supabase.co/functions/v1/mcp`

The MCP server exposes Rastrum's REST API as [Model Context Protocol](https://modelcontextprotocol.io)
tools, so AI agents (Claude Desktop, Cursor, Copilot Coding Agent, etc.)
can query and write to a user's Rastrum data using the same personal API
tokens (`rst_*`) the REST API uses.

## Why a separate function

The MCP server and the REST API (`supabase/functions/api/index.ts`)
are deliberately split:

- **REST API** is request/response, scoped per route, idiomatic for
  shell scripts and curl.
- **MCP server** is JSON-RPC 2.0 over POST, with a self-describing tool
  list, idiomatic for AI agents that pick which tool to call from a
  natural-language prompt.

Both gate on the same `user_api_tokens` table and the same scope
strings (`observe`, `identify`, `export`). Adding a tool to the MCP
server does not require changes to the REST API and vice versa, but
the logic is intentionally similar so behavior stays consistent.

## Auth

Same as the REST API:

```http
Authorization: Bearer rst_<token>
```

Tokens are created at `https://rastrum.org/profile/tokens`. Each token
has scopes; a tool is only listed/callable if the token's scopes
include the tool's required scope.

The `initialize` and `ping` JSON-RPC methods are allowed unauthenticated
so MCP clients can probe server capabilities. Everything else (`tools/list`,
`tools/call`) requires a valid `rst_*` token.

## Tools

| Tool | Scope | Description |
|---|---|---|
| `identify_species` | `identify` | Run the photo ID cascade (PlantNet → Claude Haiku → on-device) on a public image URL. |
| `submit_observation` | `observe` | Create a new observation row at the given lat/lng with optional photo + identification. |
| `list_observations` | `observe` | Paginated own-observations, newest first, with attached media + IDs. |
| `get_observation` | `observe` | Fetch one observation by id (RLS scopes to caller). |
| `export_darwin_core` | `export` | Return a Darwin Core CSV of own observations (returned as a string, not an attachment). |

## Configuring agents

### Claude Desktop / Cursor / VS Code

```jsonc
{
  "mcpServers": {
    "rastrum": {
      "type": "http",
      "url": "https://reppvlqejgoqvitturxp.supabase.co/functions/v1/mcp",
      "headers": { "Authorization": "Bearer rst_<your-token>" }
    }
  }
}
```

### GitHub Copilot Coding Agent

Repo Settings → Copilot → Coding agent → MCP configuration:

```json
{
  "mcpServers": {
    "rastrum": {
      "type": "http",
      "url": "https://reppvlqejgoqvitturxp.supabase.co/functions/v1/mcp",
      "headers": { "Authorization": "Bearer ${{ secrets.RASTRUM_API_TOKEN }}" }
    }
  }
}
```

Then add `RASTRUM_API_TOKEN` to the `copilot` environment in repo
secrets so the agent can read it but humans can't.

## Smoke test

```bash
TOKEN="rst_..."
URL="https://reppvlqejgoqvitturxp.supabase.co/functions/v1/mcp"

# 1. Probe capabilities (no auth needed)
curl -s -X POST "$URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | jq

# 2. List tools (auth needed)
curl -s -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq

# 3. Run a tool (auth + scope needed)
curl -s -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call",
       "params":{"name":"list_observations","arguments":{"limit":5}}}' | jq
```

## Deploy

```bash
gh workflow run deploy-functions.yml -f function=mcp
```

The workflow deploys with `--no-verify-jwt` because the MCP server
verifies its own `rst_*` tokens; Supabase's JWT layer would reject
those.

## Operational notes

- **Stateless.** Each request re-validates the token. There is no
  session state, so request ordering doesn't matter.
- **Token last_used_at** is updated fire-and-forget on every successful
  call.
- **Tool errors** are returned inside the JSON-RPC `result.content`
  (with `isError: true`) so MCP clients can show them to the model
  without the call counting as a transport failure.
- **CORS.** `*` allowed on `Origin`; the `mcp-session-id` header is
  included in `Access-Control-Allow-Headers` for clients that send it
  per spec.
