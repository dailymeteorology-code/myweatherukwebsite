/**
 * Weather Scenarios — taxonomy.
 *
 * Everything here is vocabulary: categories, regions, months, the frequency
 * and severity scales, and the filter dimensions. Scenario records refer to
 * these by id; the store validates every reference, so a typo fails loudly at
 * start-up (and in `npm test`) instead of silently vanishing from a filter.
 */

/* ── Categories ─────────────────────────────────────────────────────────── */
export const CATEGORIES = [
  { id: 'circulation', name: 'General atmospheric circulation', short: 'Circulation', icon: 'Globe2', colour: '#7c9cff',
    blurb: 'The large-scale patterns — jet stream, blocking highs, Atlantic lows — that decide which kind of weather the UK gets.' },
  { id: 'airmass', name: 'Air masses and airflows', short: 'Air masses', icon: 'Wind', colour: '#5fb3d9',
    blurb: 'Where the air over the UK has come from, and what it brings with it: temperature, moisture and stability.' },
  { id: 'winter', name: 'Winter weather', short: 'Winter', icon: 'Snowflake', colour: '#9cc7ff',
    blurb: 'Snow, ice, frost, freezing fog, mild spells and winter storms.' },
  { id: 'spring', name: 'Spring weather', short: 'Spring', icon: 'Sprout', colour: '#8fd694',
    blurb: 'Rapid transitions: strong sunshine, cold air aloft, late frosts, showers, early warmth and dry spells.' },
  { id: 'summer', name: 'Summer weather', short: 'Summer', icon: 'Sun', colour: '#ffb648',
    blurb: 'Heat, high pressure, humidity, thunderstorms, drought — and the cool, wet alternatives.' },
  { id: 'autumn', name: 'Autumn weather', short: 'Autumn', icon: 'Leaf', colour: '#e8894f',
    blurb: 'The return of the Atlantic: storms, rain and flooding, alongside late warmth, fog and first frosts.' },
  { id: 'rain', name: 'Rainfall and flooding', short: 'Rain & flooding', icon: 'CloudRain', colour: '#4f9cf0',
    blurb: 'From frontal rain to flash floods: how rain becomes flooding, and why the same rainfall does not always flood.' },
  { id: 'wind', name: 'Severe wind and storms', short: 'Wind & storms', icon: 'Tornado', colour: '#a98bff',
    blurb: 'Gales, damaging gusts, sting jets, squalls, mountain winds and storm surges.' },
  { id: 'thunder', name: 'Thunderstorms, lightning and tornadoes', short: 'Thunderstorms', icon: 'Zap', colour: '#ffd23f',
    blurb: 'Every kind of UK convection: ordinary showers to supercells, hail, lightning, tornadoes and waterspouts.' },
  { id: 'fog', name: 'Fog, frost and visibility', short: 'Fog & frost', icon: 'CloudFog', colour: '#a7b4c8',
    blurb: 'Radiation, advection and freezing fog, low cloud, haze, smog and the different kinds of frost.' },
  { id: 'dry', name: 'Dry weather, drought and high pressure', short: 'Dry & high pressure', icon: 'SunDim', colour: '#e3c46b',
    blurb: 'Anticyclones in every season, dry spells, and the three kinds of drought.' },
  { id: 'phenomena', name: 'Additional weather phenomena', short: 'Phenomena', icon: 'Sparkles', colour: '#d58cf0',
    blurb: 'Processes, hazards and things you can see: graupel, rime, föhn, lenticular cloud, mammatus, halos.' },
  { id: 'rare', name: 'Rare and high-impact scenarios', short: 'Rare & high-impact', icon: 'AlertOctagon', colour: '#ff5d6c',
    blurb: 'Uncommon but meteorologically plausible extremes, labelled rare only where the record supports it.' },
];

/* ── What kind of thing a record is (the brief: do not force unrelated
      phenomena into one classification) ── */
export const KINDS = {
  pattern: { label: 'Circulation pattern', help: 'A large-scale arrangement of pressure and wind. It does not fix the weather on its own.' },
  'air-mass': { label: 'Air mass / airflow', help: 'A body of air with a source region and track that set its temperature, moisture and stability.' },
  scenario: { label: 'Weather scenario', help: 'A recognisable combination of conditions and the weather it tends to produce.' },
  hazard: { label: 'Hazard', help: 'A condition that can cause harm or disruption.' },
  process: { label: 'Meteorological process', help: 'A physical mechanism that operates inside many scenarios.' },
  phenomenon: { label: 'Observable phenomenon', help: 'Something you can see or measure; often harmless, sometimes a sign of a process.' },
};

