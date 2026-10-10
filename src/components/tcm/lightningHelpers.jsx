/* Helpers extracted from TCM.jsx — strike icons, sounds, DBSCAN, storm tracker, etc. */
// City lookups are injected via setCityLookups() because TCM.jsx owns the city DB
let _nearestCity = (lat, lon) => `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
let _nearestCityShort = (lat, lon) => `${lat.toFixed(1)}, ${lon.toFixed(1)}`;
export function setCityLookups({ nearestCity, nearestCityShort }) {
  if (nearestCity) _nearestCity = nearestCity;
  if (nearestCityShort) _nearestCityShort = nearestCityShort;
}

export function makeCircleIcon(color, size = 14) {
  // Plain filled circle — no outline ring, no inner highlight dot. A small
  // radius keeps each strike rendered as a precise pinpoint rather than a
  // soft blob, which is what users want when scanning a busy map.
  const c = size / 2;
  const r = Math.round(size * 0.36);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${c}" cy="${c}" r="${r}" fill="${color}"/>
  </svg>`;
}
/** @deprecated renamed to makeCircleIcon */
export function makePlusIcon(color, size = 14) { return makeCircleIcon(color, size); }

export function strikeColor(timeMs) {
  const ageMin = (Date.now() - timeMs) / 60000;
  if (ageMin < 1)   return '#ffffff';
  if (ageMin < 5)   return '#fffde0';
  if (ageMin < 10)  return '#facc15';
  if (ageMin < 30)  return '#f97316';
  if (ageMin < 60)  return '#ef4444';
  if (ageMin < 360) return '#7f1d1d';
  if (ageMin < 720) return '#7c3aed';
  return '#4c1d95';
}

