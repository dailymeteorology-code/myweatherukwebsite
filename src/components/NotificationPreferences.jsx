/**
 * NotificationPreferences — small Settings card that lets each user opt in
 * to email alerts when the admin publishes a new severe weather outlook.
 *
 * State is stored in the EmailNotificationPref entity, keyed on the user's
 * email. RLS restricts each row to its owning user so this works as both
 * a list-and-read and write surface.
 *
 * The actual sending happens server-side from the sendOutlookEmailAlert
 * backend function which is invoked when an outlook is saved.
 */

import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Bell, Loader2, Check } from 'lucide-react';

const RISK_OPTIONS = [
  { value: 'any',      label: 'Every outlook',         desc: 'Any new outlook (including low risk)' },
  { value: 'Marginal', label: 'Marginal or higher',    desc: 'Marginal, Slight, Moderate, High, Severe' },
  { value: 'Slight',   label: 'Slight or higher',      desc: 'Slight, Moderate, High, Severe' },
  { value: 'Moderate', label: 'Moderate or higher',    desc: 'Moderate, High, Severe — default' },
  { value: 'High',     label: 'High or higher',        desc: 'Only High and Severe' },
  { value: 'Severe',   label: 'Severe only',           desc: 'Only the most extreme outlooks' },
];

export default function NotificationPreferences() {
  const [user,       setUser]       = useState(null);
  const [pref,       setPref]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // Load the current user + their existing preference row (if any).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await base44.auth.me();
        if (cancelled) return;
        setUser(me);
        const rows = await base44.entities.EmailNotificationPref.filter({ user_email: me.email });
        if (cancelled) return;
        setPref(rows?.[0] || null);
      } catch {
        // Not authenticated or query failed — leave pref null
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Patch helper that creates or updates the row and shows a brief saved state.
  const update = async (patch) => {
    if (!user) return;
    setSaving(true);
    try {
      if (pref?.id) {
        const updated = await base44.entities.EmailNotificationPref.update(pref.id, patch);
        setPref(prev => ({ ...prev, ...updated, ...patch }));
      } else {
        const created = await base44.entities.EmailNotificationPref.create({
          user_email: user.email,
          outlook_alerts_enabled: false,
          min_risk_level: 'Moderate',
          ...patch,
        });
        setPref(created);
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1400);
    } catch (e) {
      console.error('[NotificationPreferences] save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const enabled  = pref?.outlook_alerts_enabled ?? false;
  const minLevel = pref?.min_risk_level ?? 'Moderate';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-sky-600" />
          Email Notifications
          {savedFlash && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
              <Check className="w-3 h-3" /> Saved
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Get an email when a new severe weather outlook is published.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        ) : !user ? (
          <p className="text-sm text-slate-500">Sign in to manage your notification preferences.</p>
        ) : (
          <>
            {/* Master toggle */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-700">Outlook email alerts</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  We'll send the outlook summary to <span className="font-medium">{user.email}</span>.
                </p>
              </div>
              <button
                onClick={() => update({ outlook_alerts_enabled: !enabled })}
                disabled={saving}
                aria-label={enabled ? 'Disable email alerts' : 'Enable email alerts'}
                style={{
                  width: 44, height: 24, borderRadius: 12, position: 'relative',
                  background: enabled ? '#0284c7' : '#cbd5e1',
                  border: 'none', cursor: saving ? 'wait' : 'pointer',
                  transition: 'background 0.18s', flexShrink: 0,
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: enabled ? 22 : 2,
                  width: 20, height: 20, borderRadius: '50%',
                  background: '#fff', transition: 'left 0.18s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </button>
            </div>

            {/* Risk-level threshold — only when alerts are on */}
            {enabled && (
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">Which outlooks should email me?</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {RISK_OPTIONS.map(opt => {
                    const active = minLevel === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => update({ min_risk_level: opt.value })}
                        disabled={saving}
                        className={`text-left rounded-lg border px-3 py-2 transition ${
                          active
                            ? 'bg-sky-50 border-sky-400 ring-1 ring-sky-200'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <p className={`text-xs font-semibold ${active ? 'text-sky-700' : 'text-slate-700'}`}>
                          {opt.label}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}