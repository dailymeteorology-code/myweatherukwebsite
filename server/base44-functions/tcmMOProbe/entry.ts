// Admin-only probe — drills into a specific order to see its file list.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const BASE = 'https://data.hub.api.metoffice.gov.uk/atmospheric-models/1.0.0';

async function getJson(url, apiKey) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', apikey: apiKey },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 600) }; }
  return { status: res.status, ok: res.ok, data };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (user?.role !== 'admin') return Response.json({ ok: false, error: 'admin only' }, { status: 403 });
  const apiKey = Deno.env.get('MET_OFFICE_TCM_KEY');
  const url = new URL(req.url);
  const orderId = url.searchParams.get('order') || 'o192830823319';
  const out = {};
  out.latest = await getJson(`${BASE}/orders/${orderId}/latest`, apiKey);
  // Get just the first few files truncated
  if (out.latest?.data?.orderDetails?.files) {
    const files = out.latest.data.orderDetails.files;
    out.fileCount = files.length;
    out.sampleFiles = files.slice(0, 8);
    out.uniqueParams = [...new Set(files.map(f => f.fileId || f.id || ''))].slice(0, 30);
  }
  return Response.json({ ok: true, orderId, out });
});