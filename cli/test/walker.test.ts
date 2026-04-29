import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkMedia, classifyExt } from '../src/walker.js';

describe('classifyExt', () => {
  it('recognises common image extensions', () => {
    assert.equal(classifyExt('.jpg'), 'image');
    assert.equal(classifyExt('.JPEG'), 'image');
    assert.equal(classifyExt('.heic'), 'image');
    assert.equal(classifyExt('.webp'), 'image');
  });
  it('recognises common video extensions', () => {
    assert.equal(classifyExt('.mp4'), 'video');
    assert.equal(classifyExt('.MOV'), 'video');
  });
  it('returns null for non-media', () => {
    assert.equal(classifyExt('.txt'), null);
    assert.equal(classifyExt('.zip'), null);
    assert.equal(classifyExt(''), null);
  });
});

describe('walkMedia', () => {
  it('finds nested image and video files, skips dotfiles + __MACOSX', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rastrum-walk-'));
    try {
      await mkdir(join(root, 'sub'), { recursive: true });
      await mkdir(join(root, '__MACOSX'), { recursive: true });
      await writeFile(join(root, 'a.jpg'), 'x');
      await writeFile(join(root, 'sub', 'b.MOV'), 'x');
      await writeFile(join(root, 'sub', 'c.txt'), 'x');
      await writeFile(join(root, '.DS_Store'), 'x');
      await writeFile(join(root, '__MACOSX', 'd.jpg'), 'x');
      const found: string[] = [];
      for await (const e of walkMedia(root)) {
        found.push(e.path.replace(root, ''));
      }
      found.sort();
      assert.deepEqual(found, ['/a.jpg', '/sub/b.MOV']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
