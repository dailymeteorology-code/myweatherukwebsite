// TCM Sounding — real pressure-level data from Open-Meteo for a point + day.
// POST body: { lat, lon, dayOffset (0..3) }
// Response: { ok, levels:[{pressure,height,temp,dew,wspd,wdir}, ...] }

Deno.serve(async (req) => {
  try {
    const { lat, lon, dayOffset = 0 } = await req.json();
    if (lat == null || lon == null) return Response.json({ ok: false, error: 'lat/lon required' }, { status: 400 });

    const PLEVELS = [1000, 925, 850, 700, 500, 400, 300, 250, 200];
    const hourlyVars = [];
    for (const p of PLEVELS) {
      hourlyVars.push(`temperature_${p}hPa`, `dew_point_${p}hPa`, `wind_speed_${p}hPa`, `wind_direction_${p}hPa`, `geopotential_height_${p}hPa`);
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=${hourlyVars.join(',')}&timezone=UTC&forecast_days=4`;

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return Response.json({ ok: false, error: `OM ${res.status}` }, { status: 502 });
    const data = await res.json();
    const h = data?.hourly || {};
    // Pick afternoon hour (15Z) on requested day
    const hourIdx = dayOffset * 24 + 15;

    const levels = PLEVELS.map(p => ({
      pressure: p,
      height: Math.round(h[`geopotential_height_${p}hPa`]?.[hourIdx] ?? 0),
      temp: +(h[`temperature_${p}hPa`]?.[hourIdx] ?? 0).toFixed(1),
      dew: +(h[`dew_point_${p}hPa`]?.[hourIdx] ?? -50).toFixed(1),
      wspd: +(h[`wind_speed_${p}hPa`]?.[hourIdx] ?? 0).toFixed(1),
      wdir: +(h[`wind_direction_${p}hPa`]?.[hourIdx] ?? 0).toFixed(0),
    })).filter(l => l.temp !== 0 || l.pressure === 1000);

    return Response.json({ ok: true, levels, lat, lon, dayOffset });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
});