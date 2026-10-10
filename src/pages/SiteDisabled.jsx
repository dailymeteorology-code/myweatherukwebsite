import { useState, useEffect, useRef } from "react";
import { base44 } from '@/api/base44Client';
import { ArrowRight, ArrowLeft, Mail, KeyRound, UserPlus, Eye, EyeOff, RotateCcw, CheckCircle2, Loader2 } from "lucide-react";

/* ─── Email HTML builder ──────────────────────────────────────── */
function buildEmail({ type, name = '', email = '', code = '', accessCode = '' }) {
  const year = new Date().getFullYear();
  const baseStyles = `
    body { margin: 0; padding: 0; background-color: #0d1829; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .wrapper { width: 100%; background-color: #0d1829; padding: 40px 16px; }
    .container { max-width: 520px; margin: 0 auto; }
    .logo-row { text-align: center; margin-bottom: 32px; }
    .logo-wordmark { display: inline-block; font-size: 22px; font-weight: 800; letter-spacing: -0.03em; color: #f1f5f9; }
    .logo-wordmark span { color: #38bdf8; }
    .logo-sub { display: block; font-size: 11px; color: rgba(255,255,255,0.3); letter-spacing: 0.1em; text-transform: uppercase; margin-top: 4px; font-weight: 400; }
    .card { background: #111e30; border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; overflow: hidden; }
    .card-header { padding: 36px 40px 28px; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .card-header h1 { margin: 0 0 10px; font-size: 22px; font-weight: 700; color: #f1f5f9; letter-spacing: -0.02em; }
    .card-header p { margin: 0; font-size: 14px; color: rgba(255,255,255,0.5); line-height: 1.65; }
    .card-body { padding: 28px 40px; }
    .code-box { background: linear-gradient(135deg, rgba(56,189,248,0.07), rgba(129,140,248,0.07)); border: 1px solid rgba(56,189,248,0.2); border-radius: 14px; padding: 22px; text-align: center; margin: 20px 0; }
    .code-box .code { font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 800; letter-spacing: 0.18em; color: #38bdf8; }
    .code-box .code-label { font-size: 11px; color: rgba(255,255,255,0.3); letter-spacing: 0.12em; text-transform: uppercase; margin-top: 6px; }
    .access-box { background: linear-gradient(135deg, rgba(34,197,94,0.08), rgba(16,163,74,0.04)); border: 1px solid rgba(34,197,94,0.2); border-radius: 14px; padding: 22px; text-align: center; margin: 20px 0; }
    .access-box .code { font-family: 'Courier New', Courier, monospace; font-size: 26px; font-weight: 800; letter-spacing: 0.14em; color: #22c55e; }
    .access-box .code-label { font-size: 11px; color: rgba(255,255,255,0.3); letter-spacing: 0.12em; text-transform: uppercase; margin-top: 6px; }
    .note { background: rgba(255,255,255,0.03); border-left: 3px solid rgba(56,189,248,0.3); border-radius: 0 10px 10px 0; padding: 14px 18px; margin: 20px 0; font-size: 13px; color: rgba(255,255,255,0.45); line-height: 1.6; }
    .note.warning { border-left-color: rgba(251,191,36,0.4); }
    .note.success { border-left-color: rgba(34,197,94,0.4); }
    .divider { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 24px 0; }
    .body-text { font-size: 14px; color: rgba(255,255,255,0.55); line-height: 1.7; margin: 0 0 14px; }
    .highlight { color: #f1f5f9; font-weight: 600; }
    .footer { text-align: center; padding: 28px 40px; }
    .footer p { font-size: 11px; color: rgba(255,255,255,0.2); line-height: 1.7; margin: 0; }
    .footer a { color: rgba(56,189,248,0.5); text-decoration: none; }
    .status-badge-pending { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.25); color: #fbbf24; margin-bottom: 16px; }
    .status-badge-approved { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.25); color: #22c55e; margin-bottom: 16px; }
    .steps { margin: 20px 0; }
    .step { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 14px; }
    .step-num { flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%; background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.2); font-size: 12px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
    .step-text { font-size: 13px; color: rgba(255,255,255,0.5); line-height: 1.6; }
    .step-text strong { color: rgba(255,255,255,0.75); }
  `;
  const logo = `<div class="logo-row"><div class="logo-wordmark">My<span>Weather</span>UK<span class="logo-sub">Early Access</span></div></div>`;
  const footer = `<div class="footer"><p>MyWeatherUK &nbsp;·&nbsp; ${year}<br><a href="#">Unsubscribe</a> &nbsp;·&nbsp; <a href="#">Privacy Policy</a></p></div>`;

  if (type === 'verify') return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Verify your email — MyWeatherUK</title><style>${baseStyles}</style></head><body><div class="wrapper"><div class="container">${logo}<div class="card"><div class="card-header"><h1>Verify your email</h1><p>You're one step away from requesting early access to MyWeatherUK.</p></div><div class="card-body"><div class="code-box"><div class="code">${code}</div><div class="code-label">Email verification code</div></div><div class="note warning">⏱ This code expires in <strong style="color:rgba(255,255,255,0.65)">10 minutes</strong>.</div><hr class="divider"><p class="body-text">If you didn't request access, you can safely ignore this email.</p></div>${footer}</div></div></div></body></html>`;
  if (type === 'requestReceived') return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Access request received</title><style>${baseStyles}</style></head><body><div class="wrapper"><div class="container">${logo}<div class="card"><div class="card-header"><div class="status-badge-pending">Pending Review</div><h1>Request received${name ? `, ${name.split(' ')[0]}` : ''}</h1><p>Thanks for applying. Your request is now in the queue.</p></div><div class="card-body"><div class="steps"><div class="step"><div class="step-num">1</div><div class="step-text"><strong>Review</strong> — We'll look over your application within 24–48 hours.</div></div><div class="step"><div class="step-num">2</div><div class="step-text"><strong>Decision</strong> — You'll receive an email with the outcome.</div></div><div class="step"><div class="step-num">3</div><div class="step-text"><strong>Access granted</strong> — Your personal access code will be included.</div></div></div></div>${footer}</div></div></div></body></html>`;
  if (type === 'accessApproved') return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>You've been approved</title><style>${baseStyles}</style></head><body><div class="wrapper"><div class="container">${logo}<div class="card"><div class="card-header"><div class="status-badge-approved">Approved</div><h1>You're in${name ? `, ${name.split(' ')[0]}` : ''}!</h1><p>Your access request has been approved.</p></div><div class="card-body"><div class="access-box"><div class="code">${accessCode}</div><div class="code-label">Your personal access code</div></div><div class="note success">🔒 Keep this code private.</div></div>${footer}</div></div></div></body></html>`;
  if (type === 'forgotVerify') return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Verify your identity</title><style>${baseStyles}</style></head><body><div class="wrapper"><div class="container">${logo}<div class="card"><div class="card-header"><h1>Identity verification</h1><p>Enter the code below to confirm it's you.</p></div><div class="card-body"><div class="code-box"><div class="code">${code}</div><div class="code-label">Identity verification code</div></div><div class="note warning">⏱ Expires in <strong style="color:rgba(255,255,255,0.65)">10 minutes</strong>.</div></div>${footer}</div></div></div></body></html>`;
  if (type === 'forgotCode') return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Your access code</title><style>${baseStyles}</style></head><body><div class="wrapper"><div class="container">${logo}<div class="card"><div class="card-header"><h1>Here's your access code</h1><p>Use the code below to sign in to MyWeatherUK.</p></div><div class="card-body"><div class="access-box"><div class="code">${accessCode}</div><div class="code-label">Your personal access code</div></div><div class="note success">🔒 Keep this code safe.</div></div>${footer}</div></div></div></body></html>`;
  return '';
}

