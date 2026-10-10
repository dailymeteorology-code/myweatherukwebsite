import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Cookie } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'cookie_consent';

export default function CookieConsent({ triggerShow = false }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!triggerShow) return;
    const existing = localStorage.getItem(STORAGE_KEY);
    if (!existing) {
      setVisible(true);
    }
  }, [triggerShow]);

  const handleAccept = () => {
    localStorage.setItem(STORAGE_KEY, 'accepted');
    setVisible(false);
  };

  const handleDecline = () => {
    localStorage.setItem(STORAGE_KEY, 'declined');
    setVisible(false);
  };

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          // Inline fixed/centering as well as classes — guarantees the overlay
          // covers the viewport and centres the card even if a class is purged.
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
                   display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          className="bg-black/60 backdrop-blur-sm px-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="bg-slate-900 border border-slate-700 rounded-3xl p-8 max-w-md w-full shadow-2xl text-center"
          >
            <div className="w-14 h-14 rounded-2xl bg-amber-500/20 flex items-center justify-center mx-auto mb-5">
              <Cookie className="w-7 h-7 text-amber-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-3">Cookie Preferences</h2>
            <p className="text-slate-400 text-sm leading-relaxed mb-6">
              We use cookies to enhance your experience, remember your preferences, and provide personalised weather information. You can accept all cookies or decline non-essential ones.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                onClick={handleDecline}
                className="flex-1 border-slate-600 text-slate-300 hover:bg-slate-800"
              >
                Decline
              </Button>
              <Button
                onClick={handleAccept}
                className="flex-1 bg-sky-600 hover:bg-sky-700 text-white"
              >
                Accept All
              </Button>
            </div>
            <p className="text-xs text-slate-600 mt-4">
              Essential cookies are always active to keep the site functioning.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}