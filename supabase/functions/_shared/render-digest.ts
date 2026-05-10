/**
 * render-digest.ts — pure function for building weekly digest email content.
 *
 * No Deno or Supabase deps — fully unit-testable in Node/Vitest.
 * Issue #868: Weekly email digest for inactive users.
 */

export interface DigestUser {
  id: string;
  display_name: string | null;
  email: string;
  preferred_language: 'en' | 'es';
  country_code: string | null;
}

export interface FollowerObs {
  scientific_name: string;
  observer_name: string;
  observed_at: string;
  share_url: string;
}

export interface MissingSpecies {
  scientific_name: string;
  common_name: string | null;
}

export interface CommunityStats {
  total_obs_week: number;
  new_species_week: number;
}

export interface DigestData {
  user: DigestUser;
  follower_obs: FollowerObs[];
  missing_species: MissingSpecies[];
  community_stats: CommunityStats;
  rank_delta: number | null; // positive = improved
}

export interface RenderedDigest {
  subject: string;
  html: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso: string, lang: 'en' | 'es'): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function renderDigest(data: DigestData): RenderedDigest {
  const { user, follower_obs, missing_species, community_stats, rank_delta } = data;
  const isEs = user.preferred_language === 'es';
  const lang = isEs ? 'es' : 'en';

  // ── Subject ───────────────────────────────────────────────────────────────
  const subject = isEs
    ? 'Tu resumen semanal de Rastrum'
    : 'Your Rastrum weekly summary';

  // ── Greeting / name ───────────────────────────────────────────────────────
  const name = escapeHtml(user.display_name ?? (isEs ? 'naturalista' : 'naturalist'));

  // ── Rank delta blurb ──────────────────────────────────────────────────────
  let rankBlurbHtml = '';
  let rankBlurbText = '';
  if (rank_delta !== null && rank_delta !== 0) {
    if (isEs) {
      rankBlurbHtml = rank_delta > 0
        ? `<p>📈 Subiste <strong>${rank_delta}</strong> ${rank_delta === 1 ? 'posición' : 'posiciones'} en el ranking esta semana.</p>`
        : `<p>📉 Bajaste <strong>${Math.abs(rank_delta)}</strong> ${Math.abs(rank_delta) === 1 ? 'posición' : 'posiciones'} en el ranking esta semana.</p>`;
      rankBlurbText = rank_delta > 0
        ? `Subiste ${rank_delta} posicion(es) en el ranking esta semana.`
        : `Bajaste ${Math.abs(rank_delta)} posicion(es) en el ranking esta semana.`;
    } else {
      rankBlurbHtml = rank_delta > 0
        ? `<p>📈 You moved up <strong>${rank_delta}</strong> ${rank_delta === 1 ? 'rank' : 'ranks'} this week.</p>`
        : `<p>📉 You moved down <strong>${Math.abs(rank_delta)}</strong> ${Math.abs(rank_delta) === 1 ? 'rank' : 'ranks'} this week.</p>`;
      rankBlurbText = rank_delta > 0
        ? `You moved up ${rank_delta} rank(s) this week.`
        : `You moved down ${Math.abs(rank_delta)} rank(s) this week.`;
    }
  }

  // ── Follower observations table ───────────────────────────────────────────
  const obsHeading = isEs ? 'Observaciones de quienes sigues' : 'Observations from people you follow';
  const noObsMsg = isEs ? 'No hay observaciones recientes de quienes sigues.' : 'No recent observations from people you follow.';

  let obsRowsHtml = '';
  let obsRowsText = '';

  if (follower_obs.length === 0) {
    obsRowsHtml = `<tr><td colspan="3" style="padding:8px;color:#666;">${noObsMsg}</td></tr>`;
    obsRowsText = `  ${noObsMsg}`;
  } else {
    for (const obs of follower_obs) {
      const dateStr = formatDate(obs.observed_at, lang);
      obsRowsHtml += `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">
            <a href="${escapeHtml(obs.share_url)}" style="color:#2563eb;">${escapeHtml(obs.scientific_name)}</a>
          </td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(obs.observer_name)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;white-space:nowrap;">${escapeHtml(dateStr)}</td>
        </tr>`;
      obsRowsText += `  - ${obs.scientific_name} by ${obs.observer_name} on ${dateStr}: ${obs.share_url}\n`;
    }
  }

  const obsTableHtml = `
    <h2 style="font-size:16px;color:#1e293b;">${obsHeading}</h2>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="padding:6px 8px;text-align:left;">${isEs ? 'Especie' : 'Species'}</th>
          <th style="padding:6px 8px;text-align:left;">${isEs ? 'Observador' : 'Observer'}</th>
          <th style="padding:6px 8px;text-align:left;">${isEs ? 'Fecha' : 'Date'}</th>
        </tr>
      </thead>
      <tbody>
        ${obsRowsHtml}
      </tbody>
    </table>`;

  const obsTableText = `${obsHeading}\n${obsRowsText}`;

  // ── Missing species section ───────────────────────────────────────────────
  const missingHeading = isEs ? 'Especies para descubrir cerca de ti' : 'Species to discover near you';
  let missingHtml = '';
  let missingText = '';

  if (missing_species.length > 0) {
    const items = missing_species
      .map((s) => {
        const common = s.common_name ? ` (${escapeHtml(s.common_name)})` : '';
        return `<li style="margin-bottom:4px;"><em>${escapeHtml(s.scientific_name)}</em>${common}</li>`;
      })
      .join('');
    missingHtml = `
      <h2 style="font-size:16px;color:#1e293b;">${missingHeading}</h2>
      <ul style="font-size:14px;padding-left:20px;">${items}</ul>`;

    const itemsText = missing_species
      .map((s) => {
        const common = s.common_name ? ` (${s.common_name})` : '';
        return `  - ${s.scientific_name}${common}`;
      })
      .join('\n');
    missingText = `${missingHeading}\n${itemsText}\n`;
  }

  // ── Community stats ───────────────────────────────────────────────────────
  const statsHeading = isEs ? 'Esta semana en la comunidad' : 'This week in the community';
  const statsTotalLabel = isEs ? 'observaciones' : 'observations';
  const statsNewLabel = isEs ? 'especies nuevas' : 'new species';

  const statsHtml = `
    <h2 style="font-size:16px;color:#1e293b;">${statsHeading}</h2>
    <table cellpadding="0" cellspacing="0" style="font-size:14px;">
      <tr>
        <td style="padding:4px 12px 4px 0;"><strong>${community_stats.total_obs_week.toLocaleString()}</strong></td>
        <td style="padding:4px 0;">${statsTotalLabel}</td>
      </tr>
      <tr>
        <td style="padding:4px 12px 4px 0;"><strong>${community_stats.new_species_week.toLocaleString()}</strong></td>
        <td style="padding:4px 0;">${statsNewLabel}</td>
      </tr>
    </table>`;

  const statsText = `${statsHeading}\n  ${community_stats.total_obs_week} ${statsTotalLabel}\n  ${community_stats.new_species_week} ${statsNewLabel}\n`;

  // ── Unsubscribe footer ────────────────────────────────────────────────────
  const unsubUrl = `https://rastrum.org/${lang}/unsubscribe?token=PLACEHOLDER`;
  const unsubLabel = isEs ? 'Cancelar suscripción' : 'Unsubscribe';
  const unsubNote = isEs
    ? 'Recibiste este correo porque tienes notificaciones por email activadas.'
    : 'You received this email because you have email notifications enabled.';

  const unsubHtml = `
    <p style="font-size:12px;color:#94a3b8;margin-top:24px;">
      ${unsubNote}<br>
      <a href="${unsubUrl}" style="color:#94a3b8;">${unsubLabel}</a>
    </p>`;

  const unsubText = `\n--\n${unsubNote}\n${unsubLabel}: ${unsubUrl}`;

  // ── Greeting ──────────────────────────────────────────────────────────────
  const greetingHtml = isEs
    ? `<p>Hola, <strong>${name}</strong> 👋 — aquí tienes tu resumen semanal de Rastrum.</p>`
    : `<p>Hi, <strong>${name}</strong> 👋 — here's your weekly Rastrum summary.</p>`;
  const greetingText = isEs
    ? `Hola, ${user.display_name ?? 'naturalista'}! Aqui tienes tu resumen semanal de Rastrum.\n`
    : `Hi, ${user.display_name ?? 'naturalist'}! Here's your weekly Rastrum summary.\n`;

  // ── Assemble HTML ─────────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:sans-serif;">
  <table cellpadding="0" cellspacing="0" style="max-width:600px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
    <!-- Header -->
    <tr>
      <td style="background:#16a34a;padding:20px 24px;">
        <span style="color:#fff;font-size:20px;font-weight:bold;">🌿 Rastrum</span>
      </td>
    </tr>
    <!-- Body -->
    <tr>
      <td style="padding:24px;">
        ${greetingHtml}
        ${rankBlurbHtml}
        ${obsTableHtml}
        ${missingHtml}
        ${statsHtml}
        ${unsubHtml}
      </td>
    </tr>
  </table>
</body>
</html>`;

  // ── Assemble plain text ───────────────────────────────────────────────────
  const text = [
    subject,
    '='.repeat(subject.length),
    '',
    greetingText,
    rankBlurbText,
    '',
    obsTableText,
    '',
    missingText,
    statsText,
    unsubText,
  ]
    .filter((l) => l !== undefined)
    .join('\n');

  return { subject, html, text };
}
