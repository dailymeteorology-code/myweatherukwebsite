/* Windy radar, centred on the searched location.
 *
 * An embed rather than the app's own RainViewer radar because the two answer
 * different questions: the home-page radar is a national view the reader pans
 * around, this is "what is heading for the place I just looked up". Windy's
 * embed carries its own past-hour timeline and playback, which is exactly the
 * hour the reader wants and nothing this page would need to rebuild.
 *
 * `marker=true` puts Windy's own pin on the coordinates, and a ring is drawn
 * over the centre so the spot stays identifiable while the radar animates
 * across it.
 */
import React, { useState } from 'react';
import { Radar, ExternalLink } from 'lucide-react';

export default function LocationRadar({ lat, lon, name, zoom = 8 }) {
  const [loaded, setLoaded] = useState(false);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    detailLat: String(lat),
    detailLon: String(lon),
    zoom: String(zoom),
    level: 'surface',
    overlay: 'radar',
    product: 'radar',
    menu: '',
    message: '',
    marker: 'true',
    calendar: 'now',
    type: 'map',
    location: 'coordinates',
    detail: '',
    metricWind: 'mph',
    metricTemp: '°C',
    radarRange: '-1',
  });
  const src = `https://embed.windy.com/embed2.html?${params.toString()}`;

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', padding: '14px 16px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <Radar style={{ width: 15, height: 15, color: '#7dd3fc' }} />
        <h3 style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' }}>
          Radar {name ? `· ${name}` : ''}
        </h3>
        <span style={{ fontSize: '0.66rem', color: 'rgba(255,255,255,0.4)' }}>
          past hour, playable
        </span>
        <a
          href={`https://www.windy.com/?radar,${lat.toFixed(3)},${lon.toFixed(3)},${zoom}`}
          target="_blank" rel="noopener noreferrer"
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.66rem', color: '#7dd3fc', textDecoration: 'none' }}>
          Open on Windy <ExternalLink style={{ width: 10, height: 10 }} />
        </a>
      </div>

      <div style={{
        position: 'relative', width: '100%', borderRadius: 14, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.14)', background: '#0b1220',
        aspectRatio: '16 / 10',
      }}>
        <iframe
          title={`Windy radar for ${name || 'the selected location'}`}
          src={src}
          onLoad={() => setLoaded(true)}
          frameBorder="0"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
          loading="lazy"
        />

        {/* Centre ring. Windy's own marker can be lost against heavy returns,
            and this keeps the searched point findable while the loop plays.
            pointer-events off so it never blocks panning the map underneath. */}
        {loaded && (
          <div style={{
            position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
            width: 22, height: 22, borderRadius: '50%', pointerEvents: 'none',
            border: '2px solid #fff', boxShadow: '0 0 0 2px rgba(2,6,23,0.75), 0 0 12px rgba(255,255,255,0.6)',
          }}>
            <span style={{
              position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
              width: 6, height: 6, borderRadius: '50%', background: '#fff',
            }} />
          </div>
        )}

        {!loaded && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem',
          }}>
            Loading radar…
          </div>
        )}
      </div>
    </div>
  );
}
