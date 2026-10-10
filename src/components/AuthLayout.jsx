import React from "react";
import { CloudLightning } from "lucide-react";

export default function AuthLayout({ icon: Icon, title, subtitle, footer, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 relative overflow-hidden"
      style={{
        background: 'linear-gradient(170deg, #060b18 0%, #0b1424 35%, #0f1a2e 70%, #060b18 100%)',
      }}
    >
      {/* Atmospheric background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div style={{
          position: 'absolute', top: '15%', left: '-15%',
          width: 500, height: 500, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(56,189,248,0.06) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', bottom: '10%', right: '-10%',
          width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(129,140,248,0.05) 0%, transparent 70%)',
        }} />
        {/* Subtle dot grid */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.03,
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.4) 0.5px, transparent 0.5px)',
          backgroundSize: '28px 28px',
        }} />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(56,189,248,0.20), rgba(129,140,248,0.20))', border: '1px solid rgba(56,189,248,0.25)' }}>
              <CloudLightning className="w-5 h-5 text-sky-400" strokeWidth={2} />
            </div>
            <span className="text-sm font-extrabold tracking-[0.18em] uppercase text-slate-400">MyWeatherUK</span>
          </div>

          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, rgba(56,189,248,0.12), rgba(129,140,248,0.12))', border: '1px solid rgba(56,189,248,0.2)' }}>
            <Icon className="w-7 h-7 text-sky-400" aria-hidden="true" strokeWidth={1.8} />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-100">{title}</h1>
          {subtitle && <p className="text-slate-400 text-sm mt-2">{subtitle}</p>}
        </div>

        {/* Card */}
        <div className="rounded-2xl p-8 relative overflow-hidden"
          style={{
            background: 'linear-gradient(155deg, rgba(30,41,59,0.55) 0%, rgba(15,23,42,0.65) 100%)',
            border: '1px solid rgba(148,163,184,0.15)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
            backdropFilter: 'blur(18px) saturate(140%)',
            WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          }}
        >
          {/* Glass sheen */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
            background: 'linear-gradient(160deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)',
            pointerEvents: 'none',
          }} />
          <div className="relative z-10">
            {children}
          </div>
        </div>

        {footer && (
          <p className="text-center text-sm text-slate-400 mt-6">{footer}</p>
        )}
      </div>
    </div>
  );
}