/* ── Frequency / relevance per month ─────────────────────────────────────
   Single-letter codes are used in the month strings of scenario records.
   These are QUALITATIVE climatological categories, not probabilities. */
export const FREQUENCY = {
  C: { id: 'common', label: 'Seasonally common', rank: 4, colour: '#3ecf8e',
    def: 'A well-established, recurrent type of weather for this month or season. Most years will see it somewhere in the UK.' },
  P: { id: 'plausible', label: 'Plausible', rank: 3, colour: '#5aa9ff',
    def: 'Meteorologically possible and not unusual to see in some years, but with no implication that it is expected this month.' },
  U: { id: 'uncommon', label: 'Uncommon', rank: 2, colour: '#f2b53a',
    def: 'Happens less regularly, or needs a less typical combination of ingredients. Many years pass without it in this month.' },
  R: { id: 'rare', label: 'Rare or exceptional', rank: 1, colour: '#ff6b81',
    def: 'Supported by the observational record as a relatively unusual occurrence in this month, usually because the setup it needs is unusual.' },
  '-': { id: 'off-season', label: 'Outside its season', rank: 0, colour: '#4a5568',
    def: 'Not a recognised feature of this month in the UK record. This is NOT a claim that it is impossible — only that it is not documented as part of this month\'s weather.' },
};
export const FREQUENCY_NOTES = [
  'These labels describe climatology — how often a type of weather has historically turned up in a month — not the chance of it happening in any particular forecast.',
  'They are qualitative. Where a reliable quantitative figure exists it is shown separately, with its source, area and reference period.',
  'A label applies to the UK as a whole unless the regional view says otherwise; a "common" scenario can still be rare in some regions.',
  'No recurrence periods are invented. Where a source gives one, it is quoted with that source.',
];

/* ── Severity / impact potential ───────────────────────────────────────── */
export const SEVERITY = {
  low: { label: 'Low', rank: 1, def: 'Usually little disruption; worth knowing about.' },
  moderate: { label: 'Moderate', rank: 2, def: 'Can cause local disruption or difficult conditions.' },
  high: { label: 'High', rank: 3, def: 'Can cause significant disruption, damage or danger to life in the worst-affected areas.' },
  'very-high': { label: 'Very high', rank: 4, def: 'Capable of widespread damage, major disruption and loss of life.' },
};

/* ── Filter dimensions ─────────────────────────────────────────────────── */
export const TEMPERATURE_REGIMES = {
  'very-cold': 'Very cold', cold: 'Cold', cool: 'Cool', mild: 'Mild', warm: 'Warm', hot: 'Hot', variable: 'Variable / contrasting', any: 'Any temperature',
};
export const PRECIP_TYPES = {
  none: 'Mainly dry', rain: 'Rain', showers: 'Showers', drizzle: 'Drizzle', snow: 'Snow', sleet: 'Sleet', hail: 'Hail', graupel: 'Graupel',
  'freezing-rain': 'Freezing rain / drizzle', thunder: 'Thundery', mixed: 'Mixed / changing',
};
export const CIRCULATION = {
  westerly: 'Westerly (Atlantic)', 'south-westerly': 'South-westerly', northerly: 'Northerly', 'north-westerly': 'North-westerly',
  easterly: 'Easterly', 'north-easterly': 'North-easterly', southerly: 'Southerly', 'south-easterly': 'South-easterly', anticyclonic: 'Anticyclonic (high pressure)',
  cyclonic: 'Cyclonic (low pressure)', blocked: 'Blocked', transitional: 'Changing pattern', any: 'Any pattern',
};

/* ── Seasons ───────────────────────────────────────────────────────────── */
export const SEASONS = [
  { id: 'winter', name: 'Winter', months: [11, 0, 1], colour: '#8ab8ff' },
  { id: 'spring', name: 'Spring', months: [2, 3, 4], colour: '#7fd99a' },
  { id: 'summer', name: 'Summer', months: [5, 6, 7], colour: '#ffbf5a' },
  { id: 'autumn', name: 'Autumn', months: [8, 9, 10], colour: '#ee915a' },
];
export const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const seasonOfMonth = (m) => SEASONS.find((s) => s.months.includes(m)).id;

/* ── Regions ───────────────────────────────────────────────────────────────
   Fifteen forecasting regions. Boundaries: server/data/scenarios/regions.geo.json
   (ONS districts, built by server/scenarios/build/build-regions.mjs).
   `climate` lists the Met Office HadUK-Grid climate district(s) whose
   1991–2020 averages best describe the region; where a region straddles two
   districts both are shown, never blended into an invented number. */
