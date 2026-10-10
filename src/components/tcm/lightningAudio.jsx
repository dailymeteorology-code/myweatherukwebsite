/* Audio + flash helpers extracted from pages/TCM */

export class AlertQueue {
  constructor() { this._q = []; this._busy = false; }
  push(fn) { this._q.push(fn); if (!this._busy) this._next(); }
  _next() {
    if (!this._q.length) { this._busy = false; return; }
    this._busy = true;
    const fn = this._q.shift();
    Promise.resolve().then(() => fn()).finally(() => setTimeout(() => this._next(), 500));
  }
}

export function playThunder(audioCtxRef, soundEnabled) {
  if (!soundEnabled) return;
  try {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') { ctx.resume(); return; }
    const now = ctx.currentTime;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -6; compressor.knee.value = 3; compressor.ratio.value = 3;
    compressor.attack.value = 0.001; compressor.release.value = 0.08;
    compressor.connect(ctx.destination);
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.85, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    masterGain.connect(compressor);
    const crackDur = 0.055;
    const crackBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * crackDur), ctx.sampleRate);
    const crackData = crackBuf.getChannelData(0);
    for (let i = 0; i < crackData.length; i++) crackData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / crackData.length, 1.4);
    const crackSrc = ctx.createBufferSource(); crackSrc.buffer = crackBuf;
    const crackFilter = ctx.createBiquadFilter(); crackFilter.type = 'bandpass'; crackFilter.frequency.value = 1800; crackFilter.Q.value = 0.4;
    const crackGain = ctx.createGain(); crackGain.gain.setValueAtTime(1.0, now); crackGain.gain.exponentialRampToValueAtTime(0.001, now + crackDur);
    crackSrc.connect(crackFilter); crackFilter.connect(crackGain); crackGain.connect(masterGain);
    crackSrc.start(now); crackSrc.stop(now + crackDur + 0.01);
    const rumbleDur = 0.18;
    const rumbleBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * rumbleDur), ctx.sampleRate);
    const rumbleData = rumbleBuf.getChannelData(0);
    for (let i = 0; i < rumbleData.length; i++) rumbleData[i] = (Math.random() * 2 - 1);
    const rumbleSrc = ctx.createBufferSource(); rumbleSrc.buffer = rumbleBuf;
    const rumbleFilter = ctx.createBiquadFilter(); rumbleFilter.type = 'lowpass'; rumbleFilter.frequency.value = 120;
    const rumbleGain = ctx.createGain(); rumbleGain.gain.setValueAtTime(0, now); rumbleGain.gain.linearRampToValueAtTime(0.6, now + 0.01); rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + rumbleDur);
    rumbleSrc.connect(rumbleFilter); rumbleFilter.connect(rumbleGain); rumbleGain.connect(masterGain);
    rumbleSrc.start(now + 0.005); rumbleSrc.stop(now + rumbleDur + 0.01);
  } catch (_) {}
}

