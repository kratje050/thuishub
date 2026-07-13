export type HttpErrorPayload = {
  error: string;
  code?: string;
  localStreamingRequired?: true;
};

type ErrorLike = {
  message?: unknown;
  status?: unknown;
  code?: unknown;
  localStreamingRequired?: unknown;
};

function errorLike(error: unknown): ErrorLike {
  return error && typeof error === 'object' ? error as ErrorLike : {};
}

export function httpErrorStatus(error: unknown) {
  const status = Number(errorLike(error).status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

export function httpErrorPayload(error: unknown): HttpErrorPayload {
  const source = errorLike(error);
  const message = typeof source.message === 'string' && source.message.trim()
    ? source.message
    : 'Er ging iets mis.';
  const payload: HttpErrorPayload = { error: message };
  if (typeof source.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(source.code)) payload.code = source.code;
  if (source.localStreamingRequired === true) payload.localStreamingRequired = true;
  return payload;
}
