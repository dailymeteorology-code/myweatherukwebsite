import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Trash2, User, Ruler, AlertTriangle, X, Mail, ArrowRight, Globe, ChevronLeft } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useUnits } from '@/components/useUnits';
import NotificationPreferences from '@/components/NotificationPreferences';
import { Link } from 'react-router-dom';

const UNIT_OPTION_DEFS = [
  { key: 'temperature',  labelKey: 'temperature', options: [{ value: 'celsius', label: '°C — Celsius' }, { value: 'fahrenheit', label: '°F — Fahrenheit' }] },
  { key: 'windSpeed',    labelKey: 'windSpeed',   options: [{ value: 'mph', label: 'mph' }, { value: 'kmh', label: 'km/h' }] },
  { key: 'precipitation',labelKey: 'rainfall',    options: [{ value: 'mm', label: 'mm' }, { value: 'inches', label: 'inches' }] },
  { key: 'hail',         labelKey: 'hail',        options: [{ value: 'mm', label: 'mm' }, { value: 'inches', label: 'inches' }] },
];

// ─── Delete Account confirmation dialog ──────────────────────────────────────
// Uses CSS custom properties from the app's theme system so it looks
// correct in both dark and light modes.
function DeleteAccountDialog({ onConfirm, onCancel, isDeleting, t }) {
  return (
    <motion.div
      key="delete-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        style={{
          width: '100%', maxWidth: 520,
          background: 'var(--bg-card, #1e293b)',
          border: '1px solid var(--border, rgba(255,255,255,0.08))',
          borderRadius: '20px 20px 0 0',
          padding: '24px 20px 20px',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.4)',
        }}
      >
        {/* Drag handle */}
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: 'var(--border, rgba(255,255,255,0.15))',
          margin: '0 auto 20px',
        }} />

        {/* Close button */}
        <button
          onClick={onCancel}
          style={{
            position: 'absolute', top: 16, right: 16,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-secondary, #94a3b8)', padding: 4,
          }}
        >
          <X style={{ width: 18, height: 18 }} />
        </button>

        {/* Warning icon */}
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.30)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <AlertTriangle style={{ width: 24, height: 24, color: '#ef4444' }} />
        </div>

        <h2 style={{
          textAlign: 'center', margin: '0 0 10px',
          fontSize: 18, fontWeight: 800,
          color: 'var(--text-primary, #f1f5f9)',
        }}>
          {t('deleteTitle')}
        </h2>

        <div style={{
          background: 'rgba(239,68,68,0.07)',
          border: '1px solid rgba(239,68,68,0.18)',
          borderRadius: 12, padding: '12px 14px',
          marginBottom: 20,
        }}>
          <p style={{
            margin: '0 0 6px', fontSize: 13, fontWeight: 600,
            color: '#f87171',
          }}>
            {t('deleteWillRemove')}
          </p>
          <ul style={{
            margin: 0, paddingLeft: 18,
            fontSize: 13, lineHeight: 1.7,
            color: 'var(--text-secondary, #94a3b8)',
          }}>
            <li>{t('deleteItem1')}</li>
            <li>{t('deleteItem2')}</li>
            <li>{t('deleteItem3')}</li>
          </ul>
          <p style={{
            margin: '8px 0 0', fontSize: 12,
            color: 'var(--text-muted, rgba(148,163,184,0.6))',
            fontStyle: 'italic',
          }}>
            {t('deleteCannotUndo')}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            style={{
              width: '100%', padding: '14px 0',
              borderRadius: 12, border: 'none', cursor: isDeleting ? 'not-allowed' : 'pointer',
              background: isDeleting ? 'rgba(239,68,68,0.5)' : '#ef4444',
              color: '#fff', fontSize: 15, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'background 0.15s',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {isDeleting
              ? <><Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> {t('deleting')}</>
              : <><Trash2 style={{ width: 16, height: 16 }} /> {t('confirmDelete')}</>
            }
          </button>
          <button
            onClick={onCancel}
            disabled={isDeleting}
            style={{
              width: '100%', padding: '14px 0',
              borderRadius: 12,
              border: '1px solid var(--border, rgba(255,255,255,0.08))',
              background: 'var(--bg-surface, rgba(255,255,255,0.04))',
              color: 'var(--text-secondary, #94a3b8)',
              fontSize: 15, fontWeight: 600, cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {t('cancel')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function Settings() {
  const [user, setUser] = useState(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { units, updateUnit } = useUnits();
  const { t, lang, changeLang, languages } = useLanguage();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const handleDeleteConfirmed = async () => {
    setDeletingAccount(true);
    try {
      await base44.functions.invoke('deleteAccount', {});
      base44.auth.logout('/login');
    } catch (e) {
      console.error('Delete account failed:', e);
      setDeletingAccount(false);
      setShowDeleteDialog(false);
    }
  };

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50">
        <div className="max-w-xl mx-auto px-4 py-8" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="mb-8">
              <Link to="/" className="inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700 font-medium mb-4 transition-colors">
                <ChevronLeft className="w-4 h-4" /> {t('home')}
              </Link>
              <h1 className="text-3xl font-bold text-slate-800">{t('settingsTitle')}</h1>
              <p className="text-slate-500 mt-1">{t('manageAccount')}</p>
            </div>

            {/* Account Info */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5 text-sky-600" />
                  {t('yourAccount')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-600">
                {user ? (
                  <>
                    <p><span className="font-medium text-slate-800">{t('name')}:</span> {user.full_name || '—'}</p>
                    <p><span className="font-medium text-slate-800">{t('email')}:</span> {user.email}</p>
                    <p><span className="font-medium text-slate-800">{t('role')}:</span> {user.role}</p>
                  </>
                ) : (
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                )}
              </CardContent>
            </Card>

            {/* Units of Measurement */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Ruler className="w-5 h-5 text-sky-600" />
                  {t('units')}
                </CardTitle>
                <CardDescription>{t('unitsDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {UNIT_OPTION_DEFS.map(({ key, labelKey, options }) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">{t(labelKey)}</span>
                    <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                      {options.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => updateUnit(key, opt.value)}
                          className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                            units[key] === opt.value
                              ? 'bg-sky-600 text-white'
                              : 'bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Newsletter */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5 text-sky-600" />
                  {t('freeNewsletter')}
                </CardTitle>
                <CardDescription>{t('newsletterDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Link to="/NewsletterSignup">
                  <Button variant="outline" className="flex items-center gap-2">
                     {t('manageNewsletter')} <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Language */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="w-5 h-5 text-sky-600" />
                  {t('language')}
                </CardTitle>
                <CardDescription>{t('languageDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {languages.map(l => (
                    <button
                      key={l.code}
                      onClick={() => changeLang(l.code)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        lang === l.code
                          ? 'bg-sky-600 text-white border-sky-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span>{l.flag}</span>
                      <span>{l.label}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Email Notifications */}
            <NotificationPreferences />

            {/* Danger Zone */}
            <Card className="border-red-200">
              <CardHeader>
                <CardTitle className="text-red-600 flex items-center gap-2">
                  <Trash2 className="w-5 h-5" />
                  {t('dangerZone')}
                </CardTitle>
                <CardDescription>{t('dangerDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-600">{t('deleteAccountDesc')}</p>
                <Button
                  variant="destructive"
                  className="select-none w-full sm:w-auto"
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={deletingAccount}
                >
                  {deletingAccount
                    ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> {t('deleting')}</>
                     : <><Trash2 className="w-4 h-4 mr-2" /> {t('deleteAccount')}</>
                  }
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>

      {/* Delete confirmation bottom sheet */}
      <AnimatePresence>
        {showDeleteDialog && (
          <DeleteAccountDialog
            onConfirm={handleDeleteConfirmed}
            onCancel={() => setShowDeleteDialog(false)}
            isDeleting={deletingAccount}
            t={t}
          />
        )}
      </AnimatePresence>
    </>
  );
}