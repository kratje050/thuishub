export function localPlayerVolume(payload: Record<string, unknown>) {
  const value = Number(payload.level ?? payload.value);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}
