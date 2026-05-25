/**
 * PBI 4.2 — post-submit confirmation state + resend affordance.
 *
 * Source-string assertions for SignInForm.astro and i18n parity, in
 * the same shape as `first-observation-cta.test.ts`: the client logic
 * runs inside an Astro `<script>` (not the SSR pass), so we pin the
 * structural contract that matters — i18n keys, the confirmation
 * element id, the 60-second timer constant, and the Send-code
 * disabled-state on success.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const componentSrc = readFileSync(
  join(process.cwd(), 'src/components/SignInForm.astro'),
  'utf8',
);

const enJson = JSON.parse(
  readFileSync(join(process.cwd(), 'src/i18n/en.json'), 'utf8'),
) as Record<string, unknown>;

const esJson = JSON.parse(
  readFileSync(join(process.cwd(), 'src/i18n/es.json'), 'utf8'),
) as Record<string, unknown>;

interface SigninConfirm {
  sent: string;
  resend: string;
  resending: string;
  wait: string;
}

function pickConfirm(doc: Record<string, unknown>): SigninConfirm {
  const signin = doc.signin as Record<string, unknown> | undefined;
  const confirm = signin?.confirm as Record<string, unknown> | undefined;
  return {
    sent: String(confirm?.sent ?? ''),
    resend: String(confirm?.resend ?? ''),
    resending: String(confirm?.resending ?? ''),
    wait: String(confirm?.wait ?? ''),
  };
}

describe('PBI 4.2 — signin confirmation microcopy', () => {
  describe('i18n', () => {
    const en = pickConfirm(enJson);
    const es = pickConfirm(esJson);

    it('exposes signin.confirm.sent in EN with the {email} placeholder + ~30s + spam hint', () => {
      expect(en.sent).toContain('{email}');
      expect(en.sent).toMatch(/~?30s/);
      expect(en.sent.toLowerCase()).toContain('spam');
    });

    it('exposes signin.confirm.sent in ES with the {email} placeholder + ~30s + spam hint', () => {
      expect(es.sent).toContain('{email}');
      expect(es.sent).toMatch(/~?30s/);
      expect(es.sent.toLowerCase()).toContain('spam');
    });

    it('exposes signin.confirm.resend in EN+ES', () => {
      expect(en.resend).toBe('Resend code');
      expect(es.resend).toBe('Reenviar código');
    });

    it('exposes signin.confirm.resending in EN+ES', () => {
      expect(en.resending.length).toBeGreaterThan(0);
      expect(es.resending.length).toBeGreaterThan(0);
    });

    it('exposes signin.confirm.wait in EN+ES with a {seconds} placeholder', () => {
      expect(en.wait).toContain('{seconds}');
      expect(es.wait).toContain('{seconds}');
    });

    it('EN and ES have parity on the four signin.confirm.* keys', () => {
      const enKeys = Object.keys(
        ((enJson.signin as Record<string, unknown>)?.confirm ?? {}) as Record<string, unknown>,
      ).sort();
      const esKeys = Object.keys(
        ((esJson.signin as Record<string, unknown>)?.confirm ?? {}) as Record<string, unknown>,
      ).sort();
      expect(enKeys).toEqual(['resend', 'resending', 'sent', 'wait']);
      expect(esKeys).toEqual(['resend', 'resending', 'sent', 'wait']);
    });
  });

  describe('SignInForm.astro source contract', () => {
    it('renders the confirmation element with id="rastrum-signin-confirmation"', () => {
      expect(componentSrc).toMatch(/id="rastrum-signin-confirmation"/);
    });

    it('uses a data-template attribute pair (en/es) for runtime email interpolation', () => {
      expect(componentSrc).toMatch(/data-template-en=/);
      expect(componentSrc).toMatch(/data-template-es=/);
      expect(componentSrc).toContain('{email}');
    });

    it('encodes a 60-second resend cooldown (60 * 1000)', () => {
      // Either the literal 60_000 or the readable 60 * 1000 form is acceptable.
      const hasMs = /60\s*\*\s*1000/.test(componentSrc) || /60000\b/.test(componentSrc);
      expect(hasMs).toBe(true);
    });

    it('disables the Send code button after a successful submit', () => {
      // The handler must set sendBtn.disabled = true on the success branch,
      // not just during the in-flight request.
      expect(componentSrc).toMatch(/sendBtn\.disabled\s*=\s*true/);
    });

    it('renders a Resend code button (#resend-btn) starting hidden', () => {
      expect(componentSrc).toMatch(/id="resend-btn"/);
      // The Resend button must start hidden — it appears only after the cooldown.
      expect(componentSrc).toMatch(/id="resend-btn"[^>]*class="[^"]*\bhidden\b/);
    });

    it('renders a #resend-wait countdown sibling', () => {
      expect(componentSrc).toMatch(/id="resend-wait"/);
    });

    it('wires the resend handler to re-fire requestEmailOtp', () => {
      // The resend click must reuse the existing requestEmailOtp() helper.
      expect(componentSrc).toMatch(/resendBtn\?\.addEventListener\('click'/);
      expect(componentSrc).toMatch(/requestEmailOtp\(pendingEmail\)/);
    });

    it('only shows the confirmation when the OTP request succeeds', () => {
      // The success branch (post-error early-return) is what triggers the
      // confirmation; an errored request must NOT swap to the code form.
      const idx = componentSrc.indexOf('renderConfirmation(email)');
      const errIdx = componentSrc.indexOf("if (error) {");
      expect(idx).toBeGreaterThan(errIdx);
      expect(errIdx).toBeGreaterThan(-1);
    });
  });
});
