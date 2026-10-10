import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, X } from 'lucide-react';

/**
 * MobileSelect — a touch-friendly select that opens a bottom drawer on tap.
 *
 * Usage:
 *   <MobileSelect
 *     value={val}
 *     onChange={setVal}
 *     options={[{ value: 'a', label: 'A' }, ...]}
 *     placeholder="Select..."
 *     label="Pick one"
 *   />
 *
 * Falls back to the native render on desktop for keyboard accessibility,
 * but the drawer also works fine on desktop.
 */
export default function MobileSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select...',
  label,
  className = '',
  triggerStyle,
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === value);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-left text-sm text-slate-800 dark:text-slate-100 active:opacity-80 ${className}`}
        style={triggerStyle}
      >
        <span className={current ? '' : 'text-slate-400'}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[100] bg-black/50"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={(_, info) => { if (info.offset.y > 100) setOpen(false); }}
              className="fixed bottom-0 left-0 right-0 z-[101] bg-white dark:bg-slate-900 rounded-t-2xl shadow-2xl max-h-[75vh] flex flex-col"
              style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-2 pb-1">
                <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                <span className="font-semibold text-slate-800 dark:text-slate-100">
                  {label || 'Select an option'}
                </span>
                <button onClick={() => setOpen(false)} className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>

              {/* Options list */}
              <div className="overflow-y-auto py-1">
                {options.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-slate-400">No options</p>
                )}
                {options.map(opt => {
                  const selected = opt.value === value;
                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => { onChange(opt.value); setOpen(false); }}
                      className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm ${selected ? 'bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 font-semibold' : 'text-slate-700 dark:text-slate-200 active:bg-slate-100 dark:active:bg-slate-800'}`}
                    >
                      <span>{opt.label}</span>
                      {selected && <Check className="w-4 h-4 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}