/* ─── Sky color interpolation ─────────────────────────────────── */
const SKY_COLORS = {
  storm:    [8,12,22,   15,20,35],
  clearing: [20,45,75,  80,120,180],
  sunny:    [20,100,200, 100,180,255],
  clouding: [8,12,22,   15,20,35],
};

function lerpColor(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

function getSkyColors(phase, progress) {
  if (phase === 'storm') return SKY_COLORS.storm;
  if (phase === 'clearing') return lerpColor(SKY_COLORS.storm, SKY_COLORS.sunny, progress);
  if (phase === 'sunny') return SKY_COLORS.sunny;
  return lerpColor(SKY_COLORS.sunny, SKY_COLORS.storm, progress);
}

/* ─── Weather Canvas ──────────────────────────────────────────── */
const PHASE_DURATION = 40000;
const PHASES = ['storm', 'clearing', 'sunny', 'clouding'];

function WeatherCanvas({ phase, progress }) {
  const canvasRef = useRef(null);
  const stateRef = useRef({
    raindrops: [], lightningBolts: [], clouds: [], sunRays: [], tick: 0, lastLightning: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf;
    const s = stateRef.current;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initClouds();
    }

    function initClouds() {
      if (s.clouds.length === 0) {
        s.clouds = Array.from({ length: 8 }, (_, i) => ({
          x: (i / 8) * canvas.width * 1.4 - canvas.width * 0.2,
          y: -40 + Math.random() * 120,
          width: 200 + Math.random() * 220,
          height: 80 + Math.random() * 60,
          speed: 0.15 + Math.random() * 0.1,
          opacity: 0.85 + Math.random() * 0.15,
          dark: Math.random() > 0.4,
          layer: Math.floor(Math.random() * 3),
        }));
      }
    }

    function spawnRaindrop() {
      s.raindrops.push({
        x: Math.random() * canvas.width * 1.3 - canvas.width * 0.15,
        y: -20, speed: 8 + Math.random() * 6, length: 15 + Math.random() * 20,
        alpha: 0.3 + Math.random() * 0.4, wind: -2 + Math.random() * 1,
      });
    }

    function spawnLightning() {
      const x = canvas.width * 0.2 + Math.random() * canvas.width * 0.6;
      const segs = [];
      let cx = x, cy = 60;
      while (cy < canvas.height * 0.55) {
        const nx = cx + (Math.random() - 0.5) * 100;
        const ny = cy + 25 + Math.random() * 35;
        segs.push({ x1: cx, y1: cy, x2: nx, y2: ny });
        cx = nx; cy = ny;
      }
      const branches = [];
      if (segs.length > 2) {
        const branchStart = segs[Math.floor(segs.length * 0.3)];
        let bx = branchStart.x2, by = branchStart.y2;
        for (let i = 0; i < 4; i++) {
          const nx = bx + (Math.random() - 0.4) * 70;
          const ny = by + 20 + Math.random() * 25;
          branches.push({ x1: bx, y1: by, x2: nx, y2: ny });
          bx = nx; by = ny;
        }
      }
      s.lightningBolts.push({ segs, branches, life: 0, maxLife: 18, x });
    }

    function drawSky(skyC) {
      const [tr, tg, tb, br, bg, bb] = skyC;
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, `rgb(${tr},${tg},${tb})`);
      grad.addColorStop(1, `rgb(${br},${bg},${bb})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function drawSun(phaseVal, prog) {
      let sunAlpha = 0;
      if (phaseVal === 'clearing') sunAlpha = prog * 0.6;
      else if (phaseVal === 'sunny') sunAlpha = 0.95;
      else if (phaseVal === 'clouding') sunAlpha = (1 - prog) * 0.7;
      if (sunAlpha <= 0) return;
      const sx = canvas.width * 0.72, sy = 90;
      ctx.save(); ctx.globalAlpha = sunAlpha;
      const glowGrad = ctx.createRadialGradient(sx, sy, 30, sx, sy, 200);
      glowGrad.addColorStop(0, 'rgba(255,220,80,0.35)');
      glowGrad.addColorStop(0.4, 'rgba(255,180,40,0.12)');
      glowGrad.addColorStop(1, 'rgba(255,150,0,0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath(); ctx.arc(sx, sy, 200, 0, Math.PI * 2); ctx.fill();
      const diskGrad = ctx.createRadialGradient(sx - 8, sy - 8, 5, sx, sy, 50);
      diskGrad.addColorStop(0, '#fff9c4'); diskGrad.addColorStop(0.4, '#ffd700'); diskGrad.addColorStop(1, '#ff8c00');
      ctx.fillStyle = diskGrad; ctx.beginPath(); ctx.arc(sx, sy, 50, 0, Math.PI * 2); ctx.fill();
      const rayCount = 12;
      ctx.strokeStyle = 'rgba(255,220,80,0.5)'; ctx.lineWidth = 2;
      for (let i = 0; i < rayCount; i++) {
        const angle = (i / rayCount) * Math.PI * 2 + s.tick * 0.003;
        const inner = 58, outer = 78 + Math.sin(s.tick * 0.05 + i) * 8;
        ctx.beginPath(); ctx.moveTo(sx + Math.cos(angle) * inner, sy + Math.sin(angle) * inner);
        ctx.lineTo(sx + Math.cos(angle) * outer, sy + Math.sin(angle) * outer); ctx.stroke();
      }
      ctx.restore();
    }

    function drawClouds(phaseVal, prog) {
      let cloudDarkness = 0.92, cloudOpacity = 1, coverageY = 0;
      if (phaseVal === 'storm') { cloudDarkness = 0.92; cloudOpacity = 1; coverageY = 0; }
      else if (phaseVal === 'clearing') { cloudDarkness = 0.92 - prog * 0.55; cloudOpacity = 1 - prog * 0.5; coverageY = prog * 80; }
      else if (phaseVal === 'sunny') { cloudDarkness = 0.35; cloudOpacity = 0.35; coverageY = 120; }
      else { cloudDarkness = 0.35 + prog * 0.57; cloudOpacity = 0.35 + prog * 0.65; coverageY = 120 - prog * 120; }
      s.clouds.forEach(cloud => {
        cloud.x += cloud.speed;
        if (cloud.x > canvas.width + 300) cloud.x = -300;
        const cy = cloud.y + coverageY + cloud.layer * 15;
        const dark = cloud.dark && (phaseVal === 'storm' || phaseVal === 'clouding');
        const baseGray = dark ? Math.round((1 - cloudDarkness) * 255 * 0.4) : Math.round((1 - cloudDarkness * 0.3) * 255);
        ctx.save(); ctx.globalAlpha = cloudOpacity * cloud.opacity;
        const drawCloudShape = (ox, oy, scale = 1) => {
          ctx.fillStyle = `rgb(${baseGray},${baseGray},${Math.round(baseGray * (dark ? 1.05 : 1.1))})`;
          const w = cloud.width * scale, h = cloud.height * scale;
          ctx.beginPath(); ctx.ellipse(ox, oy, w * 0.5, h * 0.45, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(ox - w * 0.22, oy + h * 0.1, w * 0.32, h * 0.38, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(ox + w * 0.22, oy + h * 0.08, w * 0.35, h * 0.36, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(ox, oy + h * 0.2, w * 0.45, h * 0.32, 0, 0, Math.PI * 2); ctx.fill();
        };
        drawCloudShape(cloud.x, cy); ctx.restore();
      });
    }

    function drawRain(phaseVal, prog) {
      let rainIntensity = 0;
      if (phaseVal === 'storm') rainIntensity = 1;
      else if (phaseVal === 'clearing') rainIntensity = 1 - prog;
      else if (phaseVal === 'clouding' && prog > 0.7) rainIntensity = (prog - 0.7) / 0.3 * 0.3;
      if (rainIntensity <= 0) return;
      const spawnCount = Math.floor(rainIntensity * 14);
      for (let i = 0; i < spawnCount; i++) spawnRaindrop();
      ctx.save(); ctx.strokeStyle = `rgba(160,200,255,0.55)`; ctx.lineWidth = 1.2;
      for (let i = s.raindrops.length - 1; i >= 0; i--) {
        const r = s.raindrops[i];
        r.x += r.wind; r.y += r.speed;
        ctx.globalAlpha = r.alpha * rainIntensity;
        ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.wind * 2, r.y - r.length); ctx.stroke();
        if (r.y > canvas.height + 30) s.raindrops.splice(i, 1);
      }
      ctx.restore();
    }

    function drawLightning(phaseVal, prog) {
      let lightningChance = 0;
      if (phaseVal === 'storm') lightningChance = 1;
      else if (phaseVal === 'clearing' && prog < 0.4) lightningChance = 1 - prog / 0.4;
      if (lightningChance > 0 && s.tick - s.lastLightning > 120 + Math.random() * 180) {
        if (Math.random() < lightningChance * 0.04) { spawnLightning(); s.lastLightning = s.tick; }
      }
      s.lightningBolts.forEach(bolt => {
        bolt.life++;
        const a = bolt.life < 3 ? bolt.life / 3 : bolt.life > bolt.maxLife - 5 ? (bolt.maxLife - bolt.life) / 5 : 1;
        if (bolt.life < 4) {
          ctx.save(); ctx.fillStyle = `rgba(200,220,255,${0.08 * a})`; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore();
        }
        ctx.save(); ctx.globalAlpha = a * 0.9; ctx.strokeStyle = '#e8f4ff'; ctx.lineWidth = 2.5; ctx.shadowColor = '#a0c4ff'; ctx.shadowBlur = 15;
        ctx.beginPath();
        bolt.segs.forEach((seg, i) => { if (i === 0) ctx.moveTo(seg.x1, seg.y1); else ctx.lineTo(seg.x2, seg.y2); });
        ctx.stroke();
        ctx.strokeStyle = 'rgba(160,200,255,0.4)'; ctx.lineWidth = 6; ctx.shadowBlur = 25;
        ctx.beginPath();
        bolt.segs.forEach((seg, i) => { if (i === 0) ctx.moveTo(seg.x1, seg.y1); else ctx.lineTo(seg.x2, seg.y2); });
        ctx.stroke();
        ctx.strokeStyle = 'rgba(200,230,255,0.6)'; ctx.lineWidth = 1.2; ctx.shadowBlur = 8;
        ctx.beginPath();
        bolt.branches.forEach((seg, i) => { if (i === 0) ctx.moveTo(seg.x1, seg.y1); else ctx.lineTo(seg.x2, seg.y2); });
        ctx.stroke(); ctx.restore();
      });
      for (let i = s.lightningBolts.length - 1; i >= 0; i--) {
        if (s.lightningBolts[i].life > s.lightningBolts[i].maxLife) s.lightningBolts.splice(i, 1);
      }
    }

    function drawFog(phaseVal, prog) {
      let fogAlpha = 0;
      if (phaseVal === 'storm') fogAlpha = 0.18;
      else if (phaseVal === 'clearing') fogAlpha = 0.18 * (1 - prog);
      else if (phaseVal === 'clouding' && prog > 0.5) fogAlpha = (prog - 0.5) * 0.36;
      if (fogAlpha <= 0) return;
      const grad = ctx.createLinearGradient(0, canvas.height * 0.35, 0, canvas.height * 0.7);
      grad.addColorStop(0, `rgba(100,120,160,${fogAlpha})`);
      grad.addColorStop(1, `rgba(80,100,130,0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, canvas.height * 0.35, canvas.width, canvas.height * 0.35);
    }

    function loop() {
      s.tick++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const p = progress.current ?? 0;
      const ph = phase.current ?? 'storm';
      const skyC = getSkyColors(ph, p);
      drawSky(skyC); drawSun(ph, p); drawClouds(ph, p); drawRain(ph, p); drawLightning(ph, p); drawFog(ph, p);
      raf = requestAnimationFrame(loop);
    }

    resize();
    window.addEventListener('resize', resize);
    loop();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }} />;
}

