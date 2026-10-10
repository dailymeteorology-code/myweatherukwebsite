import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap } from 'lucide-react';

export default function UpdateBanner({ updates = [] }) {
  const [dismissed, setDismissed] = useState([]);

  const activeUpdates = updates.filter(
    u => u.is_published !== false && !dismissed.includes(u.id)
  );

  if (activeUpdates.length === 0) return null;

  const current = activeUpdates[0];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={current.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
        onClick={() => setDismissed(prev => [...prev, current.id])}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.85, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.75, y: -20, rotate: -5 }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="bg-gradient-to-br from-green-500 to-emerald-600 text-white px-8 py-6 rounded-3xl shadow-2xl max-w-md w-full border border-white/20"
        >
          <div className="flex items-start gap-4">
            <motion.div
              initial={{ rotate: -10, scale: 0.8 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.3 }}
              className="p-3 bg-white/20 rounded-2xl backdrop-blur-sm shrink-0"
            >
              <Zap className="w-7 h-7" />
            </motion.div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <motion.h4
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 }}
                  className="font-bold text-xl"
                >
                  {current.title}
                </motion.h4>
                {current.version && (
                  <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full font-medium shrink-0">
                    {current.version}
                  </span>
                )}
              </div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.25 }}
                className="text-sm opacity-95 mt-1 leading-relaxed whitespace-pre-line"
              >
                {current.description}
              </motion.p>
            </div>
            <motion.button
              whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.3)' }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setDismissed(prev => [...prev, current.id])}
              className="p-2 bg-white/10 rounded-xl transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}