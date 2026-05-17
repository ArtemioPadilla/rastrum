/**
 * #1126 guard — proves the review_requested queue-routing change did
 * NOT perturb consensus / research-grade machinery. Pure string asserts
 * against the schema source; no DB.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(
  resolve(here, '../../docs/specs/infra/supabase-schema.sql'),
  'utf8',
);

describe('#1126 consensus + research-grade floor untouched', () => {
  it('keeps the consensus expert weighting expression verbatim', () => {
    expect(schema).toContain(
      'SUM(CASE WHEN u.is_expert AND t.kingdom = ANY(u.expert_taxa) THEN 3.0 ELSE 1.0 END)',
    );
  });

  it('keeps the research-grade floor guard verbatim', () => {
    expect(schema).toContain(
      'IF NEW.is_research_grade = true AND COALESCE(NEW.confidence, 0) < 0.4 THEN',
    );
  });
});

describe('#1126 validation_queue routing is read-only', () => {
  const m = schema.match(
    /CREATE OR REPLACE VIEW public\.validation_queue AS[\s\S]*?;\n/,
  );

  it('the view definition is locatable', () => {
    expect(m).not.toBeNull();
  });

  const viewDef = m ? m[0] : '';

  it('does not call recompute_consensus', () => {
    expect(viewDef).not.toContain('recompute_consensus');
  });

  it('still gates on the unchanged research-grade column', () => {
    expect(viewDef).toContain('COALESCE(i.is_research_grade, false) = false');
  });

  it('surfaces the new review_requested + kingdom columns', () => {
    expect(viewDef).toContain('o.review_requested');
    expect(viewDef).toContain('t.kingdom');
  });
});

describe('#1128 R3 validation_queue surfaces source, consensus untouched', () => {
  const m = schema.match(
    /CREATE OR REPLACE VIEW public\.validation_queue AS[\s\S]*?;\n/,
  );
  const viewDef = m ? m[0] : '';

  it('still does not call recompute_consensus', () => {
    expect(viewDef).not.toContain('recompute_consensus');
  });

  it('still gates on the unchanged research-grade column', () => {
    expect(viewDef).toContain('COALESCE(i.is_research_grade, false) = false');
  });

  it('still surfaces review_requested + kingdom', () => {
    expect(viewDef).toContain('o.review_requested');
    expect(viewDef).toContain('t.kingdom');
  });

  it('now also surfaces the current ID source (R3 surface)', () => {
    expect(viewDef).toContain('i.source');
  });

  it('keeps the consensus expert weighting + research-grade floor verbatim', () => {
    expect(schema).toContain(
      'SUM(CASE WHEN u.is_expert AND t.kingdom = ANY(u.expert_taxa) THEN 3.0 ELSE 1.0 END)',
    );
    expect(schema).toContain(
      'IF NEW.is_research_grade = true AND COALESCE(NEW.confidence, 0) < 0.4 THEN',
    );
  });
});
