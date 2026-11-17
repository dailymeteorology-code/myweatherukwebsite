/* What a visitor is shown first: announcements and app updates (once a session), then the cookie question.
   Moved unchanged from pages/Home.jsx (17 Nov 2026, the iOS-app redesign), so they open on the new home page
   (Location Weather, at "/"); the Layout mounts this on the home page only, as the old home page did. */
import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import CombinedBannerStack from '@/components/CombinedBannerStack';
import CookieConsent from '@/components/CookieConsent';

const cookieConsentPending = () => {
  try { return !localStorage.getItem('cookie_consent'); } catch { return false; }
};

export default function FirstVisitNotices() {
  const [showBanners, setShowBanners] = useState(false);
  const [cookieConsentReady, setCookieConsentReady] = useState(false);

  /* No initialData: with it the queries reported "loaded" at once, empty, before anything had been fetched. */
  const { data: announcements = [], isSuccess: announcementsLoaded } = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => { try { return (await base44.entities.Announcement.filter({ is_active: true }, '-created_date')) || []; } catch { return []; } },
    retry: 2, retryDelay: 1000,
  });
  const { data: appUpdates = [], isSuccess: updatesLoaded } = useQuery({
    queryKey: ['appUpdates'],
    queryFn: async () => { try { return (await base44.entities.AppUpdate.filter({ is_published: true }, '-created_date')) || []; } catch { return []; } },
    retry: 1, retryDelay: 2000,
  });

  /* The banner stack opens once a session, when both lists have loaded, and the cookie notice waits until it
     is dismissed. With nothing to show, the notice comes straight away. */
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || !announcementsLoaded || !updatesLoaded) return;
    decided.current = true;
    const anything =
      announcements.some((a) => a.is_active === true && (!a.target_page || a.target_page === 'Home')) ||
      appUpdates.some((u) => u.is_published === true);
    let shown = false;
    try { shown = sessionStorage.getItem('bannersShown') === 'true'; } catch { /* storage blocked */ }
    if (anything && !shown) {
      setShowBanners(true);
      try { sessionStorage.setItem('bannersShown', 'true'); } catch { /* storage blocked */ }
    } else if (cookieConsentPending()) {
      setCookieConsentReady(true);
    }
  }, [announcementsLoaded, updatesLoaded, announcements, appUpdates]);

  return (
    <>
      <CookieConsent triggerShow={cookieConsentReady} />
      {showBanners && (
        <CombinedBannerStack
          announcements={announcements}
          updates={appUpdates}
          currentPage="Home"
          onAllDismissed={() => {
            setShowBanners(false);
            if (cookieConsentPending()) setCookieConsentReady(true);
          }} />
      )}
    </>
  );
}
