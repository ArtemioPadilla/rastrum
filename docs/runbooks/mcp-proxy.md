# MCP Proxy — mcp.rastrum.org

Exposes the Supabase Edge Function at a clean URL using Cloudflare routing rules
(no Worker runtime — just header + path manipulation at the edge):

```
https://mcp.rastrum.org  →  https://reppvlqejgoqvitturxp.supabase.co/functions/v1/mcp
```

## Why not a plain CNAME

Supabase uses SNI-based routing — it needs `Host: reppvlqejgoqvitturxp.supabase.co`.
A plain CNAME forwards `Host: mcp.rastrum.org`, which Supabase doesn't recognise.
A Cloudflare Worker would fix that but adds an unnecessary runtime hop for what is
purely a URL rewrite + header override. Cloudflare Rules handle both at the network
layer with zero additional compute.

## Setup (Cloudflare dashboard)

### 1 — DNS

Add a CNAME record in the `rastrum.org` zone:

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `mcp` | `reppvlqejgoqvitturxp.supabase.co` | ✅ Proxied (orange cloud) |

### 2 — Transform Rule (path rewrite)

**Rules → Transform Rules → URL Rewrite → Create rule**

- **When:** `(http.host eq "mcp.rastrum.org")`
- **Path → Rewrite to… Dynamic:**
  ```
  concat("/functions/v1/mcp", http.request.uri.path)
  ```
- Save.

This turns `https://mcp.rastrum.org` → path `/functions/v1/mcp` before the request
leaves Cloudflare.

### 3 — Origin Rule (Host header override)

**Rules → Origin Rules → Create rule**

- **When:** `(http.host eq "mcp.rastrum.org")`
- **Host Header → Override:** `reppvlqejgoqvitturxp.supabase.co`
- Save.

Without this, Cloudflare would forward the original `Host: mcp.rastrum.org` and
Supabase would return 404.

## Verify

```bash
curl -s -X POST https://mcp.rastrum.org \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}' | jq .
# → {"jsonrpc":"2.0","id":1,"result":{}}
```
