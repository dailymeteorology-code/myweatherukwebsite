/* Warnings, the app's Warnings tab (17 Nov 2026, the iOS-app redesign). At first it was the home page's warnings
   panel; at the user's request ("make the warnings tab show the warning map, not the section") the whole tab is
   now the warning map (components/warnings/WarningsMapScreen.jsx), with the archive, the In force and Upcoming
   switches and each warning's sheet on it. The warnings come from hooks/useWarnings (shared with the Hub), read
   again every minute while the tab is open. */
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useWarnings } from '@/hooks/useWarnings';
import { useSectionActive } from '@/components/app/sectionActive';
import WarningsMapScreen from '@/components/warnings/WarningsMapScreen';

export default function Warnings() {
  const active = useSectionActive();
  const { mergedAll, loadingWarnings, checkedAt, redWildfire } = useWarnings({ poll: 60_000, active });
  return (
    <WarningsMapScreen
      warnings={mergedAll}
      loading={loadingWarnings}
      checkedAt={checkedAt}
      banner={redWildfire ? (
        /* a red "Wild Fire" warning of our own is the one thing allowed to interrupt */
        <div role="alert" style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 14,
          background: 'rgba(220, 38, 38, 0.18)', border: '1px solid rgba(248, 113, 113, 0.45)', fontSize: '0.84rem', fontWeight: 700,
        }}>
          <AlertTriangle style={{ width: 18, height: 18, color: '#f87171', flex: 'none' }} />
          The UK Government has issued a nationwide wildfire warning
        </div>
      ) : null} />
  );
}
