/* Share as a picture (Location Weather, 16 Nov 2026, Phase F): the place's forecast as a 1080 x 1920
   picture (src/lib/location/sharePicture.js), shown in a sheet with Share (the phone's own share sheet,
   where the browser can share a picture) and Save. The picture is of the forecast as it was when the
   sheet opened, so it does not change under the reader while they look at it. */
import React, { useEffect, useRef, useState } from 'react';
import { X, Share2, Download, Loader2 } from 'lucide-react';
import { useUnits } from '@/components/useUnits';
import { drawForecastPicture, pictureName } from '@/lib/location/sharePicture';

const PHONE = '(max-width: 640px)';

export default function ShareSheet({ model, warnings, onClose }) {
  const U = useUnits();
  const [snap] = useState(() => ({ model, warnings }));
  const [pic, setPic] = useState({ busy: true });
  const sheetRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    let alive = true, url = null;
    drawForecastPicture(snap.model, { U, warnings: snap.warnings || [] })
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setPic({ busy: false, url, file: new File([blob], pictureName(snap.model), { type: 'image/jpeg' }) });
      })
      .catch(() => { if (alive) setPic({ busy: false, error: 'The picture could not be made. Please try again.' }); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [snap, U]);

  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const canShare = !!pic.file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [pic.file] });
  const share = async () => {
    try { await navigator.share({ files: [pic.file], title: `${snap.model.location.name} weather`, text: `The weather for ${snap.model.location.name}, from MyWeatherUK` }); } catch { /* cancelled */ }
  };
  const save = () => {
    const a = document.createElement('a');
    a.href = pic.url; a.download = pic.file.name;
    document.body.appendChild(a); a.click(); a.remove();
  };

  /* on a phone: drag the handle or the header down to put the sheet away (as the hour sheet) */
  const drag = {
    down: (e) => {
      const el = sheetRef.current;
      if (!el || !window.matchMedia?.(PHONE).matches) return;
      if (e.target.closest('button, a') || !e.target.closest('.lw-sh-grab, .lw-sh-head')) return;
      dragRef.current = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0 };
      try { el.setPointerCapture(e.pointerId); } catch { /* fine without */ }
      el.style.animation = 'none'; el.style.transition = 'none';
    },
    move: (e) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.id || !sheetRef.current) return;
      d.dy = Math.max(0, e.clientY - d.y0);
      sheetRef.current.style.transform = `translateY(${d.dy}px)`;
    },
    up: (e) => {
      const d = dragRef.current, el = sheetRef.current;
      if (!d || e.pointerId !== d.id || !el) return;
      dragRef.current = null;
      el.style.transition = 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)';
      const speed = d.dy / Math.max(1, performance.now() - d.t0);
      if (d.dy > Math.min(110, el.offsetHeight * 0.3) || (d.dy > 24 && speed > 0.5)) {
        el.style.transform = `translateY(${el.offsetHeight + 24}px)`;
        setTimeout(onClose, 200);
      } else el.style.transform = '';
    },
  };

  return (
    <div className="lw-sh-wrap" onClick={onClose}
      onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
      <div ref={sheetRef} className="lw-sh lw-glass lw-share" role="dialog" aria-modal="true" aria-label="Share the forecast as a picture"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={drag.down} onPointerMove={drag.move} onPointerUp={drag.up} onPointerCancel={drag.up}>
        <div className="lw-sh-grab" aria-hidden="true"><i /></div>
        <div className="lw-sh-head">
          <div className="lw-sh-when"><b>Share as a picture</b><span>{snap.model.location.name} · 1080 × 1920</span></div>
          <button type="button" className="lw-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="lw-share-pic">
          {pic.busy && <div className="lw-share-wait"><Loader2 size={20} className="animate-spin" />Making the picture…</div>}
          {pic.error && <div className="lw-share-wait">{pic.error}</div>}
          {pic.url && <img src={pic.url} alt={`The forecast for ${snap.model.location.name} as a picture`} />}
        </div>
        <div className="lw-share-btns">
          {canShare && <button type="button" className="lw-share-btn is-main" onClick={share}><Share2 size={17} />Share</button>}
          <button type="button" className={`lw-share-btn${canShare ? '' : ' is-main'}`} onClick={save} disabled={!pic.url}><Download size={17} />Save picture</button>
        </div>
      </div>
    </div>
  );
}
