import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

async function fetchWarningsPage() {
    const response = await fetch('https://www.metoffice.gov.uk/weather/warnings-and-advice/accessible-uk-warnings', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; WeatherBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml',
        }
    });
    if (!response.ok) throw new Error(`Failed to fetch Met Office page: ${response.status}`);
    return await response.text();
}

/* ── Exact warning polygons ──────────────────────────────────────────────────

   The Met Office does publish its real warning areas, but not as an API: the
   uk-warnings page embeds them in a script tag as
   `window.metoffice.warnings.config.polygonsGeoJson`, which is what their own
   Leaflet map draws. Each feature carries weather type, warningLevel, an id and
   daysAffected.

   This is what replaced approximating a warning by the council areas it names.
   Councils were badly wrong: a thunderstorm warning over Moray and Aberdeen
   filled every council it touched, so a compact blob over the Grampians came
   out as most of eastern Scotland. These are the actual freehand shapes.

   Scraped, so it can break if the Met Office restructures that page. The
   council-area fallback is deliberately left in the map component for exactly
   that case — approximate beats blank.                                       */
async function fetchWarningPolygons() {
    try {
        const res = await fetch('https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings', {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WeatherBot/1.0)', 'Accept': 'text/html' },
        });
        if (!res.ok) return [];
        const html = await res.text();

        const at = html.indexOf('polygonsGeoJson:');
        if (at < 0) return [];
        const start = html.indexOf('{', at);
        if (start < 0) return [];

        /* Brace-matched rather than regexed: the payload contains braces inside
           strings, and a lazy regex stops at the first one that looks like the
           end. String and escape state are tracked so a brace in a place name
           cannot terminate the scan early. */
        let depth = 0, end = -1, inStr = false, esc = false;
        for (let i = start; i < html.length; i++) {
            const c = html[i];
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        if (end < 0) return [];

        const gj = JSON.parse(html.slice(start, end));
        // Point features are label anchors for their map, not warning areas.
        return (gj?.features || []).filter(f => f?.geometry && f.geometry.type !== 'Point');
    } catch (e) {
        console.warn('warning polygons unavailable:', e?.message);
        return [];
    }
}

