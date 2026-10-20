/**
 * LiveStream.jsx — MyWeatherUK broadcast control surface (single-file page)
 * ----------------------------------------------------------------------------
 * A full-screen layout designed to be captured by OBS / streaming software.
 *
 * Layout
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │  [ SCREEN / BROWSER CAPTURE — big ]        │  [ UK MAP ]            │
 *   │                                            │   · radar overlay     │
 *   │                                            │   · MO warning overlay│
 *   │                                            │   · pen + polygon draw│
 *   │  ── social slideshow (YouTube/X/TikTok) ── │                       │
 *   │  ── warning count (R / A / Y) slideshow ── │  [ polygon report —   │
 *   │  ── latest MO warning banner slideshow ──  │    towns/cities, TR ] │
 *   │  [ UK clock · UK lightning strikes ]       │                       │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Everything lives in this one file (no extra components/scripts), per brief.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { loadWarningAreas, matchAreas } from '@/lib/ukWarningAreas';
import { newestUkRadar } from '@/lib/ukRadar';

/* ───────────────────────── Brand tokens ──────────────────────────────── */
const BRAND = {
  navy:    '#0b1220',
  navy2:   '#111c2e',
  panel:   'rgba(17,28,46,0.92)',
  sky:     '#38bdf8',
  sun:     '#f5c211',
  red:     '#e0322f',
  amber:   '#ef8a23',
  yellow:  '#f5c211',
  text:    '#f8fafc',
  textMid: '#94a3b8',
  line:    'rgba(56,189,248,0.18)',
};

const SEVERITY = {
  Red:    { key: 'Red',    color: '#e0322f', glow: 'rgba(224,50,47,0.55)',  label: 'Red' },
  Amber:  { key: 'Amber',  color: '#ef8a23', glow: 'rgba(239,138,35,0.5)',  label: 'Amber' },
  Yellow: { key: 'Yellow', color: '#f5c211', glow: 'rgba(245,194,17,0.45)', label: 'Yellow' },
};

const WARNING_TYPES = ['Rain', 'Wind', 'Snow', 'Ice', 'Thunderstorm', 'Fog', 'Flood', 'Extreme Heat', 'Lightning'];

const RENDER_WORKER_HTTP = 'https://blitzortungworker-3.onrender.com';

/* ───────── UK towns & cities (used for the polygon report) ─────────────
 * A representative gazetteer of UK settlements with coordinates. Not every
 * hamlet — but every city and major/medium town, enough that any drawn
 * polygon over populated areas resolves to a meaningful list. */