/* ─── Countdown ───────────────────────────────────────────────── */
function Countdown({ target }) {
  const [timeLeft, setTimeLeft] = useState(null);
  useEffect(() => {
    const calc = () => {
      const diff = new Date(target) - new Date();
      if (diff <= 0) return setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      setTimeLeft({ days: Math.floor(diff / 86400000), hours: Math.floor((diff % 86400000) / 3600000), minutes: Math.floor((diff % 3600000) / 60000), seconds: Math.floor((diff % 60000) / 1000) });
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [target]);
  if (!timeLeft) return null;
  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 28 }}>
      {[['Days', timeLeft.days], ['Hours', timeLeft.hours], ['Mins', timeLeft.minutes], ['Secs', timeLeft.seconds]].map(([label, val]) => (
        <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 16, padding: '14px 18px', minWidth: 70, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
          <span style={{ fontSize: '2.2rem', fontWeight: 800, color: '#f1f5f9', fontFamily: 'monospace', lineHeight: 1, letterSpacing: '-0.04em' }}>{String(val).padStart(2, '0')}</span>
          <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', marginTop: 6, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Step indicator ──────────────────────────────────────────── */
function Steps({ steps, current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24 }}>
      {steps.map((label, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700,
              background: i < current ? '#22c55e' : i === current ? 'linear-gradient(135deg,#38bdf8,#818cf8)' : 'rgba(255,255,255,0.07)',
              border: `1.5px solid ${i <= current ? 'transparent' : 'rgba(255,255,255,0.12)'}`,
              color: i <= current ? '#fff' : 'rgba(255,255,255,0.3)',
              transition: 'all 0.4s cubic-bezier(0.4,0,0.2,1)',
              transform: i === current ? 'scale(1.1)' : 'scale(1)',
            }}>
              {i < current ? <CheckCircle2 style={{ width: 14, height: 14 }} /> : i + 1}
            </div>
            <span style={{ fontSize: '0.58rem', color: i === current ? '#94a3b8' : 'rgba(255,255,255,0.25)', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', transition: 'color 0.3s' }}>{label}</span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: 1, background: i < current ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.08)', margin: '0 8px', marginBottom: 20, transition: 'background 0.5s ease' }} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Error banner ────────────────────────────────────────────── */
function ErrorBanner({ msg }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (msg) { setVisible(false); requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true))); }
    else setVisible(false);
  }, [msg]);
  if (!msg) return null;
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 8,
      opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(-6px)', transition: 'opacity 0.25s ease, transform 0.25s ease',
    }}>
      <span>⚠️</span> {msg}
    </div>
  );
}

