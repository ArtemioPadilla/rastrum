# Journey Catalog

> CI-enforced, provably-complete catalog of every Rastrum route + the
> end-to-end journeys over them. The §1 spine is diffed against
> `routes` (`src/i18n/utils.ts`) ∪ `CONSOLE_TABS.routeKey`
> (`src/lib/console-tabs.ts`) by `tests/unit/journey-catalog-complete.test.ts`
> — a new/removed route fails CI until this file is updated.
>
> Historical point-in-time audit: [`journey-audit-2026-05-15.md`](journey-audit-2026-05-15.md).
> CI policy: [`qa-policy.md`](qa-policy.md).

## How to read

- **Auth**: `anon` (no login) · `authed` (any signed-in user) ·
  `role:admin|moderator|expert` (console/privileged).
- **R/W**: `R` read-only surface · `R+W` has write affordances (a
  read-only sweep must not submit writes here without per-item consent).
- **Spec**: covering `tests/e2e/journey-*.spec.ts`, or `—`.
- **Verified**: `YYYY-MM-DD` of the last real Chrome verification, or
  `never`. Update in-place when you sweep (see §3).

## §1 Route spine

<!-- spine:start -->
| routeKey | EN path | ES path | Auth | R/W | Spec | Verified | Issues |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `about` | /en/about | /es/acerca | anon | R | — | 2026-05-17 |  |
| `chat` | /en/chat | /es/chat | anon | R+W | journey-chat-find-species-and-observe.spec.ts | 2026-05-16 |  |
| `community` | /en/community | /es/comunidad | anon | R | — | 2026-05-17 |  |
| `communityDonate` | /en/community/donate | /es/comunidad/donar | authed | R+W | — | 2026-05-17 | #1148 |
| `communityMap` | /en/community/map | /es/comunidad/mapa | anon | R | — | 2026-05-17 |  |
| `communityObservers` | /en/community/observers | /es/comunidad/observadores | anon | R | — | 2026-05-17 |  |
| `console` | /en/console | /es/consola | role:expert | R+W | — | 2026-05-17 |  |
| `consoleAnomalies` | /en/console/anomalies | /es/consola/anomalias | role:admin | R+W | — | 2026-05-17 |  |
| `consoleApi` | /en/console/api | /es/consola/api | role:admin | R+W | — | 2026-05-17 |  |
| `consoleAudit` | /en/console/audit | /es/consola/auditoria | role:admin | R+W | — | 2026-05-17 |  |
| `consoleBadges` | /en/console/badges | /es/consola/insignias | role:admin | R+W | — | 2026-05-17 |  |
| `consoleBioblitz` | /en/console/bioblitz | /es/consola/bioblitz | role:admin | R+W | — | 2026-05-17 |  |
| `consoleCredentials` | /en/console/credentials | /es/consola/credenciales | role:admin | R+W | — | 2026-05-17 |  |
| `consoleCron` | /en/console/cron | /es/consola/cron | role:admin | R+W | — | 2026-05-17 |  |
| `consoleErrors` | /en/console/errors | /es/consola/errores | role:admin | R+W | — | 2026-05-16 |  |
| `consoleExpertApplications` | /en/console/expert-applications | /es/consola/aplicaciones-expertas | role:admin | R+W | — | 2026-05-17 |  |
| `consoleExpertExpertise` | /en/console/expertise | /es/consola/experiencia | role:expert | R+W | — | 2026-05-17 |  |
| `consoleExpertOverrides` | /en/console/overrides | /es/consola/correcciones | role:expert | R+W | — | 2026-05-17 |  |
| `consoleExpertTaxonNotes` | /en/console/taxon-notes | /es/consola/notas-taxon | role:expert | R+W | — | 2026-05-17 |  |
| `consoleExpertValidation` | /en/console/validation | /es/consola/validacion | role:expert | R+W | — | 2026-05-17 |  |
| `consoleExperts` | /en/console/experts | /es/consola/expertos | role:admin | R+W | — | 2026-05-17 |  |
| `consoleFeatureFlags` | /en/console/features | /es/consola/caracteristicas | role:admin | R+W | — | 2026-05-17 |  |
| `consoleFeedback` | /en/console/feedback | /es/consola/retroalimentacion | role:admin | R+W | — | 2026-05-17 |  |
| `consoleFlags` | /en/console/flags | /es/consola/banderas | role:admin | R+W | — | 2026-05-17 |  |
| `consoleFollows` | /en/console/follows | /es/consola/seguimientos | role:admin | R+W | — | 2026-05-17 |  |
| `consoleForensics` | /en/console/forensics | /es/consola/forenses | role:admin | R+W | — | 2026-05-17 |  |
| `consoleHealth` | /en/console/health | /es/consola/salud | role:admin | R+W | journey-admin-health.spec.ts | 2026-05-16 |  |
| `consoleIdentifications` | /en/console/identifications | /es/consola/identificaciones | role:admin | R+W | — | 2026-05-17 |  |
| `consoleKarma` | /en/console/karma | /es/consola/karma | role:admin | R+W | — | 2026-05-17 |  |
| `consoleMedia` | /en/console/media | /es/consola/medios | role:admin | R+W | — | 2026-05-17 |  |
| `consoleModAppeals` | /en/console/appeals | /es/consola/apelaciones | role:moderator | R+W | — | 2026-05-17 |  |
| `consoleModBans` | /en/console/bans | /es/consola/suspensiones | role:moderator | R+W | — | 2026-05-17 |  |
| `consoleModComments` | /en/console/comments | /es/consola/comentarios | role:moderator | R+W | — | 2026-05-17 |  |
| `consoleModDisputes` | /en/console/disputes | /es/consola/disputas | role:moderator | R+W | — | 2026-05-17 |  |
| `consoleModFlagQueue` | /en/console/flag-queue | /es/consola/cola-banderas | role:moderator | R+W | journey-mod-flags.spec.ts | 2026-05-16 |  |
| `consoleNotifications` | /en/console/notifications | /es/consola/notificaciones | role:admin | R+W | — | 2026-05-17 |  |
| `consoleObservations` | /en/console/observations | /es/consola/observaciones | role:admin | R+W | — | 2026-05-16 | #1112 |
| `consoleProjects` | /en/console/projects | /es/consola/proyectos-admin | role:admin | R+W | — | 2026-05-17 |  |
| `consoleProposals` | /en/console/proposals | /es/consola/propuestas | role:admin | R+W | — | 2026-05-17 |  |
| `consoleSync` | /en/console/sync | /es/consola/sync | role:admin | R+W | — | 2026-05-17 |  |
| `consoleTaxa` | /en/console/taxa | /es/consola/taxa | role:admin | R+W | — | 2026-05-17 |  |
| `consoleTaxonChanges` | /en/console/taxon-changes | /es/consola/cambios-taxon | role:admin | R+W | — | 2026-05-17 |  |
| `consoleUsers` | /en/console/users | /es/consola/usuarios | role:admin | R+W | — | 2026-05-16 |  |
| `consoleWatchlists` | /en/console/watchlists | /es/consola/listas-vigilancia | role:admin | R+W | — | 2026-05-17 |  |
| `consoleWebhooks` | /en/console/webhooks | /es/consola/webhooks | role:admin | R+W | — | 2026-05-17 |  |
| `dex` | /en/profile/dex | /es/perfil/dex | authed | R | journey-falta-dex-region-pool.spec.ts | 2026-05-16 |  |
| `discover` | /en/discover | /es/descubrir | anon | R | — | 2026-05-17 |  |
| `docs` | /en/docs | /es/docs | anon | R | — | 2026-05-17 |  |
| `explore` | /en/explore | /es/explorar | anon | R | journey-guest-browse.spec.ts | 2026-05-16 |  |
| `exploreMap` | /en/explore/map | /es/explorar/mapa | anon | R | — | 2026-05-16 | #1113 |
| `explorePits` | /en/explore/pits | /es/explorar/pits | anon | R | — | 2026-05-17 |  |
| `explorePlaces` | /en/explore/places | /es/explorar/lugares | anon | R | journey-guest-browse.spec.ts | 2026-05-16 |  |
| `exploreRecent` | /en/explore/recent | /es/explorar/recientes | anon | R | journey-guest-browse.spec.ts | 2026-05-16 |  |
| `exploreSpecies` | /en/explore/species | /es/explorar/especies | anon | R | journey-guest-browse.spec.ts | 2026-05-16 |  |
| `exploreSpeciesDetail` | /en/explore/species | /es/explorar/especies | anon | R | — | 2026-05-17 |  |
| `exploreTrails` | /en/explore/trails | /es/explorar/senderos | anon | R | — | 2026-05-17 |  |
| `exploreValidate` | /en/explore/validate | /es/explorar/validar | authed | R+W | — | 2026-05-16 |  |
| `exploreWatchlist` | /en/explore/watchlist | /es/explorar/seguimiento | authed | R | journey-watchlist-rare-species-alert.spec.ts | 2026-05-17 |  |
| `faq` | /en/faq | /es/preguntas-frecuentes | anon | R | — | 2026-05-17 |  |
| `fieldGuide` | /en/explore/trails/field-guide | /es/explorar/senderos/guia-de-campo | anon | R | — | 2026-05-17 | #1130 |
| `home` | /en | /es | anon | R | journey-guest-browse.spec.ts | 2026-05-16 |  |
| `identify` | /en/observe | /es/observar | anon | R+W | — | 2026-05-17 |  |
| `inbox` | /en/inbox | /es/bandeja | authed | R | — | 2026-05-17 |  |
| `leaderboard` | /en/community/leaderboard | /es/comunidad/tabla-de-lideres | anon | R | — | 2026-05-17 |  |
| `observe` | /en/observe | /es/observar | anon | R+W | journey-observer-first-obs.spec.ts | 2026-05-16 |  |
| `privacy` | /en/privacy | /es/privacidad | anon | R | — | 2026-05-17 |  |
| `profile` | /en/profile | /es/perfil | authed | R | — | 2026-05-17 |  |
| `profileAdminExperts` | /en/profile/admin/experts | /es/perfil/admin/expertos | authed | R | — | 2026-05-17 |  |
| `profileAppeal` | /en/profile/appeal | /es/perfil/apelar | authed | R | — | 2026-05-17 |  |
| `profileEdit` | /en/profile/edit | /es/perfil/editar | authed | R+W | — | 2026-05-17 |  |
| `profileExpertApply` | /en/profile/expert-apply | /es/perfil/aplicar-experto | authed | R+W | — | 2026-05-17 |  |
| `profileExport` | /en/profile/export | /es/perfil/exportar | authed | R | journey-researcher-export.spec.ts | 2026-05-16 |  |
| `profileFollowers` | /en/profile/u | /es/perfil/u | authed | R | — | 2026-05-17 |  |
| `profileFollowing` | /en/profile/u | /es/perfil/u | authed | R | — | 2026-05-17 |  |
| `profileImpact` | /en/profile/impact | /es/perfil/impacto | authed | R | — | 2026-05-17 |  |
| `profileImport` | /en/profile/import | /es/perfil/importar | authed | R+W | — | 2026-05-17 |  |
| `profileImportCameraTrap` | /en/profile/import/camera-trap | /es/perfil/importar/camara-trampa | authed | R+W | — | 2026-05-17 |  |
| `profileNotifications` | /en/profile/notifications | /es/perfil/notificaciones | authed | R | — | 2026-05-17 |  |
| `profileObservations` | /en/profile/observations | /es/perfil/observaciones | authed | R | — | 2026-05-17 |  |
| `profileSettings` | /en/profile/settings | /es/perfil/ajustes | authed | R | — | 2026-05-17 |  |
| `profileSettingsData` | /en/profile/settings/data | /es/perfil/ajustes/data | authed | R+W | — | 2026-05-17 |  |
| `profileSettingsDeveloper` | /en/profile/settings/developer | /es/perfil/ajustes/developer | authed | R+W | — | 2026-05-17 |  |
| `profileSettingsPreferences` | /en/profile/settings/preferences | /es/perfil/ajustes/preferences | authed | R+W | — | 2026-05-17 | #1149 |
| `profileSettingsPrivacy` | /en/profile/settings/privacy | /es/perfil/ajustes/privacy | authed | R+W | — | 2026-05-17 |  |
| `profileSettingsProfile` | /en/profile/settings/profile | /es/perfil/ajustes/profile | authed | R+W | — | 2026-05-17 |  |
| `profileTokens` | /en/profile/tokens | /es/perfil/tokens | authed | R+W | — | 2026-05-17 |  |
| `profileUser` | /en/profile/u | /es/perfil/u | authed | R | — | 2026-05-17 |  |
| `profileValidate` | /en/profile/validate | /es/perfil/validar | authed | R+W | — | 2026-05-17 |  |
| `projectNew` | /en/projects/new | /es/proyectos/nuevo | authed | R+W | — | 2026-05-17 |  |
| `projects` | /en/projects | /es/proyectos | anon | R | — | 2026-05-16 |  |
| `publicProfile` | /en/u | /es/u | anon | R | — | 2026-05-16 |  |
| `signIn` | /en/sign-in | /es/ingresar | anon | R | journey-magic-link-pkce-callback.spec.ts | 2026-05-17 |  |
| `sponsoredBy` | /en/profile/sponsored-by | /es/perfil/patrocinado-por | anon | R | — | 2026-05-17 |  |
| `sponsoring` | /en/profile/sponsoring | /es/perfil/patrocinios | authed | R+W | — | 2026-05-17 |  |
| `terms` | /en/terms | /es/terminos | anon | R | — | 2026-05-17 |  |
<!-- spine:end -->