const UK_PLACES = [
  ['London',51.5074,-0.1278],['Birmingham',52.4862,-1.8904],['Manchester',53.4808,-2.2426],
  ['Leeds',53.8008,-1.5491],['Liverpool',53.4084,-2.9916],['Sheffield',53.3811,-1.4701],
  ['Bristol',51.4545,-2.5879],['Newcastle upon Tyne',54.9783,-1.6178],['Nottingham',52.9548,-1.1581],
  ['Leicester',52.6369,-1.1398],['Coventry',52.4068,-1.5197],['Bradford',53.7960,-1.7594],
  ['Cardiff',51.4816,-3.1791],['Belfast',54.5973,-5.9301],['Edinburgh',55.9533,-3.1883],
  ['Glasgow',55.8642,-4.2518],['Aberdeen',57.1497,-2.0943],['Dundee',56.4620,-2.9707],
  ['Inverness',57.4778,-4.2247],['Stirling',56.1165,-3.9369],['Perth',56.3950,-3.4308],
  ['Swansea',51.6214,-3.9436],['Newport',51.5842,-2.9977],['Wrexham',53.0430,-2.9925],
  ['Southampton',50.9097,-1.4044],['Portsmouth',50.8198,-1.0880],['Brighton',50.8225,-0.1372],
  ['Plymouth',50.3755,-4.1427],['Exeter',50.7184,-3.5339],['Bournemouth',50.7192,-1.8808],
  ['Reading',51.4543,-0.9781],['Oxford',51.7520,-1.2577],['Cambridge',52.2053,0.1218],
  ['Milton Keynes',52.0406,-0.7594],['Norwich',52.6309,1.2974],['Ipswich',52.0567,1.1482],
  ['Luton',51.8787,-0.4200],['Northampton',52.2405,-0.9027],['Peterborough',52.5695,-0.2405],
  ['York',53.9590,-1.0815],['Hull',53.7676,-0.3274],['Middlesbrough',54.5742,-1.2350],
  ['Sunderland',54.9069,-1.3838],['Durham',54.7761,-1.5733],['Carlisle',54.8924,-2.9320],
  ['Lancaster',54.0466,-2.8007],['Preston',53.7632,-2.7031],['Blackpool',53.8175,-3.0357],
  ['Blackburn',53.7486,-2.4823],['Bolton',53.5769,-2.4282],['Wigan',53.5450,-2.6318],
  ['Stockport',53.4106,-2.1575],['Oldham',53.5409,-2.1114],['Rochdale',53.6097,-2.1561],
  ['Warrington',53.3900,-2.5970],['St Helens',53.4534,-2.7370],['Chester',53.1934,-2.8931],
  ['Stoke-on-Trent',53.0027,-2.1794],['Derby',52.9226,-1.4746],['Wolverhampton',52.5870,-2.1288],
  ['Walsall',52.5862,-1.9829],['Dudley',52.5120,-2.0810],['West Bromwich',52.5187,-1.9945],
  ['Telford',52.6784,-2.4453],['Shrewsbury',52.7069,-2.7553],['Worcester',52.1920,-2.2200],
  ['Hereford',52.0567,-2.7160],['Gloucester',51.8642,-2.2380],['Cheltenham',51.8994,-2.0783],
  ['Swindon',51.5558,-1.7797],['Bath',51.3811,-2.3590],['Salisbury',51.0688,-1.7945],
  ['Yeovil',50.9430,-2.6320],['Taunton',51.0150,-3.1010],['Bridgwater',51.1280,-2.9930],
  ['Weston-super-Mare',51.3460,-2.9770],['Truro',50.2632,-5.0510],['Penzance',50.1188,-5.5370],
  ['St Austell',50.3390,-4.7900],['Newquay',50.4150,-5.0730],['Barnstaple',51.0800,-4.0590],
  ['Torquay',50.4619,-3.5253],['Paignton',50.4360,-3.5640],['Weymouth',50.6140,-2.4570],
  ['Poole',50.7150,-1.9870],['Chichester',50.8370,-0.7740],['Worthing',50.8100,-0.3720],
  ['Eastbourne',50.7687,0.2840],['Hastings',50.8550,0.5730],['Crawley',51.1090,-0.1870],
  ['Guildford',51.2360,-0.5700],['Woking',51.3190,-0.5580],['Basingstoke',51.2620,-1.0870],
  ['Winchester',51.0630,-1.3080],['Aldershot',51.2480,-0.7610],['Maidstone',51.2720,0.5290],
  ['Canterbury',51.2800,1.0790],['Dover',51.1295,1.3089],['Folkestone',51.0810,1.1660],
  ['Margate',51.3810,1.3860],['Ashford',51.1465,0.8750],['Chatham',51.3800,0.5200],
  ['Gravesend',51.4410,0.3700],['Tunbridge Wells',51.1320,0.2630],['Sevenoaks',51.2720,0.1900],
  ['Slough',51.5105,-0.5950],['Watford',51.6560,-0.3960],['Hemel Hempstead',51.7530,-0.4490],
  ['St Albans',51.7550,-0.3360],['Stevenage',51.9020,-0.2020],['Hatfield',51.7630,-0.2280],
  ['Welwyn Garden City',51.8020,-0.2050],['Harlow',51.7680,0.0930],['Chelmsford',51.7360,0.4790],
  ['Colchester',51.8890,0.9040],['Southend-on-Sea',51.5460,0.7080],['Basildon',51.5720,0.4690],
  ['Braintree',51.8780,0.5520],['Clacton-on-Sea',51.7920,1.1550],['Bury St Edmunds',52.2470,0.7110],
  ['Lowestoft',52.4750,1.7510],['Great Yarmouth',52.6080,1.7300],["King's Lynn",52.7510,0.3980],
  ['Wisbech',52.6640,0.1590],['Boston',52.9740,-0.0260],['Lincoln',53.2307,-0.5406],
  ['Grimsby',53.5675,-0.0780],['Scunthorpe',53.5890,-0.6540],['Doncaster',53.5228,-1.1285],
  ['Rotherham',53.4302,-1.3568],['Barnsley',53.5526,-1.4797],['Wakefield',53.6833,-1.4977],
  ['Huddersfield',53.6450,-1.7798],['Halifax',53.7220,-1.8590],['Dewsbury',53.6910,-1.6330],
  ['Harrogate',53.9919,-1.5378],['Scarborough',54.2830,-0.3980],['Grantham',52.9120,-0.6420],
  ['Mansfield',53.1440,-1.1980],['Chesterfield',53.2350,-1.4210],['Newark-on-Trent',53.0760,-0.8090],
  ['Kettering',52.3980,-0.7250],['Corby',52.4880,-0.7020],['Wellingborough',52.3020,-0.6940],
  ['Rugby',52.3700,-1.2650],['Nuneaton',52.5230,-1.4680],['Tamworth',52.6330,-1.6950],
  ['Lichfield',52.6820,-1.8270],['Cannock',52.6910,-2.0270],['Stafford',52.8060,-2.1170],
  ['Burton upon Trent',52.8020,-1.6360],['Redditch',52.3070,-1.9420],['Kidderminster',52.3880,-2.2490],
  ['Bromsgrove',52.3350,-2.0590],['Solihull',52.4120,-1.7780],['Banbury',52.0610,-1.3400],
  ['Bedford',52.1360,-0.4670],['Aylesbury',51.8160,-0.8130],['High Wycombe',51.6290,-0.7490],
  ['Maidenhead',51.5220,-0.7180],['Bracknell',51.4160,-0.7530],['Newbury',51.4010,-1.3230],
  ['Andover',51.2110,-1.4800],['Farnborough',51.2930,-0.7560],['Camberley',51.3350,-0.7420],
  ['Llanelli',51.6840,-4.1630],['Neath',51.6600,-3.8060],['Port Talbot',51.5920,-3.7860],
  ['Bridgend',51.5040,-3.5770],['Pontypridd',51.6010,-3.3420],['Merthyr Tydfil',51.7490,-3.3780],
  ['Aberystwyth',52.4150,-4.0830],['Bangor',53.2280,-4.1290],['Llandudno',53.3240,-3.8270],
  ['Rhyl',53.3210,-3.4910],['Colwyn Bay',53.2950,-3.7270],['Caernarfon',53.1410,-4.2770],
  ['Carmarthen',51.8560,-4.3110],['Haverfordwest',51.8010,-4.9690],['Cwmbran',51.6530,-3.0220],
  ['Ebbw Vale',51.7800,-3.2080],['Caerphilly',51.5760,-3.2180],['Barry',51.4050,-3.2700],
  ['Paisley',55.8470,-4.4240],['East Kilbride',55.7640,-4.1770],['Livingston',55.8830,-3.5230],
  ['Hamilton',55.7770,-4.0390],['Cumbernauld',55.9450,-3.9940],['Kirkcaldy',56.1130,-3.1600],
  ['Dunfermline',56.0720,-3.4520],['Ayr',55.4580,-4.6290],['Kilmarnock',55.6110,-4.4960],
  ['Greenock',55.9540,-4.7610],['Falkirk',56.0010,-3.7850],['Motherwell',55.7880,-3.9920],
  ['Coatbridge',55.8620,-4.0250],['Airdrie',55.8660,-3.9810],['Irvine',55.6190,-4.6660],
  ['Dumfries',55.0700,-3.6030],['Elgin',57.6500,-3.3160],['Fort William',56.8190,-5.1050],
  ['Oban',56.4150,-5.4720],['Stranraer',54.9020,-5.0270],['Wick',58.4390,-3.0930],
  ['Lerwick',60.1550,-1.1450],['Kirkwall',58.9810,-2.9590],['Stornoway',58.2090,-6.3870],
  ['Londonderry',54.9966,-7.3086],['Lisburn',54.5120,-6.0580],['Newtownabbey',54.6790,-5.9010],
  ['Bangor (NI)',54.6530,-5.6700],['Craigavon',54.4470,-6.3870],['Ballymena',54.8640,-6.2790],
  ['Newry',54.1750,-6.3390],['Carrickfergus',54.7150,-5.8070],['Coleraine',55.1320,-6.6680],
  ['Antrim',54.7180,-6.2070],['Omagh',54.6010,-7.3090],['Enniskillen',54.3440,-7.6310],
  ['Armagh',54.3500,-6.6530],['Larne',54.8570,-5.8240],['Banbridge',54.3490,-6.2700],
];

