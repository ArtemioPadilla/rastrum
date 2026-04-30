/**
 * Unit tests for the error_message → severity bucket heuristic used by
 * /console/errors/. The heuristic is intentionally simple — three buckets
 * by string prefix — but it gates the per-row pill color, so getting it
 * wrong silently mispaints a real handler exception as a benign event.
 */

import { describe, it, expect } from 'vitest';
import { errorSeverity, severityColorClass } from '../../src/lib/error-severity';

describe('errorSeverity', () => {
  it('classifies handler_exception as high', () => {
    expect(errorSeverity('handler_exception')).toBe('high');
  });

  it('classifies handler_exception with a suffix as high', () => {
    expect(errorSeverity('handler_exception: division by zero')).toBe('high');
  });

  it('classifies rate_limit_exceeded as medium', () => {
    expect(errorSeverity('rate_limit_exceeded')).toBe('medium');
  });

  it('classifies any rate_limit_* prefix as medium', () => {
    expect(errorSeverity('rate_limit_burst')).toBe('medium');
  });

  it('classifies non-special messages as low', () => {
    expect(errorSeverity('some other thing')).toBe('low');
    expect(errorSeverity('row not found')).toBe('low');
  });

  it('treats null/undefined/empty as low', () => {
    expect(errorSeverity(null)).toBe('low');
    expect(errorSeverity(undefined)).toBe('low');
    expect(errorSeverity('')).toBe('low');
  });

  it('does not match handler_exception_other_word elsewhere — prefix only', () => {
    expect(errorSeverity('something_handler_exception')).toBe('low');
  });
});

describe('severityColorClass', () => {
  it('high → red', () => {
    expect(severityColorClass('high')).toContain('red');
  });
  it('medium → amber', () => {
    expect(severityColorClass('medium')).toContain('amber');
  });
  it('low → zinc', () => {
    expect(severityColorClass('low')).toContain('zinc');
  });
});
