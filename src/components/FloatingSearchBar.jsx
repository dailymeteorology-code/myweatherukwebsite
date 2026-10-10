import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import LocationSearch from '@/components/LocationSearch';

export default function FloatingSearchBar() {
  const [opacity, setOpacity] = useState(1);
  // `null` until settings resolve — we render nothing while undecided so the
  // bar fades in once rather than flashing in and then out when a disabled
  // setting arrives a moment after mount.
  const [searchEnabled, setSearchEnabled] = useState(null);

  useEffect(() => {
    base44.entities.SiteSettings.list().then(list => {
      const s = list[0];
      setSearchEnabled(!(s && s.location_search_enabled === false));
    }).catch(() => setSearchEnabled(true));
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const heroHeight = 360;
      if (scrollY < heroHeight) {
        setOpacity(0.3 + (scrollY / heroHeight) * 0.7);
      } else {
        setOpacity(1);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (!searchEnabled) return null;

  return (
    <motion.div
      className="fixed top-4 right-4 z-20"
      animate={{ opacity }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
    >
      <LocationSearch expandOnHover />
    </motion.div>
  );
}