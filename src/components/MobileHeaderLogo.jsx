// Tiny helper so MobileHeader can read a fallback logo without re-fetching SiteSettings.
import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

let _cached = null;
let _inFlight = null;

export function useLogo() {
  const [logo, setLogo] = useState(_cached);
  useEffect(() => {
    if (_cached) return;
    if (!_inFlight) {
      _inFlight = base44.entities.SiteSettings.list()
        .then(list => { _cached = list?.[0]?.logo_url || ''; return _cached; })
        .catch(() => '');
    }
    _inFlight.then(setLogo);
  }, []);
  return logo;
}