/* ─── OTP input ───────────────────────────────────────────────── */
function CodeInput({ value, onChange, length = 6 }) {
  const refs = useRef([]);
  const digits = value.split('').concat(Array(length).fill('')).slice(0, length);
  const handleKey = (i, e) => {
    if (e.key === 'Backspace') {
      const next = digits.map((d, idx) => idx === i ? '' : d).join('').slice(0, length);
      onChange(next);
      if (i > 0) refs.current[i - 1]?.focus();
    } else if (/^[a-zA-Z0-9]$/.test(e.key)) {
      const next = [...digits]; next[i] = e.key.toUpperCase();
      onChange(next.join('').slice(0, length));
      if (i < length - 1) refs.current[i + 1]?.focus();
    }
  };
  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData('text').replace(/\s/g, '').toUpperCase().slice(0, length);
    if (pasted) { onChange(pasted); refs.current[Math.min(pasted.length, length - 1)]?.focus(); }
    e.preventDefault();
  };
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
      {digits.map((d, i) => (
        <input key={i} ref={el => refs.current[i] = el} value={d} onChange={() => {}} onKeyDown={e => handleKey(i, e)} onPaste={handlePaste} onFocus={e => e.target.select()} maxLength={1}
          style={{
            width: 44, height: 52, textAlign: 'center', fontSize: '1.3rem', fontWeight: 700,
            background: d ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.06)',
            border: `1.5px solid ${d ? 'rgba(56,189,248,0.45)' : 'rgba(255,255,255,0.12)'}`,
            borderRadius: 12, color: '#f1f5f9', outline: 'none', fontFamily: 'monospace',
            cursor: 'text', caretColor: '#38bdf8', transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
            transform: d ? 'scale(1.04)' : 'scale(1)',
          }} />
      ))}
    </div>
  );
}

