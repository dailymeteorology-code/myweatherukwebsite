// Named exports used by TCM.jsx — kept in a separate file to avoid being overwritten
import { useState } from "react";

const RISK_ORDER = ["No Risk", "Very Low", "Low", "Marginal", "Moderate", "High"];
const RISK_COLOR = {
  "No Risk":   "#64748b",
  "Very Low":  "#86efac",
  "Low":       "#22c55e",
  "Marginal":  "#facc15",
  "Moderate":  "#f97316",
  "High":      "#ef4444",
};
const RISK_GUIDE = {
  "No Risk":   "Conditions are stable with no convective activity expected.",
  "Very Low":  "Isolated showers possible but lightning is unlikely and impacts negligible.",
  "Low":       "Scattered thundery showers expected, generally unorganised and unlikely severe.",
  "Marginal":  "A few intense cells could produce localised flooding or small hail.",
  "Moderate":  "Organised storm systems likely with frequent lightning and structural damage risk.",
  "High":      "Dangerous weather event with widespread damage, power outages and travel disruption.",
};

function hexToRgba(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return `${r},${g},${b}`;
}

export function AutoForecastCard({ forecast, override, isAdmin, onEdit, riskTypes }) {
  const displayRisk = override?.riskLevel ?? forecast.riskLevel;
  const displayMin  = override?.minRisk   ?? forecast.minRisk;
  const displayMax  = override?.maxRisk   ?? forecast.maxRisk;
  const displayRegion = override?.regionRisks ?? forecast.regionRisks;

  const topColor = RISK_COLOR[displayRisk] || RISK_COLOR["No Risk"];
  const rgb = hexToRgba(topColor);
  const isNoRisk = displayRisk === "No Risk";
  const riskIdx = RISK_ORDER.indexOf(displayRisk);
  const rangeLabel = displayMin === displayMax ? displayRisk : `${displayMin} → ${displayMax}`;
  const dayIdx = forecast.dayLabel === "Today" ? 0 : forecast.dayLabel === "Tomorrow" ? 1 : 2;
  const dayFlagLabel = ["Today's Outlook", "Tomorrow's Outlook", "2-Day Outlook"][dayIdx];
  const typeLabel = (riskTypes || []).find(t => t.id === forecast.type)?.label || forecast.type;

  return (
    <div style={{
      borderRadius: 22, overflow: "hidden",
      background: isNoRisk ? "rgba(15,23,42,0.75)" : `linear-gradient(160deg, rgba(${rgb},0.10) 0%, rgba(15,23,42,0.88) 40%, rgba(10,15,30,0.92) 100%)`,
      border: `1px solid rgba(${rgb},${isNoRisk ? 0.12 : 0.30})`,
      backdropFilter: "blur(12px)",
      boxShadow: isNoRisk ? "none" : `0 0 40px rgba(${rgb},0.08), inset 0 1px 0 rgba(${rgb},0.12)`,
    }}>
      <div style={{ height: 4, background: isNoRisk ? "#334155" : `linear-gradient(90deg, ${topColor}, ${topColor}99, transparent)` }} />
      <div style={{ padding: "20px 22px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 20, marginBottom: 8, background: `rgba(${rgb},0.12)`, border: `1px solid rgba(${rgb},0.3)` }}>
              <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: topColor }}>{dayFlagLabel}</span>
            </div>
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.3 }}>{forecast.formattedDate}</h3>
            <p style={{ margin: "4px 0 0", fontSize: "0.74rem", color: "#64748b" }}>{typeLabel} Risk · Auto-generated from ensemble models</p>
          </div>
          {isAdmin && (
            <button onClick={() => onEdit(forecast)} style={{ flexShrink: 0, marginLeft: 12, padding: "6px 10px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#64748b", display: "flex", alignItems: "center", gap: 4, fontSize: "0.7rem", cursor: "pointer" }}>
              ✎ Edit
            </button>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 20, border: `1.5px solid ${isNoRisk ? "rgba(148,163,184,0.3)" : `${topColor}55`}`, background: isNoRisk ? "rgba(148,163,184,0.05)" : `rgba(${rgb},0.1)` }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: topColor, flexShrink: 0 }} />
            <span style={{ fontSize: "0.8rem", fontWeight: 700, color: topColor }}>{rangeLabel}</span>
          </div>
          <div style={{ display: "flex", gap: 3, alignItems: "flex-end" }}>
            {RISK_ORDER.map((rv, i) => (
              <div key={rv} style={{ width: 6, height: i <= riskIdx ? 6 + i * 4 : 3, borderRadius: 2, background: i <= riskIdx ? RISK_COLOR[rv] : "rgba(255,255,255,0.07)", transition: "height 0.3s" }} />
            ))}
          </div>
          <span style={{ fontSize: "0.65rem", color: "#475569", fontFamily: "monospace" }}>CAPE ~{forecast.avgCape} J/kg · RH ~{forecast.avgRH}%</span>
        </div>

        {/* Regional breakdown summary */}
        {displayRegion && Object.keys(displayRegion).length > 0 && (
          <div style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(displayRegion)
              .filter(([, r]) => r !== "No Risk")
              .sort((a, b) => RISK_ORDER.indexOf(b[1]) - RISK_ORDER.indexOf(a[1]))
              .slice(0, 5)
              .map(([name, risk]) => {
                const c = RISK_COLOR[risk];
                return (
                  <span key={name} style={{ fontSize: "0.62rem", fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: `${c}14`, border: `1px solid ${c}35`, color: c }}>
                    {name.split(" ")[0]}: {risk}
                  </span>
                );
              })}
          </div>
        )}

        {!isNoRisk && RISK_GUIDE[displayRisk] && (
          <div style={{ padding: "10px 14px", borderRadius: 12, background: `rgba(${rgb},0.07)`, border: `1px solid rgba(${rgb},0.18)`, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: topColor, flexShrink: 0 }} />
              <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: topColor }}>{displayRisk} Risk</span>
            </div>
            <p style={{ margin: 0, fontSize: "0.76rem", lineHeight: 1.6, color: "#cbd5e1" }}>{RISK_GUIDE[displayRisk]}</p>
          </div>
        )}

        {isNoRisk && (
          <p style={{ margin: "6px 0 14px", fontSize: "0.7rem", color: "#22c55e", textAlign: "center" }}>✓ No significant risk areas identified — conditions look generally settled</p>
        )}

        {override
          ? <p style={{ margin: "8px 0 0", fontSize: "0.62rem", color: "#f97316" }}>⚙ Risk values overridden by admin · Data: {new Date(forecast.generatedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
          : <p style={{ margin: "8px 0 0", fontSize: "0.62rem", color: "#334155" }}>Generated {new Date(forecast.generatedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · Open-Meteo CAPE, LI, RH · updated every 6 hrs</p>
        }
      </div>
    </div>
  );
}

export function ForecastEditModal({ forecast, currentOverride, onSave, onClose }) {
  const [riskLevel, setRiskLevel] = useState(currentOverride?.riskLevel ?? forecast.riskLevel);
  const [minRisk,   setMinRisk]   = useState(currentOverride?.minRisk   ?? forecast.minRisk);
  const [maxRisk,   setMaxRisk]   = useState(currentOverride?.maxRisk   ?? forecast.maxRisk);
  const handleSave = () => { onSave({ riskLevel, minRisk, maxRisk, regionRisks: currentOverride?.regionRisks ?? forecast.regionRisks }); onClose(); };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 9001, width: "92%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", background: "linear-gradient(160deg,#0d1829,#1a1040)", border: "1px solid rgba(167,139,250,0.25)", borderRadius: 22, padding: 28 }}>
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 8, width: 30, height: 30, cursor: "pointer", color: "#64748b", fontSize: 16 }}>✕</button>
        <h3 style={{ margin: "0 0 16px", fontSize: "1rem", fontWeight: 700, color: "#f1f5f9" }}>Edit Forecast — {forecast.formattedDate}</h3>

        {[["Overall Risk", riskLevel, setRiskLevel], ["Min Risk", minRisk, setMinRisk], ["Max Risk", maxRisk, setMaxRisk]].map(([label, val, setter]) => (
          <div key={label} style={{ marginBottom: 14 }}>
            <p style={{ margin: "0 0 8px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {RISK_ORDER.map(rv => {
                const c = RISK_COLOR[rv]; const active = val === rv;
                return <button key={rv} onClick={() => setter(rv)} style={{ padding: "5px 13px", borderRadius: 20, fontSize: "0.73rem", fontWeight: 700, cursor: "pointer", border: `1.5px solid ${active ? c : "rgba(255,255,255,0.1)"}`, background: active ? `${c}30` : "transparent", color: active ? c : "#64748b" }}>{rv}</button>;
              })}
            </div>
          </div>
        ))}

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#64748b", fontSize: "0.82rem", cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} style={{ flex: 2, padding: "10px 0", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }}>Save Override</button>
          {currentOverride && <button onClick={() => { onSave(null); onClose(); }} style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: "0.82rem", cursor: "pointer" }}>Reset</button>}
        </div>
      </div>
    </>
  );
}