export const REGIONS = [
  { id: 'south-east-england', name: 'South East England', nation: 'England', climate: ['England_SE_and_Central_S'],
    factors: 'The warmest and driest part of the UK in summer and the most continental in character: furthest from the Atlantic, closest to the near continent. Hot plumes and the highest temperatures usually reach here first. Chalk downland and the long south coast give sea-breeze contrasts; the Weald and Thames valley collect cold air on clear nights.',
    traits: ['coast', 'lowland', 'continental-edge'] },
  { id: 'london', name: 'London', nation: 'England', climate: ['England_SE_and_Central_S'],
    factors: 'A large urban heat island: nights stay warmer than the surrounding countryside, which matters most in heatwaves. Extensive hard surfaces make surface-water flooding from intense rain a particular risk. The tidal Thames links the city to North Sea surge events, managed by the Thames Barrier.',
    traits: ['urban', 'lowland', 'tidal-river'] },
  { id: 'east-of-england', name: 'East of England', nation: 'England', climate: ['East_Anglia'],
    factors: 'Low-lying, relatively dry and exposed to the North Sea. Among the most frequently thundery parts of the UK in summer, and well placed for North Sea snow showers in cold easterlies. Long, low coastlines and the fens make coastal and tidal flooding an important hazard; the region is also prone to agricultural drought.',
    traits: ['coast', 'lowland', 'east-facing'] },
  { id: 'south-west-england', name: 'South West England', nation: 'England', climate: ['England_SW_and_S_Wales'],
    factors: 'The most Atlantic-facing part of England: mild winters, frequent wind and rain, and the first landfall for many storms and ex-tropical systems. Dartmoor, Exmoor and Bodmin Moor wring extra rain from moist air, and steep, short river catchments (Boscastle, Lynmouth) can respond violently to intense rain.',
    traits: ['coast', 'upland', 'west-facing'] },
  { id: 'east-midlands', name: 'East Midlands', nation: 'England', climate: ['Midlands'],
    factors: 'Inland and fairly continental for England: warm summers and among the most thundery areas of the country. The Peak District rises to over 600 m in the north-west. The Trent and its tributaries collect water from a large catchment.',
    traits: ['inland', 'lowland', 'upland-edge'] },
  { id: 'west-midlands', name: 'West Midlands', nation: 'England', climate: ['Midlands'],
    factors: 'Inland, sheltered somewhat by Wales from the Atlantic. The Severn, Wye, Teme and Avon drain large areas of Wales and the Marches, so the region often floods from rain that fell further west. Cold air pools in valleys on clear winter nights.',
    traits: ['inland', 'lowland', 'major-rivers'] },
  { id: 'yorkshire-humber', name: 'Yorkshire and the Humber', nation: 'England', climate: ['England_E_and_NE'],
    factors: 'From the Pennines and Dales in the west to the North Sea coast in the east. Pennine rain and snow, sheltered lowlands in the Vale of York, North Sea haar and snow showers on the coast, and large river systems (Ouse, Aire, Don) draining to the Humber.',
    traits: ['coast', 'upland', 'east-facing', 'major-rivers'] },
  { id: 'north-west-england', name: 'North West England', nation: 'England', climate: ['England_NW_and_N_Wales'],
    factors: 'Faces the prevailing south-westerlies off the Irish Sea. The Lake District fells hold several UK rainfall records, and orographic rain over Cumbria and the Pennines drives major river floods (Carlisle 2005, Cumbria 2009 and 2015). Irish Sea snow showers can reach the Cheshire Gap in northerly flows.',
    traits: ['coast', 'upland', 'west-facing'] },
  { id: 'north-east-england', name: 'North East England', nation: 'England', climate: ['England_E_and_NE'],
    factors: 'Sheltered from the west by the Pennines, so drier than the north-west, but exposed to the North Sea. Easterly and north-easterly winds bring snow, haar and cold; north-westerly storms gust strongly down the Pennine slopes and across Northumberland.',
    traits: ['coast', 'upland', 'east-facing'] },
  { id: 'wales', name: 'Wales', nation: 'Wales', climate: ['Wales'],
    factors: 'Mountainous and Atlantic-facing. Snowdonia, the Cambrian Mountains and the Brecon Beacons take very high rainfall, feeding rivers that flood both Wales and the English Marches. Exposed western headlands record some of the UK\'s highest gusts; valleys hold cold air and fog.',
    traits: ['coast', 'upland', 'west-facing', 'mountain'] },
  { id: 'southern-scotland', name: 'Southern Scotland', nation: 'Scotland', climate: ['Scotland_W', 'Scotland_E'],
    factors: 'Dumfries and Galloway, the Borders, Ayrshire and South Lanarkshire. The Southern Uplands catch Atlantic rain in the west and shelter the Borders to the east, where some of Scotland\'s warmest summer temperatures have been recorded. Exposed to storms tracking across northern England.',
    traits: ['coast', 'upland', 'mixed'] },
  { id: 'central-scotland', name: 'Central Scotland', nation: 'Scotland', climate: ['Scotland_W', 'Scotland_E'],
    factors: 'The Central Belt (Glasgow to Edinburgh) plus Fife, Perthshire and Tayside. A west–east contrast: wetter and windier around the Clyde, drier towards the Forth and Tay. Strong winds funnel through the Central Belt in some storms; easterly flows bring snow and haar to Fife and the Lothians.',
    traits: ['urban', 'lowland', 'upland', 'mixed'] },
  { id: 'northern-scotland', name: 'Northern Scotland and the Highlands', nation: 'Scotland', climate: ['Scotland_N', 'Scotland_E'],
    factors: 'The Highlands, Grampians, Moray, Aberdeenshire and Argyll. The UK\'s highest mountains and coldest glens (Braemar, Altnaharra), the most lying snow, and a strong west–east contrast: very wet western mountains, a drier east with föhn warmth in some westerly and southerly flows.',
    traits: ['mountain', 'upland', 'coast', 'mixed'] },
  { id: 'scottish-islands', name: 'The Scottish Islands', nation: 'Scotland', climate: ['Scotland_N'],
    factors: 'The Western Isles, Orkney and Shetland. The most exposed part of the UK: closest to Atlantic storm tracks, with frequent gales and very few frosts, cool summers, and long daylight in midsummer. Sea temperatures dominate the climate.',
    traits: ['coast', 'island', 'exposed'] },
  { id: 'northern-ireland', name: 'Northern Ireland', nation: 'Northern Ireland', climate: ['Northern_Ireland'],
    factors: 'Maritime and mild, with the Atlantic to the west and the Irish Sea to the east. The Mournes and Sperrins add orographic rain; Lough Neagh and the inland lowlands can be notably warmer in summer and colder on clear winter nights than the coasts.',
    traits: ['coast', 'upland', 'west-facing'] },
];

