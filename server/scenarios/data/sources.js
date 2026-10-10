/**
 * Source records. Every URL here resolved (HTTP 200) when the catalogue was
 * built in October 2026; `npm run scenarios:check-links` re-checks them all.
 * Case studies are the Met Office National Climate Information Centre reports
 * linked from the Past UK weather events archive.
 */
export const SOURCES = [
 {
  "id": "mo-past-events",
  "title": "Past UK weather events (case-study archive)",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/past-uk-weather-events",
  "kind": "archive"
 },
 {
  "id": "mo-haduk-series",
  "title": "UK and regional climate series (HadUK-Grid)",
  "publisher": "Met Office",
  "url": "https://www.metoffice.gov.uk/research/climate/maps-and-data/uk-and-regional-series",
  "kind": "dataset"
 },
 {
  "id": "mo-climate-extremes",
  "title": "UK climate extremes (national weather records)",
  "publisher": "Met Office",
  "url": "https://www.metoffice.gov.uk/research/climate/maps-and-data/uk-climate-extremes",
  "kind": "records"
 },
 {
  "id": "mo-regional-climates",
  "title": "UK regional climates",
  "publisher": "Met Office",
  "url": "https://www.metoffice.gov.uk/research/climate/maps-and-data/regional-climates",
  "kind": "climatology"
 },
 {
  "id": "mo-location-averages",
  "title": "Location-specific long-term averages",
  "publisher": "Met Office",
  "url": "https://www.metoffice.gov.uk/research/climate/maps-and-data/location-specific-long-term-averages",
  "kind": "climatology"
 },
 {
  "id": "mo-summaries",
  "title": "UK climate summaries",
  "publisher": "Met Office",
  "url": "https://www.metoffice.gov.uk/research/climate/maps-and-data/summaries",
  "kind": "climatology"
 },
 {
  "id": "mo-state-of-climate",
  "title": "State of the UK Climate",
  "publisher": "Met Office",
  "url": "https://www.metoffice.gov.uk/research/climate/maps-and-data/about/state-of-climate",
  "kind": "assessment"
 },
 {
  "id": "mo-ukcp",
  "title": "UK Climate Projections (UKCP)",
  "publisher": "Met Office",
  "url": "https://www.metoffice.gov.uk/research/approach/collaboration/ukcp",
  "kind": "projections"
 },
 {
  "id": "mo-uk-warnings",
  "title": "Met Office UK weather warnings",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings",
  "kind": "warnings"
 },
 {
  "id": "ons-boundaries",
  "title": "ONS Open Geography Portal: Local Authority Districts (Dec 2024) BUC and LAD to Region lookup",
  "publisher": "Office for National Statistics",
  "url": "https://geoportal.statistics.gov.uk/",
  "kind": "dataset"
 },
 {
  "id": "mo-cs-2019-001-storm-erik",
  "title": "Storm Erik",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2019_001_storm_erikpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2019-002-february-warmspell",
  "title": "Exceptional warmth February 2019",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2019_002_february_warmspellpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2019-003-storm-freya",
  "title": "Storm Freya",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2019_003_storm_freyapdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2019-004-stormy-spell",
  "title": "Stormy and very wet spell March 2019",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2019_004_stormy_spellpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2019-005-storm-hannah",
  "title": "Storm Hannah 26 to 27 April 2019",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2019_005_storm_hannahpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2019-006-rainfall-lincolnshire",
  "title": "Wet weather June 2019",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2019_006_rainfall_lincolnshirepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2019-007-july-heatwave",
  "title": "Record breaking heat-wave July 2019",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2019_007_july_heatwavepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2019-008-july-rainfall",
  "title": "Heavy rainfall July 2019",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2019_008_july_rainfallpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2019-009-storm-lorenzo",
  "title": "Storm Lorenzo October 2019",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2019_009_storm_lorenzopdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2019-010-october-rainfall",
  "title": "Persistent wet weather October 2019",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2019_010_october_rainfallpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2019-011-november-wind",
  "title": "Strong winds November 2019",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2019_011_november_windpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2019-012-november-rain",
  "title": "Severe flooding South Yorkshire, November 2019",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2019_012_november_rainpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2019-013-december-temperature",
  "title": "UK temperature record, December 2019",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2019_013_december_temperaturepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2020-01-storm-brendan",
  "title": "Storms Atiyah (December 2019) and Brendan (January 2020)",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2020_01_storm_brendanpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2020-02-storm-ciara",
  "title": "Storm Ciara",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2020_02_storm_ciarapdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2020-03-storm-dennis",
  "title": "Storm Dennis",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2020_03_storm_dennispdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2020-04-storm-jorge",
  "title": "Storm Jorge",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2020_04_storm_jorgepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2020-05-july-temperature",
  "title": "Exceptionally hot day, 31 July 2020",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2020_05_july_temperaturepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2020-06-august-heatwave",
  "title": "August heat-wave",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2020_06_august_heatwavepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2020-07-august-rain",
  "title": "Thunderstorms north-east Scotland 11-12 August 2020",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2020_07_august_rainpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2020-08-storms-ellen-francis",
  "title": "Storms Ellen and Francis, August 2020",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2020_08_storms_ellen_francispdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2020-09-storm-alex-1",
  "title": "Storm Alex and heavy rain 2 to 4 October 2020",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2020_09_storm_alex_1pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2020-10-storm-aiden",
  "title": "Storm Aiden 31 October 2020",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2020_10_storm_aidenpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2020-11-storm-bella",
  "title": "Storm Bella 26 to 27 December 2020",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2020_11_storm_bellapdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2020-12-august-rain-1",
  "title": "Extreme Norfolk rainfall, 16 August 2020",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2020_12_august_rain_1pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2021-01-storm-christoph",
  "title": "Storm Christoph 18 to 20 January 2021",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2021_01_storm_christophpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2021-02-low-temperatures",
  "title": "Severe winter weather and storm Darcy, February 2021",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2021_02_low_temperaturespdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2021-03-high-temperatures",
  "title": "Extremes of temperature, March and April 2021",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2021_03_high_temperaturespdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2021-04-july-northern-ireland-temperature",
  "title": "Northern Ireland temperature record, July 2021",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2021_04_july_northern_ireland_temperaturepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2021-05-storm-evert",
  "title": "Storm Evert, 29 to 30 July 2021",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2021_05_storm_evertpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2021-06-october-rain",
  "title": "Heavy and persistent rain, October 2021",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2021_06_october_rainpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2021-07-storm-arwen",
  "title": "Storm Arwen, 26 to 27 November 2021",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2021_07_storm_arwenpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2021-08-storm-barra",
  "title": "Storm Barra, 7 to 8 December 2021",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2021_08_storm_barrapdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2021-09-high-temperatures",
  "title": "Exceptionally mild New Year, 2021/2022",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2021_09_high_temperaturespdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2022-01-storms-malik-corrie",
  "title": "Storm Malik and storm Corrie, January 2022",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2022_01_storms_malik_corriepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2022-02-storms-dudley-eunice-franklin",
  "title": "Storms Dudley, Eunice and Franklin, February 2022",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2022_02_storms_dudley_eunice_franklinpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2022-03-july-heatwave",
  "title": "Unprecedented extreme heatwave, July 2022",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2022_03_july_heatwave_v1pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2022-04-december-low-temperatures",
  "title": "Prolonged spell of low temperatures, December 2022",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2022_04_december_low_temperatures_v1pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2023-01-storm-otto",
  "title": "Storm Otto, 17 February 2023",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2023_01_storm_ottopdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2023-02-storm-noa",
  "title": "Storm Noa, 12 April 2023",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2023_02_storm_noapdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2023-03-storm-antoni",
  "title": "Storm Antoni, 5 August 2023",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2023_03_storm_antonipdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2023-04-storm-betty",
  "title": "Storm Betty, 18 to 19 August 2023",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2023_04_storm_bettypdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2023-05-september-heatwave",
  "title": "Heatwave, September 2023",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2023_05_september_heatwavepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2023-06-storm-agnes",
  "title": "Storm Agnes, 27 to 28 September 2023",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2023_06_storm_agnespdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2023-07-scotland-rain",
  "title": "Exceptional rainfall in Scotland, 6 to 7 October 2023",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2023_07_scotland_rainpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2023-08-storm-babet",
  "title": "Storm Babet, 18 to 21 October 2023",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2023_08_storm_babetpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2023-09-storm-ciaran-2",
  "title": "Storm Ciarán, 1 to 2 November 2023",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2023_09_storm_ciaran_2pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2023-10-storm-debi",
  "title": "Storm Debi, 13 November 2023",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2023_10_storm_debipdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2023-11-storms-elin-fergus-1",
  "title": "Storms Elin and Fergus, 9 to 10 December 2023",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2023_11_storms_elin_fergus_1pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2023-12-storm-gerrit",
  "title": "Storm Gerrit, 27 to 28 December 2023",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2023_12_storm_gerritpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2024-01-storm-henk",
  "title": "Storm Henk, 2 January 2024",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2024_01_storm_henk_v1pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2024-02-storms-isha-jocelyn",
  "title": "Storms Isha and Jocelyn, 21 to 24 January 2024",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2024_02_storms_isha_jocelynpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2024-03-jan-hightemp-scotland",
  "title": "UK January temperature record, 28 January 2024",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2024_03_jan_hightemp_scotlandpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2024-04-storm-kathleen",
  "title": "Storm Kathleen, 6 to 7 April 2024",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2024_04_storm_kathleenpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2024-05-wet-weather",
  "title": "Exceptionally wet weather, 21 to 23 May 2024",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2024_05_wet_weatherpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2024-06-storm-lilian",
  "title": "Storm Lilian, 23 August 2024",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2024_06_storm_lilianpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2024-07-september-rain",
  "title": "Exceptionally wet month for parts of the Midlands, September 2024",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2024_07_september_rainpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2024-08-storm-ashley",
  "title": "Storm Ashley, 20 to 21 October 2024",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2024_08_storm_ashleypdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2024-09-storm-bert",
  "title": "Storm Bert, 22 to 25 November 2024 and storm Conall, 26 to 27 November 2024",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2024_09_storm_bert_v1pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2024-10-storm-darragh",
  "title": "Storm Darragh, 6 to 7 December 2024",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2024_10_storm_darragh_v2pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2025-01-wind-rain-snow",
  "title": "Heavy rain, strong winds and snow, New Year 2024-2025",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2025_01_wind_rain_snowpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2025-02-storm-eowyn",
  "title": "Storm Éowyn, 24 January 2025",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2025_02_storm_eowynpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2025-03-spring-2025",
  "title": "Spring 2025",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2025_03_spring_2025_v2pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2025-04-storm-floris",
  "title": "Storm Floris, 4 to 5 August 2025",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2025_04_storm_florispdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2025-05-storm-amy-2",
  "title": "Storm Amy, 3 to 4 October 2025",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2025_05_storm_amy_2pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2025-06-storm-claudia",
  "title": "Storm Claudia, 14 November 2025",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2025_06_storm_claudiapdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2025-07-storm-bram-1",
  "title": "Storm Bram, 9 to 10 December 2025",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2025_07_storm_bram_1pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2026-01-scotland-snow-1",
  "title": "Wintry spell with deep snow for northern and north-east Scotland, January 2026",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2026_01_scotland_snow_1pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2026-02-storm-goretti",
  "title": "Storm Goretti 8 to 9 January 2026",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2026_02_storm_gorettipdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2026-03-storm-chandra",
  "title": "Storm Chandra 26 to 27 January 2026",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2026_03_storm_chandrapdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2026-04-storm-dave-1",
  "title": "Storm Dave 4 to 5 April 2026",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2026_04_storm_dave_1pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2026-05-may-heatwave",
  "title": "Unprecedented late spring heatwave, May 2026",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2026_05_may_heatwave_2pdf-1.2026_05_may_heatwave_2pdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-2026-06-june-heatwave-final",
  "title": "Unprecedented heatwave with high humidity, June 2026",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/2026_06_June_heatwave_finalpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-april-2000-record-rainfall",
  "title": "April 2000 - Record rainfall",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/april-2000---record-rainfall---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-autumn-storm-october-2013",
  "title": "Autumn storm, October 2013",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/autumn-storm-october-2013---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-burns-day-storm-25-january-1990",
  "title": "Burns' Day Storm - 25 January 1990",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/burns-day-storm---25-january-1990---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-dry-spell-2004-6",
  "title": "Dry spell 2004/6",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/dry-spell-2004_6---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-dry-weather-during-2003",
  "title": "Dry weather during 2003",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/dry-weather-during-2003---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-early-february-2009-snowfalls",
  "title": "Early February 2009 snowfalls",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/early-february-2009-snowfalls---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-early-winter-storms-late-2011",
  "title": "Early winter storms, late 2011",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/early-winter-storms-late-2011---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-easter-1998-floods",
  "title": "Easter 1998 floods",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/easter-1998-floods---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-england-and-wales-drought-2010-to-2012",
  "title": "England and Wales drought 2010 to 2012",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/england-and-wales-drought-2010-to-2012---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-ex-hurricane-bertha",
  "title": "Ex-hurricane Bertha",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/ex-hurricane-bertha---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-ex-hurricane-ophelia-16-october-2017",
  "title": "Ex-Hurricane Ophelia 16 October 2017",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/ex-hurricane-ophelia-16-october-2017---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-exceptional-warmth-april-2018",
  "title": "Exceptional warmth April 2018",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/exceptional-warmth-april-2018---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-exceptional-warmth-december-2015",
  "title": "Exceptional warmth, December 2015",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/exceptional-warmth-december-2015---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-exceptional-warmth-september-2016",
  "title": "Exceptional warmth, September 2016",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/exceptional-warmth-september-2016---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-exceptionally-warm-and-dry-spring-2011",
  "title": "Exceptionally warm and dry Spring 2011",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/exceptionally-warm-and-dry-spring-2011---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-exceptionally-wet-weather-november-2012",
  "title": "Exceptionally wet weather - November 2012",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/exceptionally-wet-weather---november-2012---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-february-2001-rainfall",
  "title": "February 2001",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/february-2001-rainfall---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-flooding-in-cumbria-december-2015",
  "title": "Flooding in Cumbria December 2015",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/flooding-in-cumbria-december-2015---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-flooding-in-north-cornwall-16-august-2004",
  "title": "Flooding in north Cornwall - 16 August 2004",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/flooding-in-north-cornwall---16-august-2004---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-flooding-in-north-yorkshire-19-june-2005",
  "title": "Flooding in North Yorkshire - 19 June 2005",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/flooding-in-north-yorkshire---19-june-2005---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-floods-in-carlisle-january-2005",
  "title": "Floods in Carlisle - January 2005",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/floods-in-carlisle---january-2005---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-further-rainfall-and-flooding-across-north-of-the-uk",
  "title": "Further rainfall and flooding across north of the UK",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/further-rainfall-and-flooding-across-north-of-the-uk---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-hail-thunderstorms-over-east-devon-29-30-october-2008",
  "title": "Hail/thunderstorms over east Devon - 29/30 October 2008",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/hail_thunderstorms-over-east-devon---29_30-october-2008---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-heatwave-01-july-2015-correction",
  "title": "Heatwave 1 July 2015",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/heatwave_01_july_2015_correctionpdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-heavy-rainfall-east-uk-20-21-october-2001",
  "title": "Heavy rainfall - East UK 20/21 October 2001",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/heavy-rainfall---east-uk-20_21-october-2001---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-heavy-rainfall-and-flooding-in-cornwall-november-2010",
  "title": "Heavy rainfall and flooding in Cornwall, November 2010",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/heavy-rainfall-and-flooding-in-cornwall-november-2010---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-heavy-rainfall-early-september-2008",
  "title": "Heavy rainfall early September 2008",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/heavy-rainfall-early-september-2008---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-heavy-rainfall-flooding-july-2007",
  "title": "Heavy rainfall/flooding - July 2007",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/heavy-rainfall_flooding---july-2007---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-heavy-rainfall-flooding-june-2007",
  "title": "Heavy rainfall/flooding - June 2007",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/heavy-rainfall_flooding---june-2007---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-lake-district-floods-november-2009",
  "title": "Heavy rainfall/flooding in the Lake District, Cumbria - November 2009",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/heavy-rainfall_flooding-in-the-lake-district-cumbria---november-2009---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-heavy-rainfall-strong-winds-13-october-2002",
  "title": "Heavy rainfall/strong winds - 13 October 2002",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/heavy-rainfall_strong-winds---13-october-2002---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-heavy-rainfall-strong-winds-14-15-october-2002",
  "title": "Heavy rainfall/strong winds - 14/15 October 2002",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/heavy-rainfall_strong-winds---14_15-october-2002---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-hot-dry-spell-july-2013",
  "title": "Hot dry spell July 2013",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/hot-dry-spell-july-2013---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-hot-spell-august-2003",
  "title": "Hot spell - August 2003",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/hot-spell---august-2003---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-hot-spell-august-1990",
  "title": "Hot spell August 1990",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/hot-spell-august-1990---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-hot-spell-june-2017",
  "title": "Hot spell June 2017",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/hot-spell-june-2017---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-january-2005-stormy-spells",
  "title": "January 2005 - stormy spells",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/january-2005---stormy-spells---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-october-2001-rain",
  "title": "October 2001 rain",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/october-2001-rain---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-rainfall-over-south-east-england-20-23-nov-2003",
  "title": "Rainfall over south-east England, 20-23 Nov 2003",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/rainfall-over-south-east-england-20-23-nov-2003---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-record-breaking-heat-and-sunshine-july-2006",
  "title": "Record breaking heat and sunshine - July 2006",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/record-breaking-heat-and-sunshine---july-2006---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-record-breaking-maximum-temperatures-26-27-january-2003",
  "title": "Record-breaking maximum temperatures - 26/27 January 2003",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/record-breaking-maximum-temperatures---26_27-january-2003---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-record-december-2001-sunshine",
  "title": "Record December 2001 sunshine",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/record-december-2001-sunshine---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-record-rainfall-april-to-july-2012",
  "title": "Record rainfall - April to July 2012",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/record-rainfall---april-to-july-2012---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-record-rainfall-june-july-may-july-2007",
  "title": "Record rainfall - June-July & May-July 2007",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/record-rainfall---june-july--may-july-2007---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-record-rainfall-october-december-2002",
  "title": "Record rainfall - October/December 2002",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/record-rainfall---october_december-2002---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-snow-and-low-temperatures-28-30-october-2008",
  "title": "Snow and low temperatures - 28-30 October 2008",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/snow-and-low-temperatures---28-30-october-2008---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-snow-and-low-temperatures-december-2009-to-january-2010",
  "title": "Snow and low temperatures - December 2009 to January 2010",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/snow-and-low-temperatures---december-2009-to-january-2010---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-snow-and-low-temperatures-december-2010",
  "title": "Snow and low temperatures, December 2010",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/snow-and-low-temperatures-december-2010---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-snow-and-low-temperatures-february-to-march-2018",
  "title": "Snow and low temperatures February to March 2018",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/snow-and-low-temperatures-february-to-march-2018---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-snow-and-low-temperatures-late-march-2013",
  "title": "Snow and low temperatures late March 2013",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/snow-and-low-temperatures-late-march-2013---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-storm-deirdre",
  "title": "Storm Deirdre",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/storm-deirdre---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-strong-winds-27-october-2002",
  "title": "Strong Winds - 27 October 2002",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/strong-winds---27-october-2002---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-strong-winds-10-12-march-2008",
  "title": "Strong winds 10-12 March 2008",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/strong-winds-10-12-march-2008---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-strong-winds-and-flooding-from-storm-angus-november-2016",
  "title": "Strong winds and flooding from storm Angus, November 2016",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/strong-winds-and-flooding-from-storm-angus-november-2016---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-strong-winds-and-heavy-rain-from-storm-callum",
  "title": "Strong winds and heavy rain from storm Callum",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/strong-winds-and-heavy-rain-from-storm-callum---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-strong-winds-and-heavy-rain-from-storms-ali-and-bronagh",
  "title": "Strong winds and heavy rain from storms Ali and Bronagh",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/strong-winds-and-heavy-rain-from-storms-ali-and-bronagh---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-strong-winds-from-storm-hector",
  "title": "Strong winds from storm Hector",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/strong-winds-from-storm-hector---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-strong-winds-heavy-rainfall-7-8-july-2004",
  "title": "Strong winds/heavy rainfall - 7/8 July 2004",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/strong-winds_heavy-rainfall---7_8-july-2004---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-summer-2018",
  "title": "Summer 2018",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/summer-2018---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-the-bracknell-storm-7-may-2000",
  "title": "The Bracknell Storm - 7 May 2000",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/the-bracknell-storm---7-may-2000---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-the-wet-autumn-of-2000",
  "title": "The wet autumn of 2000",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/the-wet-autumn-of-2000---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-uk-warm-dry-and-sunny-year-2003",
  "title": "UK warm, dry and sunny year - 2003",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/uk-warm-dry-and-sunny-year---2003---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-winter-storms-december-2013-to-january-2014",
  "title": "Winter storms, December 2013 to January 2014",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/winter-storms-december-2013-to-january-2014---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-winter-storms-early-january-2012",
  "title": "Winter storms, early January 2012",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/winter-storms-early-january-2012---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-cs-winter-storms-january-to-february-2014",
  "title": "Winter storms, January to February 2014",
  "publisher": "Met Office (National Climate Information Centre)",
  "url": "https://www.metoffice.gov.uk/api/assets/file/winter-storms-january-to-february-2014---met-officepdf?prefix=assets",
  "kind": "case-study"
 },
 {
  "id": "mo-learn-tornadoes",
  "title": "Tornadoes",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/tornadoes",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-thunder",
  "title": "Thunder and lightning",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/thunder-and-lightning",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-hail",
  "title": "Hail",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/hail",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-fog",
  "title": "Fog",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/fog",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-frost-ice",
  "title": "Frost and ice",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/frost-and-ice",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-snow",
  "title": "Snow",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/snow",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-blizzard",
  "title": "Blizzards and snow drifts",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/snow/blizzard",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-sleet",
  "title": "Sleet",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/snow/sleet",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-white-christmas",
  "title": "White Christmas and UK Christmas weather records",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/snow/white-christmas",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-freezing-rain",
  "title": "Freezing rain",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/rain/freezing-rain",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-rain",
  "title": "Rain",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/rain",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-rain-showers",
  "title": "Rain and showers",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/rain/rain-and-showers",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-uk-rainfall",
  "title": "How much does it rain in the UK?",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/rain/how-much-does-it-rain-in-the-uk",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-heatwave",
  "title": "What is a heatwave?",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/temperature/heatwave",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-autumn-warmth",
  "title": "Summer weather during autumn",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/temperature/indian-summer",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-inversion",
  "title": "Temperature inversion",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/temperature/temperature-inversion",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-humidity",
  "title": "Humidity",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/humidity",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-spanish-plume",
  "title": "What is a Spanish plume?",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/storms/spanish-plume",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-storm-surge",
  "title": "Storm surge",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/storms/storm-surge",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-weather-bomb",
  "title": "What is a weather bomb?",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/storms/weather-bomb",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-winter-storms",
  "title": "Winter storms",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/storms/winter-storms",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-sting-jet",
  "title": "What is a sting jet?",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/wind/sting-jet",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-foehn",
  "title": "Foehn effect",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/wind/foehn-effect",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-helm-wind",
  "title": "The Helm Wind",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/wind/helm-wind",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-lee-waves",
  "title": "Lee waves",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/wind/lee-waves",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-jet-stream",
  "title": "What is the jet stream?",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/wind/what-is-the-jet-stream",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-ssw",
  "title": "Sudden stratospheric warming",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/wind/sudden-stratospheric-warming",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-wind-chill",
  "title": "Wind chill",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/wind/wind-chill-factor",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-types-of-wind",
  "title": "Types of wind",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/wind/types-of-wind",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-hurricanes",
  "title": "Hurricanes",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/hurricanes",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-clouds-unusual",
  "title": "Unusual cloud formations",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/clouds/unusual-cloud-formations",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-clouds-low",
  "title": "Low-level clouds",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/clouds/low-level-clouds",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-optical",
  "title": "Optical effects",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/optical-effects",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-blocks",
  "title": "Blocking patterns",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/how-weather-works/high-and-low-pressure/blocks",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-pressure",
  "title": "High and low pressure",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/how-weather-works/high-and-low-pressure",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-convection",
  "title": "What is convection?",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/how-weather-works/what-is-convection",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-fronts",
  "title": "Weather fronts",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/atmosphere/weather-fronts",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-global-circulation",
  "title": "Global circulation patterns",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/atmosphere/global-circulation-patterns",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-winter-factors",
  "title": "Factors that influence UK winters",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/seasons/winter/factors-that-influence-uk-winters",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-season-spring",
  "title": "Spring",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/seasons/spring",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-season-summer",
  "title": "Summer",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/seasons/summer",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-season-autumn",
  "title": "Autumn",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/seasons/autumn",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-season-winter",
  "title": "Winter",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/seasons/winter",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-great-storm",
  "title": "The Great Storm of 1987",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/case-studies/great-storm",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-severe-winters",
  "title": "Severe winters (1947 and 1963)",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/case-studies/severe-winters",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-freezing-rain-1996",
  "title": "UK freezing rain - 23 to 24 January 1996",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/case-studies/freezing-rain",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-great-smog",
  "title": "The Great Smog of 1952",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/case-studies/great-smog",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-boscastle",
  "title": "Boscastle floods, August 2004",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/case-studies/boscastle",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-ottery-hail",
  "title": "Ottery St Mary hailstorm, October 2008",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/case-studies/ottery-hail",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-snow-2010",
  "title": "UK snow 2010",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/case-studies/uk-snow-2010",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-snow-feb-2012",
  "title": "Snow, February 2012",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/case-studies/snow-feb-2012",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-april-2012",
  "title": "April 2012",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/case-studies/april-2012",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-floods",
  "title": "Floods",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/case-studies/floods",
  "kind": "explainer"
 },
 {
  "id": "mo-learn-heatwave-cs",
  "title": "Heatwave case study",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/learn-about/weather/case-studies/heatwave",
  "kind": "explainer"
 },
 {
  "id": "mo-advice-heavy-rain",
  "title": "Stay safe in heavy rain",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/stay-safe-in-heavy-rain",
  "kind": "safety"
 },
 {
  "id": "mo-advice-strong-wind",
  "title": "Stay safe in strong wind",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/stay-safe-in-strong-wind",
  "kind": "safety"
 },
 {
  "id": "mo-advice-storm",
  "title": "Stay safe in a storm",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/your-home/stay-safe-in-a-storm",
  "kind": "safety"
 },
 {
  "id": "mo-advice-thunder",
  "title": "Stay safe in thunder and lightning",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/health-wellbeing/stay-safe-in-thunder-and-lightning",
  "kind": "safety"
 },
 {
  "id": "mo-advice-hot-weather",
  "title": "Hot weather and its impacts",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/health-wellbeing/hot-weather-and-its-impacts",
  "kind": "safety"
 },
 {
  "id": "mo-advice-older-cool",
  "title": "Tips for keeping older people cool",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/health-wellbeing/tips-for-keeping-older-people-cool",
  "kind": "safety"
 },
 {
  "id": "mo-advice-uv",
  "title": "UV",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/health-wellbeing/uv",
  "kind": "safety"
 },
 {
  "id": "mo-advice-winter-well",
  "title": "Stay well in winter",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/health-wellbeing/stay-well-in-winter",
  "kind": "safety"
 },
 {
  "id": "mo-advice-snow-ice-travel",
  "title": "Travelling in heavy snow and ice",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/travel/travelling-in-heavy-snow-and-ice",
  "kind": "safety"
 },
 {
  "id": "mo-advice-winter-driving",
  "title": "Drive safely in winter weather",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/travel/drive-safely-in-winter-weather",
  "kind": "safety"
 },
 {
  "id": "mo-advice-fog-travel",
  "title": "Advice for travelling in fog",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/travel/advice-for-travelling-in-fog",
  "kind": "safety"
 },
 {
  "id": "mo-advice-storm-travel",
  "title": "Travelling in storms, rain and wind",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/travel/travelling-in-storms-rain-and-wind",
  "kind": "safety"
 },
 {
  "id": "mo-advice-flood-property",
  "title": "Protecting your property from flooding",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/your-home/protecting-your-property-from-flooding",
  "kind": "safety"
 },
 {
  "id": "mo-advice-in-a-flood",
  "title": "What to do in a flood",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/your-home/what-to-do-in-a-flood",
  "kind": "safety"
 },
 {
  "id": "mo-advice-power-cut",
  "title": "What to do in a power cut",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/your-home/what-to-do-in-a-power-cut",
  "kind": "safety"
 },
 {
  "id": "mo-advice-burst-pipes",
  "title": "Frozen or burst pipes",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/your-home/frozen-or-burst-pipes",
  "kind": "safety"
 },
 {
  "id": "mo-advice-winter-home",
  "title": "Protecting your property from winter weather",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/your-home/protecting-your-property-from-winter-weather",
  "kind": "safety"
 },
 {
  "id": "mo-advice-beach",
  "title": "10 beach safety tips",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/travel/out-and-about/10-beach-safety-tips",
  "kind": "safety"
 },
 {
  "id": "mo-advice-rip",
  "title": "Understanding rip currents",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/travel/out-and-about/understanding-rip-currents",
  "kind": "safety"
 },
 {
  "id": "mo-advice-open-water",
  "title": "Open water swimming",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/travel/out-and-about/open-water-swimming",
  "kind": "safety"
 },
 {
  "id": "mo-advice-winter-water",
  "title": "Winter water safety",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/travel/out-and-about/winter-water-safety",
  "kind": "safety"
 },
 {
  "id": "mo-advice-camping",
  "title": "Camping in wind and rain",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/travel/out-and-about/camping-in-wind-and-rain",
  "kind": "safety"
 },
 {
  "id": "mo-advice-gardening",
  "title": "Gardening",
  "publisher": "Met Office",
  "url": "https://weather.metoffice.gov.uk/warnings-and-advice/seasonal-advice/your-home/gardening",
  "kind": "safety"
 },
 {
  "id": "gov-check-flooding",
  "title": "Check for flooding (England)",
  "publisher": "GOV.UK",
  "url": "https://check-for-flooding.service.gov.uk/",
  "kind": "official"
 },
 {
  "id": "gov-prepare-flooding",
  "title": "Prepare for flooding",
  "publisher": "GOV.UK",
  "url": "https://www.gov.uk/prepare-for-flooding",
  "kind": "official"
 },
 {
  "id": "sepa-floodline",
  "title": "SEPA Floodline (Scotland)",
  "publisher": "SEPA",
  "url": "https://floodline.sepa.org.uk/",
  "kind": "official"
 },
 {
  "id": "nrw-flood-warnings",
  "title": "Check flood warnings (Wales)",
  "publisher": "Natural Resources Wales",
  "url": "https://naturalresources.wales/flooding/check-flood-warnings",
  "kind": "official"
 },
 {
  "id": "nidirect-flooding",
  "title": "Flooding (Northern Ireland)",
  "publisher": "nidirect",
  "url": "https://www.nidirect.gov.uk/articles/flooding",
  "kind": "official"
 },
 {
  "id": "sais",
  "title": "Scottish Avalanche Information Service",
  "publisher": "SAIS",
  "url": "https://www.sais.gov.uk/",
  "kind": "official"
 },
 {
  "id": "mountain-rescue",
  "title": "Mountain Rescue England and Wales",
  "publisher": "Mountain Rescue England and Wales",
  "url": "https://www.mountain.rescue.org.uk/",
  "kind": "official"
 },
 {
  "id": "torro",
  "title": "TORRO (Tornado and Storm Research Organisation)",
  "publisher": "TORRO",
  "url": "https://www.torro.org.uk/",
  "kind": "research"
 }
];