const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** YYYYMMDD in UTC, the format daysAffected uses. */
function dayKey(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Attach the real geometry to each warning.
 *
 * EXACT WHEN THERE IS AN ID. The polygon features are keyed by the same Met
 * Office uuid the warning cards carry, so when the parse captured one the join
 * is a direct lookup: this warning, these shapes, no inference.
 *
 * The type + level + day fallback only runs for a warning with no id — a record
 * cached before ids were threaded through, or a page the marker did not survive.
 * It is a heuristic and it can over-match: two different thunderstorm warnings
 * on the same day would each receive both areas. `polygonMatch` records which
 * route was taken so that is visible rather than assumed.
 */
function attachPolygons(warnings, features) {
    if (!features.length) return warnings;

    const byId = new Map();
    for (const f of features) {
        const id = f.properties?.id;
        if (!id) continue;
        if (!byId.has(id)) byId.set(id, []);
        byId.get(id).push(f);
    }

    return warnings.map(w => {
        const exact = w.id ? byId.get(w.id) : null;
        if (exact?.length) {
            return {
                ...w,
                polygons: exact.map(f => f.geometry),
                polygonIds: [w.id],
                polygonMatch: 'id',
            };
        }

        const key = dayKey(w.validFrom) || dayKey(w.validTo);
        const hits = features.filter(f => {
            const p = f.properties || {};
            if (!sameText(p.weather, w.type) || !sameText(p.warningLevel, w.severity)) return false;
            const days = Array.isArray(p.daysAffected) ? p.daysAffected : [];
            return !key || !days.length || days.includes(key);
        });
        if (!hits.length) return w;
        return {
            ...w,
            polygons: hits.map(f => f.geometry),
            polygonIds: hits.map(f => f.properties?.id).filter(Boolean),
            polygonMatch: 'approx',
        };
    });
}

/* Identity of a warning, for telling a still-published one from a vanished one.

   EVERY warning gets BOTH keys, and two warnings are the same if they share
   EITHER. That matters at the boundary where ids were introduced:

     cached before ids  ->  only the composite key
     the same warning,
     freshly fetched    ->  an id key AND the composite key

   Keying on the id alone made those two look like different warnings, so the
   cached copy was declared vanished and filed as expired while the fresh copy
   showed as active — the same thunderstorm listed twice, once as history. The
   composite key overlaps and holds them together.

   The id key still earns its place: it survives an AMENDMENT. A warning whose
   end time is extended keeps its id but changes its composite key, and without
   the id it would look like a new warning while the original was filed as
   expired — the same duplication from the other direction. */
function warningKeys(w) {
    const regions = Array.isArray(w.regions) ? w.regions.join(',') : (w.region || '');
    const keys = [`${w.type}|${w.severity}|${regions}|${w.validFrom}|${w.validTo}`];
    if (w.id) keys.push(`id:${w.id}`);
    return keys;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const now = new Date();

        const pageHtml = await fetchWarningsPage();

        /* Carry the Met Office's own warning id through the tag strip.

           Each warning detail block is <div class="warning-card"
           data-warning-id="<uuid>">, and the same uuid keys the polygon in
           polygonsGeoJson. Stripping tags destroyed it, which is why geometry
           had to be matched on type + level + day — a heuristic that merges two
           different warnings of the same type on the same day. Rewriting the
           attribute into a plain-text token BEFORE the strip lets the id survive
           into what the model reads, so the join can be exact.

           Only the detail cards are marked. The summary rows at the top of the
           page carry the same attribute, and tagging both would put two ids in
           front of the model for one warning.

           The pattern consumes the WHOLE opening tag and replaces it with the
           marker. Rewriting just the attribute put the marker inside the tag,
           where the very next line — which deletes everything between < and > —
           swallowed it along with the tag. The marker has to end up as ordinary
           text between tags to survive. */
        const pageText = pageHtml
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<div[^>]*class="warning-card"[^>]*data-warning-id="([0-9a-fA-F-]{36})"[^>]*>/gi,
                     ' [[WARNING_ID:$1]] ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim()
            // Raised from 20k: the full warning text, the what-to-expect bullets
            // and the county lists for several concurrent warnings do not fit in
            // 20k, and the tail was being cut off mid-warning.
            .slice(0, 60000);

        const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `Below is the content of the Met Office accessible UK weather warnings page, fetched right now (${now.toISOString()} UTC).

Parse ALL weather warnings from this page content and return them as structured JSON.

PAGE CONTENT:
${pageText}

For each warning extract:
- "id": The warning's Met Office id. Each warning's details are preceded by a marker of the form [[WARNING_ID:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx]] — copy the value inside it exactly. If a warning has no such marker, use "".
- "type": Warning type (e.g. Rain, Wind, Snow, Ice, Thunderstorm, Fog, Flood, Extreme Heat)
- "severity": Severity level (Yellow, Amber, or Red)
- "regions": Array of affected regions/areas (e.g. ["Scotland", "Northern England"] or ["South West England"])
- "counties": Array of the individual counties / council areas named for this warning, exactly as written on the page (e.g. ["Aberdeen", "Aberdeenshire", "Moray"]). The page usually lists these after the region name, separated by commas. Return [] if none are given.
- "headline": The Met Office's own one-line headline for this warning, verbatim.
- "description": The FULL warning text, not a summary. Include every paragraph the page gives under the warning: what is expected, where, when, how it develops through the period, and any caveats about confidence or timing. Several paragraphs is normal and correct — separate them with blank lines. Do NOT compress this to a sentence; the page already has the headline for that.
- "whatToExpect": Array of the bullet points listed under "What should I expect?", each verbatim as its own string. [] if absent.
- "updateReason": If the page says this warning has been updated, amended or reissued, the reason given, verbatim. "" if it does not say.
- "validFrom": Start date/time in ISO 8601 UTC format (e.g. 2026-02-18T06:00:00Z)
- "validTo": End date/time in ISO 8601 UTC format (e.g. 2026-02-18T18:00:00Z)
- "impacts": Optional string describing the impacts of this warning

Rules:
- Include EVERY warning listed — do not skip any.
- id MUST come from the [[WARNING_ID:...]] marker immediately preceding that warning's details. Never invent one, never reuse another warning's.
- Do NOT combine multiple warnings into one.
- regions MUST be an array (even if only one region affected)
- counties MUST be an array of the SMALLEST named areas on the page. These drive the map: each one is matched against real UK council boundaries, so give the council/county names verbatim rather than paraphrasing or grouping them.
- description is the LONG text. A one-sentence description is wrong — that is what headline is for. Copy the wording rather than rewriting it: this is safety information and paraphrasing changes what it says.
- If no warnings are found, return { "all_warnings": [] }.
- For validFrom/validTo, use the current year (${now.getFullYear()}) if no year is given on the page.`,
            response_json_schema: {
                type: "object",
                properties: {
                    all_warnings: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "string" },
                                type: { type: "string" },
                                severity: { type: "string" },
                                regions: { type: "array", items: { type: "string" } },
                                counties: { type: "array", items: { type: "string" } },
                                headline: { type: "string" },
                                description: { type: "string" },
                                whatToExpect: { type: "array", items: { type: "string" } },
                                updateReason: { type: "string" },
                                validFrom: { type: "string" },
                                validTo: { type: "string" },
                                impacts: { type: "string" }
                            }
                        }
                    }
                }
            }
        });

        const parsedWarnings = Array.isArray(result?.all_warnings) ? result.all_warnings : [];

        // Real areas, fetched alongside the text parse and joined onto it.
        const polygonFeatures = await fetchWarningPolygons();
        const freshWarnings = attachPolygons(parsedWarnings, polygonFeatures);
        const fetchedAt = now.toISOString();

        // Load the existing cached record so we can preserve historical warnings
        const existing = await base44.asServiceRole.entities.CachedWarnings.list();
        const existingRecord = existing[0] || null;
        const previousWarnings = Array.isArray(existingRecord?.all_warnings) ? existingRecord.all_warnings : [];

        // Cut-off: only keep historical warnings from the last 5 days
        const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

        // Every identity the fresh warnings answer to.
        const freshKeys = new Set(freshWarnings.flatMap(warningKeys));

        /* A warning that has dropped off the Met Office page ended one of two
           ways, and the difference matters to a reader:

             EXPIRED    it ran to its published end time and lapsed.
             CANCELLED  the Met Office withdrew it early, while it still had
                        time left to run — the threat did not materialise.

           The old filter required validTo < now to keep anything, so a
           cancelled warning — which by definition still has a future end time —
           failed that test and was DISCARDED. Cancelled warnings were not
           mislabelled in the past list, they never reached it at all.

           The status is STICKY once set. Without that, a warning cancelled at
           14:00 with a 21:00 end time would quietly turn into "expired" at
           21:01, because by then validTo really is in the past. What ended it
           is a fact about the moment it vanished, not about the clock now. */
        const historicalWarnings = previousWarnings
            // Still published under ANY of its identities? Then not history yet.
            .filter(w => !warningKeys(w).some(k => freshKeys.has(k)))
            .map(w => {
                if (w.status === 'cancelled' || w.status === 'expired') return w;  // already decided
                const validTo = w.validTo ? new Date(w.validTo) : null;
                if (!validTo) return null;
                return {
                    ...w,
                    status: validTo >= now ? 'cancelled' : 'expired',
                    endedAt: now.toISOString(),
                };
            })
            .filter(w => {
                if (!w) return false;
                // Trim on when it actually ended, so a warning cancelled days
                // early still ages out five days after the cancellation rather
                // than five days after an end time it never reached.
                const ended = new Date(w.endedAt || w.validTo);
                return ended >= fiveDaysAgo;
            });

        /* ── Amendments ─────────────────────────────────────────────────────

           The Met Office amends live warnings: the area grows, the timing
           shifts, the level goes from yellow to amber. Previously each fetch
           simply overwrote the stored copy, so an amendment was invisible — the
           warning silently became something else and nobody could see what had
           changed or when.

           A snapshot of the PREVIOUS version is now kept on the warning itself,
           so the card can show a before and after. Only the fields a reader
           would care about are compared; a reworded description alone still
           counts, because that is often exactly what the amendment was.

           `previousVersions` keeps the last three. Unbounded history would grow
           the cached record without limit for a warning amended hourly through a
           long event, and nobody reads the fifth-oldest revision.

           `polygons` is watched too. The Met Office very often amends a warning
           by redrawing its area and changing no wording at all, which used to
           register as no change whatsoever. Keeping the old outline is also what
           lets the card draw a before/after map of the area. */
        const WATCHED = ['severity', 'validFrom', 'validTo', 'description', 'headline', 'regions', 'counties', 'impacts', 'polygons'];

        /* Snapshots keep a coarsened copy of the geometry. Full-resolution
           multipolygons are by far the largest thing on a warning, and the
           before/after map is a thumbnail: 3 decimal places is roughly 110 m,
           far finer than that map can resolve. */
        const COARSE = 1000;
        const coarsenRing = (ring) => {
            const out = [];
            for (const pt of ring) {
                const p = [Math.round(pt[0] * COARSE) / COARSE, Math.round(pt[1] * COARSE) / COARSE];
                const last = out[out.length - 1];
                if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
            }
            // Rounding can collapse a small ring entirely; keep the original.
            return out.length >= 4 ? out : ring;
        };
        const coarsenGeometry = (g) => {
            if (!g?.coordinates) return g;
            if (g.type === 'Polygon') return { ...g, coordinates: g.coordinates.map(coarsenRing) };
            if (g.type === 'MultiPolygon') return { ...g, coordinates: g.coordinates.map((poly) => poly.map(coarsenRing)) };
            return g;
        };
        // Only the newest snapshot needs geometry — the card only ever draws the
        // most recent change, so older ones would be dead weight in the record.
        const withoutPolygons = ({ polygons, ...rest }) => rest;

        const snapshotOf = (w) => {
            const s = { capturedAt: w.lastCheckedAt || fetchedAt };
            for (const k of WATCHED) if (w[k] !== undefined) s[k] = w[k];
            if (Array.isArray(s.polygons)) s.polygons = s.polygons.map(coarsenGeometry);
            return s;
        };

        const changedFields = (a, b) => WATCHED.filter(k => {
            // A failed polygon scrape leaves a warning with no geometry. That is a
            // gap in our own data, not the Met Office moving the area, and
            // reporting it as an amendment would invent one out of an outage.
            if (k === 'polygons' && (!a?.polygons?.length || !b?.polygons?.length)) return false;
            return JSON.stringify(a?.[k] ?? null) !== JSON.stringify(b?.[k] ?? null);
        });

        const previousByKey = new Map();
        for (const w of previousWarnings) {
            for (const k of warningKeys(w)) previousByKey.set(k, w);
        }

        const mergedWarnings = [
            ...freshWarnings.map(w => {
                const before = warningKeys(w).map(k => previousByKey.get(k)).find(Boolean);
                const base = { ...w, status: 'active', endedAt: null, lastCheckedAt: fetchedAt };
                if (!before) return base;

                const changed = changedFields(before, w);
                if (!changed.length) {
                    // Unchanged: carry any amendment history forward untouched.
                    return {
                        ...base,
                        updatedAt: before.updatedAt || null,
                        updatedFields: before.updatedFields || [],
                        previousVersions: before.previousVersions || [],
                    };
                }
                return {
                    ...base,
                    updatedAt: fetchedAt,
                    updatedFields: changed,
                    // Newest first, capped at three.
                    previousVersions: [snapshotOf(before), ...(before.previousVersions || []).map(withoutPolygons)].slice(0, 3),
                };
            }),
            ...historicalWarnings,
        ];

        // Update or create the single cached record
        // map_url points to the Met Office's public static PNG of the current
        // warnings map — always reflects the live warning areas.
        const MAP_URL = 'https://www.metoffice.gov.uk/public/data/PWSCache/WarningsMaps/UK';

        if (existingRecord) {
            await base44.asServiceRole.entities.CachedWarnings.update(existingRecord.id, {
                all_warnings: mergedWarnings,
                fetched_at: fetchedAt,
                map_url: MAP_URL,
            });
        } else {
            await base44.asServiceRole.entities.CachedWarnings.create({
                all_warnings: mergedWarnings,
                fetched_at: fetchedAt,
                map_url: MAP_URL,
            });
        }

        return Response.json({ all_warnings: mergedWarnings, fetched_at: fetchedAt, map_url: MAP_URL });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});