/* ─── Btn ─────────────────────────────────────────────────────── */
function Btn({ children, loading, variant = 'primary', ...props }) {
  const styles = {
    primary: { background: 'linear-gradient(135deg,#38bdf8,#818cf8)', color: '#fff', border: 'none' },
    success: { background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', border: 'none' },
    ghost: { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' },
  };
  return (
    <button {...props} disabled={loading || props.disabled}
      style={{ width: '100%', padding: '12px 20px', borderRadius: 12, fontSize: '0.85rem', fontWeight: 700, cursor: loading || props.disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: props.disabled && !loading ? 0.45 : 1, transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)', fontFamily: 'inherit', ...styles[variant], ...props.style }}
      onMouseEnter={e => { if (!loading && !props.disabled) { e.currentTarget.style.filter = 'brightness(1.12)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
      onMouseLeave={e => { e.currentTarget.style.filter = 'none'; e.currentTarget.style.transform = 'none'; }}
      onMouseDown={e => { if (!loading && !props.disabled) e.currentTarget.style.transform = 'scale(0.98)'; }}
      onMouseUp={e => { if (!loading && !props.disabled) e.currentTarget.style.transform = 'translateY(-1px)'; }}>
      {loading ? <><Loader2 style={{ width: 15, height: 15, animation: 'spin 1s linear infinite' }} /> Processing…</> : children}
    </button>
  );
}

/* ─── Animated form container ─────────────────────────────────── */
function AnimatedStep({ children, stepKey }) {
  const [visible, setVisible] = useState(false);
  const prevKey = useRef(stepKey);
  useEffect(() => {
    if (prevKey.current !== stepKey) {
      setVisible(false); prevKey.current = stepKey;
      const t = setTimeout(() => setVisible(true), 50);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => setVisible(true), 30);
      return () => clearTimeout(t);
    }
  }, [stepKey]);
  return (
    <div style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(10px)', transition: 'opacity 0.3s cubic-bezier(0.4,0,0.2,1), transform 0.3s cubic-bezier(0.4,0,0.2,1)' }}>
      {children}
    </div>
  );
}

/* ─── Request Access Form ─────────────────────────────────────── */
function RequestAccessForm({ onDone }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [form, setForm] = useState({ full_name: '', email: '', reason: '' });
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const sendVerification = async (email) => {
    const c = Math.floor(100000 + Math.random() * 900000).toString();
    localStorage.setItem('pending_verify_code', c);
    localStorage.setItem('pending_verify_email', email);
    // Pass HTML as the body — SendEmail renders it as HTML automatically
    await base44.integrations.Core.SendEmail({
      to: email,
      subject: 'Verify your email — MyWeatherUK',
      body: buildEmail({ type: 'verify', email, code: c }),
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('');
    if (!form.full_name.trim()) return setError('Please enter your full name.');
    if (!form.email.trim()) return setError('Please enter your email address.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return setError('Please enter a valid email address.');
    if (!form.reason.trim()) return setError('Please tell us why you are applying.');
    setLoading(true);
    try {
      await sendVerification(form.email);
      setStepIdx(1); setResendCooldown(60);
    } catch {
      setError('Failed to send verification email. Please try again.');
    }
    setLoading(false);
  };

  const handleVerify = async (e) => {
    if (e?.preventDefault) e.preventDefault(); setError('');
    const stored = localStorage.getItem('pending_verify_code');
    if (code.replace(/\s/g, '') !== stored) return setError('Incorrect code. Please check your email and try again.');
    setLoading(true);
    try {
      const savedEmail = localStorage.getItem('pending_verify_email');
      const accessCode = Math.random().toString(36).substring(2, 10).toUpperCase();
      try { await base44.entities.AccessRequest.create({ full_name: form.full_name, email: savedEmail, social_media_handle: form.reason, status: 'pending' }); } catch { }
      try { await base44.entities.SiteAccessCode.create({ email: savedEmail, code: accessCode, is_active: false }); } catch { }
      try {
        await base44.integrations.Core.SendEmail({
          to: savedEmail,
          subject: 'Access request received — MyWeatherUK',
          body: buildEmail({ type: 'requestReceived', name: form.full_name, email: savedEmail }),
        });
      } catch { }
      localStorage.removeItem('pending_verify_code'); localStorage.removeItem('pending_verify_email');
      setStepIdx(2); setTimeout(() => onDone('requested'), 2000);
    } catch { setError('Something went wrong. Please try again.'); }
    setLoading(false);
  };

  const fieldStyle = {
    width: '100%', boxSizing: 'border-box', padding: '11px 14px 11px 38px',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 12, color: '#f1f5f9', fontSize: '0.85rem', outline: 'none',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease',
    fontFamily: 'inherit',
  };
  const onFocus = e => { e.target.style.borderColor = 'rgba(56,189,248,0.5)'; e.target.style.boxShadow = '0 0 0 3px rgba(56,189,248,0.08)'; e.target.style.background = 'rgba(255,255,255,0.09)'; };
  const onBlur = e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; e.target.style.boxShadow = 'none'; e.target.style.background = 'rgba(255,255,255,0.06)'; };

  return (
    <div>
      <Steps steps={['Details', 'Verify', 'Done']} current={stepIdx} />
      <AnimatedStep stepKey={stepIdx}>
        {stepIdx === 0 && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ErrorBanner msg={error} />
            <div style={{ position: 'relative' }}>
              <UserPlus style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
              <input placeholder="Full name" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} disabled={loading} style={fieldStyle} onFocus={onFocus} onBlur={onBlur} />
            </div>
            <div style={{ position: 'relative' }}>
              <Mail style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
              <input type="email" placeholder="Email address" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} disabled={loading} style={fieldStyle} onFocus={onFocus} onBlur={onBlur} />
            </div>
            <textarea placeholder="Why are you applying for access?" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} disabled={loading} rows={3}
              style={{ padding: '11px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, color: '#f1f5f9', fontSize: '0.85rem', outline: 'none', resize: 'none', fontFamily: 'inherit', transition: 'border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease' }}
              onFocus={e => { e.target.style.borderColor = 'rgba(56,189,248,0.5)'; e.target.style.boxShadow = '0 0 0 3px rgba(56,189,248,0.08)'; e.target.style.background = 'rgba(255,255,255,0.09)'; }}
              onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; e.target.style.boxShadow = 'none'; e.target.style.background = 'rgba(255,255,255,0.06)'; }} />
            <Btn loading={loading}>Submit Request <ArrowRight style={{ width: 15, height: 15 }} /></Btn>
          </form>
        )}
        {stepIdx === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8, animation: 'wobble 0.6s ease' }}>📬</div>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.83rem', lineHeight: 1.6, margin: 0 }}>We sent a 6-digit code to<br /><strong style={{ color: '#38bdf8' }}>{form.email}</strong></p>
            </div>
            <ErrorBanner msg={error} />
            <CodeInput value={code} onChange={setCode} length={6} />
            <Btn loading={loading} onClick={handleVerify} disabled={code.length < 6 || loading}>Verify & Submit <ArrowRight style={{ width: 15, height: 15 }} /></Btn>
            <button onClick={async () => {
              if (resendCooldown > 0) return;
              setLoading(true);
              await sendVerification(form.email);
              setLoading(false); setResendCooldown(60);
            }} disabled={resendCooldown > 0}
              style={{ background: 'none', border: 'none', color: resendCooldown > 0 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.5)', fontSize: '0.75rem', cursor: resendCooldown > 0 ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, transition: 'color 0.2s' }}>
              <RotateCcw style={{ width: 12, height: 12 }} /> {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
            </button>
          </div>
        )}
        {stepIdx === 2 && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', animation: 'popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}>
              <CheckCircle2 style={{ width: 28, height: 28, color: '#22c55e' }} />
            </div>
            <p style={{ color: '#22c55e', fontWeight: 700, fontSize: '0.95rem', margin: '0 0 6px' }}>Request submitted!</p>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem', margin: 0 }}>Check your email for your access code once approved.</p>
          </div>
        )}
      </AnimatedStep>
    </div>
  );
}

