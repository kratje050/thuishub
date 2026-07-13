import { describe, expect, it } from 'vitest';
import { httpErrorPayload, httpErrorStatus } from './http-errors.js';

describe('HTTP-foutserialisatie', () => {
  it('behoudt veilige machineleesbare foutvelden voor de client', () => {
    const error = Object.assign(new Error('De sessie is gewijzigd.'), {
      status: 409,
      code: 'STALE_PLAYBACK_SESSION',
      localStreamingRequired: true,
      secret: 'mag nooit naar de client',
    });
    expect(httpErrorStatus(error)).toBe(409);
    expect(httpErrorPayload(error)).toEqual({
      error: 'De sessie is gewijzigd.',
      code: 'STALE_PLAYBACK_SESSION',
      localStreamingRequired: true,
    });
  });

  it('weigert ongeldige statuscodes en vrije foutcodes', () => {
    expect(httpErrorStatus({ status: 200 })).toBe(500);
    expect(httpErrorPayload({ message: '', code: 'niet veilig' })).toEqual({ error: 'Er ging iets mis.' });
  });
});
