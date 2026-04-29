import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLog, saveLog, recordEntry, isAlreadyUploaded, summary } from '../src/log.js';

describe('import log', () => {
  it('loads an empty log when the file does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rastrum-log-'));
    try {
      const log = await loadLog(join(dir, 'missing.json'));
      assert.equal(log.version, 1);
      assert.deepEqual(log.entries, {});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('round-trips entries through save/load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rastrum-log-'));
    const path = join(dir, 'log.json');
    try {
      const log = await loadLog(path);
      recordEntry(log, '/abs/foo.jpg', { status: 'uploaded', observation_id: 'obs1', photo_url: 'https://r2/x.jpg' });
      recordEntry(log, '/abs/bar.jpg', { status: 'failed', error: 'put: 500' });
      await saveLog(path, log);
      const reloaded = await loadLog(path);
      assert.equal(reloaded.entries['/abs/foo.jpg'].status, 'uploaded');
      assert.equal(reloaded.entries['/abs/foo.jpg'].observation_id, 'obs1');
      assert.equal(reloaded.entries['/abs/bar.jpg'].status, 'failed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('isAlreadyUploaded returns true only for status=uploaded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rastrum-log-'));
    try {
      const log = await loadLog(join(dir, 'log.json'));
      recordEntry(log, '/a.jpg', { status: 'uploaded' });
      recordEntry(log, '/b.jpg', { status: 'failed', error: 'x' });
      recordEntry(log, '/c.jpg', { status: 'skipped' });
      assert.equal(isAlreadyUploaded(log, '/a.jpg'), true);
      assert.equal(isAlreadyUploaded(log, '/b.jpg'), false);
      assert.equal(isAlreadyUploaded(log, '/c.jpg'), false);
      assert.equal(isAlreadyUploaded(log, '/missing.jpg'), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('summary tallies by status', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rastrum-log-'));
    try {
      const log = await loadLog(join(dir, 'log.json'));
      recordEntry(log, '/a.jpg', { status: 'uploaded' });
      recordEntry(log, '/b.jpg', { status: 'uploaded' });
      recordEntry(log, '/c.jpg', { status: 'failed', error: 'x' });
      recordEntry(log, '/d.jpg', { status: 'skipped' });
      const s = summary(log);
      assert.deepEqual(s, { uploaded: 2, failed: 1, skipped: 1, total: 4 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
