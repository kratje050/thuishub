import { describe, expect, it } from 'vitest';
import { databaseTimestampMs } from './time.js';

describe('database-tijdstempels', () => {
  it('interpreteert SQLite CURRENT_TIMESTAMP expliciet als UTC', () => {
    expect(databaseTimestampMs('2026-07-13 20:15:30')).toBe(Date.UTC(2026, 6, 13, 20, 15, 30));
    expect(databaseTimestampMs('2026-07-13T20:15:30')).toBe(Date.UTC(2026, 6, 13, 20, 15, 30));
  });

  it('behoudt tijdzones in volledige ISO-tijdstempels en weigert ongeldige invoer', () => {
    expect(databaseTimestampMs('2026-07-13T22:15:30+02:00')).toBe(Date.UTC(2026, 6, 13, 20, 15, 30));
    expect(databaseTimestampMs('geen datum')).toBeNaN();
  });
});
