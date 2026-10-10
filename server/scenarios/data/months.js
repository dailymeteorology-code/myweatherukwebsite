/**
 * Month-specific editorial content. Everything numeric about a "typical"
 * month (temperature, rain, sunshine, frost days) is NOT written here — it is
 * read from climate-1991-2020.json (Met Office HadUK-Grid) at runtime, so the
 * text and the figures cannot drift apart. Scenario lists per month come from
 * the scenario records' month codes.
 */
export const MONTHS = [
  {
    key: 'jan', theme: { from: '#1b2f5c', to: '#4a7bd1', accent: '#9cc7ff', icon: 'Snowflake' },
    title: 'January — winter weather and Atlantic storms',
    tagline: 'Mild Atlantic gales or bitter continental cold — the month can go either way.',
    intro: 'January is, on average, the UK\'s coldest month alongside February and one of its wettest and windiest. Most Januaries are dominated by Atlantic westerlies: mild, wet and windy weather with named storms, heavy rain on western hills and only brief cold snaps. But January is also prime time for blocking: a Scandinavian or Greenland high can switch the UK into a cold easterly or northerly regime with snow, ice days and severe frost. Snow is more likely now than in December.',
    compare: { prev: 'Colder than December on average and more likely to bring lying snow (3.3 days vs 3.0, 1991–2020), with a similar storm risk.', next: 'Similar to February in temperature; February is usually drier and can be even more prone to late-winter easterlies.' },
    regional: [
      ['northern-scotland', 'The Highlands and Grampians see the most snow and the coldest glens; föhn can produce exceptional warmth in the lee (19.9 °C at Achfary on 28 January 2024).'],
      ['north-west-england', 'Western uplands take the brunt of Atlantic rain; Cumbrian floods (Carlisle 2005) often come in January.'],
      ['east-coast', 'In easterly spells, eastern coasts get North Sea snow showers; in westerlies they are sheltered and often brighter.'],
      ['south-east', 'Usually mild and damp; lowland snow needs an easterly or a Channel low running into cold air.'],
    ],
    hazards: ['Wind storms', 'Flooding', 'Snow and ice', 'Freezing fog'],
  },
  {
    key: 'feb', theme: { from: '#22305a', to: '#6c8fd6', accent: '#b8d0ff', icon: 'CloudSnow' },
    title: 'February — late-winter extremes and changing air masses',
    tagline: 'The most variable winter month: record warmth and the Beast from the East have both happened in February.',
    intro: 'February varies enormously between years because the large-scale pattern often changes during it. Stormy, jet-driven Februaries (2014, 2020, 2022) bring repeated named storms and floods. Blocked Februaries (1947, 2018, 2021) bring the UK\'s most severe late-winter cold, as the continent is at its coldest and sudden stratospheric warmings from January can be influencing the circulation. And February has also produced extraordinary warmth: 21.2 °C at Kew on 26 February 2019, the UK\'s highest winter-month temperature.',
    compare: { prev: 'Similar in temperature to January but usually drier; snow lies on about as many days (3.4 vs 3.3).', next: 'Colder and more wintry than March, though March can still bring severe cold and snow.' },
    regional: [
      ['east-coast', 'Most exposed to late-winter easterly outbreaks and North Sea snow (2018, 2021).'],
      ['south-west-england', 'Atlantic storms and, occasionally, battleground snow when Atlantic lows meet cold air (Storm Emma, March 2018).'],
      ['wales', 'Repeated storms on saturated ground bring river floods (Storm Dennis, February 2020).'],
      ['northern-scotland', 'Snow cover persists longest; severe minimums in snowy glens (Braemar −23.0 °C, February 2021).'],
    ],
    hazards: ['Wind storms', 'Flooding', 'Snow and ice', 'Severe cold'],
  },
  {
    key: 'mar', theme: { from: '#24474a', to: '#5fb39a', accent: '#a6e3c6', icon: 'Sprout' },
    title: 'March — early spring and residual winter',
    tagline: 'Strong sunshine, cold air aloft: showers, hail, late snow and the first warm days.',
    intro: 'March sits on the boundary between seasons. The sun is now as strong as in early October, but the sea is near its coldest and Arctic air is still available, so March can deliver both the first 20 °C days (24.5 °C at Kew on 30 March 2021) and severe snow (1947\'s worst blizzards came in March; late March 2013 was one of the harshest spells of that winter). Atlantic storms continue, though usually less frequently than in mid-winter, and dry, sunny, blocked spells become more common.',
    compare: { prev: 'Milder and sunnier than February, with fewer frost days; but cold snaps can still be severe.', next: 'Colder and wetter than April on average; showers become more convective into April.' },
    regional: [
      ['north', 'Snow showers and frosts remain common in the north, especially on hills.'],
      ['south-east', 'Often the first region to see spring warmth, but also exposed to cold easterlies (March 2013).'],
      ['west-coast', 'Atlantic fronts and showers; hail in cold north-westerlies.'],
    ],
    hazards: ['Late snow', 'Frost', 'Hail showers', 'Gales'],
  },
  {
    key: 'apr', theme: { from: '#2f5a3a', to: '#86c96f', accent: '#cdeeb3', icon: 'CloudSun' },
    title: 'April — sunshine, showers and rapid transitions',
    tagline: 'April showers are real: cold air aloft over warming land means big convective clouds.',
    intro: 'April\'s reputation for showers comes from the contrast between warming land and air that is still cold aloft. Sunny mornings build into hail and thunder by afternoon, then clear to frosty nights. Northerly plunges can still bring snow to hills and occasionally lower down, while southerly or anticyclonic spells give summer-like afternoons (29.1 °C at St James\'s Park in April 2018). Blocking highs, most common in spring, can make April very dry; others have been record-breakingly wet (2000, 2012). April storms happen too (Hannah 2019, Noa 2023, Kathleen 2024, Dave 2026).',
    compare: { prev: 'Warmer and sunnier than March, with fewer frosts but more convective showers.', next: 'Cooler than May and with a higher frost risk; May brings more warmth and stronger storms.' },
    regional: [
      ['inland-england', 'Biggest diurnal range: frosty dawns, warm afternoons, afternoon showers.'],
      ['east-coast', 'Spring is haar season; easterly breezes keep coasts cool while the west is warm.'],
      ['wales', 'April storms have been notable here (Hannah 2019).'],
    ],
    hazards: ['Late frost', 'Hail and thunder', 'Spring gales', 'Dry spells'],
  },
  {
    key: 'may', theme: { from: '#3b6b2f', to: '#c2d95b', accent: '#ecf5a8', icon: 'Sun' },
    title: 'May — increasing warmth and convective potential',
    tagline: 'The sunniest month in many places — and now capable of genuine heat and thunderstorms.',
    intro: 'In the 1991–2020 UK averages, May is the sunniest month. Warm high-pressure spells become common, and continental air can now bring real heat: May 2026 set a UK May record of 35.1 °C and the first May tropical night. Thunderstorms become more frequent and stronger as surface heating increases, but frost has not gone — ground frost on clear nights in rural hollows remains plausible. Cool, showery or wet spells (May 2024\'s record rain in northern England) are still possible.',
    compare: { prev: 'Warmer and sunnier than April, with fewer frosts and stronger convection.', next: 'Slightly sunnier than June on UK average but cooler; June brings the first heatwaves more often.' },
    regional: [
      ['south-east', 'Warmest and most likely to see early heat and plume storms.'],
      ['east-coast', 'Haar and onshore breezes can keep coasts much cooler.'],
      ['northern-scotland', 'Long days; snow still possible on high summits early in the month.'],
    ],
    hazards: ['Late frost', 'Thunderstorms', 'Early heat', 'Dry spells'],
  },
  {
    key: 'jun', theme: { from: '#5a5a1f', to: '#f2c94c', accent: '#ffe9a3', icon: 'SunMedium' },
    title: 'June — early summer and thunderstorm scenarios',
    tagline: 'Long days and rising heat; warm or humid weather alone does not guarantee storms.',
    intro: 'June brings the longest days and, increasingly, the first heatwaves: June 2026 set a UK June record of 38.0 °C with heatwave conditions somewhere every day from 16 to 30 June. Hot plumes from Iberia can bring thunderstorms, though a strong cap or a settled high can keep skies storm-free despite heat. June can also be cool and wet when the jet stream lies over the UK (June 2007, 2012). Coastal haar and sea breezes keep many coasts much cooler than inland.',
    compare: { prev: 'Warmer than May with more thunderstorms and the first heatwaves.', next: 'July is on average warmer, with more frequent heat and storms.' },
    regional: [
      ['south-and-midlands', 'Highest heat and thunderstorm potential.'],
      ['east-coast', 'Haar can blanket eastern coasts on otherwise hot days.'],
      ['scotland', 'Long daylight; summer storms (Hector 2018) and occasional heat.'],
    ],
    hazards: ['Heat', 'Thunderstorms', 'Flash flooding', 'Wildfire'],
  },
  {
    key: 'jul', theme: { from: '#6b3c12', to: '#ff9f43', accent: '#ffd29a', icon: 'Flame' },
    title: 'July — peak summer heat and severe convection',
    tagline: 'The warmest month on average and home to the UK\'s temperature records.',
    intro: 'July is on average the UK\'s warmest month, and the national records for England, Wales and Scotland were all set in July 2022 (40.3 °C at Coningsby). Persistent highs can bring drought and wildfires; hot, humid plumes bring the summer\'s most active thunderstorms — isolated cells, multicell clusters and occasionally organised lines and supercells where wind shear permits. But July can equally be cool and wet (July 2007), and a summer windstorm is possible (Evert 2021).',
    compare: { prev: 'Warmer than June, with more frequent heatwaves and storms.', next: 'Similar to August, which is usually a little cooler and often more unsettled late in the month.' },
    regional: [
      ['south-east', 'Highest temperatures and most heat-health risk (urban heat island in London).'],
      ['midlands', 'Heat extends inland; frequent thunderstorms.'],
      ['northern-ireland', 'Heat here is rarer: the NI record 31.3 °C was set in July 2021.'],
    ],
    hazards: ['Extreme heat', 'Thunderstorms and lightning', 'Flash flooding', 'Drought and wildfire'],
  },
  {
    key: 'aug', theme: { from: '#6b2f1a', to: '#f07b3f', accent: '#ffc39a', icon: 'CloudLightning' },
    title: 'August — late-summer instability and transition',
    tagline: 'Hot plumes and big storms early; the first Atlantic storms and ex-tropical remnants later.',
    intro: 'August still brings intense heat (38.5 °C at Faversham in August 2003, six days above 34 °C in August 2020) and some of the year\'s most extreme thunderstorm rainfall (Boscastle 2004, 239.9 mm at East Wretham in 2020). As the month goes on, the Atlantic jet strengthens: named storms in August are uncommon but not rare (Ellen and Francis 2020, Lilian 2024, Floris 2025), and the remnants of hurricanes start to appear (ex-Bertha 2014).',
    compare: { prev: 'Similar warmth to July; often more unsettled, with stronger Atlantic influence late on.', next: 'Warmer and more thundery than September; September brings more settled spells but increasing Atlantic storms.' },
    regional: [
      ['south-west-england', 'Atlantic storms and intense convective rain on coasts.'],
      ['east-of-england', 'Plume storms and record short-duration rainfall.'],
      ['northern-scotland', 'Summer storms (Floris 2025); ex-tropical rain (Bertha 2014).'],
    ],
    hazards: ['Heat', 'Thunderstorms', 'Flash flooding', 'Summer gales'],
  },
  {
    key: 'sep', theme: { from: '#5a3a1f', to: '#d9894a', accent: '#f4c99a', icon: 'Leaf' },
    title: 'September — late summer and the return of Atlantic systems',
    tagline: 'Often settled and warm early, increasingly stormy late.',
    intro: 'September often brings some of the year\'s most settled weather, and residual heat is possible: September 2023 had seven consecutive days above 30 °C, and 10 September was the hottest day of that year. The jet stream strengthens through the month, so the first named storms of the season (which begins in September) and ex-tropical systems become more likely, and slow-moving systems can bring exceptional rain (late September 2024). Fog and mist return on longer, clearer nights; the first frosts and cold snaps arrive in northern glens and uplands.',
    compare: { prev: 'Cooler and less thundery than August, but often more settled.', next: 'Warmer and drier than October on average; October is stormier and wetter.' },
    regional: [
      ['south', 'Late heat is most likely here.'],
      ['northern-scotland', 'First snow on the highest summits and first frosts in glens are possible.'],
      ['midlands', 'Slow-moving autumn rain systems (September 2024).'],
    ],
    hazards: ['Late heat', 'First storms', 'Heavy rain', 'Fog'],
  },
  {
    key: 'oct', theme: { from: '#4a2a1a', to: '#c0622f', accent: '#efa77a', icon: 'Wind' },
    title: 'October — autumn storms and prolonged rain',
    tagline: 'The Atlantic returns in earnest — but quiet, warm, foggy Octobers happen too.',
    intro: 'October is one of the UK\'s wettest months and the start of the main storm season. Deep Atlantic lows, atmospheric rivers and slow-moving fronts bring flood events (Storm Babet 2023, Scotland\'s record 2-day rain in 2023, the UK\'s wettest day on 3 October 2020). Ex-tropical storms can arrive (Ophelia 2017). The Great Storm struck on 16 October 1987. Yet October can also bring warmth (29.9 °C on 1 October 2011), long settled spells, fog and the first widespread frosts. Snow returns to the Scottish mountains.',
    compare: { prev: 'Wetter, windier and cooler than September.', next: 'Milder than November, with fewer frosts but similar rain and storm risk.' },
    regional: [
      ['west-uplands', 'Orographic and atmospheric-river rain: Cumbria, Wales, western Scotland.'],
      ['northern-scotland', 'First significant mountain snow; atmospheric-river floods.'],
      ['south-east', 'Autumn windstorms with trees in full leaf (1987, 2013).'],
    ],
    hazards: ['Wind storms', 'Flooding', 'Fog', 'First frosts'],
  },
  {
    key: 'nov', theme: { from: '#2f2a3f', to: '#7a6bb0', accent: '#c4b8ee', icon: 'CloudRain' },
    title: 'November — storm tracks, cold snaps and early winter',
    tagline: 'Wet, windy and darkening — with the first proper taste of winter in some years.',
    intro: 'November is among the wettest months, with repeated Atlantic lows and some of the UK\'s worst flood events (Cumbria 2009, South Yorkshire 2019, autumn 2000, Storm Bert 2024). Severe windstorms occur (Arwen 2021 brought damaging northerlies; Ciarán 2023 set England\'s lowest November pressure). Northerly outbreaks can bring snow to Scottish hills and occasionally lower, while high pressure gives fog, frost and freezing fog on long nights.',
    compare: { prev: 'Colder than October with more frosts, but similar rainfall and storms.', next: 'Milder than December on average but often equally wet.' },
    regional: [
      ['north-west-england', 'Major orographic flood events.'],
      ['yorkshire-humber', 'Slow-moving fronts and river floods (2019).'],
      ['north-east-england', 'Exposed to rare damaging northerly storms (Arwen 2021).'],
    ],
    hazards: ['Flooding', 'Wind storms', 'Fog and frost', 'First snow'],
  },
  {
    key: 'dec', theme: { from: '#1a2347', to: '#4f63b8', accent: '#aab8ff', icon: 'Snowflake' },
    title: 'December — winter storms and seasonal contrasts',
    tagline: 'Snow at Christmas is one possible scenario — not the expected one.',
    intro: 'December brings the longest nights and a peak in Atlantic storms and flooding (December 2015, the UK\'s wettest calendar month on record, was also its mildest December). Cold spells are possible — December 2010 was exceptionally cold and snowy — but on average snow lies less often in December than in January or February. The Met Office notes widespread snow lying on Christmas Day has happened only four times since 1960 (1981, 1995, 2009, 2010), although snow falling somewhere in the UK on Christmas Day is more common.',
    compare: { prev: 'Colder than November, with more frost and a little more snow.', next: 'Milder than January on average, with slightly fewer lying-snow days (3.0 vs 3.3).' },
    regional: [
      ['north-west-england', 'Flooding from atmospheric rivers (Desmond 2015).'],
      ['northern-scotland', 'Snow most likely; föhn warmth also possible (18.7 °C at Achfary, December 2019).'],
      ['south', 'Mild and wet most years; damaging storms possible (Bella 2020).'],
    ],
    hazards: ['Wind storms', 'Flooding', 'Snow and ice', 'Freezing fog'],
    special: { title: 'A white Christmas?', text: 'For the Met Office, a single snowflake observed falling on 25 December counts. Since 1960 around half of years have had snow falling at 5% or more of stations; widespread lying snow on Christmas Day (over 40% of stations) has happened only in 1981, 1995, 2009 and 2010.', source: 'mo-learn-white-christmas' },
  },
];

