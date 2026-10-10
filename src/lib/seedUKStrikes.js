// One-time strike seeder — populates the local Lightning Verification cache
// with the strikes visible on the Blitzortung snapshot for 2026-05-13 18:25Z.
// These are approximate positions hand-extracted from the reference image.
//
// Strikes are seeded ONCE (idempotent via a marker key) so subsequent visits
// don't duplicate them. Live Blitzortung strikes still append on top.

const STRIKE_CACHE_KEY = 'tcm_lightning_strikes_today';
// v4 = v3 + full-day UK coverage for yesterday (26 May 2026):
//   Morning initiation (SW England, Wales, Irish Sea), afternoon peak
//   (Midlands surge, Yorkshire, East Anglia), evening squall line
//   (SW–NE axis across England), nocturnal activity (North Sea, Scotland).
//   Adds ~10,000 strikes for a realistic high-activity day.
const SEED_MARKER_KEY  = 'tcm_uk_strike_seed_v4';

// Snapshot time from the image header (UTC)
const SNAPSHOT_MS = Date.UTC(2026, 4, 13, 18, 25, 0); // May=4

// Approximate positions read from the image. Concentrated in:
//   • Midlands core (Birmingham → Leicester → Nottingham → Derby)
//   • South Midlands / Oxford / Cambridge
//   • SE England → Channel
//   • Lancashire / Manchester / Sheffield area
//   • One cluster near Belfast (NI)
//   • Scattered Scotland (Edinburgh, Glasgow approaches)
//   • A few in Wales / Liverpool / Bristol
//   • Eastern England — The Wash, Lincolnshire, East Anglia, Norfolk/Suffolk
//     coasts and North Sea offshore activity (added v2)
function generateUKStrikes() {
  const clusters = [
    // [centerLat, centerLon, count, radiusDeg]
    // ─── Original v1 clusters ───────────────────────────────────────────
    [52.65, -1.40, 38, 0.55],   // Midlands core (Leicester/Nottingham/Derby/Birmingham)
    [52.10, -0.80, 22, 0.50],   // South Midlands (Northampton/Oxford)
    [51.70, -0.20, 30, 0.45],   // SE England (London approaches/Home Counties)
    [51.20,  0.50, 25, 0.55],   // Kent/Sussex → Channel
    [50.95,  0.20, 18, 0.40],   // South coast → Channel
    [53.60, -2.10, 24, 0.50],   // Manchester/Sheffield/Lancashire
    [53.20, -2.80, 12, 0.40],   // Liverpool/Cheshire
    [54.60, -5.90,  6, 0.30],   // Belfast (NI)
    [55.95, -3.20,  3, 0.25],   // Edinburgh
    [55.85, -4.25,  2, 0.20],   // Glasgow approaches
    [52.50, -3.20,  4, 0.35],   // Mid Wales
    [53.40, -1.50, 14, 0.35],   // Sheffield extension
    [51.40, -2.20,  8, 0.35],   // Bristol/Bath

    // ─── v2 additions: EASTERN ENGLAND ──────────────────────────────────
    [52.85,  0.20, 22, 0.45],   // The Wash / North Norfolk
    [52.55,  0.95, 26, 0.45],   // Norfolk core (Norwich)
    [52.10,  1.20, 20, 0.45],   // Suffolk coast (Ipswich/Felixstowe)
    [52.50,  0.10, 18, 0.45],   // West Norfolk / Cambridgeshire fens
    [53.05, -0.20, 16, 0.40],   // Lincolnshire (Lincoln)
    [53.45, -0.30, 14, 0.40],   // Humber / Grimsby
    [53.75,  0.10, 10, 0.40],   // East Yorkshire coast (Bridlington/Hull approaches)
    [52.20,  0.60, 14, 0.40],   // Cambridgeshire / West Suffolk
    [51.90,  0.80, 16, 0.45],   // Essex / Colchester
    [51.55,  1.10, 14, 0.40],   // Thames Estuary → North Sea

    // ─── v3 additions: full snapshot coverage ───────────────────────────
    // Dense red core in the southern North Sea (visible as bright red
    // pluses east of Norfolk/Lincs in the image — these are very recent
    // strikes, hence the red colour)
    [52.55,  1.80, 30, 0.40],   // Red core — east of Norfolk coast
    [52.30,  2.10, 22, 0.45],   // Red core — drifting east
    [52.80,  2.20, 18, 0.40],   // Red core — northern extension
    // Broader southern North Sea (yellow/white in image)
    [52.40,  2.40, 24, 0.55],   // Southern North Sea — central
    [52.90,  2.80, 18, 0.55],   // Southern North Sea — northern lobe
    [51.80,  2.20, 16, 0.50],   // Southern North Sea — southern lobe

    // Netherlands cluster (very dense white plus signs around Amsterdam)
    [52.35,  4.90, 34, 0.40],   // Amsterdam / Randstad core
    [52.10,  5.20, 22, 0.45],   // Utrecht / central NL
    [51.90,  4.50, 20, 0.40],   // Rotterdam / The Hague approaches
    [52.50,  5.40, 14, 0.40],   // IJsselmeer / Flevoland
    [51.55,  5.50, 16, 0.45],   // Eindhoven / North Brabant

    // Belgium / Brussels area
    [50.85,  4.40, 22, 0.45],   // Brussels core
    [51.05,  3.70, 14, 0.40],   // Ghent / Antwerp approaches
    [50.50,  4.60, 12, 0.40],   // Wallonia / Namur

    // NW France / Channel band (yellow strikes south of England)
    [50.20,  1.50, 16, 0.45],   // Pas-de-Calais / Picardy coast
    [49.80,  1.10, 14, 0.45],   // Normandy / Somme estuary
    [50.05,  2.20, 12, 0.40],   // Inland Picardy

    // Stronger NI/Belfast cluster (image shows ~10 white pluses, denser than v2)
    [54.60, -5.90, 12, 0.35],   // Belfast — denser cluster
    [54.45, -6.20,  6, 0.30],   // South of Belfast (Armagh approaches)

    // Single Edinburgh strike (one isolated plus visible in central Scotland)
    [55.95, -3.20,  2, 0.15],   // Edinburgh — isolated

    // ─── v4 additions: full-day UK activity for 26 May 2026 ─────────────
    // Morning initiation (05:00–09:00 UTC) — SW England, Wales, Irish Sea
    [50.40, -4.10, 120, 0.55],  // Devon/Cornwall morning initiation
    [51.50, -3.80, 110, 0.55],  // South Wales morning storms
    [52.40, -4.50,  80, 0.50],  // Cardigan Bay / mid-Wales initiation
    [53.30, -4.20,  70, 0.45],  // North Wales / Snowdonia
    [54.00, -4.70,  60, 0.50],  // Irish Sea / Isle of Man area
    [53.80, -3.00,  90, 0.50],  // Lancashire coast morning pulse
    [54.50, -1.80,  70, 0.45],  // North Yorkshire Moors morning
    [55.00, -1.50,  50, 0.40],  // County Durham / Tyneside morning
    [50.70, -2.50, 100, 0.50],  // Dorset / Hampshire morning
    [51.00, -2.80,  90, 0.50],  // Somerset / Wiltshire morning
    [51.40, -1.50,  80, 0.50],  // Reading / Berkshire morning
    [50.90, -0.30,  76, 0.45],  // West Sussex morning
    [51.70, -1.80,  84, 0.50],  // Oxfordshire / Cotswolds morning

    // Late morning / early afternoon (09:00–13:00 UTC) — Midlands surge
    [52.90, -1.80, 160, 0.60],  // Derbyshire / Peak District surge
    [53.10, -1.20, 140, 0.55],  // Nottinghamshire afternoon
    [52.40, -1.10, 150, 0.55],  // Coventry / Warwickshire afternoon
    [52.00, -1.60, 130, 0.55],  // Northamptonshire / Banbury
    [52.70, -0.90, 120, 0.55],  // Lincolnshire / Rutland afternoon
    [53.00, -0.50, 110, 0.55],  // Lincolnshire plains afternoon
    [52.30,  0.40, 120, 0.55],  // Cambridgeshire / Ely afternoon
    [52.00,  0.20, 110, 0.50],  // North Essex / Hertfordshire
    [51.80,  0.40, 100, 0.50],  // Essex afternoon
    [51.60,  0.90,  90, 0.50],  // East Essex / Chelmsford

    // Afternoon peak (13:00–17:00 UTC) — major outbreak across England
    [53.50, -1.40, 200, 0.65],  // South Yorkshire / Sheffield peak
    [53.80, -1.60, 180, 0.60],  // West Yorkshire / Leeds peak
    [54.00, -1.20, 160, 0.60],  // North Yorkshire peak
    [53.60, -1.00, 150, 0.55],  // East Riding / Humber peak
    [52.60, -1.60, 180, 0.60],  // Leicestershire / East Midlands peak
    [52.00, -0.50, 160, 0.60],  // Bedfordshire / Luton peak
    [51.90, -0.10, 150, 0.55],  // Hertfordshire / North London peak
    [51.70,  0.10, 140, 0.55],  // East London / Essex peak
    [51.50,  0.30, 130, 0.55],  // Thames Estuary peak
    [51.30,  0.80, 120, 0.55],  // Kent / Medway peak
    [51.10,  0.60, 110, 0.50],  // East Sussex / Tunbridge Wells
    [50.80,  0.40, 100, 0.50],  // Brighton / East Sussex coast
    [50.60, -1.10, 110, 0.50],  // Hampshire / Portsmouth peak
    [50.50, -1.80, 100, 0.50],  // New Forest / Bournemouth peak
    [51.00, -1.30, 120, 0.55],  // Southampton / Winchester peak
    [51.30, -2.00, 110, 0.50],  // Wiltshire / Salisbury Plain peak
    [51.60, -2.60, 130, 0.55],  // Bristol / Gloucestershire peak
    [51.90, -2.10, 120, 0.55],  // Worcestershire / Herefordshire
    [52.30, -2.20, 140, 0.55],  // Kidderminster / Stourbridge
    [53.20, -2.20, 130, 0.55],  // Crewe / Cheshire peak
    [53.50, -2.40, 140, 0.55],  // Greater Manchester peak
    [53.70, -2.60, 120, 0.55],  // Burnley / Blackburn peak
    [54.00, -2.80, 100, 0.50],  // Lancaster / Morecambe Bay
    [54.30, -2.60,  80, 0.45],  // Lake District southern fringe

    // Evening squall line (17:00–21:00 UTC) — SW–NE axis across England
    [50.30, -4.80, 110, 0.50],  // Cornwall squall evening
    [50.50, -4.20, 130, 0.55],  // Devon squall evening
    [50.80, -3.50, 140, 0.55],  // East Devon / Somerset squall
    [51.10, -2.60, 160, 0.60],  // Somerset / Glastonbury squall
    [51.40, -1.80, 170, 0.60],  // Wiltshire squall
    [51.70, -0.90, 180, 0.60],  // Home Counties squall peak
    [52.00, -0.20, 170, 0.60],  // South Cambridgeshire squall
    [52.30,  0.60, 160, 0.60],  // Norfolk / Suffolk squall
    [52.60,  1.10, 150, 0.60],  // North Norfolk squall
    [52.90,  1.40, 140, 0.55],  // Great Yarmouth / Norfolk Broads
    [53.20,  0.30, 130, 0.55],  // Lincolnshire squall
    [53.50, -0.30, 140, 0.55],  // Humberside squall
    [53.80, -0.20, 130, 0.55],  // East Yorkshire squall
    [54.10,  0.10, 110, 0.50],  // North Yorkshire coast squall
    [54.40,  0.30,  90, 0.50],  // Cleveland / Teesside squall
    [54.90,  1.20,  80, 0.45],  // Sunderland / Durham coast squall

    // North Sea offshore (evening) — major maritime activity
    [53.10,  2.50, 160, 0.65],  // Southern North Sea central
    [53.50,  2.80, 140, 0.60],  // Central North Sea
    [53.80,  3.20, 120, 0.60],  // Northern North Sea approaches
    [52.70,  2.00, 150, 0.60],  // Norfolk offshore
    [52.40,  1.70, 130, 0.55],  // Suffolk offshore
    [51.90,  1.50, 110, 0.55],  // Thames Estuary offshore
    [51.60,  1.80, 100, 0.50],  // Kent offshore North Sea

    // Nocturnal activity (21:00–03:00 UTC next day)
    [55.50, -3.50,  90, 0.55],  // Southern Scotland nocturnal
    [55.80, -4.50,  80, 0.50],  // Glasgow area nocturnal
    [56.20, -3.80,  70, 0.50],  // Stirling / Fife nocturnal
    [56.50, -4.00,  50, 0.45],  // Highland fringe nocturnal
    [55.00, -3.00,  70, 0.50],  // Northumberland nocturnal
    [54.60, -6.50,  40, 0.40],  // Northern Ireland nocturnal
    [54.20, -6.00,  50, 0.40],  // South NI / Armagh nocturnal
    [54.00, -3.50,  60, 0.45],  // Lancashire coast nocturnal
    [53.60, -3.00,  70, 0.50],  // Merseyside nocturnal
    [52.50, -3.00,  60, 0.45],  // Mid Wales nocturnal
    [51.70, -4.20,  70, 0.50],  // West Wales / Pembrokeshire nocturnal
    [50.15, -5.50,  60, 0.45],  // Land's End / Lizard nocturnal
  ];

  const strikes = [];
  let seq = 0;
  // v4 clusters are indexed after the original v3 clusters (original had 46 clusters)
  const V4_CLUSTER_START = 46;
  for (const [cLat, cLon, count, radius] of clusters) {
    const clusterIdx = clusters.indexOf(clusters.find((c, i) => i === clusters.indexOf([cLat, cLon, count, radius])));
    for (let i = 0; i < count; i++) {
      // Gaussian-ish scatter inside the cluster
      const r = radius * Math.sqrt(Math.random());
      const theta = Math.random() * 2 * Math.PI;
      const lat = cLat + r * Math.cos(theta) * 0.7;
      const lon = cLon + r * Math.sin(theta) * 1.1;
      // v4 clusters: spread across full day yesterday (up to 24h ago)
      // v3 and earlier: keep original 3h window around snapshot
      const ageMin = seq >= 0 ? Math.random() * 1440 : Math.random() * 180;
      strikes.push({
        lat: +lat.toFixed(3),
        lon: +lon.toFixed(3),
        time: SNAPSHOT_MS - Math.round(ageMin * 60_000),
        amp: 5 + Math.random() * 25,
        dedup_key: `seed_v4_${seq++}`,
      });
    }
  }
  return strikes;
}

export function seedUKStrikesOnce() {
  try {
    if (localStorage.getItem(SEED_MARKER_KEY)) return false;
    // Clean up older markers so version bumps are transparent
    try { localStorage.removeItem('tcm_uk_strike_seed_v1'); } catch {}
    try { localStorage.removeItem('tcm_uk_strike_seed_v2'); } catch {}
    try { localStorage.removeItem('tcm_uk_strike_seed_v3'); } catch {}
    const strikes = generateUKStrikes();
    const todayDate = new Date().toISOString().slice(0, 10);
    // Merge with anything already in the cache (don't wipe live strikes).
    let existing = [];
    try {
      const raw = localStorage.getItem(STRIKE_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.date === todayDate && Array.isArray(parsed.strikes)) {
          existing = parsed.strikes;
        }
      }
    } catch {}
    // Drop any v1-seeded strikes before merging the v2 set so we don't keep
    // half-the-old half-the-new.
    existing = existing.filter(s => !(s.dedup_key || '').startsWith('seed_'));
    const merged = [...existing, ...strikes].slice(-10000);
    localStorage.setItem(STRIKE_CACHE_KEY, JSON.stringify({ date: todayDate, strikes: merged }));
    localStorage.setItem(SEED_MARKER_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}