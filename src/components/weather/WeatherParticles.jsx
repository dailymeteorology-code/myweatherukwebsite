import React, { useEffect, useRef } from 'react';

/**
 * Falling weather, on a canvas.
 *
 * Extracted from the backgrounds library so the Location Forecast page gets the
 * same rain rather than a second implementation that drifts. Rain, snow, hail
 * and sleet genuinely ARE particles: thousands of short-lived independent
 * sprites are what a canvas is for, and doing it declaratively would mean one
 * DOM node per drop.
 *
 * Density scales with the element's area, so the same config looks right in an
 * 80px library tile and behind a full-screen forecast.
 */
export default function WeatherParticles({ type, count, speed, className = '' }) {
  const canvasRef = useRef(null);
  const cfg = { particles: type, count, speed };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cfg?.particles) return;

    canvas.width = canvas.offsetWidth || 120;
    canvas.height = canvas.offsetHeight || 64;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    const type = cfg.particles;
    const count = Math.round((cfg.count || 60) * (W * H) / (400 * 200));
    const spd = cfg.speed || (type === 'torrential' ? 15 : type === 'rain' ? 8 : type === 'sleet' ? 7 : type === 'blizzard' ? 4.5 : type === 'heavySnow' ? 1.5 : type === 'snow' ? 1.2 : type === 'hail' ? 10 : 1);

    const particles = Array.from({ length: count }, () => mkP(W, H, type, spd, true));

    function mkP(W, H, type, spd, init = false) {
      const x = Math.random() * W;
      const y = init ? Math.random() * H : -8;
      if (type === 'fog') {
        return { x, y: Math.random() * H, vx: 0.15 + Math.random() * 0.2, vy: 0, w: 40 + Math.random() * 60, op: 0.04 + Math.random() * 0.06 };
      }
      if (type === 'wind') {
        return { x, y: Math.random() * H, vx: 1 + Math.random() * 2, vy: (Math.random() - 0.5) * 0.3, len: 15 + Math.random() * 30, op: 0.04 + Math.random() * 0.08 };
      }
      if (type === 'snow' || type === 'heavySnow') {
        const bigFlake = type === 'heavySnow' && Math.random() < 0.3;
        return { x, y, r: bigFlake ? 2.5 + Math.random() * 2 : 1 + Math.random() * 2, vy: spd * (0.6 + Math.random()), vx: (Math.random() - 0.5) * 0.5, phase: Math.random() * Math.PI * 2, op: 0.5 + Math.random() * 0.5 };
      }
      if (type === 'blizzard') {
        return { x, y, r: 1 + Math.random() * 2.5, vy: spd * (0.7 + Math.random()), vx: -(1.5 + Math.random() * 2.5), phase: Math.random() * Math.PI * 2, op: 0.5 + Math.random() * 0.5 };
      }
      if (type === 'hail') {
        return { x, y, r: 1.5 + Math.random() * 2, vy: spd + Math.random() * 3, vx: (Math.random() - 0.5), op: 0.6 + Math.random() * 0.4 };
      }
      if (type === 'sleet') {
        return { x, y, vy: spd + Math.random() * 2, vx: -0.5 - Math.random(), len: 5 + Math.random() * 4, op: 0.4 + Math.random() * 0.4, isSnow: Math.random() < 0.35, r: 1 + Math.random() * 1.5 };
      }
      // rain / drizzle / torrential
      const len = type === 'torrential' ? 18 + Math.random() * 10 : type === 'drizzle' ? 4 + Math.random() * 3 : 8 + Math.random() * 6;
      const wx = type === 'torrential' ? -(0.8 + Math.random() * 0.5) : -0.2 - Math.random() * 0.3;
      return { x, y, vy: spd + Math.random() * (type === 'drizzle' ? 1.5 : 3), vx: wx, len, op: 0.3 + Math.random() * 0.5 };
    }

    let animId;
    let t = 0;
    function draw() {
      ctx.clearRect(0, 0, W, H);
      t += 0.016;
      for (const p of particles) {
        if (type === 'fog') {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.w);
          g.addColorStop(0, `rgba(255,255,255,${p.op})`);
          g.addColorStop(1, `rgba(255,255,255,0)`);
          ctx.fillStyle = g;
          ctx.fillRect(p.x - p.w, p.y - p.w * 0.5, p.w * 2, p.w);
          p.x += p.vx;
          if (p.x > W + p.w) p.x = -p.w;
          continue;
        }
        if (type === 'wind') {
          p.x += p.vx;
          p.y += p.vy;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.len, p.y);
          ctx.strokeStyle = `rgba(200,220,255,${p.op})`;
          ctx.lineWidth = 0.7;
          ctx.stroke();
          if (p.x > W + p.len) { p.x = -p.len; p.y = Math.random() * H; }
          continue;
        }
        if (type === 'snow' || type === 'heavySnow') {
          p.x += p.vx + Math.sin(t + p.phase) * 0.3;
          p.y += p.vy;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(210,230,255,${p.op})`;
          ctx.fill();
          if (p.y > H + 4) Object.assign(p, mkP(W, H, type, spd));
          continue;
        }
        if (type === 'blizzard') {
          p.x += p.vx;
          p.y += p.vy + Math.sin(t + p.phase) * 0.4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(220,235,255,${p.op})`;
          ctx.fill();
          if (p.y > H + 4 || p.x < -4) Object.assign(p, { ...mkP(W, H, type, spd), x: W + 4 });
          continue;
        }
        if (type === 'hail') {
          p.x += p.vx;
          p.y += p.vy;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(200,225,255,${p.op})`;
          ctx.strokeStyle = `rgba(150,200,240,${p.op * 0.7})`;
          ctx.lineWidth = 0.5;
          ctx.fill();
          ctx.stroke();
          if (p.y > H + 4) Object.assign(p, mkP(W, H, type, spd));
          continue;
        }
        if (type === 'sleet') {
          p.x += p.vx;
          p.y += p.vy;
          if (p.isSnow) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(210,230,255,${p.op})`;
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - (p.vx / p.vy) * p.len, p.y - p.len);
            ctx.strokeStyle = `rgba(140,180,220,${p.op})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          if (p.y > H + 6) Object.assign(p, mkP(W, H, type, spd));
          continue;
        }
        // rain / drizzle / torrential
        p.x += p.vx;
        p.y += p.vy;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - (p.vx / p.vy) * p.len, p.y - p.len);
        ctx.strokeStyle = type === 'drizzle' ? `rgba(180,210,240,${p.op * 0.5})` : type === 'torrential' ? `rgba(100,140,200,${p.op * 0.85})` : `rgba(140,180,230,${p.op * 0.7})`;
        ctx.lineWidth = type === 'drizzle' ? 0.6 : type === 'torrential' ? 2.0 : 1.2;
        ctx.stroke();
        if (p.y > H + 20) Object.assign(p, mkP(W, H, type, spd));
      }
      animId = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(animId);
  }, [cfg?.particles, cfg?.count, cfg?.speed]);

  if (!type) return null;
  return <canvas ref={canvasRef} className={className || 'absolute inset-0 w-full h-full'} />;
}
