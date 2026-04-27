# Security policy

## Reporting a vulnerability

If you find a security issue in Rastrum, please **do not** open a public
GitHub issue. Instead, use one of:

- **Email:** `artemiopadilla@gmail.com` with subject `[rastrum-security]`.
- **GitHub private security advisory:**
  <https://github.com/ArtemioPadilla/rastrum/security/advisories/new>.

Please include enough detail for us to reproduce — affected URL,
payload, expected vs. observed behaviour. PoC code is welcome but not
required.

## Scope

The following surfaces are in scope:

- The deployed website at `https://rastrum.org` and its static assets.
- The Supabase Edge Functions (`identify`, `enrich-environment`,
  `recompute-streaks`, `award-badges`, `share-card`, `get-upload-url`,
  `export-dwca`, `api`, `mcp`).
- The Supabase Postgres database (RLS policies in particular —
  unauthorised reads of sensitive-species precise coordinates are
  always in scope).
- The Cloudflare R2 bucket reachable through `media.rastrum.org`.

## Out of scope

- **Dependency CVEs without a working exploit path through Rastrum.**
  Dependabot covers these; please file a regular issue or PR instead.
- **Cloudflare or Supabase platform issues** — report directly to those
  vendors.
- **Username enumeration via email-based magic links.** Supabase's
  upstream behaviour; intentional within their threat model.
- **Email spoofing of magic links.** Mitigated by SPF/DKIM at the SMTP
  provider; not a Rastrum-controlled surface.
- **Self-XSS that requires the user to paste attacker-supplied code
  into devtools.**

## Disclosure timeline

We aim for the following on confirmed reports:

- Initial acknowledgement: within 3 business days.
- Severity assessment: within 7 business days.
- Fix shipped to production: within 90 days, sooner for criticals.
- Public advisory: published after the fix lands, crediting the reporter
  unless they prefer otherwise.

## Acknowledgements

Rastrum does not currently run a paid bounty program. We do credit
researchers in the GitHub security advisory and (if they consent) in
the changelog. If your employer requires a public reference for
responsible disclosure work, we are happy to provide one.

Thank you for keeping the project safe.
