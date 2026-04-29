const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY');
const OPERATOR_EMAIL  = Deno.env.get('OPERATOR_EMAIL') ?? 'hello@rastrum.org';
const FROM_ADDRESS    = `Rastrum <${OPERATOR_EMAIL}>`;

export interface EmailMessage {
  to:      string;
  subject: string;
  html:    string;
  text?:   string;
  replyTo?: string;
}

export interface EmailResult {
  ok:    boolean;
  id?:   string;
  error?: string;
  skipped?: boolean;
}

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  if (!RESEND_API_KEY) {
    // allowed: log of recipient (no secret content)
    console.warn(`[email] RESEND_API_KEY not set; skipping email to ${msg.to}: "${msg.subject}"`);
    return { ok: false, skipped: true, error: 'no_api_key' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    FROM_ADDRESS,
        to:      [msg.to],
        subject: msg.subject,
        html:    msg.html,
        text:    msg.text,
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `resend_${res.status}: ${body.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, id: (data as { id?: string }).id };
  } catch (e) {
    return { ok: false, error: `network: ${(e as Error).message}` };
  }
}
