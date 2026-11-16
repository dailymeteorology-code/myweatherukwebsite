/* Sign in or sign up with Apple or Google, above the email form on /login and /register.

   Apple: in the iPhone app (Apple's own sign-in sheet, through the app). Google: wherever the site has a
   Google sign-in set up (server/socialAuth.js, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env); in the
   app it opens in a secure sign-in sheet, as Google requires. Each button shows only where it works. */
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import GoogleIcon from '@/components/GoogleIcon';

function AppleIcon({ className }) {
  return (
    <svg viewBox="0 0 17 20" className={className} aria-hidden="true" fill="currentColor">
      <path d="M14.06 10.62c-.02-2.13 1.74-3.15 1.82-3.2-.99-1.45-2.54-1.65-3.09-1.67-1.32-.13-2.57.78-3.24.78-.67 0-1.7-.76-2.79-.74-1.44.02-2.76.83-3.5 2.12-1.49 2.59-.38 6.42 1.07 8.52.71 1.03 1.55 2.18 2.66 2.14 1.07-.04 1.47-.69 2.76-.69 1.29 0 1.65.69 2.78.67 1.15-.02 1.88-1.05 2.58-2.08.81-1.19 1.15-2.35 1.17-2.41-.03-.01-2.24-.86-2.26-3.42zM11.94 4.36c.59-.71.99-1.7.88-2.69-.85.03-1.88.57-2.49 1.28-.55.63-1.03 1.64-.9 2.61.95.07 1.92-.48 2.51-1.2z" />
    </svg>
  );
}

export default function SocialSignIn({ redirect = '/', onError }) {
  const [providers, setProviders] = useState({ apple: false, google: false });
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let alive = true;
    base44.auth.providers().then((p) => { if (alive) setProviders(p); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!providers.apple && !providers.google) return null;

  const go = async (provider) => {
    setBusy(provider);
    try {
      await base44.auth.loginWithProvider(provider, redirect);
    } catch (err) {
      if (err?.message && !err.cancelled) onError?.(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="space-y-3 mb-6">
        {providers.apple && (
          <Button
            type="button"
            className="w-full h-12 text-sm font-semibold rounded-xl bg-white text-black hover:bg-slate-200 border border-white"
            onClick={() => go('apple')}
            disabled={!!busy}
          >
            {busy === 'apple' ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <AppleIcon className="w-5 h-5 mr-2 -mt-0.5" />}
            Continue with Apple
          </Button>
        )}
        {providers.google && (
          <Button
            type="button"
            variant="outline"
            className="w-full h-12 text-sm font-semibold bg-transparent border-slate-700/50 text-slate-200 hover:bg-slate-800/50 hover:border-slate-600"
            onClick={() => go('google')}
            disabled={!!busy}
          >
            {busy === 'google' ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <GoogleIcon className="w-5 h-5 mr-2" />}
            Continue with Google
          </Button>
        )}
      </div>
      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-700/60" /></div>
        <div className="relative flex justify-center text-xs uppercase tracking-wider">
          <span className="bg-[#111a2c] px-3 text-slate-500">or with email</span>
        </div>
      </div>
    </>
  );
}