export function localDateKey(ts) {
  return new Date(ts || Date.now()).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function dbscan(points, eps, minPts) {
  const labels = new Array(points.length).fill(-2);
  let cluster = 0;
  const nb = (idx) => {
    const p = points[idx]; const out = [];
    for (let i = 0; i < points.length; i++) {
      if (i === idx) continue;
      const q = points[i];
      const dLat = p.lat - q.lat;
      const dLon = (p.lon - q.lon) * Math.cos((p.lat * Math.PI) / 180);
      if (Math.sqrt(dLat * dLat + dLon * dLon) <= eps) out.push(i);
    }
    return out;
  };
  for (let i = 0; i < points.length; i++) {
    if (labels[i] !== -2) continue;
    const seeds = nb(i);
    if (seeds.length < minPts) { labels[i] = -1; continue; }
    labels[i] = cluster;
    for (let j = 0; j < seeds.length; j++) {
      const s = seeds[j];
      if (labels[s] === -1) labels[s] = cluster;
      if (labels[s] !== -2) continue;
      labels[s] = cluster;
      const nb2 = nb(s);
      if (nb2.length >= minPts) nb2.forEach(x => { if (!seeds.includes(x)) seeds.push(x); });
    }
    cluster++;
  }
  const clusters = {};
  for (let i = 0; i < points.length; i++) { const l = labels[i]; if (l < 0) continue; if (!clusters[l]) clusters[l] = []; clusters[l].push(points[i]); }
  return Object.values(clusters);
}

export function buildSmoothBlob(pts, padDeg = 0.18) {
  if (pts.length < 3) {
    const cLat = pts.reduce((s,p) => s+p.lat,0)/pts.length;
    const cLon = pts.reduce((s,p) => s+p.lon,0)/pts.length;
    const r = padDeg * 1.5;
    return Array.from({length:16},(_,i) => {
      const a = (i/16)*Math.PI*2;
      return [cLat + Math.cos(a)*r, cLon + Math.sin(a)*r*1.5];
    });
  }
  const cLat = pts.reduce((s,p) => s+p.lat,0)/pts.length;
  const cLon = pts.reduce((s,p) => s+p.lon,0)/pts.length;
  const ANGLES = 24;
  const radii = [];
  for (let i = 0; i < ANGLES; i++) {
    const angle = (i / ANGLES) * Math.PI * 2;
    let maxR = padDeg;
    pts.forEach(p => {
      const dLat = p.lat - cLat, dLon = (p.lon - cLon) * 0.65;
      const pAngle = Math.atan2(dLon, dLat);
      const angDiff = Math.abs(((angle - pAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (angDiff < Math.PI / 3) {
        const dist = Math.sqrt(dLat*dLat + dLon*dLon);
        const weight = Math.cos(angDiff * 3 / Math.PI) * 0.5 + 0.5;
        maxR = Math.max(maxR, dist * weight + padDeg);
      }
    });
    radii.push(maxR);
  }
  const smooth = radii.map((_, i) => {
    const w = [0.1, 0.2, 0.4, 0.2, 0.1];
    return w.reduce((s, wt, wi) => s + wt * radii[(i + wi - 2 + ANGLES) % ANGLES], 0);
  });
  return smooth.map((r, i) => {
    const angle = (i / ANGLES) * Math.PI * 2;
    return [cLat + Math.cos(angle)*r, cLon + Math.sin(angle)*r*1.5];
  });
}

export const STORM_RISK = {
  yellow: {
    color: '#facc15', label: 'Advisory', fullLabel: 'Yellow — Advisory',
    desc: 'Thunderstorm activity detected. Localised lightning and heavy rainfall possible. Stay alert and avoid exposed areas.',
    minStrikes: 30, minPoints: 20, expiryMs: 2 * 60 * 60 * 1000,
  },
  amber: {
    color: '#f97316', label: 'Warning', fullLabel: 'Amber — Warning',
    desc: 'Active thunderstorm with frequent lightning. Potential for flash flooding, strong gusts and hail. Move indoors.',
    minStrikes: 150, minPoints: 80, expiryMs: 3 * 60 * 60 * 1000,
  },
  red: {
    color: '#ef4444', label: 'Severe', fullLabel: 'Red — Severe',
    desc: 'Dangerous severe thunderstorm in progress. High likelihood of structural damage, large hail and major flooding. Take cover immediately.',
    minStrikes: 300, minPoints: 120, expiryMs: 4 * 60 * 60 * 1000,
  },
};

const STORM_PATH_MAX_DEG = 0.72;

export function buildTtsString(risk, count, lat, lon) {
  const loc = _nearestCity(lat, lon);
  if (risk === 'yellow') return `Advisory. Thunderstorm activity detected ${loc}. ${count} lightning strikes recorded. Localised lightning and rainfall possible. Stay alert.`;
  if (risk === 'amber')  return `Amber warning. Active thunderstorm ${loc}. ${count} lightning strikes in the last 30 minutes. Flash flooding, strong gusts and hail are possible. Move indoors immediately.`;
  return `Red severe warning. Dangerous thunderstorm ${loc}. ${count} lightning strikes in 30 minutes. Structural damage, large hail and major flooding likely. Take cover immediately and do not travel.`;
}

export function createStormTracker() {
  let rolling = [];
  const cellHistory = {};

  function ingest(strike) { rolling.push(strike); }
  function pruneRolling() { const cutoff = Date.now() - 30*60*1000; rolling = rolling.filter(s => s.time > cutoff); }

  function cluster(windMap = {}) {
    pruneRolling();
    if (rolling.length < 5) return [];
    const groups = dbscan(rolling, 0.55, 6);
    return groups.map((pts, idx) => {
      const cLat = pts.reduce((s,p) => s+p.lat,0)/pts.length;
      const cLon = pts.reduce((s,p) => s+p.lon,0)/pts.length;
      const id   = `storm-${idx}`;
      if (!cellHistory[id]) cellHistory[id] = { history: [], createdAt: Date.now() };
      const h = cellHistory[id];
      h.history.push({ lat: cLat, lon: cLon, time: Date.now() });
      if (h.history.length > 30) h.history.shift();

      let driftLat = 0, driftLon = 0, hasDrift = false;
      if (h.history.length >= 4) {
        const oldest = h.history[0], newest = h.history[h.history.length-1];
        const rawDLat = newest.lat - oldest.lat, rawDLon = newest.lon - oldest.lon;
        if (Math.sqrt(rawDLat*rawDLat + rawDLon*rawDLon) > 0.02) {
          driftLat = rawDLat / h.history.length;
          driftLon = rawDLon / h.history.length;
          hasDrift = true;
        }
      }
      const windKey = `${Math.round(cLat * 2) / 2}_${Math.round(cLon * 2) / 2}`;
      const wind = windMap[windKey];
      let windLat = 0, windLon = 0, hasWind = false;
      if (wind && wind.speed > 2) {
        const scale = (wind.speed / 111) * (1/60) * 3;
        windLat = wind.v * scale / 111;
        windLon = wind.u * scale / (111 * Math.cos(cLat * Math.PI / 180));
        hasWind = true;
      }
      let dir = null;
      if (hasDrift || hasWind) {
        const dw = hasDrift && hasWind ? 0.5 : hasDrift ? 1.0 : 0.0;
        const ww = hasWind  ? (hasDrift ? 0.5 : 1.0) : 0.0;
        const blendLat = driftLat * dw + windLat * ww;
        const blendLon = driftLon * dw + windLon * ww;
        const mag = Math.sqrt(blendLat*blendLat + blendLon*blendLon);
        if (mag > 0.0001) {
          const clamped = Math.min(mag * 10, STORM_PATH_MAX_DEG);
          dir = { dLat: (blendLat/mag) * clamped, dLon: (blendLon/mag) * clamped };
        }
      }

      const count = pts.length;
      let risk = count >= STORM_RISK.red.minPoints ? 'red' : count >= STORM_RISK.amber.minPoints ? 'amber' : 'yellow';
      const avgAmp = pts.reduce((s,p) => s + Math.abs(p.amp||0),0)/pts.length;
      if (avgAmp > 80  && risk === 'yellow') risk = 'amber';
      if (avgAmp > 120 && risk === 'amber')  risk = 'red';

      const spread = pts.reduce((s,p) => {
        const dLat = p.lat-cLat, dLon = p.lon-cLon;
        return s + Math.sqrt(dLat*dLat+dLon*dLon);
      }, 0) / pts.length;
      const corePolygon = buildSmoothBlob(pts, Math.max(0.12, spread * 0.8));

      let pathPolygon = null;
      if (dir && corePolygon.length >= 2) {
        const pLen   = Math.sqrt(dir.dLon*dir.dLon + dir.dLat*dir.dLat) || 1;
        const normLat = dir.dLat / pLen, normLon = dir.dLon / pLen;
        const tipDist = Math.min(pLen, STORM_PATH_MAX_DEG);
        const tipLat  = cLat + normLat * tipDist;
        const tipLon  = cLon + normLon * tipDist;
        const baseW   = Math.max(0.08, Math.min(0.20, spread * 0.5));
        const arrowW  = baseW * 0.4;
        pathPolygon = [
          [cLat + (-normLon) * baseW,  cLon + (normLat) * baseW],
          [tipLat + (-normLon) * arrowW, tipLon + (normLat) * arrowW],
          [tipLat + normLat * 0.15,     tipLon + normLon * 0.15],
          [tipLat - (-normLon) * arrowW, tipLon - (normLat) * arrowW],
          [cLat - (-normLon) * baseW,  cLon - (normLat) * baseW],
        ];
      }

      const prevRisk  = cellHistory[id]._lastRisk;
      const RISK_RANK = { yellow: 0, amber: 1, red: 2 };
      const prevRiskWasUpgraded = prevRisk && RISK_RANK[prevRisk] > RISK_RANK[risk];
      if (prevRiskWasUpgraded) risk = prevRisk;
      const riskChanged = prevRisk && prevRisk !== risk && !prevRiskWasUpgraded;
      cellHistory[id]._lastRisk = risk;

      const expiresAt = Date.now() + STORM_RISK[risk].expiryMs;

      return {
        id, risk, corePolygon, pathPolygon, count,
        centroid: { lat: cLat, lon: cLon },
        direction: dir,
        locationLabel: _nearestCityShort(cLat, cLon),
        startTime: new Date(h.createdAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),
        endTime:   new Date(h.createdAt+2*60*60*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),
        updatedAt: Date.now(),
        expiresAt,
        riskChanged,
      };
    });
  }

  function getRolling() { return rolling; }
  function resetDay()   { const snap = [...rolling]; rolling = []; Object.keys(cellHistory).forEach(k => delete cellHistory[k]); return snap; }
  return { ingest, cluster, getRolling, resetDay };
}

export function createThunderSound(audioCtx) {
  try {
    const ctx = audioCtx, now = ctx.currentTime;
    const bufSize = ctx.sampleRate * 0.08;
    const buf  = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random()*2-1);
    const noiseSource = ctx.createBufferSource(); noiseSource.buffer = buf;
    const crackFilter = ctx.createBiquadFilter(); crackFilter.type = 'bandpass'; crackFilter.frequency.value = 1200; crackFilter.Q.value = 0.4;
    const crackGain   = ctx.createGain(); crackGain.gain.setValueAtTime(0.55, now); crackGain.gain.exponentialRampToValueAtTime(0.001, now+0.08);
    noiseSource.connect(crackFilter); crackFilter.connect(crackGain); crackGain.connect(ctx.destination);
    noiseSource.start(now); noiseSource.stop(now+0.08);
    const rumbleBuf = ctx.createBuffer(1, ctx.sampleRate*0.6, ctx.sampleRate);
    const rData = rumbleBuf.getChannelData(0);
    for (let i = 0; i < rData.length; i++) rData[i] = (Math.random()*2-1);
    const rumbleSource = ctx.createBufferSource(); rumbleSource.buffer = rumbleBuf;
    const rumbleFilter = ctx.createBiquadFilter(); rumbleFilter.type = 'lowpass'; rumbleFilter.frequency.value = 80;
    const rumbleGain   = ctx.createGain(); rumbleGain.gain.setValueAtTime(0.0, now); rumbleGain.gain.linearRampToValueAtTime(0.3, now+0.05); rumbleGain.gain.exponentialRampToValueAtTime(0.001, now+0.6);
    rumbleSource.connect(rumbleFilter); rumbleFilter.connect(rumbleGain); rumbleGain.connect(ctx.destination);
    rumbleSource.start(now+0.01); rumbleSource.stop(now+0.62);
  } catch (_) {}
}

export function renderGlowFlash(lat, lon, flashLayerRef) {
  const L = window.L;
  if (!L || !flashLayerRef.current) return;
  const ring = L.circleMarker([lat,lon],{radius:6,color:'#ffffff',fillColor:'#ffffff',fillOpacity:1.0,weight:2,opacity:1.0}).addTo(flashLayerRef.current);
  const core = L.circleMarker([lat,lon],{radius:3,color:'#ffffff',fillColor:'#fffde0',fillOpacity:1.0,weight:1,opacity:1.0}).addTo(flashLayerRef.current);
  const DURATION_MS=1500,FPS=40,STEPS=Math.round((DURATION_MS/1000)*FPS);
  let step=0;
  const iv=setInterval(()=>{
    step++;
    const t=step/STEPS;
    if(t>=1){clearInterval(iv);try{flashLayerRef.current?.removeLayer(ring);}catch(_){}try{flashLayerRef.current?.removeLayer(core);}catch(_){}return;}
    const eased=1-Math.pow(1-t,2);
    try{ring.setRadius(6+eased*28);ring.setStyle({fillOpacity:0.9*(1-t),opacity:0.85*(1-t)});}catch(_){}
    try{const coreFade=Math.max(0,1-t*2.5);core.setStyle({fillOpacity:coreFade,opacity:coreFade});}catch(_){}
  },1000/FPS);
}