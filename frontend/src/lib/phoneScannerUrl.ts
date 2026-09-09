const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export function buildPhoneScannerPageUrl({
  sessionId,
  pageOrigin,
  lanIPv4,
}: {
  sessionId: string;
  pageOrigin: string;
  lanIPv4?: string | null;
}): string {
  const current = new URL(pageOrigin);
  const useLan =
    LOOPBACK.has(current.hostname) && Boolean(lanIPv4);

  const origin = useLan
    ? `${current.protocol}//${lanIPv4}${current.port ? `:${current.port}` : ''}`
    : current.origin;

  return `${origin}/scanner?session=${encodeURIComponent(sessionId)}`;
}
