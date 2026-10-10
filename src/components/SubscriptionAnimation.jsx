import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const BADGE_CONFIG = {
  lite: {
    name: 'Silver',
    gradient: 'from-slate-300 via-slate-100 to-slate-400',
    glow: 'rgba(148,163,184,0.6)',
    ring: 'border-slate-300',
    text: 'text-slate-700',
    features: ['Ad-free experience', '10 saved locations', '30 location searches/day'],
  },
  pro: {
    name: 'Gold',
    gradient: 'from-amber-400 via-yellow-200 to-amber-500',
    glow: 'rgba(251,191,36,0.6)',
    ring: 'border-amber-400',
    text: 'text-amber-800',
    features: ['Unlimited location searches', 'Unlimited saved locations', 'Radar updates every 5 minutes', 'In-depth warning info'],
  },
  elite: {
    name: 'Platinum',
    gradient: 'from-sky-200 via-white to-indigo-300',
    glow: 'rgba(147,197,253,0.6)',
    ring: 'border-sky-300',
    text: 'text-sky-800',
    features: ['Priority features', 'Exclusive content', 'All Pro features'],
  },
  developer: {
    name: 'Diamond',
    gradient: 'from-cyan-300 via-white to-purple-300',
    glow: 'rgba(103,232,249,0.6)',
    ring: 'border-cyan-300',
    text: 'text-cyan-900',
    features: ['API access', 'Webhook integrations', 'Priority support', 'Early access to new features', 'Custom data exports'],
  },
};

const PIECES = Array.from({ length: 8 }, (_, i) => ({
  id: i,
  angle: (i / 8) * 360,
  delay: i * 0.06,
}));

export default function SubscriptionAnimation({ tier, planName, onClose }) {
  const [phase, setPhase] = useState('assembling'); // assembling | zoom | features
  const cfg = BADGE_CONFIG[tier] || BADGE_CONFIG.lite;
  const audioRef = useRef(null);

  useEffect(() => {
    // Gentle chime via Web Audio API
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const frequencies = [523, 659, 784, 1047];
      frequencies.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.15);
        gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + i * 0.15 + 0.05);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.15 + 0.4);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.5);
      });
    } catch {}

    const t1 = setTimeout(() => setPhase('zoom'), 1000);
    const t2 = setTimeout(() => setPhase('features'), 1600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md px-4">
      {/* Accessibility warning */}
      <div className="sr-only" role="alert">
        This screen contains animation. If you are sensitive to flashing content, you may close this window.
      </div>
      <div className="bg-amber-900/40 border border-amber-500/40 text-amber-300 text-xs px-3 py-1.5 rounded-full absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
        <AlertTriangle className="w-3 h-3" /> Contains animation
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gradient-to-b from-slate-900 to-slate-800 border border-slate-700 rounded-3xl p-8 max-w-md w-full text-center shadow-2xl"
      >
        {/* Badge assembly */}
        <div className="relative flex items-center justify-center mb-8" style={{ height: 160 }}>
          {/* Pieces flying in */}
          {phase === 'assembling' && PIECES.map(p => (
            <motion.div
              key={p.id}
              initial={{
                x: Math.cos((p.angle * Math.PI) / 180) * 120,
                y: Math.sin((p.angle * Math.PI) / 180) * 120,
                opacity: 0,
                scale: 0.5,
              }}
              animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              transition={{ delay: p.delay, duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
              className={`absolute w-12 h-12 rounded-full bg-gradient-to-br ${cfg.gradient} opacity-60`}
              style={{ filter: `blur(4px)` }}
            />
          ))}

          {/* Assembled badge */}
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={phase !== 'assembling' ? {
              scale: phase === 'zoom' ? 1.3 : 1,
              opacity: 1,
            } : { scale: 0, opacity: 0 }}
            transition={{ duration: 0.5, type: 'spring', stiffness: 200 }}
            className={`w-32 h-32 rounded-full bg-gradient-to-br ${cfg.gradient} border-4 ${cfg.ring} flex items-center justify-center shadow-2xl`}
            style={{ boxShadow: `0 0 40px ${cfg.glow}` }}
          >
            <span className={`text-lg font-black ${cfg.text}`}>{cfg.name}</span>
          </motion.div>
        </div>

        <AnimatePresence>
          {phase === 'features' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <h2 className="text-2xl font-bold text-white mb-1">Welcome to {planName}!</h2>
              <p className="text-slate-400 text-sm mb-6">Your {cfg.name} badge has been unlocked</p>

              <div className="bg-slate-800/60 rounded-2xl p-4 mb-6 text-left space-y-2">
                <p className="text-xs text-slate-500 uppercase font-semibold mb-3">Unlocked Features</p>
                {cfg.features.map((f, i) => (
                  <motion.div
                    key={f}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.08 }}
                    className="flex items-center gap-2 text-sm text-slate-200"
                  >
                    <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                    {f}
                  </motion.div>
                ))}
              </div>

              <div className="flex justify-end">
                <Button onClick={onClose} className="bg-sky-600 hover:bg-sky-700 px-8">
                  Continue
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}