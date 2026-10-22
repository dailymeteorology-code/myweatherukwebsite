/* The square detail tiles of the Location page, in the Apple Weather manner: a label, one big
   number, a small picture of it, and a sentence that says what it means. Every value is the
   place's own UKV hour (or the 15-minute analysis for "now"); the sentences only describe them. */
import React from 'react';
import {
  Thermometer, Wind, Sun, Sunset, Droplets, Droplet, Eye, Gauge, Cloud, CloudLightning, Snowflake, Moon, SunMedium, History,
} from 'lucide-react';
import { beaufort, compass, condLabel, hhmm, moonPhase, sunTimes, thunderRisk, ukDay, uvWord, visWord } from '@/lib/ukvLocation';

const Tile = ({ icon: Icon, label, children }) => (
  <div className="lw-glass lw-tile">
    <div className="lw-title"><Icon />{label}</div>
    {children}
  </div>
);

const fmtLen = (h) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min`;
const r1 = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);

function WindDial({ dir, speed }) {
  const ticks = Array.from({ length: 36 }, (_, i) => i * 10);
  return (
    <svg viewBox="0 0 100 100" width="100%" style={{ maxWidth: 118, display: 'block', margin: '0 auto' }} aria-hidden="true">
      {ticks.map((a) => {
        const r = (a * Math.PI) / 180, big = a % 90 === 0;
        return <line key={a} x1={50 + Math.sin(r) * 44} y1={50 - Math.cos(r) * 44} x2={50 + Math.sin(r) * (big ? 38 : 41)} y2={50 - Math.cos(r) * (big ? 38 : 41)} stroke={big ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)'} strokeWidth={big ? 1.6 : 1} />;
      })}
      {[['N', 50, 22], ['E', 80, 53.5], ['S', 50, 84], ['W', 20, 53.5]].map(([l, x, y]) => <text key={l} x={x} y={y} textAnchor="middle" fontSize="8" fontWeight="700" fill="rgba(255,255,255,0.7)">{l}</text>)}
      {dir != null && (
        <g transform={`rotate(${dir + 180} 50 50)`}>
          <line x1="50" y1="88" x2="50" y2="17" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M50 10 L56 21 L44 21 Z" fill="#fff" />
          <circle cx="50" cy="88" r="3.2" fill="#fff" />
        </g>
      )}
      <circle cx="50" cy="50" r="15" fill="rgba(10,20,35,0.55)" />
      <text x="50" y="52" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">{speed == null ? '—' : Math.round(speed)}</text>
      <text x="50" y="60" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.7)">mph</text>
    </svg>
  );
}

function PressureGauge({ hpa, trend }) {
  const lo = 960, hi = 1050, a0 = -135, a1 = 135;
  const ang = (v) => a0 + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (a1 - a0);
  const pt = (a, r) => [50 + Math.sin((a * Math.PI) / 180) * r, 52 - Math.cos((a * Math.PI) / 180) * r];
  const ticks = Array.from({ length: 31 }, (_, i) => a0 + (i * (a1 - a0)) / 30);
  return (
    <svg viewBox="0 0 100 92" width="100%" style={{ maxWidth: 122, display: 'block', margin: '0 auto' }} aria-hidden="true">
      {ticks.map((a, i) => { const [x1, y1] = pt(a, 42), [x2, y2] = pt(a, i % 5 ? 38 : 35); return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.45)" strokeWidth={i % 5 ? 1 : 1.6} />; })}
      {hpa != null && (() => { const [x, y] = pt(ang(hpa), 40); return <circle cx={x} cy={y} r="4" fill="#fff" />; })()}
      <text x="50" y="50" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff">{hpa == null ? '—' : Math.round(hpa)}</text>
      <text x="50" y="60" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.7)">hPa</text>
      <text x="50" y="72" textAnchor="middle" fontSize="11" fill="#fff">{trend > 0 ? '↑' : trend < 0 ? '↓' : '→'}</text>
      <text x="20" y="88" textAnchor="middle" fontSize="6.5" fill="rgba(255,255,255,0.6)">Low</text>
      <text x="80" y="88" textAnchor="middle" fontSize="6.5" fill="rgba(255,255,255,0.6)">High</text>
    </svg>
  );
}

function SunArc({ rise, set, now }) {
  const f = rise && set ? (now - rise) / (set - rise) : null;
  const up = f != null && f >= 0 && f <= 1;
  const x = up ? 8 + f * 84 : f != null && f > 1 ? 92 : 8;
  const y = up ? 46 - Math.sin(f * Math.PI) * 34 : 52;
  return (
    <svg viewBox="0 0 100 60" width="100%" style={{ display: 'block' }} aria-hidden="true">
      <defs>
        <linearGradient id="lwArc" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="rgba(255,214,102,0.35)" /><stop offset="1" stopColor="rgba(255,214,102,0)" /></linearGradient>
      </defs>
      <path d="M8 46 Q50 -22 92 46" fill="url(#lwArc)" stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" />
      <line x1="2" x2="98" y1="46" y2="46" stroke="rgba(255,255,255,0.45)" strokeWidth="1" />
      <circle cx={x} cy={y} r="4.5" fill={up ? '#FFD84D' : 'rgba(255,255,255,0.5)'} stroke={up ? '#fff6c7' : 'none'} strokeWidth="1.5" />
    </svg>
  );
}

function MoonDisc({ phase }) {
  const r = 30, cx = 50, cy = 36, k = Math.cos(2 * Math.PI * phase), right = phase < 0.5;
  const lit = `M${cx},${cy - r} A${r},${r} 0 0 ${right ? 1 : 0} ${cx},${cy + r} A${Math.abs(k) * r},${r} 0 0 ${right ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0)} ${cx},${cy - r}Z`;
  return (
    <svg viewBox="0 0 100 72" width="100%" style={{ display: 'block', maxWidth: 110, margin: '0 auto' }} aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} fill="rgba(20,28,44,0.7)" stroke="rgba(255,255,255,0.18)" />
      <path d={lit} fill="#f3f1e6" />
    </svg>
  );
}

export default function LocationTiles({ model, unit }) {
  const T = (c) => (c == null ? null : unit === 'F' ? (c * 9) / 5 + 32 : c);
  const deg = (c) => (c == null ? '—' : `${Math.round(T(c))}°`);
  const now = model.now, nowMs = Date.now();
  const next = (hrs) => model.full.filter((h) => h.t > nowMs - 30 * 60e3 && h.t <= nowMs + hrs * 36e5);
  const today = model.days[0];
  const n24 = next(24), n12 = next(12);

  /* feels like */
  const dFeel = (now.feels ?? now.t2) - now.t2;
  const feelText = dFeel <= -1.5 ? 'The wind makes it feel colder than it is.' : dFeel >= 1.5 ? 'Humidity makes it feel warmer than it is.' : 'About the same as the actual temperature.';
  /* UV */
  const uvToday = today?.hours.filter((h) => h.full && h.uvi != null) || [];
  const uvPeak = uvToday.reduce((a, b) => (b.uvi > (a?.uvi ?? -1) ? b : a), null);
  const uvNow = now.isDay ? model.hours[model.nowIdx]?.uvi ?? 0 : 0;
  /* sun */
  const st = sunTimes(ukDay(nowMs), model.lat, model.lon);
  const tomorrow = model.days[1] ? sunTimes(model.days[1].day, model.lat, model.lon) : null;
  const nextSun = st.rise && nowMs < st.rise ? ['Sunrise', st.rise] : st.set && nowMs < st.set ? ['Sunset', st.set] : ['Sunrise', tomorrow?.rise];
  const sunDay = st.set && nowMs > st.set && tomorrow ? tomorrow : st;          // after dark, tomorrow's times
  /* rain */
  const rain24 = n24.reduce((s, h) => s + (h.span > 0 ? h.precip ?? 0 : 0), 0);
  const wetDay = model.days.find((d, i) => i > 0 && d.rain >= 1);
  /* pressure trend over the next three hours */
  const p3 = model.full.find((h) => h.t >= nowMs + 3 * 36e5);
  const dp = p3 && now.mslp != null ? p3.mslp - now.mslp : 0;
  const trend = dp >= 1 ? 1 : dp <= -1 ? -1 : 0;
  /* visibility, cloud, thunder, frost */
  const fogSoon = n12.find((h) => h.cond === 'fog');
  const thunder = n24.reduce((m, h) => Math.max(m, h.pThunder ?? 0), 0);
  const cape = n24.reduce((m, h) => Math.max(m, h.cape ?? 0), 0);
  /* the riskiest hour of the next 24 by TCM NOVA, MyWeatherUK's thunderstorm model */
  const novaNext = (model.nova?.hours || []).filter((x) => x.t > nowMs - 30 * 60e3 && x.t <= nowMs + 24 * 36e5);
  const novaPeak = novaNext.length ? novaNext.reduce((a, b) => (b.p > a.p ? b : a)) : null;
  const novaLv = novaPeak && thunderRisk(novaPeak.p);
  const frost = next(18).reduce((a, h) => (h.ground != null && (a == null || h.ground < a.ground) ? h : a), null);
  const lying = model.hours[model.nowIdx]?.snowLying ?? 0;
  const moon = moonPhase(nowMs);
  const swPeak = today?.hours.filter((h) => h.full && h.sw != null).reduce((a, b) => (b.sw > (a?.sw ?? -1) ? b : a), null);
  const cur = model.hours[model.nowIdx] || {};
  const obs = model.observed;

  return (
    <div className="lw-tiles">
      <Tile icon={Thermometer} label="Feels like">
        <div className="lw-big">{deg(now.feels)}</div>
        <div className="lw-foot">{feelText}</div>
      </Tile>

      <Tile icon={Wind} label="Wind">
        <WindDial dir={now.wdir} speed={now.wind} />
        <div className="lw-foot">From the {compass(now.wdir) || '—'}, gusts {now.gust == null ? '—' : Math.round(now.gust)} mph · {beaufort(now.wind).name.toLowerCase()}</div>
      </Tile>

      <Tile icon={Sun} label="UV index">
        <div className="lw-big">{Math.round(uvNow)}</div>
        <div className="lw-word">{uvWord(uvNow)}</div>
        <div style={{ position: 'relative', height: 6, borderRadius: 9, margin: '10px 0 0', background: 'linear-gradient(90deg,#3ccb5b,#f6d03c,#f59a2b,#ef4444,#a855f7)' }}>
          <span style={{ position: 'absolute', top: -2, left: `calc(${Math.min(100, (uvNow / 11) * 100)}% - 5px)`, width: 10, height: 10, borderRadius: 9, background: '#fff', boxShadow: '0 0 0 2px rgba(0,0,0,0.35)' }} />
        </div>
        <div className="lw-foot">
          {!uvPeak || uvPeak.uvi < 0.5 ? 'Low all day.' : uvPeak.t < nowMs ? `Peaked at ${Math.round(uvPeak.uvi)} around ${hhmm(uvPeak.t)}.` : `Peaks at ${Math.round(uvPeak.uvi)} around ${hhmm(uvPeak.t)}.`}
          {uvPeak && uvPeak.uvi >= 3 && uvPeak.t >= nowMs ? ' Sun protection advised in the middle of the day.' : ''}
        </div>
      </Tile>

      <Tile icon={Sunset} label={nextSun[0]}>
        <div className="lw-big">{nextSun[1] ? hhmm(nextSun[1]) : '—'}</div>
        <SunArc rise={st.rise} set={st.set} now={nowMs} />
        <div className="lw-foot">{sunDay.rise ? `${sunDay === st ? 'Today' : 'Tomorrow'}: sunrise ${hhmm(sunDay.rise)}, sunset ${hhmm(sunDay.set)}` : ''}<br />{fmtLen(sunDay.length)} of daylight</div>
      </Tile>

      <Tile icon={Droplets} label="Rain">
        <div className="lw-big">{r1(rain24)}<small>mm</small></div>
        <div className="lw-mini">in the next 24 hours</div>
        <div className="lw-foot">
          {obs?.precip_total != null && <>Today so far {r1(obs.precip_total)} mm (radar). </>}
          {wetDay ? `${wetDay.label}: ${r1(wetDay.rain)} mm expected.` : 'No wetter day in the forecast.'}
        </div>
      </Tile>

      <Tile icon={Droplet} label="Humidity">
        <div className="lw-big">{now.rh == null ? '—' : `${Math.round(now.rh)}%`}</div>
        <div className="lw-foot">The dew point is {deg(now.td)} right now{now.rh >= 95 ? ' and the air is close to saturated.' : now.rh <= 45 ? ', fairly dry air.' : '.'}</div>
      </Tile>

      <Tile icon={Eye} label="Visibility">
        <div className="lw-big">{cur.vis == null ? '—' : r1(cur.vis)}<small>km</small></div>
        <div className="lw-word">{visWord(cur.vis)}</div>
        <div className="lw-foot">{fogSoon ? `Fog likely by ${hhmm(fogSoon.t)}.` : cur.vis != null && cur.vis >= 20 ? 'A clear view all round.' : 'Haze or low cloud is cutting the view.'}</div>
      </Tile>

      <Tile icon={Gauge} label="Pressure">
        <PressureGauge hpa={now.mslp} trend={trend} />
        <div className="lw-foot" style={{ textAlign: 'center' }}>{trend > 0 ? 'Rising' : trend < 0 ? 'Falling' : 'Steady'} over the next three hours</div>
      </Tile>

      {/* The total is now's (satellite and airports, in the analysis); the layers are the UKV's hour,
          labelled so: they used to sit under the total unexplained, and could disagree with it. */}
      <Tile icon={Cloud} label="Cloud cover">
        <div className="lw-big">{now.tcc == null ? '—' : `${Math.round(now.tcc)}%`}</div>
        <div className="lw-word">{now.tcc == null ? '' : condLabel(now.tcc < 12 ? 'clear' : now.tcc < 35 ? 'mostlyClear' : now.tcc < 62 ? 'partly' : now.tcc < 85 ? 'mostlyCloudy' : now.tcc < 96 ? 'cloudy' : 'overcast', now.isDay)}</div>
        <div className="lw-mini" style={{ marginTop: 6 }}>{model.analysis?.tcc != null ? 'Now, by satellite and airport reports. Layers, UKV forecast:' : 'Layers, UKV forecast:'}</div>
        <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
          {[['High', cur.hcc], ['Middle', cur.mcc], ['Low', cur.lcc]].map(([l, v]) => (
            <div key={l} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 34px', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink2)' }}>
              <span>{l}</span>
              <span style={{ height: 5, borderRadius: 9, background: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${Math.round(v ?? 0)}%`, background: 'rgba(255,255,255,0.85)' }} /></span>
              <span style={{ textAlign: 'right' }}>{v == null ? '—' : `${Math.round(v)}%`}</span>
            </div>
          ))}
        </div>
        <div className="lw-foot">{cur.cloudBase != null && (cur.tcc ?? 0) > 20 ? `Cloud base about ${Math.round(cur.cloudBase / 50) * 50} m.` : 'Little or no low cloud.'}</div>
      </Tile>

      {novaPeak ? (
        <Tile icon={CloudLightning} label="Thunder">
          <div className="lw-big" style={novaLv ? { color: novaLv.colour } : undefined}>{Math.round(novaPeak.p)}<small>%</small></div>
          <div className="lw-mini">highest thunderstorm risk, next 24 h · TCM NOVA</div>
          <div className="lw-foot">
            {novaLv ? `${novaLv.word} risk, highest around ${hhmm(novaPeak.t)}.` : 'No thunderstorms expected.'} Storm fuel (CAPE) up to {Math.round(cape)} J/kg.
          </div>
        </Tile>
      ) : (
        <Tile icon={CloudLightning} label="Thunder">
          <div className="lw-big">{thunder}<small>%</small></div>
          <div className="lw-mini">chance of lightning within 16 km, next 24 h</div>
          <div className="lw-foot">{thunder >= 30 ? 'Thunderstorms are possible.' : cape >= 300 ? 'Some storm fuel in the air, but storms are unlikely.' : 'No thunderstorms expected.'} Storm fuel (CAPE) up to {Math.round(cape)} J/kg.</div>
        </Tile>
      )}

      <Tile icon={Snowflake} label="Snow & ice">
        <div className="lw-big">{cur.frz == null ? '—' : Math.round(cur.frz / 10) * 10}<small>m</small></div>
        <div className="lw-mini">freezing level</div>
        <div className="lw-foot">
          {frost && frost.ground <= 0 ? `Ground frost likely by ${hhmm(frost.t)} (${deg(frost.ground)}).` : `No frost expected; the ground stays above ${deg(frost?.ground)}.`}
          {lying > 0.5 ? ` Lying snow: ${Math.round(lying)} mm of water.` : ''}
        </div>
      </Tile>

      <Tile icon={Moon} label="Moon">
        <MoonDisc phase={moon.phase} />
        <div className="lw-word" style={{ textAlign: 'center' }}>{moon.name}</div>
        <div className="lw-foot" style={{ textAlign: 'center' }}>{Math.round(moon.lit * 100)}% lit</div>
      </Tile>

      <Tile icon={SunMedium} label="Sunshine">
        <div className="lw-big">{Math.round(cur.sw ?? 0)}<small>W/m²</small></div>
        <div className="lw-mini">solar power at the ground now</div>
        <div className="lw-foot">{swPeak && swPeak.sw > 20 ? `Strongest around ${hhmm(swPeak.t)} at ${Math.round(swPeak.sw)} W/m².` : 'Little sunshine left today.'}</div>
      </Tile>

      <Tile icon={History} label="Today so far">
        {obs ? (
          <div style={{ display: 'grid', gap: 6, fontSize: 14 }}>
            {[['High', deg(obs.t2_max)], ['Low', deg(obs.t2_min)], ['Rain', obs.precip_total == null ? '—' : `${r1(obs.precip_total)} mm`], ['Max gust', obs.gust10_max == null ? '—' : `${Math.round(obs.gust10_max)} mph`]].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 4 }}><span style={{ color: 'var(--ink2)' }}>{l}</span><b>{v}</b></div>
            ))}
          </div>
        ) : <div className="lw-mini">Observed data for today is not ready yet.</div>}
        <div className="lw-foot lw-mini">Since midnight, from the UKV analysis corrected by station reports and the radar.</div>
      </Tile>
    </div>
  );
}