/* ─── Sign In Form ────────────────────────────────────────────── */
// Accepts the universal access key (from settings) in addition to per-user codes.
function SignInForm({ onGrantAccess, universalKey }) {
  const [view, setView] = useState('main');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [verifyCode, setVerify] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const navigate = (v) => { setView(v); setError(''); };

  const handleSignIn = async (e) => {
    e.preventDefault(); setError('');
    if (!code.trim()) return setError('Please enter your access code.');
    setLoading(true);

    const entered = code.trim().toUpperCase();

    // Check universal key first (no DB query needed)
    if (universalKey && entered === universalKey.toUpperCase()) {
      localStorage.setItem('site_access_granted', 'true');
      localStorage.setItem('site_access_email', 'universal');
      setLoading(false);
      onGrantAccess();
      return;
    }

    // Fall back to per-user codes
    const records = await base44.entities.SiteAccessCode.list();
    const match = records.find(r => r.code === entered && r.is_active);
    setLoading(false);
    if (match) {
      localStorage.setItem('site_access_granted', 'true');
      localStorage.setItem('site_access_email', match.email);
      onGrantAccess();
    } else {
      setError('Invalid or inactive code. Please check and try again.');
    }
  };

  const handleForgotSend = async (e) => {
    e.preventDefault(); setError('');
    if (!email.trim()) return setError('Enter your email address.');
    setLoading(true);
    const c = Math.floor(100000 + Math.random() * 900000).toString();
    localStorage.setItem('forgot_verify_code', c); localStorage.setItem('forgot_verify_email', email.trim());
    await base44.integrations.Core.SendEmail({
      to: email.trim(),
      subject: 'Verify your identity — MyWeatherUK',
      body: buildEmail({ type: 'forgotVerify', email: email.trim(), code: c }),
    });
    setLoading(false); navigate('forgotVerify'); setResendCooldown(60);
  };

  const handleForgotVerify = async (e) => {
    e.preventDefault(); setError('');
    const stored = localStorage.getItem('forgot_verify_code');
    const storedEmail = localStorage.getItem('forgot_verify_email');
    if (verifyCode.trim() !== stored) return setError('Incorrect code.');
    setLoading(true);
    const records = await base44.entities.SiteAccessCode.filter({ email: storedEmail });
    const active = records.find(r => r.is_active);
    if (active) {
      await base44.integrations.Core.SendEmail({
        to: storedEmail,
        subject: 'Your MyWeatherUK access code',
        body: buildEmail({ type: 'forgotCode', email: storedEmail, accessCode: active.code }),
      });
    }
    localStorage.removeItem('forgot_verify_code'); localStorage.removeItem('forgot_verify_email');
    setLoading(false); navigate('forgotDone');
  };

  const inputBase = { width: '100%', boxSizing: 'border-box', padding: '11px 14px 11px 38px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, color: '#f1f5f9', fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease' };
  const onFocusIn = e => { e.target.style.borderColor = 'rgba(56,189,248,0.5)'; e.target.style.boxShadow = '0 0 0 3px rgba(56,189,248,0.08)'; e.target.style.background = 'rgba(255,255,255,0.09)'; };
  const onFocusOut = e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; e.target.style.boxShadow = 'none'; e.target.style.background = 'rgba(255,255,255,0.06)'; };

  const BackBtn = ({ to, label = 'Back to sign in' }) => (
    <button onClick={() => navigate(to)}
      style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, transition: 'color 0.2s', width: '100%' }}
      onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.65)'}
      onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}>
      <ArrowLeft style={{ width: 12, height: 12 }} /> {label}
    </button>
  );

  return (
    <AnimatedStep stepKey={view}>
      {view === 'forgot' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ textAlign: 'center', marginBottom: 4 }}>
            <div style={{ fontSize: '1.8rem', marginBottom: 6 }}>🔑</div>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.8rem', margin: 0, lineHeight: 1.6 }}>Enter your email and we'll verify your identity, then resend your access code.</p>
          </div>
          <ErrorBanner msg={error} />
          <div style={{ position: 'relative' }}>
            <Mail style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'rgba(255,255,255,0.3)' }} />
            <input type="email" placeholder="Your email address" value={email} onChange={e => setEmail(e.target.value)} style={inputBase} onFocus={onFocusIn} onBlur={onFocusOut} />
          </div>
          <Btn loading={loading} onClick={handleForgotSend}>Send Verification Code <ArrowRight style={{ width: 15, height: 15 }} /></Btn>
          <BackBtn to="main" />
        </div>
      )}

      {view === 'forgotVerify' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ textAlign: 'center', marginBottom: 4 }}>
            <div style={{ fontSize: '1.8rem', marginBottom: 6 }}>📧</div>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.8rem', margin: 0, lineHeight: 1.6 }}>Code sent to <strong style={{ color: '#38bdf8' }}>{localStorage.getItem('forgot_verify_email')}</strong></p>
          </div>
          <ErrorBanner msg={error} />
          <CodeInput value={verifyCode} onChange={setVerify} length={6} />
          <Btn loading={loading} onClick={handleForgotVerify} disabled={verifyCode.length < 6}>Verify Identity</Btn>
          <button onClick={async () => {
            if (resendCooldown > 0) return;
            const c = Math.floor(100000 + Math.random() * 900000).toString();
            localStorage.setItem('forgot_verify_code', c);
            const em = localStorage.getItem('forgot_verify_email');
            await base44.integrations.Core.SendEmail({
              to: em,
              subject: 'Verify your identity — MyWeatherUK',
              body: buildEmail({ type: 'forgotVerify', email: em, code: c }),
            });
            setResendCooldown(60);
          }} disabled={resendCooldown > 0}
            style={{ background: 'none', border: 'none', color: resendCooldown > 0 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.5)', fontSize: '0.75rem', cursor: resendCooldown > 0 ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, transition: 'color 0.2s' }}>
            <RotateCcw style={{ width: 12, height: 12 }} /> {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
          </button>
        </div>
      )}

      {view === 'forgotDone' && (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', animation: 'popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}>
            <Mail style={{ width: 24, height: 24, color: '#22c55e' }} />
          </div>
          <p style={{ color: '#22c55e', fontWeight: 700, fontSize: '0.9rem', margin: '0 0 6px' }}>Access code sent!</p>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.78rem', margin: '0 0 16px' }}>Check your inbox and use the code to sign in.</p>
          <BackBtn to="main" label="Back to sign in" />
        </div>
      )}

      {view === 'main' && (
        <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ErrorBanner msg={error} />
          <div style={{ position: 'relative' }}>
            <KeyRound style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
            <input placeholder="Enter your access code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} disabled={loading} type={showCode ? 'text' : 'password'}
              style={{ ...inputBase, padding: '11px 44px 11px 38px', fontSize: '0.9rem', letterSpacing: '0.12em', fontFamily: 'monospace', fontWeight: 700 }}
              onFocus={onFocusIn} onBlur={onFocusOut} />
            <button type="button" onClick={() => setShowCode(v => !v)}
              style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', padding: 0, transition: 'color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.65)'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.35)'}>
              {showCode ? <EyeOff style={{ width: 15, height: 15 }} /> : <Eye style={{ width: 15, height: 15 }} />}
            </button>
          </div>
          <Btn variant="success" loading={loading} disabled={!code.trim()}>Sign In <ArrowRight style={{ width: 15, height: 15 }} /></Btn>
          <button type="button" onClick={() => navigate('forgot')}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center', transition: 'color 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.6)'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.35)'}>
            Forgot your code?
          </button>
        </form>
      )}
    </AnimatedStep>
  );
}