/* ───────────────────────── helpers ────────────────────────────────────── */
function pointInPolygon(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1];
    const yj = poly[j][0], xj = poly[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function strikeTimeMs(t) {
  const n = Number(t);
  if (!Number.isFinite(n)) return NaN;
  if (n > 1e15) return Math.floor(n / 1e6);
  if (n > 1e12) return n;
  if (n > 1e9)  return n * 1000;
  return n;
}

function loadScriptOnce(src, id) {
  return new Promise((resolve, reject) => {
    if (id && document.getElementById(id)) return resolve();
    const s = document.createElement('script');
    if (id) s.id = id;
    s.src = src;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ════════════════════════════ PAGE ════════════════════════════════════ */
/* Error boundary — if anything inside throws at runtime, show a readable
 * message on the broadcast surface instead of a blank white screen. */
class LiveStreamBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[LiveStream] crashed:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: '#0b1220', color: '#f8fafc',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Inter, system-ui, sans-serif', padding: 24, textAlign: 'center', zIndex: 99999,
        }}>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Live Stream hit an error</div>
          <div style={{ color: '#94a3b8', fontSize: 13, maxWidth: 520, marginBottom: 16 }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
          <button onClick={() => this.setState({ error: null })} style={{
            padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: '#38bdf8', color: '#04121f', fontWeight: 800, fontSize: 14,
          }}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function LiveStream() {
  return (
    <LiveStreamBoundary>
      <LiveStreamInner />
    </LiveStreamBoundary>
  );
}

function LiveStreamInner() {
  /* ───── data state ───── */
  const [warnings, setWarnings] = useState([]);
  const [ukStrikes, setUkStrikes] = useState(0);
  const [clock, setClock] = useState(new Date());

  /* ───── screen capture ───── */
  const screenVideoRef = useRef(null);
  const screenStreamRef = useRef(null);
  const [capturing, setCapturing] = useState(false);

  /* ───── map ───── */
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const radarLayerRef = useRef(null);
  const moWarnLayerRef = useRef(null);
  const drawLayerRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  /* ───── map controls ───── */
  const [radarOn, setRadarOn] = useState(true);
  const [radarTime, setRadarTime] = useState(null);   // the shown scan's time
  const radarRun = useRef({ gen: 0, url: null });
  const [moWarnOn, setMoWarnOn] = useState(true);
  const [typeFilter, setTypeFilter] = useState(new Set(WARNING_TYPES));
  const [sevFilter, setSevFilter] = useState(new Set(['Red', 'Amber', 'Yellow']));

  /* ───── drawing ───── */
  const [drawMode, setDrawMode] = useState('off');
  const [drawColor, setDrawColor] = useState('#e0322f');
  const penPathRef = useRef(null);
  const polyPointsRef = useRef([]);
  const polyTempRef = useRef(null);
  const [polygonReport, setPolygonReport] = useState(null);
  const [polyDesc, setPolyDesc] = useState('');

  /* ───── slideshow indices ───── */
  const [bannerIdx, setBannerIdx] = useState(0);
  const [countIdx, setCountIdx] = useState(0);
  const [socialIdx, setSocialIdx] = useState(0);

  /* derived warning counts */
  const counts = { Red: 0, Amber: 0, Yellow: 0 };
  const now = Date.now();
  const activeWarnings = (warnings || []).filter(w => {
    const to = w.validTo ? new Date(w.validTo).getTime() : Infinity;
    return to >= now;
  });
  activeWarnings.forEach(w => {
    const s = w.severity && counts[w.severity] !== undefined ? w.severity : 'Yellow';
    counts[s]++;
  });

  /* ─────────────────────── clock tick ─────────────────────── */
  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  /* ─────────────────────── warnings fetch ─────────────────────── */
  useEffect(() => {
    let cancelled = false;
    const fetchWarnings = async () => {
      try {
        const res = await base44.functions.invoke('getMetOfficeWarnings', {});
        const data = res?.data || res;
        const list = data?.all_warnings || data?.warnings || (Array.isArray(data) ? data : []);
        if (!cancelled && Array.isArray(list)) setWarnings(list);
      } catch (_) {}
    };
    fetchWarnings();
    const iv = setInterval(fetchWarnings, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  /* ─────────────────────── lightning count ─────────────────────── */
  useEffect(() => {
    let cancelled = false;
    const todayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
    const fetchCount = async () => {
      try {
        const tStart = todayStart();
        const [ukRes, workerRes] = await Promise.allSettled([
          base44.functions.invoke('historicalLightning', { region: 'uk', daysBack: 0 }),
          fetch(`${RENDER_WORKER_HTTP}/strikes`).then(r => (r.ok ? r.json() : [])).then(b => (Array.isArray(b) ? b : b?.strikes || [])).catch(() => []),
        ]);
        const seen = new Set();
        let n = 0;
        const add = (lat, lon, time) => {
          if (lat == null || lon == null) return;
          const t = strikeTimeMs(time);
          if (!Number.isFinite(t) || t < tStart) return;
          if (lat < 49.5 || lat > 61.0 || lon < -10.8 || lon > 2.5) return;
          const k = `${Math.round(t / 1000)}_${Math.round(lat * 1000)}_${Math.round(lon * 1000)}`;
          if (seen.has(k)) return;
          seen.add(k); n++;
        };
        if (ukRes.status === 'fulfilled') {
          const s = ukRes.value?.data?.strikes || ukRes.value?.strikes || [];
          s.forEach(x => add(x.lat, x.lon, x.time));
        }
        if (workerRes.status === 'fulfilled' && Array.isArray(workerRes.value)) {
          workerRes.value.forEach(x => add(x.lat, x.lon, x.time));
        }
        if (!cancelled) setUkStrikes(n);
      } catch (_) {}
    };
    fetchCount();
    const iv = setInterval(fetchCount, 20 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  /* ─────────────────────── slideshows (10s each) ─────────────────────── */
  useEffect(() => {
    const iv = setInterval(() => setBannerIdx(i => i + 1), 10000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    const iv = setInterval(() => setCountIdx(i => i + 1), 10000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    const iv = setInterval(() => setSocialIdx(i => i + 1), 10000);
    return () => clearInterval(iv);
  }, []);

  /* ─────────────────────── Leaflet map init ─────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!document.getElementById('leaflet-css')) {
        const l = document.createElement('link');
        l.id = 'leaflet-css'; l.rel = 'stylesheet';
        l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(l);
      }
      if (!window.L) {
        await loadScriptOnce('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'leaflet-js').catch(() => {});
      }
      if (cancelled || !window.L || !mapElRef.current || mapRef.current) return;
      const L = window.L;
      const map = L.map(mapElRef.current, {
        center: [54.5, -3.0], zoom: 6, zoomControl: false, attributionControl: false,
        preferCanvas: true,
      });
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        subdomains: 'abcd', maxZoom: 19, detectRetina: true,
      }).addTo(map);
      /* the radar gets its own pane between the base map and the overlays, so the warning shapes
         and drawings always sit on top of it */
      map.createPane('lsRadar').style.zIndex = 350;
      radarLayerRef.current  = L.layerGroup().addTo(map);
      moWarnLayerRef.current = L.layerGroup().addTo(map);
      drawLayerRef.current   = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  /* ─────────────────────── radar overlay ───────────────────────
     The Met Office 1 km radar (the newest 15-minute scan, from the AWS bucket via this server),
     in the Model Data page's colours: the same radar the home page and Location Weather show.
     It covers the UK, Ireland and the near continent. A newer scan replaces the old one only once
     it is drawn, so the map never blanks; a refresh that loses a race to a newer one is dropped. */
  const refreshRadar = useCallback(async () => {
    const L = window.L;
    const layer = radarLayerRef.current;
    if (!L || !layer) return;
    const run = radarRun.current;
    const gen = ++run.gen;
    if (!radarOn) {
      layer.clearLayers();
      if (run.url) { URL.revokeObjectURL(run.url); run.url = null; }
      return;
    }
    try {
      const r = await newestUkRadar({ width: 900 });
      if (!r) return;
      if (gen !== run.gen || !radarLayerRef.current) { URL.revokeObjectURL(r.url); return; }
      layer.clearLayers();
      if (run.url) URL.revokeObjectURL(run.url);
      run.url = r.url;
      L.imageOverlay(r.url, r.bounds, { pane: 'lsRadar', opacity: 0.85, interactive: false }).addTo(layer);
      setRadarTime(r.valid);
    } catch (_) { /* radar unavailable: keep the last scan up */ }
  }, [radarOn]);

  useEffect(() => {
    if (!mapReady) return undefined;
    refreshRadar();
    const iv = setInterval(refreshRadar, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [mapReady, refreshRadar]);
  useEffect(() => () => { const run = radarRun.current; run.gen++; if (run.url) URL.revokeObjectURL(run.url); }, []);

  /* ─────────────────────── Met Office warning overlay ───────────────────────
     Each warning in force, in its severity's colour: its own shape from the Met
     Office feed where it has one, else the council areas it names (dashed, as
     they are approximate). This used to lay the Met Office's warning-map PNG
     over the UK; that image is gone (404), so the toggle showed nothing. */
  useEffect(() => {
    const L = window.L;
    const layer = moWarnLayerRef.current;
    if (!mapReady || !L || !layer) return undefined;
    layer.clearLayers();
    if (!moWarnOn) return undefined;
    const t = Date.now();
    const typeOk = (w) => {
      const ty = String(w.type || w.weatherType || '').toLowerCase();
      const known = WARNING_TYPES.find((k) => ty.includes(k.toLowerCase().replace(/s$/, '')));
      return known ? typeFilter.has(known) : typeFilter.size > 0;
    };
    const shown = (warnings || []).filter((w) => {
      const to = w.validTo ? new Date(w.validTo).getTime() : Infinity;
      return to >= t && sevFilter.has(SEVERITY[w.severity] ? w.severity : 'Yellow') && typeOk(w);
    });
    let live = true;
    const colour = (w) => (SEVERITY[w.severity] || SEVERITY.Yellow).color;
    const approx = [];
    shown.forEach((w) => {
      const geoms = (Array.isArray(w.polygons) && w.polygons.length ? w.polygons : [w.geometry])
        .filter((g) => g && (g.type === 'Polygon' || g.type === 'MultiPolygon'));
      if (!geoms.length) { approx.push(w); return; }
      geoms.forEach((g) => {
        try {
          L.geoJSON(g, { interactive: false, style: { color: colour(w), weight: 2, opacity: 0.95, fillColor: colour(w), fillOpacity: 0.28 } }).addTo(layer);
        } catch (_) { /* a malformed shape is skipped */ }
      });
    });
    if (approx.length) {
      loadWarningAreas().then((all) => {
        if (!live) return;
        approx.forEach((w) => {
          const names = Array.isArray(w.counties) && w.counties.length ? w.counties : Array.isArray(w.regions) ? w.regions : (w.region ? [w.region] : []);
          matchAreas(all, names).forEach((a) => a.rings.forEach((ring) => {
            L.polygon(ring, { interactive: false, color: colour(w), weight: 1.4, opacity: 0.8, dashArray: '6, 5', fillColor: colour(w), fillOpacity: 0.18 }).addTo(layer);
          }));
        });
      }).catch(() => {});
    }
    return () => { live = false; };
  }, [mapReady, moWarnOn, typeFilter, sevFilter, warnings]);

  /* ─────────────────────── drawing interactions ─────────────────────── */
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!mapReady || !L || !map) return;

    if (drawMode === 'off') { map.dragging.enable(); }
    else { map.dragging.disable(); }

    const onDown = (e) => {
      if (drawMode === 'pen') {
        penPathRef.current = L.polyline([e.latlng], { color: drawColor, weight: 4, opacity: 0.95 }).addTo(drawLayerRef.current);
        map.on('mousemove', onPenMove);
        map.once('mouseup', onPenUp);
      } else if (drawMode === 'polygon') {
        polyPointsRef.current.push([e.latlng.lat, e.latlng.lng]);
        redrawTempPoly();
      }
    };
    const onPenMove = (e) => { if (penPathRef.current) penPathRef.current.addLatLng(e.latlng); };
    const onPenUp = () => { map.off('mousemove', onPenMove); penPathRef.current = null; };

    const redrawTempPoly = () => {
      if (polyTempRef.current) { drawLayerRef.current.removeLayer(polyTempRef.current); }
      if (polyPointsRef.current.length >= 1) {
        polyTempRef.current = L.polygon(polyPointsRef.current, {
          color: drawColor, weight: 3, fillColor: drawColor, fillOpacity: 0.18, dashArray: '6 5',
        }).addTo(drawLayerRef.current);
      }
    };

    if (drawMode !== 'off') map.on('mousedown', onDown);
    return () => {
      map.off('mousedown', onDown);
      map.off('mousemove', onPenMove);
    };
  }, [mapReady, drawMode, drawColor]);

  /* finalize polygon → compute towns/cities inside */
  const finishPolygon = useCallback(() => {
    const L = window.L;
    const pts = polyPointsRef.current;
    if (!L || pts.length < 3) return;
    if (polyTempRef.current) drawLayerRef.current.removeLayer(polyTempRef.current);
    polyTempRef.current = null;
    L.polygon(pts, { color: drawColor, weight: 3, fillColor: drawColor, fillOpacity: 0.22 }).addTo(drawLayerRef.current);
    const inside = UK_PLACES
      .filter(([, lat, lon]) => pointInPolygon(lat, lon, pts))
      .map(([name]) => name)
      .sort();
    setPolygonReport({ color: drawColor, places: inside, desc: polyDesc });
    polyPointsRef.current = [];
  }, [drawColor, polyDesc]);

  const clearDrawing = useCallback(() => {
    if (drawLayerRef.current) drawLayerRef.current.clearLayers();
    polyPointsRef.current = [];
    polyTempRef.current = null;
    penPathRef.current = null;
    setPolygonReport(null);
  }, []);

  /* ─────────────────────── screen capture ─────────────────────── */
  const startCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 }, audio: false,
      });
      screenStreamRef.current = stream;
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
        await screenVideoRef.current.play().catch(() => {});
      }
      setCapturing(true);
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        setCapturing(false);
        screenStreamRef.current = null;
      });
    } catch (_) {}
  }, []);

  const stopCapture = useCallback(() => {
    const s = screenStreamRef.current;
    if (s) s.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
    setCapturing(false);
  }, []);

  /* ─────────────────────── slideshow content ─────────────────────── */
  const sevRank = { Red: 0, Amber: 1, Yellow: 2 };
  const bannerSlides = [...activeWarnings].sort((a, b) =>
    (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3)
  );
  const curBanner = bannerSlides.length ? bannerSlides[bannerIdx % bannerSlides.length] : null;

  const countSlides = [SEVERITY.Red, SEVERITY.Amber, SEVERITY.Yellow];
  const curCount = countSlides[countIdx % countSlides.length];

  const socials = [
    { net: 'YouTube',  handle: '@myweatheruk', color: '#ff0033' },
    { net: 'X',        handle: '@myweatheruk', color: '#ffffff' },
    { net: 'TikTok',   handle: '@myweatheruk', color: '#25f4ee' },
  ];
  const curSocial = socials[socialIdx % socials.length];

  /* ═════════════════════════ render ═════════════════════════ */
  return (
    <div style={S.root}>
      {/* ───────────────── LEFT: capture + overlays ───────────────── */}
      <div style={S.leftCol}>
        <div style={S.screenBox}>
          <video ref={screenVideoRef} style={S.video} muted playsInline />
          {!capturing && (
            <div style={S.captureEmpty}>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 6 }}>
                No source selected
              </div>
              <div style={{ color: BRAND.textMid, fontSize: 13, marginBottom: 18, maxWidth: 360, textAlign: 'center' }}>
                Pick a browser tab, window, or whole screen to broadcast into the feed.
              </div>
              <button style={S.btnPrimary} onClick={startCapture}>Select source</button>
            </div>
          )}
          {capturing && (
            <div style={S.captureBar}>
              <span style={S.liveDot} /> CAPTURING
              <button style={S.barBtn} onClick={stopCapture}>Stop</button>
              <button style={S.barBtn} onClick={startCapture}>Change</button>
            </div>
          )}
        </div>

        <div style={S.overlayStack}>
          {/* Social slideshow */}
          <div style={S.socialRow}>
            <div key={socialIdx} style={{ ...S.socialPill, animation: 'mwFade 0.5s ease' }}>
              <span style={{ ...S.socialNet, color: curSocial.color }}>{curSocial.net}</span>
              <span style={S.socialHandle}>Follow {curSocial.handle}</span>
            </div>
          </div>

          {/* Warning count slideshow */}
          <div style={S.countRow}>
            <div key={countIdx} style={{
              ...S.countCard,
              borderColor: curCount.color,
              boxShadow: `0 0 22px ${curCount.glow}, inset 0 0 0 1px ${curCount.color}33`,
              animation: 'mwFade 0.5s ease',
            }}>
              <span style={{ ...S.countNum, color: curCount.color, textShadow: `0 0 16px ${curCount.glow}` }}>
                {counts[curCount.key]}
              </span>
              <span style={S.countLabel}>
                {curCount.label}<br /><span style={{ color: BRAND.textMid, fontWeight: 600 }}>warning{counts[curCount.key] === 1 ? '' : 's'}</span>
              </span>
            </div>
          </div>

          {/* Latest warning banner slideshow */}
          <div style={S.bannerRow}>
            {curBanner ? (
              <WarningBanner key={bannerIdx} w={curBanner} />
            ) : (
              <div style={S.bannerEmpty}>No active Met Office warnings</div>
            )}
          </div>

          {/* Clock + lightning */}
          <div style={S.infoRow}>
            <div style={S.infoChip}>
              <span style={S.infoLabel}>UK TIME</span>
              <span style={S.infoValue}>
                {clock.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
            <div style={S.infoChip}>
              <span style={S.infoLabel}>⚡ UK STRIKES TODAY</span>
              <span style={{ ...S.infoValue, color: BRAND.sun }}>{ukStrikes.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ───────────────── RIGHT: map + report ───────────────── */}
      <div style={S.rightCol}>
        <div style={S.mapWrap}>
          <div ref={mapElRef} style={S.map} />

          {polygonReport && (
            <div style={{ ...S.report, borderColor: polygonReport.color }}>
              <div style={{ ...S.reportHead, color: polygonReport.color }}>
                {polygonReport.desc ? polygonReport.desc : 'Area report'}
              </div>
              <div style={S.reportSub}>
                {polygonReport.places.length} place{polygonReport.places.length === 1 ? '' : 's'} affected
              </div>
              <div style={S.reportList}>
                {polygonReport.places.length === 0
                  ? <span style={{ color: BRAND.textMid }}>No towns or cities inside the area.</span>
                  : polygonReport.places.map(p => <span key={p} style={S.reportPlace}>{p}</span>)}
              </div>
            </div>
          )}

          <div style={S.dock}>
            <div style={S.dockGroup}>
              <button style={S.dockBtn(radarOn)} onClick={() => setRadarOn(v => !v)}>Radar</button>
              <span style={S.dockNote}>
                Met Office{radarOn && radarTime ? ` · ${new Date(radarTime).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })}` : ''}
              </span>
            </div>
            <div style={S.dockGroup}>
              <button style={S.dockBtn(moWarnOn)} onClick={() => setMoWarnOn(v => !v)}>MO Warnings</button>
            </div>
            <div style={S.dockGroup}>
              {['Red', 'Amber', 'Yellow'].map(s => (
                <button key={s} style={S.sevBtn(sevFilter.has(s), SEVERITY[s].color)}
                  onClick={() => setSevFilter(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; })}>
                  {s}
                </button>
              ))}
            </div>
            <div style={S.dockGroup}>
              <button style={S.dockBtn(drawMode === 'pen')} onClick={() => setDrawMode(m => m === 'pen' ? 'off' : 'pen')}>Pen</button>
              <button style={S.dockBtn(drawMode === 'polygon')} onClick={() => setDrawMode(m => m === 'polygon' ? 'off' : 'polygon')}>Polygon</button>
              <input type="color" value={drawColor} onChange={e => setDrawColor(e.target.value)} style={S.colorInput} title="Draw colour" />
              {drawMode === 'polygon' && (
                <>
                  <input value={polyDesc} onChange={e => setPolyDesc(e.target.value)} placeholder="Polygon label…" style={S.descInput} />
                  <button style={S.dockBtnSm(true)} onClick={finishPolygon}>Finish</button>
                </>
              )}
              <button style={S.dockBtnSm(false)} onClick={clearDrawing}>Clear</button>
            </div>
          </div>

          <div style={S.typeRow}>
            {WARNING_TYPES.map(t => (
              <button key={t} style={S.typeBtn(typeFilter.has(t))}
                onClick={() => setTypeFilter(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; })}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes mwFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes mwPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        .leaflet-container { background: ${BRAND.navy} !important; cursor: crosshair; }
        input[type=color]::-webkit-color-swatch-wrapper { padding: 2px; }
        input[type=color]::-webkit-color-swatch { border: none; border-radius: 5px; }
      `}</style>
    </div>
  );
}

/* ───────────── Warning banner ───────── */
function WarningBanner({ w }) {
  const now = Date.now();
  const from = w.validFrom ? new Date(w.validFrom).getTime() : 0;
  const isUpcoming = from > now;
  const sev = SEVERITY[w.severity] || SEVERITY.Yellow;
  const regions = Array.isArray(w.regions) ? w.regions.join(' & ') : (w.region || 'UK');
  const fmt = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const day = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/London' }).toUpperCase();
    const tm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    return `${day} ${tm}`;
  };
  return (
    <div style={{ ...BANNER.wrap, animation: 'mwFade 0.5s ease' }}>
      <div style={BANNER.left}>
        <div style={{ ...BANNER.status, background: isUpcoming ? '#2563eb' : sev.color }}>
          {isUpcoming ? '◷ UPCOMING' : '● ACTIVE'}
        </div>
        <div style={BANNER.sevLabel}>{sev.label}</div>
        <div style={BANNER.type}>{w.type || 'Weather'}</div>
      </div>
      <div style={{ ...BANNER.right, background: sev.color }}>
        <div style={BANNER.region}>📍 {regions}</div>
        <div style={BANNER.validLabel}>Valid</div>
        <div style={BANNER.validTime}>{fmt(w.validFrom)} – {fmt(w.validTo)}</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════ styles ═══════════════════════════ */
const S = {
  root: {
    position: 'fixed', inset: 0, display: 'flex', gap: 14, padding: 14,
    background: `radial-gradient(1200px 600px at 20% -10%, #16273f 0%, ${BRAND.navy} 55%)`,
    color: BRAND.text, fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    overflow: 'hidden',
  },
  leftCol: { flex: '1 1 58%', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 },
  rightCol: { flex: '1 1 42%', display: 'flex', flexDirection: 'column', minWidth: 0 },

  screenBox: {
    position: 'relative', flex: '1 1 auto', borderRadius: 16, overflow: 'hidden',
    background: '#05080f', border: `1px solid ${BRAND.line}`,
    boxShadow: '0 18px 50px rgba(0,0,0,0.55)', minHeight: 0,
  },
  video: { width: '100%', height: '100%', objectFit: 'contain', background: '#05080f', display: 'block' },
  captureEmpty: {
    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
  },
  captureBar: {
    position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 12px', borderRadius: 10, background: 'rgba(5,8,15,0.78)',
    backdropFilter: 'blur(8px)', fontSize: 12, fontWeight: 800, letterSpacing: '0.08em',
    border: '1px solid rgba(224,50,47,0.4)',
  },
  liveDot: { width: 9, height: 9, borderRadius: '50%', background: BRAND.red, animation: 'mwPulse 1.4s infinite' },
  barBtn: {
    marginLeft: 4, padding: '4px 10px', borderRadius: 7, border: `1px solid ${BRAND.line}`,
    background: 'rgba(255,255,255,0.06)', color: BRAND.text, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  },

  overlayStack: { display: 'flex', flexDirection: 'column', gap: 10, flex: '0 0 auto' },
  socialRow: { display: 'flex' },
  socialPill: {
    display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 16px',
    borderRadius: 12, background: BRAND.panel, border: `1px solid ${BRAND.line}`,
  },
  socialNet: { fontWeight: 900, fontSize: 15, letterSpacing: '-0.01em' },
  socialHandle: { fontWeight: 700, fontSize: 14, color: BRAND.text },

  countRow: { display: 'flex' },
  countCard: {
    display: 'inline-flex', alignItems: 'center', gap: 14, padding: '10px 20px',
    borderRadius: 14, background: BRAND.panel, border: '2px solid',
  },
  countNum: { fontSize: 40, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
  countLabel: { fontSize: 14, fontWeight: 800, lineHeight: 1.2 },

  bannerRow: { display: 'flex', width: '100%' },
  bannerEmpty: {
    padding: '14px 18px', borderRadius: 12, background: BRAND.panel,
    border: `1px solid ${BRAND.line}`, color: BRAND.textMid, fontWeight: 700, fontSize: 14,
  },

  infoRow: { display: 'flex', gap: 10 },
  infoChip: {
    display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 16px',
    borderRadius: 12, background: BRAND.panel, border: `1px solid ${BRAND.line}`,
  },
  infoLabel: { fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', color: BRAND.textMid },
  infoValue: { fontSize: 22, fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1 },

  mapWrap: {
    position: 'relative', flex: '1 1 auto', borderRadius: 16, overflow: 'hidden',
    border: `1px solid ${BRAND.line}`, boxShadow: '0 18px 50px rgba(0,0,0,0.55)', minHeight: 0,
  },
  map: { position: 'absolute', inset: 0 },

  report: {
    position: 'absolute', top: 12, right: 12, width: 280, maxHeight: '46%', overflowY: 'auto',
    padding: 14, borderRadius: 12, background: 'rgba(5,8,15,0.9)', backdropFilter: 'blur(10px)',
    border: '2px solid', zIndex: 500,
  },
  reportHead: { fontSize: 16, fontWeight: 900, letterSpacing: '-0.01em', marginBottom: 2 },
  reportSub: { fontSize: 11, fontWeight: 700, color: BRAND.textMid, marginBottom: 10 },
  reportList: { display: 'flex', flexWrap: 'wrap', gap: 5 },
  reportPlace: {
    fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
    background: 'rgba(255,255,255,0.07)', border: `1px solid ${BRAND.line}`,
  },

  dock: {
    position: 'absolute', left: 10, right: 10, bottom: 10, zIndex: 500,
    display: 'flex', flexWrap: 'wrap', gap: 8, padding: 10, borderRadius: 12,
    background: 'rgba(5,8,15,0.86)', backdropFilter: 'blur(10px)', border: `1px solid ${BRAND.line}`,
  },
  dockGroup: { display: 'flex', alignItems: 'center', gap: 5, paddingRight: 8, borderRight: `1px solid ${BRAND.line}` },
  dockBtn: (on) => ({
    padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 800,
    border: `1px solid ${on ? BRAND.sky : BRAND.line}`,
    background: on ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.04)',
    color: on ? BRAND.sky : BRAND.text,
  }),
  dockNote: { fontSize: 11, fontWeight: 700, color: BRAND.textMid, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  dockBtnSm: (on) => ({
    padding: '6px 9px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700,
    border: `1px solid ${on ? BRAND.sky : BRAND.line}`,
    background: on ? 'rgba(56,189,248,0.16)' : 'rgba(255,255,255,0.04)',
    color: on ? BRAND.sky : BRAND.textMid,
  }),
  sevBtn: (on, color) => ({
    padding: '6px 11px', borderRadius: 7, cursor: 'pointer', fontSize: 11.5, fontWeight: 800,
    border: `1px solid ${on ? color : BRAND.line}`,
    background: on ? `${color}26` : 'rgba(255,255,255,0.04)',
    color: on ? color : BRAND.textMid,
  }),
  colorInput: {
    width: 34, height: 30, padding: 0, border: `1px solid ${BRAND.line}`, borderRadius: 7,
    background: 'transparent', cursor: 'pointer',
  },
  descInput: {
    width: 130, padding: '6px 9px', borderRadius: 7, fontSize: 12, fontWeight: 600,
    border: `1px solid ${BRAND.line}`, background: 'rgba(255,255,255,0.05)', color: BRAND.text, outline: 'none',
  },
  typeRow: {
    position: 'absolute', top: 10, left: 10, zIndex: 500, display: 'flex', flexWrap: 'wrap', gap: 5,
    maxWidth: '62%',
  },
  typeBtn: (on) => ({
    padding: '5px 9px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700,
    border: `1px solid ${on ? BRAND.sun : BRAND.line}`,
    background: on ? 'rgba(245,194,17,0.16)' : 'rgba(5,8,15,0.8)',
    color: on ? BRAND.sun : BRAND.textMid, backdropFilter: 'blur(6px)',
  }),

  btnPrimary: {
    padding: '11px 22px', borderRadius: 11, border: 'none', cursor: 'pointer',
    background: `linear-gradient(135deg, ${BRAND.sky}, #0ea5e9)`, color: '#04121f',
    fontWeight: 900, fontSize: 14, letterSpacing: '-0.01em',
    boxShadow: '0 8px 24px rgba(56,189,248,0.35)',
  },
};

const BANNER = {
  wrap: {
    display: 'flex', width: '100%', height: 92, borderRadius: 14, overflow: 'hidden',
    boxShadow: '0 14px 36px rgba(0,0,0,0.5)', position: 'relative',
  },
  left: {
    flex: '1 1 58%', background: 'linear-gradient(145deg, #2a2f37 0%, #14171c 100%)',
    padding: '12px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3,
  },
  status: {
    alignSelf: 'flex-start', padding: '4px 12px', borderRadius: 20, color: '#fff',
    fontSize: 12, fontWeight: 900, letterSpacing: '0.04em', marginBottom: 3,
  },
  sevLabel: { fontSize: 13, fontWeight: 800, color: '#e2e8f0', lineHeight: 1 },
  type: { fontSize: 26, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1 },
  right: {
    flex: '1 1 42%', padding: '12px 18px', display: 'flex', flexDirection: 'column',
    justifyContent: 'center', gap: 3, clipPath: 'polygon(8% 0, 100% 0, 100% 100%, 0% 100%)',
  },
  region: { fontSize: 13, fontWeight: 900, color: '#fff', lineHeight: 1.1 },
  validLabel: { fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  validTime: { fontSize: 17, fontWeight: 900, color: '#fff', letterSpacing: '-0.01em', lineHeight: 1 },
};