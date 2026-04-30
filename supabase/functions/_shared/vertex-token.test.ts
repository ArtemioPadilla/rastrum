import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { parseServiceAccount, clearCache } from './vertex-token.ts';

Deno.test('parseServiceAccount — accepts a well-formed envelope', () => {
  const sa = parseServiceAccount(JSON.stringify({
    type: 'service_account',
    project_id: 'my-proj',
    private_key_id: 'kid-1',
    private_key: '-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n',
    client_email: 'svc@my-proj.iam.gserviceaccount.com',
  }));
  assertEquals(sa?.project_id, 'my-proj');
  assertEquals(sa?.client_email, 'svc@my-proj.iam.gserviceaccount.com');
});

Deno.test('parseServiceAccount — rejects when type is not service_account', () => {
  const sa = parseServiceAccount(JSON.stringify({
    type: 'authorized_user',
    project_id: 'x',
    private_key: 'x',
    client_email: 'x',
  }));
  assertEquals(sa, null);
});

Deno.test('parseServiceAccount — rejects when required fields are missing', () => {
  assertEquals(parseServiceAccount('{}'), null);
  assertEquals(parseServiceAccount('{"type":"service_account"}'), null);
  assertEquals(parseServiceAccount(JSON.stringify({
    type: 'service_account',
    project_id: 'x',
    private_key_id: 'k',
    private_key: 'pk',
    // missing client_email
  })), null);
});

Deno.test('parseServiceAccount — null on malformed JSON', () => {
  assertEquals(parseServiceAccount(''), null);
  assertEquals(parseServiceAccount('not json'), null);
  assertEquals(parseServiceAccount('ya29.legacy-access-token'), null);
});

Deno.test('clearCache — does not throw on empty cache', () => {
  clearCache();
  clearCache();
});