export function playWarningSiren(audioCtxRef, warnSoundEnabled, riskLevel = 'yellow') {
  return new Promise(resolve => {
    if (!warnSoundEnabled) { resolve(); return; }
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') { ctx.resume().then(resolve); return; }
      const now = ctx.currentTime;
      const profiles = {
        yellow: { freq1: 440, freq2: 660, sweeps: 2, gainPeak: 0.25, sweepDur: 0.5 },
        amber:  { freq1: 520, freq2: 880, sweeps: 3, gainPeak: 0.35, sweepDur: 0.45 },
        red:    { freq1: 600, freq2: 1100, sweeps: 4, gainPeak: 0.5, sweepDur: 0.38 },
      };
      const p = profiles[riskLevel] || profiles.yellow;
      const master = ctx.createDynamicsCompressor();
      master.threshold.value = -6; master.knee.value = 3; master.ratio.value = 4; master.attack.value = 0.003; master.release.value = 0.1;
      master.connect(ctx.destination);
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0, now);
      masterGain.gain.linearRampToValueAtTime(p.gainPeak, now + 0.05);
      masterGain.connect(master);
      for (let i = 0; i < p.sweeps; i++) {
        const offset = i * (p.sweepDur + 0.08);
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(p.freq1, now + offset);
        osc.frequency.linearRampToValueAtTime(p.freq2, now + offset + p.sweepDur * 0.6);
        osc.frequency.linearRampToValueAtTime(p.freq1, now + offset + p.sweepDur);
        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(0, now + offset);
        oscGain.gain.linearRampToValueAtTime(0.7, now + offset + 0.04);
        oscGain.gain.setValueAtTime(0.7, now + offset + p.sweepDur - 0.06);
        oscGain.gain.linearRampToValueAtTime(0, now + offset + p.sweepDur);
        osc.connect(oscGain); oscGain.connect(masterGain);
        osc.start(now + offset); osc.stop(now + offset + p.sweepDur + 0.05);
      }
      const totalDur = p.sweeps * (p.sweepDur + 0.08) + 0.3;
      masterGain.gain.setValueAtTime(p.gainPeak, now + totalDur - 0.15);
      masterGain.gain.linearRampToValueAtTime(0, now + totalDur);
      setTimeout(resolve, totalDur * 1000 + 200);
    } catch (_) { resolve(); }
  });
}

export function speakWarning(text, ttsEnabled, riskLevel = 'yellow') {
  return new Promise(resolve => {
    if (!ttsEnabled) { resolve(); return; }
    try {
      if (!window.speechSynthesis) { resolve(); return; }
      window.speechSynthesis.cancel();
      const voices = window.speechSynthesis.getVoices();
      const preferred = ['Google UK English Female','Google UK English Male','Microsoft Hazel Desktop','Microsoft George Desktop','en-GB'];
      let chosen = null;
      for (const name of preferred) { chosen = voices.find(v => v.name === name || v.lang === name); if (chosen) break; }
      const rateMap  = { yellow: 0.95, amber: 1.0,  red: 1.08 };
      const pitchMap = { yellow: 1.0,  amber: 0.95, red: 0.9 };
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = 'en-GB';
      utt.rate = rateMap[riskLevel]  ?? 1.0;
      utt.pitch = pitchMap[riskLevel] ?? 1.0;
      utt.volume = 1.0;
      if (chosen) utt.voice = chosen;
      let keepAlive = null;
      utt.onstart = () => {
        keepAlive = setInterval(() => {
          if (!window.speechSynthesis.speaking) { clearInterval(keepAlive); return; }
          window.speechSynthesis.pause(); window.speechSynthesis.resume();
        }, 10000);
      };
      utt.onend   = () => { clearInterval(keepAlive); resolve(); };
      utt.onerror = () => { clearInterval(keepAlive); resolve(); };
      window.speechSynthesis.speak(utt);
      setTimeout(() => { clearInterval(keepAlive); resolve(); }, 20000);
    } catch (_) { resolve(); }
  });
}

/* PERFORMANCE: at most 8 flashes animate at once, at 20 fps instead of 40, and
   none while the tab is hidden. In a big storm the old version ran dozens of
   40 fps timers, each forcing a canvas repaint of the strike layer. */
let activeFlashes = 0;
export function renderGlowFlash(lat, lon, flashLayerRef) {
  const L = window.L;
  if (!L || !flashLayerRef.current) return;
  if (document.visibilityState !== 'visible' || activeFlashes >= 8) return;
  activeFlashes += 1;
  setTimeout(() => { activeFlashes -= 1; }, 1500);
  const ring = L.circleMarker([lat,lon],{radius:6,color:'#ffffff',fillColor:'transparent',fillOpacity:0,weight:2,opacity:0.95}).addTo(flashLayerRef.current);
  const core = L.circleMarker([lat,lon],{radius:2,color:'#facc15',fillColor:'#facc15',fillOpacity:0.9,weight:1,opacity:0.9}).addTo(flashLayerRef.current);
  const DURATION_MS=1500,FPS=20,STEPS=Math.round((DURATION_MS/1000)*FPS);
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