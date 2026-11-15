# MyWeatherUK versions

The site's version is **5.##.###**, numbers only:

- **5** is the main version: V5, the site launched in September 2026.
- **##** goes up by one with each big-ish update: a new page, a new model, or a rebuild or redesign of a section.
  The last three digits go back to 000.
- **###** goes up by one with each smaller patch: a fix, a tweak, polish, speed or work behind the scenes.

Every version is a save of the site's code (a git commit, which also has a code of letters and numbers,
shown here as "Saved as"), and every save from 10 Oct 2026 on is listed below, numbered in order. Versions
are tagged in git with their number, so `git checkout 5.50.003` opens that version.

Each save bumps the number in the same commit: `node scripts/version.mjs minor "What changed"` for a big-ish
update, `node scripts/version.mjs patch "What changed"` for a patch, then after committing
`node scripts/version.mjs tag` and `git push origin main 5.##.###` (that tag only). The current version is in `version.json`;
the site shows it in the bottom corner of every page.

| Version | Date | Kind | Saved as | What changed | Chat |
|---|---|---|---|---|---|
| 5.52.010 | 2026-11-15 | Patch | — | The site's line, "Alert. Aware. Safe" and "For A Brighter Future", beside Account in the top bar; on phones and tablets it stands under the MyWeatherUK name on the home page in place of the description | Location Weather overhaul (Nov) |
| 5.52.009 | 2026-11-15 | Patch | 203ad9a | Warning map on phones: the warning's details take under half the screen (was three-quarters), so its area stays in view, and they drag down to close | Location Weather overhaul (Nov) |
| 5.52.008 | 2026-11-15 | Patch | 22cc244 | Home: pressing a warning card opens the warning map on that warning, on its day, framed on its area, with its full details open beside it | Location Weather overhaul (Nov) |
| 5.52.007 | 2026-11-15 | Patch | 605df71 | Model Data: point at any line of the polar vortex chart (or press on it on a phone or tablet) to pick out that GEFS member, GFS, the mean, the observed or the normal, and see what it says that day, its lowest and highest, and whether it reverses the winds; the timeline lands only on steps that have loaded (a drag, a tap, the arrow keys, back and next) and no longer jitters under a drag | Model Data STRATA redesign (Nov) |
| 5.52.006 | 2026-11-15 | Patch | 5f6fca0 | Model Data: a Long range view: the stratospheric polar vortex (the westerly wind round the Arctic at 10 hPa, observed, GFS and all 30 GEFS members to 35 days against the 1991-2020 normal) and the MJO's phase over the past 40 days; the vortex's 10 hPa winds on the map; an i beside each chart says what it is, how to read it and why it matters for the UK | Model Data STRATA redesign (Nov) |
| 5.52.005 | 2026-11-15 | Patch | 26c1369 | Model Data: GDPS fixed (its rain rate was a thousand times too high at most steps, painting rain over the whole map; its precipitation type, freezing rain and ice pellets remade, the lifted index's no-parcel filler and CAPE's gaps cleared, its 6-hour highs and lows named as such), and the stratosphere at 10 and 50 hPa (the polar vortex) for GFS and GDPS | Model Data STRATA redesign (Nov) |
| 5.52.004 | 2026-11-15 | Patch | 19ccf3d | Model Data: ECMWF ENS and AIFS ENS in Forecast mode, as the mean of their 50 members, with the spread between them, the strongest gust and the wettest member | Model Data STRATA redesign (Nov) |
| 5.52.003 | 2026-11-15 | Patch | 73ab61b | Model Data: Météo-France's ARPEGE (0.1° over Europe, 79 layers with its own precipitation type and upper air) and AROME (2.5 km on the UK map, south of 55.4°N, 42 layers) | Model Data STRATA redesign (Nov) |
| 5.52.002 | 2026-11-15 | Patch | d904f9c | Model Data: three new models (NOAA's AI GFS, Canada's GDPS, MET Norway's HARMONIE at 2.5 km) and 25 layers worked out from other layers (wet-bulb, humidex, frost and icy-surface risk, Beaufort force, lapse rates, pressure and temperature changes and more) | Model Data STRATA redesign (Nov) |
| 5.52.001 | 2026-11-15 | Patch | 7c7a694 | Location Weather: rain splashing on the top card again (the warnings card when there is one), snow that settles along it, round its corners and now and then off its ends, and frost on the glass below freezing | Location Weather overhaul (Nov) |
| 5.52.000 | 2026-11-15 | Update | 21c6708 | Model Data: the wide map grown to Alaska, Canada, Greenland, all of Scandinavia and North Africa; a region picker (the UK and Ireland, Europe, North Africa and North America, down to countries and regions); no descriptions under layer names; the radar's rain, sleet, snow and ice steered by what the airports report | Model Data STRATA redesign (Nov) |
| 5.51.000 | 2026-11-15 | Update | 77627aa | Location Weather: the freezing level read at the ground, the hours and detailed forecast to the last day (Saturday), the radar beside the days and the detailed forecast moved up | Location Weather overhaul (Nov) |
| 5.50.006 | 2026-11-15 | Patch | 8d3fa4e | Version tool: tags only the save that carries the version (a failed commit cannot pass its number to the one before) | Location Weather overhaul (Nov) |
| 5.50.005 | 2026-11-15 | Patch | f17be9c | Version tool: push only the new version's tag (the cloud runs' release tags stay put) | Location Weather overhaul (Nov) |
| 5.50.004 | 2026-11-15 | Patch | cb861e2 | Site version numbers: 5.##.### in the corner of every page, every save of the site numbered (VERSIONS.md) | Location Weather overhaul (Nov) |
| 5.50.003 | 2026-11-15 | Patch | 5a070f7 | Model Data: coded layers drawn in their own class; the timeline's arrow keys take one step | Model Data STRATA redesign (Nov) |
| 5.50.002 | 2026-11-15 | Patch | 190807b | Location Weather cubes: read again a frame caught half-written; the Mix waits for its UKV run's amounts | Location Weather overhaul (Nov) |
| 5.50.001 | 2026-11-15 | Patch | 7dc0e35 | Model Data: load count, satellite detail, more places, cm/h and in/h, a roomy phone layout | Model Data STRATA redesign (Nov) |
| 5.50.000 | 2026-11-15 | Update | 643bea2 | Location Weather: a 7-day Day and Night forecast, snow chance each hour, 15-minute steps, five kinds of precipitation, and much faster loading | Location Weather overhaul (Nov) |
| 5.49.000 | 2026-11-15 | Update | a3b2f51 | Model Data: snow risk conditions index, and the MWUK Mix (UKV + ICON-EU) | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.48.001 | 2026-11-15 | Patch | 9d86ffc | Model Data: named-class keys show every name; the timeline never squeezes labels | Model Data STRATA redesign (Nov) |
| 5.48.000 | 2026-11-15 | Update | 8f2bb78 | Model Data: the STRATA redesign, with the simplest navigation yet | Model Data STRATA redesign (Nov) |
| 5.47.000 | 2026-11-15 | Update | 26b0a29 | Model Data: DWD ICON-EU, with every field it publishes (98 layers) | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.46.004 | 2026-11-15 | Patch | a302a7e | Model Data: the layer someone is waiting for comes first again | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.46.003 | 2026-11-14 | Patch | e77b0d2 | Model Data exports: much smoother transitions, and GIFs and videos time themselves | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.46.002 | 2026-11-14 | Patch | b463c03 | TCM FROST: start each next cloud run itself, as TCM NOVA does | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.46.001 | 2026-11-13 | Patch | b487287 | Model Data: AIFS precipitation no longer 1000x too high; 14 more AIFS layers, 28 more GEFS mean layers, 8 more GEFS chances | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.46.000 | 2026-11-13 | Update | 4b689af | TCM FROST page in the Forecast menu; the Snow overlay's options fit the Layers panel | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.45.001 | 2026-11-13 | Patch | 8c63f41 | TCM FROST: the UKV's long runs read three-hourly past T+54, and a step without precipitation is integrated across | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.45.000 | 2026-11-13 | Update | 2f36160 | TCM FROST on the site: a model on Model Data, a snow overlay for everyone, a snow card on Location Weather | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.44.002 | 2026-11-13 | Patch | 0b514b2 | TCM FROST 1.1.0: Met Office Global read in the cloud, longer runs carry short ones on, whole totals only, run log | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.44.001 | 2026-11-13 | Patch | 11fffa4 | TCM FROST: call the expected snow layer snow_expected (snow_acc is Model Data's 10:1 accumulation) | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.44.000 | 2026-11-13 | Update | 85f3bb9 | TCM FROST: a snow model for the UK and Ireland (2 km, 10 days, every 6 h) | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.43.003 | 2026-11-13 | Patch | 18df3d0 | Smooth precipitation type, radar typed at once, faster AWS fetching | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.43.002 | 2026-11-13 | Patch | 16c3f92 | Model Data: pick any run from the last 24 hours | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.43.001 | 2026-11-12 | Patch | 353f93a | Live analysis: fill older times' precipitation type cheaply | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.43.000 | 2026-11-12 | Update | c51769d | Precipitation type as rain, snow, sleet and ice; pale colours; site stalls | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.42.002 | 2026-11-08 | Patch | 41bdb62 | Top bar: Remembrance poppy for November, Polish mourning ribbon to 11 Nov | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.42.001 | 2026-11-07 | Patch | 5488c88 | Model Data: draw layers from their values at screen resolution | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.42.000 | 2026-11-07 | Update | 7db683a | Model Data: warnings overlay, two-window compare, video, smooth motion, layer stack | Model Data, TCM FROST and the MWUK Mix (Nov) |
| 5.41.001 | 2026-10-26 | Patch | b09e033 | Model Data: much less lag with extra layers on | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.41.000 | 2026-10-26 | Update | 95a8948 | Model Data: Europe-wide global models, MSLP overlay, more layers; Weather Patterns by named week pattern | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.40.003 | 2026-10-26 | Patch | 8860315 | Keepalive: catch a start that hangs, give a booting server time | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.40.002 | 2026-10-24 | Patch | 55e05cc | Warnings: MyWeatherUK's own symbol for every warning type except wind | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.40.001 | 2026-10-24 | Patch | 037bc7a | Ready for the clocks going back (BST to GMT, 01:00 UTC on 25 Oct) | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.40.000 | 2026-10-24 | Update | 13a2b00 | Forecast Verification: import saved studio outlooks and score them; any strike colour | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.39.005 | 2026-10-23 | Patch | 371806b | Location Weather: the hourly strip starts at the hour we are in | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.39.004 | 2026-10-23 | Patch | df38a1b | Wind Gusts graphic: UKV periods, Smooth/Broad gust layer, mph key, no Conditional | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.39.003 | 2026-10-23 | Patch | f21f501 | Graphic Studio: delete saved graphics, closeable Saved window, lightning accuracy score | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.39.002 | 2026-10-23 | Patch | 1e57448 | Studio saves in reach; NOVA import from any recent run; Model Data risk overlay and strike styles | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.39.001 | 2026-10-23 | Patch | b0782ab | Warning map: only warnings in force or upcoming; days right across the clock change | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.39.000 | 2026-10-23 | Update | d4ce3cc | Settings rebuilt; preferences that stick; the site in five more languages | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.38.000 | 2026-10-22 | Update | 1f157bc | News and Newsletter pages rebuilt in liquid glass; the newsletter popup is gone | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.37.001 | 2026-10-22 | Patch | 1e8a513 | TCM Verification and the TCM Archive open to everyone | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.37.000 | 2026-10-22 | Update | 0560025 | Verification section rebuilt: graphic lightning overlay, TCM NOVA verification and archive | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.36.001 | 2026-10-22 | Patch | b46b924 | Lock down the entity API: per-entity read and write rules | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.36.000 | 2026-10-22 | Update | 5dfb5e7 | Public Graphic Studio: the outlook tools for everyone, in liquid glass | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.35.003 | 2026-10-22 | Patch | 8255329 | Remove the Graphics page and the menu's graphics shortcuts | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.35.002 | 2026-10-22 | Patch | 1857d51 | Graphic posts: key words coloured automatically by what they mean | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.35.001 | 2026-10-22 | Patch | 056b918 | Location Weather: hourly summary covers the next 12 hours and says when | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.35.000 | 2026-10-22 | Update | 50e2748 | Location Weather: TCM NOVA thunderstorm risk each hour, truer cloud and forecasts | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.34.001 | 2026-10-22 | Patch | 277e0d0 | Outlook graphics: no footer band, clearer tinted liquid glass, glass in the JPG | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.34.000 | 2026-10-22 | Update | c6b2827 | Graphic Studio: AWS temperature map at ~250 m, timed risk areas, timeline fixes | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.33.001 | 2026-10-22 | Patch | 3a57b46 | Graphic Studio: undo/redo, Select tool, smoother imports, glass for every tool | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.33.000 | 2026-10-22 | Update | 075c9c5 | Graphic Studio: county map views, dated timeline, TCM NOVA, glass controls | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.32.003 | 2026-10-22 | Patch | 9f31873 | Max gust so far on Model Data; draw anywhere in the studio; compact Hazards | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.32.002 | 2026-10-22 | Patch | 376a1ef | Location Weather: right cloud now, Mostly cloudy, charts readable to the minute | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.32.001 | 2026-10-22 | Patch | 74d0f70 | Warning map: save the selected warning as a JPG | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.32.000 | 2026-10-22 | Update | 7e1db2e | Location Weather: warning cards, warning bars on the hourly strip, day details | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.31.004 | 2026-10-22 | Patch | 10a4c5d | Right-now cloud from the satellite and airport reports, not the UKV forecast | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.31.003 | 2026-10-21 | Patch | 228cb73 | Menu: rewrite page descriptions, fix the blank MyWeatherUK Graphics link | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.31.002 | 2026-10-21 | Patch | e192410 | Home page: bigger title, warnings status fix, server lightning counts, cleanup | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.31.001 | 2026-10-21 | Patch | f6d3c91 | Lightning page: full screen could not be left | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.31.000 | 2026-10-21 | Update | 366f821 | AI lightning warnings: GFS atmosphere from AWS, training on the archive, cloud gap-filling | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.30.001 | 2026-10-21 | Patch | cc07528 | Lightning capture on GitHub Actions, so strikes are recorded while the PC is off | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.30.000 | 2026-10-21 | Update | f4534e5 | Lightning page: 24/7 server-side strike archive and a liquid-glass rebuild | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.29.001 | 2026-10-21 | Patch | 894dace | Weather Patterns: fix card glitches and tidy the layout | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.29.000 | 2026-10-21 | Update | 9d1770b | Weather Patterns: new daily ECMWF + GFS blended weekly scenarios | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.28.001 | 2026-10-21 | Patch | a8a96a4 | Card rain: drops out of focus behind the glass, so the numbers stay readable | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.28.000 | 2026-10-21 | Update | 0ae56f2 | Location Weather: new weather types and symbols, smooth skies, rain on the cards' glass | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.27.003 | 2026-10-21 | Patch | ce57e6b | Further info panel: liquid glass, light and dark, the graphic's risk ladder | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.27.002 | 2026-10-21 | Patch | 4b952a9 | Graphic descriptions keep the colours picked in the editor | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.27.001 | 2026-10-21 | Patch | 2e63aa2 | README: drop the RelayStatusPanel note (the panel was removed with the TCM admin section) | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.27.000 | 2026-10-21 | Update | 447c66f | Admin Settings rebuilt in liquid glass, light and dark; TCM and Source Files removed | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.26.003 | 2026-10-21 | Patch | 39e7c82 | Graphic Studio: lightning from the Met Office, like the rest of the site | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.26.002 | 2026-10-21 | Patch | 98d58cd | Graphics: no more one-tap archiving; put an archived graphic back on the home page | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.26.001 | 2026-10-21 | Patch | 025c4d2 | Graphics: archive scroll fix, risks as the Thunderstorm graphic draws them, new glass upload sheet | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.26.000 | 2026-10-21 | Update | 0e06bcf | Location Weather: minute-by-minute radar nowcast, denser downpours, rain on the cards | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.25.001 | 2026-10-21 | Patch | ab65875 | Keep the radar, "right now" and forecast fresh after the PC has slept | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.25.000 | 2026-10-20 | Update | aa88448 | Around the world: the new live skies and symbols, and Met Office data everywhere | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.24.001 | 2026-10-20 | Patch | 9f68a9f | Warning map: the UK map shows sharp and centred, and never waits on a CDN | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.24.000 | 2026-10-20 | Update | b5b0cef | Warnings: liquid-glass warning map and a rebuilt warnings archive | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.23.003 | 2026-10-20 | Patch | 842756f | LiveStream: Met Office radar instead of RainViewer | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.23.002 | 2026-10-20 | Patch | 716ff77 | TCM NOVA: log every model's HTTP attempts and decoder-lock use per frame; ask a stalled byte range again | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.23.001 | 2026-10-20 | Patch | eb4aacd | Fix the radar jumping to India on a theme switch; site-wide bug and dead-code sweep | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.23.000 | 2026-10-20 | Update | b8adca0 | Graphics archive in liquid glass; Met Office radar on the home page | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.22.003 | 2026-10-20 | Patch | c5265fc | Home: MyWeatherUK Graphics in liquid glass, moved to the top while one is in force | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.22.002 | 2026-10-20 | Patch | a4650e0 | Location Weather: a real place search, glass suggestions, tidy city cards | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.22.001 | 2026-10-20 | Patch | 5767179 | Location Weather: one glass top bar, chart choices visible on phones | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.22.000 | 2026-10-20 | Update | ecaeef6 | Location Weather: rebuilt on Met Office UKV from AWS, in liquid glass | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.21.006 | 2026-10-20 | Patch | 58f3e23 | Keep-alive task: start PowerShell through conhost --headless | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.21.005 | 2026-10-20 | Patch | 2f0e05b | TCM NOVA: combine hours across days into one map | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.21.004 | 2026-10-20 | Patch | 4bca209 | TCM NOVA Main Run: Met Office Global profiles over one kept-alive connection; skip the fallback publish when every chunk succeeded | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.21.003 | 2026-10-20 | Patch | 5e61e09 | Model Data: phone and tablet layouts reworked | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.21.002 | 2026-10-20 | Patch | e9eaf5e | TCM NOVA Main Run: ECMWF cycles complete on the Google copy, publish from the one-lead chunk, faster job start | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.21.001 | 2026-10-20 | Patch | 63520f0 | Model Data polish: one Layers panel, model picker, point timeline, fixes | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.21.000 | 2026-10-20 | Update | 4e760a1 | Model Data: observed days, current conditions, roads, value grid, wind arrows, weather symbols, more AWS models; studio radar = Met Office | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.20.002 | 2026-10-20 | Patch | cdd0a5f | TCM NOVA Main Run: keep UKV and Met Office Global past T+48; log fetch time per model | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.20.001 | 2026-10-20 | Patch | c7a9381 | TCM NOVA: fix the site mirror stalling on Hyper-Short, and shrink stored runs | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.20.000 | 2026-10-20 | Update | 9a76f36 | Model Data: Live mode (satellite, Met Office radar, lightning), motion-graphics radar palette, new graphic layout, fresher runs | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.19.001 | 2026-10-19 | Patch | 8d6ee67 | Model Data probability: type the exact threshold, step it, bigger slider | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.19.000 | 2026-10-19 | Update | 48dd91b | Model Data: probability mode from ECMWF ENS (50 members) and GEFS (31 members) | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.18.002 | 2026-10-19 | Patch | 95fe255 | Model Data: glass UI follows the map theme (readable on the light map), lighter prefetch | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.18.001 | 2026-10-19 | Patch | 2ce136c | Model Data: smooth coarse models, far faster loading, time kept on switch, max star | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.18.000 | 2026-10-19 | Update | 1045833 | Model Data: Liquid Glass UI, framed preview = export, light/satellite/real-time maps | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.17.000 | 2026-10-19 | Update | d4650f0 | Model Data rebuilt: every AWS model on the UKV 2 km grid, GIF/PNG export | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.16.001 | 2026-10-19 | Patch | 5a0758e | Forecast Scenarios: story cards, ECMWF loading fix, day ranges | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.16.000 | 2026-10-19 | Update | e035d1f | TCM NOVA: Hyper-Short 2, faster Main Run, calibration era | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.15.010 | 2026-10-19 | Patch | 5bc3e75 | TCM NOVA: a Main Run made by an older engine version is redone for the current cycle (engine recorded in latest.json); the newest run is always re-uploaded | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.15.009 | 2026-10-19 | Patch | d1faa05 | TCM NOVA workflow: a push of the workflow starts the heartbeat chain; training only when TRAIN_REQUEST changes | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.15.008 | 2026-10-19 | Patch | c20c333 | TCM NOVA workflow: self-sustaining 9-minute heartbeat (workflow_dispatch chain, one at a time) so runs no longer depend on GitHub's irregular cron | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.15.007 | 2026-10-19 | Patch | b6b3683 | TCM NOVA V5 engine: faster kernels (pointer environment walk, shared fixed-pressure interpolation tables, tabulated saturation, compiled transfers/compositions, dew point, wet bulb) -- still PASS against V5 exactly in verification mode; uncertainty and initiation layers on the page | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.15.006 | 2026-10-19 | Patch | 05636f4 | TCM NOVA: Met Office Global joins the V5 chain (7 models): its 870 MB-a-step global 3-D files are read as just the UK window's HDF5 chunks (~3 MB), in parallel processes | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.15.005 | 2026-10-19 | Patch | 159bbfe | TCM NOVA rebuilt on the TCM V5 engine, fast enough to run every cycle | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.15.004 | 2026-10-19 | Patch | 553a357 | Warnings: Met Office-style detail panel on the warning map (headline, what to expect, further detail, why this colour + official impact matrix, issued, regions and local authorities); official impact matrix in the warning card info; jump-to-day button when the selected day has no warnings; toggleable warning name tags; place names only inside warning areas | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.15.003 | 2026-10-19 | Patch | 3a673ee | Radar: leaving fullscreen puts the home-page map back where it was before fullscreen (zoom and position), whatever was explored full-size | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.15.002 | 2026-10-19 | Patch | e45580a | Radar: much faster zooming — decoded-tile cache (no re-download or re-decode when revisiting a zoom level), hidden loop frames detach during a zoom and reload one at a time behind the visible frame, allocation-free pixel decode | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.15.001 | 2026-10-19 | Patch | 3a7bff2 | Keep-alive watchdog: restarts the site within ~90 s if it stops answering; starts hidden at logon via a scheduled task | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.15.000 | 2026-10-19 | Update | addafb7 | TCM NOVA Main Run on the TCM V5 engine: every AWS/DWD model downscaled to the 2 km V5 grid, reworked NOVA-V5 weighting (continuous lead baseline, resolution credit, cycle freshness, skill, family caps, per-cell consensus), V5 Stages 3-8 on the blend; whole-day risk view by default with an optional 3-hourly view; GitHub runs the Main Run as 4 parallel chunks | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.14.002 | 2026-10-19 | Patch | bf66fa9 | Warnings: Met Office further details, what-to-expect impacts and impact matrix in the warning info; zoom-dependent place names (toggle) on the warning maps; NOVA sync no longer blocks the server | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.14.001 | 2026-10-19 | Patch | 8699fcf | Warnings: draw the official Met Office NSWWS polygon on every warning map (was read as 'polygons' but delivered as 'geometry', so maps fell back to council blocks or nothing) | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.14.000 | 2026-10-18 | Update | da5ccde | Graphic Studio: Snow Accumulation, Snow Risk and new Wind graphic share the Snow Chance/Thunderstorm studio; map moved up off the footer; photo credit removed | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.13.003 | 2026-10-18 | Patch | ff34ef7 | Site mirrors: one cached GitHub /releases call for every mirrored release (stays inside the 60/h anonymous API limit) | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.13.002 | 2026-10-18 | Patch | ce608e7 | TCM V3: install locally built runs through the running server (keeps the in-memory DB authoritative) | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.13.001 | 2026-10-18 | Patch | 81e064f | NOVA workflow: build static data once before parallel training; tolerate release/upload races | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.13.000 | 2026-10-18 | Update | 7d50e4a | TCM V3 from AWS on GitHub at 03:00/15:00 UK (V3's own engine, synced into the site DB), NOVA admin-only with public coming-soon lock, V3 lightning from the Met Office full-day feed like NOVA, netCDF decode lock (fixes UKV/MO fields mixing across threads), training trigger | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.12.001 | 2026-10-18 | Patch | 56af56b | NOVA workflow: system ecCodes via apt | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.12.000 | 2026-10-18 | Update | faf3608 | TCM NOVA on GitHub Actions (hourly Hyper-Short, 4x daily Main Run, nightly learning, lightning archive, parallel training) published as releases and mirrored locally; lightning-today overlay; fix UKV RH (fraction, over ice) drying every UKV profile; keep undefined CIN undefined; NOVA bar docks under site nav | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.11.001 | 2026-10-18 | Patch | 20cda86 | TCM NOVA globe: ~16x cheaper per frame (110m coastlines, merged region geometry, cached gradients), 20 fps idle cap, stops spinning after 15 s, pauses when hidden/off-screen, frame-throttled hover | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.11.000 | 2026-10-18 | Update | 643ea92 | TCM NOVA: NOVA-AI region/terrain-aware calibration network, England/Wales/Scotland/Ireland region map and per-region verification, grids extended over all of Ireland, 3D globe region picker, Day 1-4 menu, smoother probability colours, UKV long-run selection | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.10.000 | 2026-10-18 | Update | 25e63b0 | TCM NOVA: 4-day Main Run, historical training (hindcasts -> skill weights + calibration), nightly 00:00 learning job with verification, diagnosis and recalibration, Learning tab; CIN undefined without LFC | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.09.000 | 2026-10-18 | Update | cd3b6fb | TCM NOVA: ICON-EU + ICON-EU-EPS from DWD open data, microphysics (GFS hydrometeors, ICON columns, derived contents/radii/charging), Hyper-Short blends latest UKV, isotonic calibration from hindcasts, 8x faster column physics | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.08.000 | 2026-10-18 | Update | e457cdb | TCM NOVA replaces TCM V5: 2 km Main Run (8 AWS models, dynamic weights, terrain, column diagnostics) + 1.5 km Hyper-Short (radar/lightning), scheduler, API, page, tests | Self-hosted site back up: TCM NOVA, Model Data, Location Weather (Oct) |
| 5.07.003 | 2026-10-17 | Patch | 8e9d497 | MWUK animation rendered through the real graphic: frames in the tool's map space, captured from the tool, composed to MP4 | Moving the site off Base44 (Sep–Oct) |
| 5.07.002 | 2026-10-17 | Patch | 1042917 | Storm outlook: region views clip at the footer band instead of shrinking the map box (keeps land and risk areas registered) | Moving the site off Base44 (Sep–Oct) |
| 5.07.001 | 2026-10-17 | Patch | f7957ea | MWUK at ~2 km: bilinear regridding, configurable grid, scale-aware blend (all-model pattern + UKV/HARMONIE detail); video gets outlines above the rain, no arrows, MWUK end card | Moving the site off Base44 (Sep–Oct) |
| 5.07.000 | 2026-10-17 | Update | d1a8cb0 | MWUK: MyWeatherUK's own blended model (5 AWS models -> hourly rain + lightning density) and an MP4 animation of it over the thunderstorm outlook | Moving the site off Base44 (Sep–Oct) |
| 5.06.001 | 2026-10-17 | Patch | cf9cc0e | Storm outlook builder: tidy the TSTM band (drop stray blobs over France, bridge nearby blobs onto the main area) and add storm-motion arrows from the GFS 700 hPa steering wind | Moving the site off Base44 (Sep–Oct) |
| 5.06.000 | 2026-10-17 | Update | 14d22f5 | Thunderstorm outlook from a 5-model AWS blend; South England view cut to real counties with greyed northern France | Moving the site off Base44 (Sep–Oct) |
| 5.05.000 | 2026-10-11 | Update | a70ca6c | Past & Future graphics on real data, no Open-Meteo | Moving the site off Base44 (Sep–Oct) |
| 5.04.002 | 2026-10-11 | Patch | ab9155d | Lightning ingest: de-duplicate strikes across second boundaries | Moving the site off Base44 (Sep–Oct) |
| 5.04.001 | 2026-10-11 | Patch | d419603 | Snow graphics: polished look (glass header/cards, shaded land, band lines, sparkle, flakes), smoothed drawn areas, hatched possible-extent areas | Moving the site off Base44 (Sep–Oct) |
| 5.04.000 | 2026-10-10 | Update | 8cef10f | Snow graphics: rename to Snow Chance, photo backgrounds (3 to choose), new Snow Accumulation and Snow Risk graphics with drawing and possible-extent line | Moving the site off Base44 (Sep–Oct) |
| 5.03.000 | 2026-10-10 | Update | 3eb2cbd | Graphic Studio: Snow Outlook graphic (thunderstorm tool for snow, auto areas from ECMWF/GFS/UKMO/UKV snowfall) | Moving the site off Base44 (Sep–Oct) |
| 5.02.003 | 2026-10-10 | Patch | 5d4fa96 | Auto-login: recover from a revoked or expired saved session | Moving the site off Base44 (Sep–Oct) |
| 5.02.002 | 2026-10-10 | Patch | 25f459c | Auto-login only for the site owner | Moving the site off Base44 (Sep–Oct) |
| 5.02.001 | 2026-10-10 | Patch | a2f1112 | Netlify: logo, social links and content load without the server | Moving the site off Base44 (Sep–Oct) |
| 5.02.000 | 2026-10-10 | Update | 0553dc1 | Live week-ahead scenarios from ECMWF, GFS and UKMO, built daily at 06:00 | Moving the site off Base44 (Sep–Oct) |
| 5.01.000 | 2026-10-10 | Update | cf59542 | Weather Scenarios: a full UK weather scenario library | Moving the site off Base44 (Sep–Oct) |
| 5.00.002 | 2026-10-10 | Patch | e0b532d | Lightning: draw all strikes on one canvas, save strike cache in idle time | Moving the site off Base44 (Sep–Oct) |
| 5.00.001 | 2026-10-10 | Patch | a411421 | Reduce lag: static background glow, cheaper strike flashes | Moving the site off Base44 (Sep–Oct) |
| 5.00.000 | 2026-10-10 | Start of the record | 506f40b | Initial commit: MyWeatherUK self-hosted website | Moving the site off Base44 (Sep–Oct) |
