import { SunnyIcon, ClearNightIcon, SunnyIntervalsIcon, SunnyIntervalsNightIcon, SunnyIntervalsV2Icon, PartlyCloudyIcon, PartlyCloudyNightIcon } from './icons/SunMoonIcons';
import { CloudyIcon, OvercastIcon, FogIcon, MistIcon, WindyIcon } from './icons/CloudIcons';
import { DrizzleIcon, DrizzleNightIcon, DrizzleCloudIcon, LightRainIcon, LightRainNightIcon, LightRainCloudIcon, ModerateRainIcon, ModerateRainNightIcon, ModerateRainCloudIcon, HeavyRainIcon, HeavyRainNightIcon, HeavyRainCloudIcon, TorrentialRainIcon, TorrentialRainNightIcon, TorrentialRainCloudIcon, RainShowerIcon, RainShowerNightIcon, RainShowerCloudIcon, ModerateShowerIcon, ModerateShowerNightIcon, ModerateShowerCloudIcon, HeavyShowersIcon, HeavyShowersNightIcon, HeavyShowersCloudIcon, ThunderyShowerIcon, ThunderyShowerNightIcon, ThunderyShowerCloudIcon } from './icons/RainIcons';
import { FlurryIcon, FlurryNightIcon, FlurryCloudIcon, LightSnowIcon, LightSnowNightIcon, LightSnowCloudIcon, SnowIcon, SnowNightIcon, SnowCloudIcon, HeavySnowIcon, HeavySnowNightIcon, HeavySnowCloudIcon, BlizzardIcon, BlizzardNightIcon, BlizzardCloudIcon } from './icons/SnowIcons';
import { LightSleetIcon, LightSleetNightIcon, LightSleetCloudIcon, SleetIcon, SleetNightIcon, SleetCloudIcon, HeavySleetIcon, HeavySleetNightIcon, HeavySleetCloudIcon, LightHailIcon, LightHailNightIcon, LightHailCloudIcon, HailIcon, HailNightIcon, HailCloudIcon, HeavyHailIcon, HeavyHailNightIcon, HeavyHailCloudIcon } from './icons/MixedIcons';
import { IsolatedThunderstormsIcon, ScatteredThunderstormsIcon, ThunderstormsIcon } from './icons/StormIcons';

export const weatherIcons = {
  // Clear
  'Sunny': SunnyIcon,
  'Clear Night': ClearNightIcon,
  'Sunny Intervals': SunnyIntervalsIcon,
  'Sunny Intervals Night': SunnyIntervalsNightIcon,
  'Sunny Intervals V2': SunnyIntervalsV2Icon,
  'Partly Cloudy': PartlyCloudyIcon,
  'Partly Cloudy Night': PartlyCloudyNightIcon,
  // Cloud
  'Cloudy': CloudyIcon,
  'Overcast': OvercastIcon,
  'Fog': FogIcon,
  'Mist': MistIcon,
  'Windy': WindyIcon,
  // Rain
  'Drizzle': DrizzleIcon,
  'Drizzle Night': DrizzleNightIcon,
  'Drizzle Cloud': DrizzleCloudIcon,
  'Light Rain': LightRainIcon,
  'Light Rain Night': LightRainNightIcon,
  'Light Rain Cloud': LightRainCloudIcon,
  'Moderate Rain': ModerateRainIcon,
  'Moderate Rain Night': ModerateRainNightIcon,
  'Moderate Rain Cloud': ModerateRainCloudIcon,
  'Heavy Rain': HeavyRainIcon,
  'Heavy Rain Night': HeavyRainNightIcon,
  'Heavy Rain Cloud': HeavyRainCloudIcon,
  'Torrential Rain': TorrentialRainIcon,
  'Torrential Rain Night': TorrentialRainNightIcon,
  'Torrential Rain Cloud': TorrentialRainCloudIcon,
  'Rain Shower': RainShowerIcon,
  'Rain Shower Night': RainShowerNightIcon,
  'Rain Shower Cloud': RainShowerCloudIcon,
  'Moderate Shower': ModerateShowerIcon,
  'Moderate Shower Night': ModerateShowerNightIcon,
  'Moderate Shower Cloud': ModerateShowerCloudIcon,
  'Heavy Showers': HeavyShowersIcon,
  'Heavy Showers Night': HeavyShowersNightIcon,
  'Heavy Showers Cloud': HeavyShowersCloudIcon,
  'Thundery Shower': ThunderyShowerIcon,
  'Thundery Shower Night': ThunderyShowerNightIcon,
  'Thundery Shower Cloud': ThunderyShowerCloudIcon,
  // Snow
  'Flurry': FlurryIcon,
  'Flurry Night': FlurryNightIcon,
  'Flurry Cloud': FlurryCloudIcon,
  'Light Snow': LightSnowIcon,
  'Light Snow Night': LightSnowNightIcon,
  'Light Snow Cloud': LightSnowCloudIcon,
  'Snow': SnowIcon,
  'Snow Night': SnowNightIcon,
  'Snow Cloud': SnowCloudIcon,
  'Heavy Snow': HeavySnowIcon,
  'Heavy Snow Night': HeavySnowNightIcon,
  'Heavy Snow Cloud': HeavySnowCloudIcon,
  'Blizzard': BlizzardIcon,
  'Blizzard Night': BlizzardNightIcon,
  'Blizzard Cloud': BlizzardCloudIcon,
  // Mixed
  'Light Sleet': LightSleetIcon,
  'Light Sleet Night': LightSleetNightIcon,
  'Light Sleet Cloud': LightSleetCloudIcon,
  'Sleet': SleetIcon,
  'Sleet Night': SleetNightIcon,
  'Sleet Cloud': SleetCloudIcon,
  'Heavy Sleet': HeavySleetIcon,
  'Heavy Sleet Night': HeavySleetNightIcon,
  'Heavy Sleet Cloud': HeavySleetCloudIcon,
  'Light Hail': LightHailIcon,
  'Light Hail Night': LightHailNightIcon,
  'Light Hail Cloud': LightHailCloudIcon,
  'Hail': HailIcon,
  'Hail Night': HailNightIcon,
  'Hail Cloud': HailCloudIcon,
  'Heavy Hail': HeavyHailIcon,
  'Heavy Hail Night': HeavyHailNightIcon,
  'Heavy Hail Cloud': HeavyHailCloudIcon,
  // Storm
  'Isolated Thunderstorms': IsolatedThunderstormsIcon,
  'Scattered Thunderstorms': ScatteredThunderstormsIcon,
  'Thunder': ThunderstormsIcon,
  'Thunderstorms': ThunderstormsIcon,
};

export function getWeatherSymbol(name) {
  return weatherIcons[name] || CloudyIcon;
}