/* Seasonal overviews. The detail is composed at runtime from the constituent
   months, so these short framings cannot contradict the monthly catalogue. */
export const SEASON_TEXT = {
  winter: 'December, January and February: the Atlantic is at its most active, so mild, wet, windy weather dominates most winters, with named storms, flooding on saturated ground and coastal surges. Blocking highs can switch the pattern to frost, fog, freezing fog or cold continental and Arctic outbreaks with snow and ice. Snow lies most often in January and February.',
  spring: 'March, April and May: rapid transitions. The sun strengthens quickly while the sea is at its coldest and Arctic air is still available, so spring brings sunshine and showers, hail and thunder, late frosts and late snow — alongside the year\'s first warm spells. Blocking is most common in spring, so very dry, sunny springs (2025) and drought development are possible.',
  summer: 'June, July and August: heatwaves under high pressure, hot continental plumes and the year\'s most active thunderstorms, with flash flooding from intense downpours, drought and wildfire risk in dry summers. Equally possible: cool, wet summers when the jet stream sits over or south of the UK, and occasional summer windstorms.',
  autumn: 'September, October and November: the shift from summer-like weather to the Atlantic storm season. Late warmth and long settled spells are common early on; then deep lows, atmospheric rivers and slow-moving fronts bring windstorms and some of the UK\'s worst floods. Ex-tropical systems can arrive. Fog, first frosts and early mountain snow return as nights lengthen. A quiet autumn can still contain one severe event.',
};