## §2 Journey-flow overlay

End-to-end flows as an ordered `routeKey` sequence → guarding spec.
Reading aid; not drift-checked (every route is already proven present
by §1).

| Flow | Route sequence | Spec |
| --- | --- | --- |
| guest-browse | `home` → `explore` → `exploreRecent` → `explorePlaces` → `exploreSpecies` | `journey-guest-browse.spec.ts` |
| first-observation | `observe` → `profileObservations` → `publicProfile` | `journey-observer-first-obs.spec.ts` |
| identify-cascade | `observe` (photo → cascade UI) | `journey-photo-id-cascade.spec.ts` |
| share-observation | `publicProfile` → `/share/obs/?id=` (locale-neutral) | `journey-share-observation-public.spec.ts` |
| watchlist | `exploreWatchlist` | `journey-watchlist-rare-species-alert.spec.ts` |
| social-engage | `publicProfile` → `inbox` → `profileFollowers` → `profileFollowing` | `journey-social-engage.spec.ts` |
| projects-camera | `projects` → `projectNew` | `journey-projects-create-and-join.spec.ts`, `journey-camera-station-import.spec.ts` |
| researcher-export | `profileExport` | `journey-researcher-export.spec.ts` |
| moderation-triage | `consoleModFlagQueue` → `consoleObservations` | `journey-mod-flags.spec.ts`, `journey-admin-health.spec.ts` |
| falta-dex | `dex` | `journey-falta-dex-region-pool.spec.ts` |
| auth-magic-link | `signIn` → `/auth/callback/` (locale-neutral) | `journey-magic-link-pkce-callback.spec.ts` |
| auth-passkey | `profileSettingsPrivacy` | `journey-passkey-enroll-then-verify.spec.ts` |
| onboarding | `home` (replay tour) | `journey-onboarding-tour-replay.spec.ts` |
| offline-pwa | `observe` (offline) | `journey-observer-offline.spec.ts` |
| mobile-chrome | `home` (mobile viewport) | `journey-mobile-core.spec.ts` |
| chat-ask-rastrum | `chat` (deep-link `?attach=`) | `journey-chat-find-species-and-observe.spec.ts` (model mocked) |

## §3 Sweep procedure

Read-only Chrome, signed-in. Walk §1 top-to-bottom. Per route:
`read_console_messages` with an error pattern + `read_network_requests`
(media/5xx); screenshot visual surfaces (map, observe form, lists).
On a clean route, set its `Verified` cell to the sweep date **in the
same PR**. A route marked `R+W` must not have writes submitted in a
read-only sweep without explicit per-item user consent. New bug → file
an issue, add its `#ref` to the route's `Issues` cell.

`/auth/callback/` and `/share/obs/` are intentionally locale-neutral
(no `routeKey`); they ride the `auth-magic-link` / `share-observation`
flows in §2 and are not §1 spine rows.
