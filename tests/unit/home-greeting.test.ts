import { describe, it, expect } from 'vitest';
import { bucketForHour, buildGreeting } from '../../src/lib/home-greeting';

describe('home-greeting', () => {
  describe('bucketForHour', () => {
    it('puts 00:00 in madrugada', () => {
      expect(bucketForHour(0)).toBe('madrugada');
    });
    it('puts 05:59 in madrugada', () => {
      expect(bucketForHour(5)).toBe('madrugada');
    });
    it('puts 06:00 in morning', () => {
      expect(bucketForHour(6)).toBe('morning');
    });
    it('puts 11:00 in morning', () => {
      expect(bucketForHour(11)).toBe('morning');
    });
    it('puts 12:00 in afternoon', () => {
      expect(bucketForHour(12)).toBe('afternoon');
    });
    it('puts 18:00 in afternoon', () => {
      expect(bucketForHour(18)).toBe('afternoon');
    });
    it('puts 19:00 in evening', () => {
      expect(bucketForHour(19)).toBe('evening');
    });
    it('puts 23:00 in evening', () => {
      expect(bucketForHour(23)).toBe('evening');
    });
    it('handles fractional hours by flooring', () => {
      expect(bucketForHour(11.9)).toBe('morning');
      expect(bucketForHour(12.1)).toBe('afternoon');
    });
    it('normalizes negative or out-of-range hours', () => {
      expect(bucketForHour(-1)).toBe('evening');
      expect(bucketForHour(24)).toBe('madrugada');
      expect(bucketForHour(30)).toBe('morning');
    });
  });

  describe('buildGreeting', () => {
    it('appends a comma + name when present', () => {
      expect(buildGreeting(9, 'en', 'Maria')).toBe('Good morning, Maria');
      expect(buildGreeting(9, 'es', 'María')).toBe('Buenos días, María');
    });
    it('omits the comma when name is empty', () => {
      expect(buildGreeting(9, 'en', '')).toBe('Good morning');
      expect(buildGreeting(9, 'es', null)).toBe('Buenos días');
      expect(buildGreeting(9, 'en', undefined)).toBe('Good morning');
    });
    it('trims whitespace in display names', () => {
      expect(buildGreeting(20, 'es', '  Juan  ')).toBe('Buenas noches, Juan');
    });
    it('localizes per bucket', () => {
      expect(buildGreeting(2, 'en', null)).toBe('Up late');
      expect(buildGreeting(2, 'es', null)).toBe('Buenas madrugadas');
      expect(buildGreeting(15, 'en', null)).toBe('Good afternoon');
      expect(buildGreeting(15, 'es', null)).toBe('Buenas tardes');
      expect(buildGreeting(21, 'en', null)).toBe('Good evening');
      expect(buildGreeting(21, 'es', null)).toBe('Buenas noches');
    });
  });
});
