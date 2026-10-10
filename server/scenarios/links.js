/**
 * Source link checker. Used by the admin panel and by
 *   npm run scenarios:check-links
 * A link passes on any 2xx/3xx after redirects. Some sites refuse HEAD, so a
 * failed HEAD is retried as GET. Requests run a few at a time to be polite.
 */
export async function checkOne(url, timeoutMs = 20000) {
  const attempt = async (method) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (MyWeatherUK link checker)' } });
      return res.status;
    } catch (e) {
      return 0;
    } finally { clearTimeout(t); }
  };
  let status = await attempt('HEAD');
  if (status === 0 || status >= 400) status = await attempt('GET');
  return status;
}

export async function checkLinks(sources, concurrency = 6) {
  const queue = [...sources];
  const failed = [];
  let ok = 0;
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift();
      const status = await checkOne(s.url);
      if (status >= 200 && status < 400) ok += 1; else failed.push({ id: s.id, url: s.url, status });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { at: new Date().toISOString(), total: sources.length, ok, failed };
}
