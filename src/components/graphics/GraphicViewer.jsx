/* A MyWeatherUK graphic full screen (the home page and the graphics archive share it): fitted to
   the screen from a web-sized copy first, the full-resolution upload once you tap to zoom.
   Escape or a tap on the backdrop closes it; ← and → step through a list when one is given. */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import { sized } from '@/lib/sizedImage';

const CSS = `
.gv { position: fixed; inset: 0; z-index: 9999; display: flex; flex-direction: column; background: rgba(3,6,12,.94);
  -webkit-backdrop-filter: blur(24px) saturate(140%); backdrop-filter: blur(24px) saturate(140%); animation: gv-fade .2s ease both;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, Roboto, sans-serif; color: #fff; }
@keyframes gv-fade { from { opacity: 0; } to { opacity: 1; } }
.gv-bar { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
.gv-bar span { flex: 1; min-width: 0; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gv-btn { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 13px; border-radius: 12px; cursor: pointer; font: inherit; font-size: .82rem; font-weight: 600; text-decoration: none; color: #fff; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.22); }
.gv-btn:hover { background: rgba(255,255,255,.2); }
.gv-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; cursor: pointer; color: #fff; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.22); }
.gv-icon:hover { background: rgba(255,255,255,.2); }
.gv-icon:disabled { opacity: .35; cursor: default; }
/* flex, not grid: a grid cell's height is not definite, so the image's max-height could not fit it */
.gv-stage { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 0 12px; overflow: hidden; }
.gv-stage img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 12px; cursor: zoom-in; box-shadow: 0 30px 80px rgba(0,0,0,.6); }
.gv-stage.is-zoom { display: block; overflow: auto; -webkit-overflow-scrolling: touch; }
.gv-stage.is-zoom img { max-width: none; max-height: none; width: min(5120px, 300%); cursor: zoom-out; border-radius: 0; }
.gv-step { position: absolute; top: 50%; transform: translateY(-50%); z-index: 1; }
.gv-step.is-prev { left: 14px; } .gv-step.is-next { right: 14px; }
.gv-hint { margin: 0; padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px)); text-align: center; font-size: .78rem; color: rgba(255,255,255,.6); }
@media (prefers-reduced-motion: reduce) { .gv { animation: none; } }
`;

export default function GraphicViewer({ graphic, onClose, onPrev = null, onNext = null }) {
  const [zoom, setZoom] = useState(false);
  useEffect(() => { setZoom(false); }, [graphic?.id]);
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && onNext) onNext();
    };
    document.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; };
  }, [onClose, onPrev, onNext]);
  if (!graphic?.image_url) return null;
  const title = graphic.title || 'Forecast graphic';
  return createPortal(
    <div className="gv" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <style>{CSS}</style>
      <div className="gv-bar" onClick={(e) => e.stopPropagation()}>
        <span>{title}</span>
        <a className="gv-btn" href={graphic.image_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Original</a>
        <button type="button" className="gv-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className={`gv-stage${zoom ? ' is-zoom' : ''}`}>
        {(onPrev || onNext) && !zoom && (
          <>
            <button type="button" className="gv-icon gv-step is-prev" disabled={!onPrev} aria-label="Previous graphic" onClick={(e) => { e.stopPropagation(); onPrev?.(); }}><ChevronLeft size={18} /></button>
            <button type="button" className="gv-icon gv-step is-next" disabled={!onNext} aria-label="Next graphic" onClick={(e) => { e.stopPropagation(); onNext?.(); }}><ChevronRight size={18} /></button>
          </>
        )}
        <img src={zoom ? graphic.image_url : sized(graphic.image_url, 2400)} alt={title}
          onClick={(e) => { e.stopPropagation(); setZoom((z) => !z); }} />
      </div>
      <p className="gv-hint">{zoom ? 'Tap the graphic to fit it to the screen' : 'Tap the graphic to see it at full resolution'}</p>
    </div>,
    document.body,
  );
}