/* ─── Panel ───────────────────────────────────────────────────── */
function Panel({ icon, title, subtitle, expanded, onToggle, children }) {
  const [contentHeight, setContentHeight] = useState(0);
  const contentRef = useRef(null);

  useEffect(() => {
    if (!contentRef.current) return;
    if (expanded) { setContentHeight(contentRef.current.scrollHeight); } else { setContentHeight(0); }
  }, [expanded]);

  useEffect(() => {
    if (!expanded || !contentRef.current) return;
    const observer = new ResizeObserver(() => {
      if (contentRef.current) setContentHeight(contentRef.current.scrollHeight);
    });
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [expanded]);

  return (
    <div style={{
      background: 'rgba(10,18,35,0.75)', backdropFilter: 'blur(20px)',
      border: `1px solid ${expanded ? 'rgba(56,189,248,0.3)' : 'rgba(255,255,255,0.1)'}`,
      borderRadius: 18, overflow: 'hidden',
      transition: 'border-color 0.35s cubic-bezier(0.4,0,0.2,1), box-shadow 0.35s ease',
      boxShadow: expanded ? '0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(56,189,248,0.05)' : '0 8px 32px rgba(0,0,0,0.4)',
    }}>
      <button onClick={onToggle}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'background 0.2s' }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}>
        <div style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          background: expanded ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${expanded ? 'rgba(56,189,248,0.25)' : 'rgba(255,255,255,0.08)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.35s cubic-bezier(0.4,0,0.2,1)',
          transform: expanded ? 'scale(1.05)' : 'scale(1)',
        }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: expanded ? '#f1f5f9' : 'rgba(255,255,255,0.75)', transition: 'color 0.25s' }}>{title}</p>
          <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', whiteSpace: 'pre-line', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.45 }}>{subtitle}</p>
        </div>
        <div style={{
          width: 24, height: 24, borderRadius: 8, background: 'rgba(255,255,255,0.05)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.35s cubic-bezier(0.4,0,0.2,1)',
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
      </button>
      <div style={{ height: contentHeight, overflow: 'hidden', transition: 'height 0.4s cubic-bezier(0.4,0,0.2,1)' }}>
        <div ref={contentRef} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '0 20px 20px' }}>
          <div style={{ paddingTop: 18 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ─── Weather Brand Text ──────────────────────────────────────── */
function WeatherBrandText({ phase, progress, stormText, sunnyText, settings }) {
  const isStormy = phase === 'storm' || (phase === 'clearing' && progress < 0.5) || (phase === 'clouding' && progress > 0.6);
  const countdownActive = settings?.countdown_enabled && settings?.countdown_target && settings?.countdown_display !== 'homepage';

  const adminTitle = (settings?.disabled_title || '').trim();
  const adminMessage = (settings?.disabled_message || '').trim();

  const title = adminTitle
    || (isStormy
        ? (stormText?.title || sunnyText?.title || settings?.countdown_title || 'TCM Storm Centre')
        : (sunnyText?.title || stormText?.title || settings?.countdown_title || 'MyWeatherUK'));

  const message = adminMessage
    || (isStormy
        ? (stormText?.message || "Professional storm chasing and severe weather tracking across the UK.")
        : (sunnyText?.message || "Your trusted source for UK weather forecasts and alerts."));

  return (
    <div style={{ textAlign: 'center', marginBottom: 32, transition: 'all 1s cubic-bezier(0.4,0,0.2,1)' }}>
      <div style={{
        width: 88, height: 88, borderRadius: 24, background: 'rgba(0,0,0,0.4)',
        border: `1px solid ${isStormy ? 'rgba(129,140,248,0.3)' : 'rgba(56,189,248,0.3)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
        boxShadow: isStormy ? '0 0 50px rgba(129,140,248,0.2)' : '0 0 50px rgba(255,200,50,0.2)',
        overflow: 'hidden', backdropFilter: 'blur(8px)',
        transition: 'border-color 1s ease, box-shadow 1s ease',
      }}>
        <img src={settings?.tcm_logo_url || '/IMG_7372__2_.PNG'} alt="Logo"
          onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          style={{ width: 76, height: 76, objectFit: 'contain', objectPosition: 'center' }} />
        <span style={{ fontSize: '2.2rem', display: 'none', alignItems: 'center', justifyContent: 'center' }}>
          {isStormy ? '⛈️' : '☀️'}
        </span>
      </div>
      <h1 style={{
        margin: '0 0 10px', fontSize: '1.9rem', fontWeight: 800, color: '#f1f5f9',
        letterSpacing: '-0.03em', lineHeight: 1.15,
        transition: 'text-shadow 1s ease',
        textShadow: isStormy ? '0 0 30px rgba(129,140,248,0.4)' : '0 2px 20px rgba(0,0,0,0.5)',
      }}>{title}</h1>
      <p style={{ margin: 0, color: 'rgba(255,255,255,0.65)', fontSize: '0.9rem', lineHeight: 1.7, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>{message}</p>
      {countdownActive && (
        <>
          {settings?.countdown_description && (
            <p style={{ margin: '10px 0 0', color: 'rgba(255,255,255,0.3)', fontSize: '0.78rem' }}>
              {settings.countdown_description}
            </p>
          )}
          <Countdown target={settings.countdown_target} />
        </>
      )}
    </div>
  );
}

/* ─── Main export ─────────────────────────────────────────────── */
export default function SiteDisabled({ settings, onAccessGranted }) {
  const [panel, setPanel] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [currentPhase, setCurrentPhase] = useState('storm');
  const [phaseProgress, setPhaseProgress] = useState(0);
  const phaseRef = useRef('storm');
  const progressRef = useRef(0);
  const phaseStartRef = useRef(Date.now());

  useEffect(() => { setTimeout(() => setMounted(true), 80); }, []);

  useEffect(() => {
    let raf;
    const tick = () => {
      const elapsed = Date.now() - phaseStartRef.current;
      const prog = Math.min(elapsed / PHASE_DURATION, 1);
      progressRef.current = prog;
      setPhaseProgress(prog);
      if (prog >= 1) {
        const idx = PHASES.indexOf(phaseRef.current);
        const next = PHASES[(idx + 1) % PHASES.length];
        phaseRef.current = next;
        setCurrentPhase(next);
        phaseStartRef.current = Date.now();
        progressRef.current = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const stormText = settings?.storm_text ? JSON.parse(settings.storm_text) : null;
  const sunnyText = settings?.sunny_text ? JSON.parse(settings.sunny_text) : null;
  const universalKey = (settings?.universal_access_key || '').trim() || null;

  const panelTitle = (settings?.disabled_title || '').trim() || 'Request Access';
  const panelSubtitle = (settings?.disabled_message || '').trim() || 'Apply for an access code';

  const togglePanel = (id) => setPanel(p => p === id ? null : id);

  const cloudCoverPx = currentPhase === 'storm' ? 160
    : currentPhase === 'sunny' ? 60
    : currentPhase === 'clearing' ? 160 - phaseProgress * 100
    : 60 + phaseProgress * 100;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', fontFamily: "'system-ui', sans-serif", position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:translateY(0); } }
        @keyframes popIn { 0% { transform:scale(0.5); opacity:0; } 70% { transform:scale(1.1); } 100% { transform:scale(1); opacity:1; } }
        @keyframes wobble { 0%,100% { transform: rotate(0); } 20% { transform: rotate(-12deg); } 60% { transform: rotate(8deg); } }
        @keyframes shimmer { 0% { opacity:0.5; } 50% { opacity:1; } 100% { opacity:0.5; } }
        ::placeholder { color: rgba(255,255,255,0.3) !important; }
        * { box-sizing: border-box; }
      `}</style>

      <WeatherCanvas phase={phaseRef} progress={progressRef} />

      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: cloudCoverPx + 40, background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.15) 100%)', pointerEvents: 'none', zIndex: 1, transition: 'height 2s ease' }} />

      <div style={{
        position: 'relative', zIndex: 10, width: '100%', maxWidth: 460,
        marginTop: Math.max(cloudCoverPx - 60, 0),
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(28px)',
        transition: 'opacity 0.7s cubic-bezier(0.4,0,0.2,1), transform 0.7s cubic-bezier(0.4,0,0.2,1), margin-top 2s ease',
      }}>
        <WeatherBrandText phase={currentPhase} progress={phaseProgress} stormText={stormText} sunnyText={sunnyText} settings={settings} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
          <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 }}>Access</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!submitted ? (
            <Panel
              icon={<UserPlus style={{ width: 18, height: 18, color: panel === 'request' ? '#38bdf8' : 'rgba(255,255,255,0.4)', transition: 'color 0.25s' }} />}
              title={panelTitle}
              subtitle={panelSubtitle}
              expanded={panel === 'request'}
              onToggle={() => togglePanel('request')}>
              <RequestAccessForm onDone={(s) => { if (s === 'requested') { setPanel(null); setSubmitted(true); } }} />
            </Panel>
          ) : (
            <div style={{ padding: '20px', borderRadius: 18, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)', backdropFilter: 'blur(20px)', display: 'flex', alignItems: 'flex-start', gap: 14, animation: 'fadeUp 0.4s cubic-bezier(0.4,0,0.2,1)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <CheckCircle2 style={{ width: 20, height: 20, color: '#22c55e' }} />
              </div>
              <div>
                <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#22c55e', fontSize: '0.88rem' }}>Request submitted!</p>
                <p style={{ margin: 0, color: 'rgba(255,255,255,0.45)', fontSize: '0.78rem', lineHeight: 1.6 }}>You'll receive your access code by email once approved.</p>
                <button onClick={() => setSubmitted(false)}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit', marginTop: 8, padding: 0, transition: 'color 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.55)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}>
                  Submit another request
                </button>
              </div>
            </div>
          )}

          <Panel
            icon={<KeyRound style={{ width: 18, height: 18, color: panel === 'signin' ? '#22c55e' : 'rgba(255,255,255,0.4)', transition: 'color 0.25s' }} />}
            title="Sign In"
            subtitle="Already have an access code?"
            expanded={panel === 'signin'}
            onToggle={() => togglePanel('signin')}>
            <SignInForm onGrantAccess={onAccessGranted} universalKey={universalKey} />
          </Panel>
        </div>

        <p style={{ textAlign: 'center', marginTop: 28, fontSize: '0.65rem', color: 'rgba(255,255,255,0.15)', letterSpacing: '0.08em' }}>
          MyWeatherUK — Early Access
        </p>
      </div>
    </div>
  );
}