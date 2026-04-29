import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli.js';

describe('parseArgs', () => {
  it('requires --dir', () => {
    assert.throws(() => parseArgs(['--token', 'rst_x', '--baseUrl', 'https://x/']), /--dir/);
  });

  it('requires --token starting with rst_', () => {
    assert.throws(
      () => parseArgs(['--dir', '/x', '--baseUrl', 'https://x/', '--token', 'badprefix']),
      /rst_/
    );
  });

  it('requires --baseUrl (or env var)', () => {
    delete process.env.RASTRUM_BASE_URL;
    assert.throws(
      () => parseArgs(['--dir', '/x', '--token', 'rst_abc']),
      /baseUrl/
    );
  });

  it('parses a complete invocation with flags', () => {
    const args = parseArgs([
      '--dir', '/sd',
      '--baseUrl', 'https://proj.supabase.co/functions/v1',
      '--token', 'rst_abc',
      '--dry-run',
      '--skip-identify',
      '--notes', 'station SJ-CAM-01',
      '--verbose',
    ]);
    assert.equal(args.dir, '/sd');
    assert.equal(args.baseUrl, 'https://proj.supabase.co/functions/v1');
    assert.equal(args.token, 'rst_abc');
    assert.equal(args.dryRun, true);
    assert.equal(args.skipIdentify, true);
    assert.equal(args.notes, 'station SJ-CAM-01');
    assert.equal(args.verbose, true);
    assert.equal(args.logPath, '/sd/import-log.json');
  });

  it('honours --log override', () => {
    const args = parseArgs([
      '--dir', '/sd',
      '--baseUrl', 'https://x/',
      '--token', 'rst_abc',
      '--log', '/var/log/r.json',
    ]);
    assert.equal(args.logPath, '/var/log/r.json');
  });

  it('falls back to env vars for baseUrl + token', () => {
    process.env.RASTRUM_BASE_URL = 'https://env-base/';
    process.env.RASTRUM_TOKEN = 'rst_envtoken';
    const args = parseArgs(['--dir', '/sd']);
    assert.equal(args.baseUrl, 'https://env-base/');
    assert.equal(args.token, 'rst_envtoken');
    delete process.env.RASTRUM_BASE_URL;
    delete process.env.RASTRUM_TOKEN;
  });
});
