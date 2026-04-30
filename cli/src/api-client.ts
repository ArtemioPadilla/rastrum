/**
 * Thin client for the rst_-token-authenticated REST API.
 * Wraps the three endpoints the CLI uses:
 *   POST /api/upload-url
 *   POST /api/observe
 *   POST /api/identify
 */

export interface ApiClientOpts {
  /** Supabase Edge Function base URL. e.g. https://<proj>.supabase.co/functions/v1 */
  baseUrl: string;
  /** Personal API token (rst_…). */
  token: string;
  /** Optional fetch implementation — useful for tests. */
  fetchImpl?: typeof fetch;
}

export interface UploadUrlResponse {
  key: string;
  upload_url: string;
  public_url: string;
  content_type: string;
}

export interface ObserveResponse {
  id: string;
  observed_at: string;
  created_at: string;
}

export class ApiClient {
  constructor(private readonly opts: ApiClientOpts) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(`${this.opts.baseUrl}/api/${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.opts.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST /api/${path} → ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  uploadUrl(ext: string, contentType?: string): Promise<UploadUrlResponse> {
    return this.post<UploadUrlResponse>('upload-url', { ext, content_type: contentType });
  }

  observe(input: {
    lat?: number | null;
    lng?: number | null;
    observed_at?: string | null;
    notes?: string | null;
    photo_url?: string;
    habitat?: string | null;
    evidence_type?: string;
    scientific_name?: string;
  }): Promise<ObserveResponse> {
    return this.post<ObserveResponse>('observe', input);
  }

  identify(input: {
    image_url: string;
    lat?: number | null;
    lng?: number | null;
    user_hint?: string;
  }): Promise<unknown> {
    return this.post('identify', input);
  }
}

/**
 * PUT raw bytes to a presigned R2 URL. Returns nothing on success;
 * throws with the response status + body excerpt on failure.
 */
export async function putBytes(
  url: string,
  bytes: Uint8Array,
  contentType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  // Wrap in a Blob so Node's undici and browser fetch agree on the body type.
  const body = new Blob([new Uint8Array(bytes)], { type: contentType });
  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PUT ${url} → ${res.status}: ${text.slice(0, 200)}`);
  }
}