/* Region groups — shorthand for scenario authoring only. The store expands
   every group into explicit per-region rows, so the data the page reads is
   always one row per (scenario, region). */
export const REGION_GROUPS = {
  all: REGIONS.map((r) => r.id),
  england: ['south-east-england', 'london', 'east-of-england', 'south-west-england', 'east-midlands', 'west-midlands', 'yorkshire-humber', 'north-west-england', 'north-east-england'],
  scotland: ['southern-scotland', 'central-scotland', 'northern-scotland', 'scottish-islands'],
  'south-east': ['south-east-england', 'london', 'east-of-england'],
  south: ['south-east-england', 'london', 'east-of-england', 'south-west-england'],
  'south-and-midlands': ['south-east-england', 'london', 'east-of-england', 'south-west-england', 'east-midlands', 'west-midlands'],
  'south-coast': ['south-west-england', 'south-east-england'],
  midlands: ['east-midlands', 'west-midlands'],
  'east-coast': ['east-of-england', 'yorkshire-humber', 'north-east-england', 'central-scotland', 'northern-scotland'],
  'west-coast': ['south-west-england', 'wales', 'north-west-england', 'southern-scotland', 'northern-scotland', 'scottish-islands', 'northern-ireland'],
  'west-uplands': ['south-west-england', 'wales', 'north-west-england', 'southern-scotland', 'northern-scotland'],
  uplands: ['wales', 'north-west-england', 'yorkshire-humber', 'north-east-england', 'southern-scotland', 'central-scotland', 'northern-scotland'],
  north: ['north-west-england', 'north-east-england', 'yorkshire-humber', 'southern-scotland', 'central-scotland', 'northern-scotland', 'scottish-islands'],
  'north-england': ['north-west-england', 'north-east-england', 'yorkshire-humber'],
  'north-west': ['north-west-england', 'southern-scotland', 'central-scotland', 'northern-scotland', 'scottish-islands', 'northern-ireland'],
  'far-north': ['northern-scotland', 'scottish-islands'],
  'irish-sea': ['north-west-england', 'wales', 'northern-ireland', 'southern-scotland'],
  'inland-england': ['london', 'east-midlands', 'west-midlands', 'east-of-england', 'south-east-england'],
};

/* Regional relevance levels for (scenario, region) rows. */
export const RELEVANCE = {
  high: { label: 'Particularly relevant', rank: 3 },
  moderate: { label: 'Relevant', rank: 2 },
  low: { label: 'Less characteristic', rank: 1 },
};
