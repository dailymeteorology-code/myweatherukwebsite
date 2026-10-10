/**
 * PngExportModal — extracted from pages/WeatherPatterns to keep that file
 * under the size editing limit. No behavioural changes from the original.
 *
 * Props are unchanged: { open, onClose, onExport, data, region, riskType,
 * dayIdx, run, strikes, savedOutlooks, captureMapImage, buildCanvas,
 * REGIONS, PNG_COLOUR_PRESETS, AlertTriangle, Zap, CloudSnow, CloudRain,
 * X, Download, Loader2 }
 *
 * captureMapImage and buildCanvas are passed in as props so this component
 * stays decoupled from WeatherPatterns' large internal helpers.
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function PngExportModal({
  open, onClose, onExport,
  data, region, riskType, dayIdx, run, strikes,
  captureMapImage, buildCanvas,
  REGIONS, PNG_COLOUR_PRESETS,
  AlertTriangle, Zap, CloudSnow, CloudRain, X, Download, Loader2,
}) {
  const [darkMode,                 setDarkMode]                 = useState(true);
  const [showKey,                  setShowKey]                  = useState(true);
  const [showLightningDots,        setShowLightningDots]        = useState(false);
  const [showOverlaySVR,           setShowOverlaySVR]           = useState(false);
  const [showOverlayLightning,     setShowOverlayLightning]     = useState(false);
  const [showOverlayHail,          setShowOverlayHail]          = useState(false);
  const [showOverlayFloodFlashing, setShowOverlayFloodFlashing] = useState(false);
  const [colourPreset,             setColourPreset]             = useState('default');
  const [exporting,                setExporting]                = useState(false);
  const [previewUrl,               setPreviewUrl]               = useState(null);
  const [previewBusy,              setPreviewBusy]              = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    clearTimeout(timerRef.current);
    setPreviewBusy(true);
    timerRef.current = setTimeout(async () => {
      try {
        const prevBbox = REGIONS[region]?.bbox ?? { lonMin: -10.5, lonMax: 2.5, latMin: 49.5, latMax: 61.5 };
        const prevMapUrl = await captureMapImage(null, prevBbox, !darkMode);
        const c = await buildCanvas({
          mapDataUrl: prevMapUrl,
          opts: { darkMode, showKey, showRiskBar: false, showActivityBar: false,
                  showLightningDots, colourPreset,
                  showOverlaySVR, showOverlayLightning, showOverlayHail, showOverlayFloodFlashing },
          data, dayIdx, riskType, region, run, strikes, scale: 1, adminOutlooksMeta: [],
        });
        setPreviewUrl(c.toDataURL('image/png'));
      } catch (e) { console.warn('preview err', e); }
      setPreviewBusy(false);
    }, 300);
    return () => clearTimeout(timerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, darkMode, showKey, showLightningDots, showOverlaySVR, showOverlayLightning,
      showOverlayHail, showOverlayFloodFlashing, colourPreset, region, dayIdx, riskType]);

  if (!open) return null;

  const pal  = PNG_COLOUR_PRESETS.find(p => p.id === colourPreset) || PNG_COLOUR_PRESETS[0];
  const BD   = 'rgba(255,255,255,0.08)';
  const SBG  = 'rgba(255,255,255,0.04)';

  const handleDL = async () => {
    setExporting(true);
    try {
      await onExport({
        darkMode, showKey, showRiskBar: false, showActivityBar: false,
        showLightningDots, colourPreset,
        showOverlaySVR, showOverlayLightning, showOverlayHail, showOverlayFloodFlashing,
        selectedOutlooks: [],
      });
    } catch (e) { console.error(e); } finally { setExporting(false); }
  };

  const SectionLabel = ({ children }) => (
    <p style={{ margin: '0 0 8px', fontSize: '0.60rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.11em' }}>{children}</p>
  );

  const Toggle = ({ val, set, label, desc }) => (
    <button onClick={() => set(!val)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '9px 12px', borderRadius: 10, cursor: 'pointer', background: val ? 'rgba(99,102,241,0.14)' : SBG, border: `1px solid ${val ? 'rgba(99,102,241,0.40)' : BD}`, transition: 'all 0.15s', gap: 10 }}>
      <div style={{ flex: 1, textAlign: 'left' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: val ? '#a5b4fc' : '#94a3b8' }}>{label}</div>
        {desc && <div style={{ fontSize: '0.62rem', color: '#334155', marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{ width: 32, height: 18, borderRadius: 9, flexShrink: 0, position: 'relative', background: val ? '#6366f1' : '#1e293b', border: `1px solid ${val ? '#818cf8' : '#334155'}`, transition: 'background 0.2s' }}>
        <div style={{ position: 'absolute', top: 2, left: val ? 14 : 2, width: 13, height: 13, borderRadius: '50%', background: '#fff', transition: 'left 0.18s' }} />
      </div>
    </button>
  );

  const HazardBtn = ({ val, set, label, sub, accent, Icon }) => (
    <button onClick={() => set(!val)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', background: val ? accent + '18' : SBG, border: `1.5px solid ${val ? accent + 'aa' : BD}`, transition: 'all 0.15s', width: '100%', textAlign: 'left' }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: val ? accent + '28' : 'rgba(255,255,255,0.05)', border: `1.5px solid ${val ? accent + '70' : BD}`, boxShadow: val ? `0 0 12px ${accent}44` : 'none', transition: 'all 0.15s' }}>
        <Icon style={{ width: 16, height: 16, color: val ? accent : '#475569' }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: val ? '#f1f5f9' : '#64748b' }}>{label}</div>
        {sub && <div style={{ fontSize: '0.62rem', color: val ? accent : '#334155', marginTop: 1 }}>{sub}</div>}
      </div>
      <div style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, background: val ? accent : 'transparent', border: `2px solid ${val ? accent : '#334155'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {val && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
      </div>
    </button>
  );

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 999999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,6,0.90)', backdropFilter: 'blur(18px)', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'linear-gradient(160deg, #0a0f1e 0%, #080c18 100%)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 20, width: '100%', maxWidth: 1060, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 60px 140px rgba(0,0,0,0.90), 0 0 0 0.5px rgba(255,255,255,0.05)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0, background: 'linear-gradient(135deg, rgba(34,197,94,0.08), rgba(56,189,248,0.05))' }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: 'linear-gradient(135deg, rgba(34,197,94,0.22), rgba(56,189,248,0.15))', border: '1px solid rgba(34,197,94,0.30)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Download style={{ width: 16, height: 16, color: '#22c55e' }} />
          </div>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9' }}>Save as PNG</div>
            <div style={{ fontSize: '0.67rem', color: '#475569', marginTop: 1 }}>Choose overlays, preview, then download the map as a full-resolution image</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', width: 30, height: 30, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', flexShrink: 0 }}>
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <div style={{ width: 270, flexShrink: 0, overflowY: 'auto', padding: '18px 16px', borderRight: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', gap: 20, scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}>
            <div>
              <SectionLabel>Hazard Overlays</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <HazardBtn val={showOverlaySVR}           set={setShowOverlaySVR}           label="SVR"         sub="Severe Thunderstorm"  accent="#ef4444" Icon={AlertTriangle} />
                <HazardBtn val={showOverlayLightning}     set={setShowOverlayLightning}     label="Lightning"   sub="High Risk of Lightning" accent="#fbbf24" Icon={Zap}           />
                <HazardBtn val={showOverlayHail}          set={setShowOverlayHail}          label="Large Hail"  sub="Hail risk present"    accent="#38bdf8" Icon={CloudSnow}     />
                <HazardBtn val={showOverlayFloodFlashing} set={setShowOverlayFloodFlashing} label="Flash Flood" sub="Flash flooding risk"   accent="#0ea5e9" Icon={CloudRain}     />
              </div>
            </div>
            <div>
              <SectionLabel>Map Options</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <Toggle val={showKey}           set={setShowKey}           label="Risk Scale Key"     desc="Show all risk levels along the top" />
                <Toggle val={showLightningDots} set={setShowLightningDots} label="Lightning Strikes"  desc="Plot recent strike locations" />
              </div>
            </div>
            <div>
              <SectionLabel>Map Theme</SectionLabel>
              <div style={{ display: 'flex', gap: 5 }}>
                {[{ v: true, l: 'Dark' }, { v: false, l: 'Light' }].map(o => (
                  <button key={String(o.v)} onClick={() => setDarkMode(o.v)} style={{ flex: 1, padding: '8px 5px', borderRadius: 9, cursor: 'pointer', border: `1.5px solid ${darkMode === o.v ? '#38bdf8' : BD}`, background: darkMode === o.v ? 'rgba(56,189,248,0.14)' : SBG, color: darkMode === o.v ? '#38bdf8' : '#475569', fontSize: '0.72rem', fontWeight: 700, transition: 'all 0.14s' }}>{o.l}</button>
                ))}
              </div>
            </div>
            <div>
              <SectionLabel>Accent Colour</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                {PNG_COLOUR_PRESETS.map(p => (
                  <button key={p.id} onClick={() => setColourPreset(p.id)} style={{ padding: '7px 10px', borderRadius: 8, cursor: 'pointer', border: `1.5px solid ${colourPreset === p.id ? p.accent : BD}`, background: colourPreset === p.id ? p.accent + '1c' : SBG, color: colourPreset === p.id ? p.accent : '#475569', fontSize: '0.69rem', fontWeight: 700, transition: 'all 0.14s', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.accent, flexShrink: 0, boxShadow: colourPreset === p.id ? `0 0 6px ${p.accent}` : 'none' }} />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 'auto' }}>
              <button onClick={handleDL} disabled={exporting} style={{ width: '100%', padding: '13px', borderRadius: 12, background: exporting ? '#1e293b' : `linear-gradient(135deg, #22c55e, ${pal.accent})`, border: 'none', color: exporting ? '#475569' : '#fff', fontSize: '0.85rem', fontWeight: 800, cursor: exporting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: exporting ? 0.7 : 1, transition: 'all 0.2s', boxShadow: exporting ? 'none' : `0 4px 24px ${pal.accent}44` }}>
                {exporting
                  ? <><Loader2 className="animate-spin" style={{ width: 15, height: 15 }} /> Capturing map…</>
                  : <><Download style={{ width: 15, height: 15 }} /> Download PNG</>}
              </button>
              <p style={{ margin: '8px 0 0', fontSize: '0.62rem', color: '#1e293b', textAlign: 'center', lineHeight: 1.4 }}>The final export captures the live map at full resolution</p>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: 12, background: 'rgba(0,0,0,0.25)', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '0.60rem', fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.11em' }}>Live Preview</div>
              <div style={{ fontSize: '0.60rem', color: '#1e293b' }}>Updates as you change settings</div>
            </div>
            <div style={{ width: '100%', position: 'relative', borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 16px 60px rgba(0,0,0,0.70)' }}>
              {previewBusy && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,8,18,0.82)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: '0.72rem' }}>
                    <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} />
                    Updating preview…
                  </div>
                </div>
              )}
              {previewUrl
                ? <img src={previewUrl} alt="PNG export preview" style={{ width: '100%', display: 'block' }} />
                : (<div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: '0.72rem' }}>Building preview…</div>)}
            </div>
            {(showOverlaySVR || showOverlayLightning || showOverlayHail || showOverlayFloodFlashing) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                <span style={{ fontSize: '0.60rem', color: '#334155', alignSelf: 'center' }}>Active overlays:</span>
                {showOverlaySVR           && <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: 'rgba(239,68,68,0.12)',  border: '1px solid rgba(239,68,68,0.30)',  color: '#ef4444' }}>SVR</span>}
                {showOverlayLightning     && <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.30)', color: '#fbbf24' }}>Lightning</span>}
                {showOverlayHail          && <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: 'rgba(56,189,248,0.12)',  border: '1px solid rgba(56,189,248,0.30)',  color: '#38bdf8' }}>Large Hail</span>}
                {showOverlayFloodFlashing && <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: 'rgba(14,165,233,0.12)',  border: '1px solid rgba(14,165,233,0.30)',  color: '#0ea5e9' }}>Flash Flood</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  , document.body);
}