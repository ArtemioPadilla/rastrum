# MCP Proxy — mcp.rastrum.org

Cloudflare Worker that exposes the Supabase Edge Function at a clean URL:

```
https://mcp.rastrum.org  →  https://reppvlqejgoqvitturxp.supabase.co/functions/v1/mcp
```

## Why a Worker (not a plain CNAME)

Supabase uses SNI-based routing — it needs the `Host` header to match the project
subdomain. A plain CNAME would send `Host: mcp.rastrum.org`, which Supabase doesn't
recognise. The Worker rewrites the target URL so Cloudflare's fetch sets the correct
host automatically.

## Worker script

Create a new Worker in the Cloudflare dashboard (Workers & Pages → Create) and paste:

```javascript
export default {
  async fetch(request) {
    const UPSTREAM = 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1/mcp';

    const url = new URL(request.url);
    const target = new URL(UPSTREAM);
    // Preserve any path suffix the client may add (e.g. /health)
    target.pathname = UPSTREAM.replace('https://reppvlqejgoqvitturxp.supabase.co', '') + url.pathname.replace(/^\/$/, '');
    target.search = url.search;

    const proxied = new Request(target.toString(), {
      method:  request.method,
      headers: request.headers,
      body:    request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
    });

    return fetch(proxied);
  },
};
```

## Deploy steps

1. **Cloudflare dashboard** → Workers & Pages → Create application → Create Worker
2. Paste the script above → Save and deploy
3. **Settings → Triggers → Custom Domains** → Add `mcp.rastrum.org`
   - Cloudflare will provision the TLS certificate automatically
4. Verify: `curl -X POST https://mcp.rastrum.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'`
   - Should return `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05",...}}`

## DNS

No manual DNS record needed — adding the custom domain in Workers triggers Cloudflare
to create a `AAAA` / `A` record pointing to Workers automatically (orange-cloud).
