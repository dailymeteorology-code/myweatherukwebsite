/* Where an outlook tool saves its graphics.

   In Admin Settings: the graphics library (WeatherGraphic, the state in graphic_tool_state, never
   published). In the public Graphic Studio (the tools' `basic` mode): the signed-in visitor's own
   list (StudioGraphic, the state in graphic_state, with their email), and saving asks them to log
   in first. A saved state names its tool (`tool`), so each tool lists only its own. */
import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

/** The signed-in user in the public studio (null when signed out); always null in the admin one. */
export function useStudioUser(basic) {
  const [me, setMe] = useState(null);
  useEffect(() => {
    if (!basic) return undefined;
    let live = true;
    base44.auth.me().then((u) => live && setMe(u || null)).catch(() => live && setMe(null));
    return () => { live = false; };
  }, [basic]);
  return me;
}

export async function saveStudioGraphic({ basic, me, title, state }) {
  if (basic) return base44.entities.StudioGraphic.create({ title, graphic_state: state, user_email: me?.email || '' });
  return base44.entities.WeatherGraphic.create({ title, graphic_tool_state: state, published: false, is_forecast: false });
}

/** The saved graphics, newest first, each with its state as `state`, for the tool `keep` accepts. */
export async function listStudioGraphics({ basic, me, keep }) {
  const rows = basic
    ? (me?.email ? await base44.entities.StudioGraphic.filter({ user_email: me.email }, '-created_date', 50) : [])
    : await base44.entities.WeatherGraphic.filter({}, '-created_date', 50);
  return (rows || []).map((g) => ({ ...g, state: g.graphic_tool_state || g.graphic_state })).filter((g) => g.state && keep(g.state));
}
