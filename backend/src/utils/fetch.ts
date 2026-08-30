export function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {}
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: init.signal || AbortSignal.timeout(10_000),
  });
}
