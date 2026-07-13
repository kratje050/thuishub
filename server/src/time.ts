const sqliteUtcTimestamp = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)$/;

/** Parses SQLite CURRENT_TIMESTAMP values as UTC instead of local time. */
export function databaseTimestampMs(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = sqliteUtcTimestamp.exec(text);
  const parsed = Date.parse(match ? `${match[1]}T${match[2]}Z` : text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
