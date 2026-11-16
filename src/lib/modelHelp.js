/* Help for people new to Model Data (15 Nov 2026, at the user's request: "Simple mode", an "i" on
   every model, and questions to start with). Plain words: who makes each model, how fine and how far
   ahead it sees, and what it is good for; the layers that answer everyday questions; and the few
   layers Simple mode lists. */

/* what each model is, in a sentence or two */
export const MODEL_ABOUT = {
  ukv: 'The Met Office’s own model for the UK and Ireland, in 2 km squares. New runs come through the day and reach two to five days ahead. Its fine detail suits showers, hills, coasts and fog.',
  mo_global: 'The Met Office’s model for the whole world, in 10 km squares, reaching about six days ahead: the Met Office’s view beyond the UKV’s range.',
  ifs: 'ECMWF’s main model (often called the “European”), run for the whole world four times a day and reaching about ten days ahead. Shown here at 0.25° from ECMWF’s open data.',
  aifs: 'ECMWF’s AI model, trained on decades of past weather. It runs for the whole world and reaches about two weeks ahead. Often good on the big pattern, smoother on small details such as showers.',
  gfs: 'The Global Forecast System from NOAA in the USA. It covers the whole world at 0.25°, four times a day, hourly for five days and then every three hours to 16 days.',
  gefs_mean: 'The average of NOAA’s ensemble (GEFS): the same model run 31 times from slightly different starts. Smoother than any one run, it shows the most likely pattern to 16 days.',
  gefs_aer: 'NOAA’s GEFS with dust, smoke and other particles in the air: where Saharan dust or wildfire smoke is heading.',
  frost: 'TCM FROST, MyWeatherUK’s own snow model: the chance of snow and how much could settle, on the UKV’s 2 km map.',
  icon: 'DWD’s ICON-EU from Germany, in 6.5 km squares, shown on the UK’s 2 km map. Hourly to three days, then every three hours to five.',
  icon_europe: 'The same DWD ICON-EU over the whole of Europe, North Africa and the eastern Atlantic.',
  mix: 'The MWUK Mix: MyWeatherUK’s blend of the Met Office UKV and DWD ICON-EU, leaning on the UKV at first. Steadier than either model on its own.',
  aigfs: 'NOAA’s AI version of the GFS. It covers the whole world at 0.25°, every six hours to 16 days.',
  gdps: 'Environment and Climate Change Canada’s global model (GDPS), in 15 km squares to ten days.',
  meps: 'MET Norway’s HARMONIE-AROME (MEPS), in 2.5 km squares over Scandinavia, the Baltic, the North Sea and the east of Britain, hourly to 66 hours.',
  arpege: 'Météo-France’s global model ARPEGE, shown here at 0.1° over Europe, North Africa and the eastern Atlantic, hourly to about four days.',
  arome: 'Météo-France’s AROME, in 2.5 km squares over France, the Low Countries, southern Britain and Ireland, hourly to 51 hours. Built for showers and thunderstorms.',
  ecmwf_ensm: 'The average of ECMWF’s ensemble: its model run 50 times from slightly different starts. It shows the most likely outcome, and its spread shows how sure the forecast is.',
  aifs_ensm: 'The average of ECMWF’s AI ensemble (AIFS ENS), 50 runs to about two weeks.',
  consensus: 'MWUK: the middle forecast of nine models (the Met Office UKV and Global, ECMWF and its AI model, GFS and its AI model, ICON-EU, Canada’s GDPS and France’s ARPEGE), cell by cell, on a 2 km map. When they disagree it takes neither extreme. Each runs from the models’ newest runs at 00, 06, 12 and 18 UTC (a slow model joins with its last one). Models showing rain and the temperature and pressure spreads show how far they agree. Its precipitation type is its own rate in the kind the models give there: the middle of their rain, sleet and snow, or ice where at least two, and half of those with something falling, show ice.',
};

/* questions to start with: each picks a model, a layer and the hour now (the first model in the list
   that has the layer) */
export const QUESTIONS = [
  { key: 'rain', label: 'Will it rain?', models: ['mix', 'ukv', 'icon', 'gfs'], v: 'precip_rate' },
  { key: 'snow', label: 'Snow?', models: ['mix', 'ukv', 'icon'], v: 'snow_cond' },
  { key: 'cold', label: 'How cold?', models: ['mix', 'ukv', 'gfs'], v: 't2' },
  { key: 'wind', label: 'Wind?', models: ['mix', 'ukv', 'gfs'], v: 'gust10' },
  { key: 'storms', label: 'Storms?', models: ['ukv', 'gfs'], v: 'lightning', alt: 'cape_mu' },
  { key: 'sun', label: 'Cloud or sun?', models: ['mix', 'ukv', 'gfs'], v: 'tcc' },
];

/* Simple mode's layers: the ones that answer everyday questions (those the model has) */
export const ESSENTIALS = ['precip_rate', 'ptype', 'precip_total', 'snow_cond', 'snow_risk', 'snow_acc', 't2', 'feels', 'gust10', 'wind10', 'tcc',
  'lightning', 'fog_vis', 'mslp', 'uv_index'];
