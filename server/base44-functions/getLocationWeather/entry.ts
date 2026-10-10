import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { location } = body;

    if (!location || typeof location !== 'string') {
      return Response.json({ error: 'Location parameter required' }, { status: 400 });
    }

    const locationData = await searchLocation(location);
    if (!locationData) {
      return Response.json(
        { error: `Location "${location}" not found. Try a UK city or town name.` },
        { status: 404 }
      );
    }

    const { forecast, hourly, past24h } = await fetchWeather(locationData);

    return Response.json({
      location: {
        name: locationData.name,
        latitude: locationData.latitude,
        longitude: locationData.longitude,
      },
      forecast,
      hourly,
      past24h,
    });
  } catch (error) {
    console.error('Error fetching location weather:', error);
    return Response.json(
      { error: 'Failed to fetch weather data. Please try again.' },
      { status: 500 }
    );
  }
});

async function searchLocation(query) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=gb&format=json&limit=1`,
      { headers: { 'User-Agent': 'WeatherApp/1.0' } }
    );
    if (!response.ok) throw new Error('Location search failed');
    const results = await response.json();
    if (!results || results.length === 0) return null;
    const result = results[0];
    return {
      name: result.name || query,
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
    };
  } catch (error) {
    console.error('Location search error:', error);
    return null;
  }
}

async function fetchWeather(location) {
  const { latitude, longitude } = location;

  const [weatherRes, airRes] = await Promise.all([
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max,` +
      `windspeed_10m_max,winddirection_10m_dominant,windgusts_10m_max,uv_index_max,weathercode,` +
      `sunrise,sunset` +
      `&hourly=temperature_2m,precipitation_probability,weathercode,windspeed_10m,winddirection_10m,windgusts_10m,relative_humidity_2m,visibility,surface_pressure,precipitation,snowfall` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,snowfall,windspeed_10m,` +
      `winddirection_10m,surface_pressure,visibility,uv_index,weathercode` +
      `&wind_speed_unit=mph` +
      `&models=ukmo_seamless` +
      `&timezone=Europe/London&forecast_days=6&past_days=1`
    ),
    fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}` +
      `&current=european_aqi&hourly=european_aqi&timezone=Europe/London&forecast_days=5`
    ),
  ]);

  const weatherData = await weatherRes.json();
  const airData = airRes.ok ? await airRes.json() : null;

  const daily = weatherData.daily;
  const current = weatherData.current || {};
  const hourlyRaw = weatherData.hourly || {};
  const airHourly = airData?.hourly || {};

  // Helper: get average of hourly values for a given date string
  const avgForDay = (arr, times, dateStr, fromHour = 0) => {
    if (!arr || !times) return null;
    const vals = [];
    for (let i = 0; i < times.length; i++) {
      if (!times[i].startsWith(dateStr)) continue;
      const hour = parseInt(times[i].split('T')[1]?.split(':')[0] ?? 0);
      if (hour < fromHour) continue;
      if (arr[i] != null) vals.push(arr[i]);
    }
    if (!vals.length) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };

  // Helper: get median wind for a day (more representative than max)
  const medianForDay = (arr, times, dateStr) => {
    if (!arr || !times) return null;
    const vals = [];
    for (let i = 0; i < times.length; i++) {
      if (times[i].startsWith(dateStr) && arr[i] != null) vals.push(arr[i]);
    }
    if (!vals.length) return null;
    vals.sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return Math.round(vals.length % 2 !== 0 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2);
  };

  // Helper: sum hourly values for a given date string
  const sumForDay = (arr, times, dateStr) => {
    if (!arr || !times) return null;
    let total = 0;
    for (let i = 0; i < times.length; i++) {
      if (times[i].startsWith(dateStr) && arr[i] != null) total += arr[i];
    }
    return Math.round(total * 10) / 10;
  };

  // Build today's hourly forecast from current hour onwards
  const now = new Date();
  const nowHour = now.getHours();
  const todayStr = now.toISOString().split('T')[0];

  // Past 24h: yesterday + today hours up to nowHour
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  let past24hRain = 0;
  let past24hSnow = 0;
  if (hourlyRaw.time) {
    for (let i = 0; i < hourlyRaw.time.length; i++) {
      const t = hourlyRaw.time[i];
      const dateStr = t.split('T')[0];
      const hour = parseInt(t.split('T')[1]?.split(':')[0] ?? 0);
      const isYesterday = dateStr === yesterdayStr && hour >= nowHour;
      const isToday24 = dateStr === todayStr && hour <= nowHour;
      if (isYesterday || isToday24) {
        past24hRain += hourlyRaw.precipitation?.[i] ?? 0;
        past24hSnow += hourlyRaw.snowfall?.[i] ?? 0;
      }
    }
  }
  past24hRain = Math.round(past24hRain * 10) / 10;
  past24hSnow = Math.round(past24hSnow * 10) / 10;
  const hourly = [];
  if (hourlyRaw.time) {
    for (let i = 0; i < hourlyRaw.time.length; i++) {
      const t = hourlyRaw.time[i];
      if (!t.startsWith(todayStr)) continue;
      const hour = parseInt(t.split('T')[1].split(':')[0]);
      if (hour < nowHour) continue; // Only from current hour onwards
      const deg = hourlyRaw.winddirection_10m?.[i] ?? null;
      hourly.push({
        time: t,
        hour: formatHour(hour),
        temp: Math.round(hourlyRaw.temperature_2m?.[i] ?? 0),
        rainChance: hourlyRaw.precipitation_probability?.[i] ?? 0,
        windSpeed: Math.round(hourlyRaw.windspeed_10m?.[i] ?? 0),
        windGust: Math.round(hourlyRaw.windgusts_10m?.[i] ?? 0),
        windDeg: deg,
        windDirection: deg != null ? getWindDirection(deg) : null,
        humidity: hourlyRaw.relative_humidity_2m?.[i] ?? null,
        visibility: hourlyRaw.visibility?.[i] ?? null,
        description: (() => {
          const weatherCode = hourlyRaw.weathercode?.[i];
          const rainProb = hourlyRaw.precipitation_probability?.[i] ?? 0;
          // For clear/cloudy codes (0-3), override with rain description if there's a notable rain chance
          if (weatherCode >= 0 && weatherCode <= 3 && rainProb >= 40) {
            if (rainProb >= 80) return 'Heavy Showers';
            if (rainProb >= 60) return 'Showers';
            return 'Light Showers';
          }
          return getWeatherDescriptionFromCode(weatherCode);
        })(),
      });
    }
  }

  // Next hour rain chance
  const nextHourIndex = hourlyRaw.time
    ? hourlyRaw.time.findIndex(t => {
        const h = parseInt(t.split('T')[1]?.split(':')[0]);
        return t.startsWith(todayStr) && h === (nowHour + 1) % 24;
      })
    : -1;
  const nextHourRain = nextHourIndex >= 0 ? (hourlyRaw.precipitation_probability?.[nextHourIndex] ?? null) : null;

  // Air quality current + per-day averages
  const currentAqi = airData?.current?.european_aqi ?? null;

  // Build forecast for all 5 days (skip past days)
  const forecast = daily.time
    .map((date, index) => ({ date, index }))
    .filter(({ date }) => date >= todayStr)
    .slice(0, 5)
    .map(({ date, index }) => {
    const isToday = date === todayStr;

    // Per-day hourly averages for extra stats
    const humidity = isToday
      ? (current.relative_humidity_2m ?? avgForDay(hourlyRaw.relative_humidity_2m, hourlyRaw.time, date))
      : avgForDay(hourlyRaw.relative_humidity_2m, hourlyRaw.time, date);

    const pressure = isToday
      ? (current.surface_pressure ? Math.round(current.surface_pressure) : avgForDay(hourlyRaw.surface_pressure, hourlyRaw.time, date))
      : avgForDay(hourlyRaw.surface_pressure, hourlyRaw.time, date);

    const visibility = isToday
      ? (current.visibility ?? avgForDay(hourlyRaw.visibility, hourlyRaw.time, date))
      : avgForDay(hourlyRaw.visibility, hourlyRaw.time, date);

    const aqi = isToday
      ? (currentAqi ?? avgForDay(airHourly.european_aqi, airHourly.time, date))
      : avgForDay(airHourly.european_aqi, airHourly.time, date);

    // Use median wind speed for typical conditions, max for gusts
    const windSpeedTypical = medianForDay(hourlyRaw.windspeed_10m, hourlyRaw.time, date);
    const windGustMax = Math.round(daily.windgusts_10m_max[index] || 0);
    const windDeg = daily.winddirection_10m_dominant[index];

    // For today: rain chance = average of remaining hours; description = severity-dominant code
    let rainChance, description;
    if (isToday) {
      rainChance = avgForDay(hourlyRaw.precipitation_probability, hourlyRaw.time, date, nowHour) ?? daily.precipitation_probability_max[index] ?? 0;
      const todayCodes = [];
      for (let i = 0; i < (hourlyRaw.time?.length ?? 0); i++) {
        if (!hourlyRaw.time[i].startsWith(date)) continue;
        const hour = parseInt(hourlyRaw.time[i].split('T')[1]?.split(':')[0] ?? 0);
        if (hour >= nowHour && hourlyRaw.weathercode?.[i] != null) todayCodes.push(hourlyRaw.weathercode[i]);
      }
      description = todayCodes.length
        ? getWeatherDescriptionFromCode(dominantWeatherCode(todayCodes))
        : getWeatherDescriptionFromCode(daily.weathercode?.[index]);
    } else {
      rainChance = daily.precipitation_probability_max[index] || 0;
      // Use severity-dominant code across all hours for the day
      const dayCodes = [];
      for (let i = 0; i < (hourlyRaw.time?.length ?? 0); i++) {
        if (hourlyRaw.time[i].startsWith(date) && hourlyRaw.weathercode?.[i] != null) {
          dayCodes.push(hourlyRaw.weathercode[i]);
        }
      }
      description = dayCodes.length
        ? getWeatherDescriptionFromCode(dominantWeatherCode(dayCodes))
        : getWeatherDescriptionFromCode(daily.weathercode?.[index]);
    }

    const precipSum = daily.precipitation_sum?.[index] ?? null;
    const snowfallSum = daily.snowfall_sum?.[index] ?? null;

    return {
      date,
      dayName: new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' }),
      temperature: {
        max: Math.round(daily.temperature_2m_max[index]),
        min: Math.round(daily.temperature_2m_min[index]),
      },
      rainChance,
      precipitation: precipSum != null ? Math.round(precipSum * 10) / 10 : null,
      snowfall: snowfallSum != null ? Math.round(snowfallSum * 10) / 10 : null,
      windSpeed: windSpeedTypical ?? Math.round(daily.windspeed_10m_max[index]),
      windSpeedMax: Math.round(daily.windspeed_10m_max[index]),
      windDirection: getWindDirection(windDeg),
      windDeg,
      windGust: windGustMax,
      description,
      uvIndex: daily.uv_index_max?.[index] ?? null,
      sunrise: daily.sunrise?.[index] ?? null,
      sunset: daily.sunset?.[index] ?? null,
      humidity,
      pressure,
      visibility,
      aqi,
      aqiLabel: getAQILabel(aqi),
      ...(isToday ? {
        nextHourRain,
        feelsLike: current.apparent_temperature ? Math.round(current.apparent_temperature) : null,
      } : {}),
    };
  });

  return { forecast, hourly, past24h: { rain: past24hRain, snow: past24hSnow } };

}

function formatHour(hour) {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${period}`;
}

function getAQILabel(aqi) {
  if (aqi === null || aqi === undefined) return 'Unknown';
  if (aqi <= 20) return 'Good';
  if (aqi <= 40) return 'Fair';
  if (aqi <= 60) return 'Moderate';
  if (aqi <= 80) return 'Poor';
  if (aqi <= 100) return 'Very Poor';
  return 'Extremely Poor';
}

function getWindDirection(degrees) {
  if (degrees == null) return 'N/A';
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

// Returns the most weather-significant code from an array.
// Prefers precipitation/storm codes over plain cloud/clear codes.
function dominantWeatherCode(codes) {
  if (!codes || codes.length === 0) return 3; // fallback: overcast
  // Severity tiers: higher = more significant. We pick the highest tier present,
  // then within that tier pick the most frequent code.
  const tier = (c) => {
    if (c >= 95) return 7; // thunderstorm
    if (c >= 85) return 6; // snow showers
    if (c >= 80) return 5; // rain showers
    if (c >= 71) return 4; // snow
    if (c >= 61) return 4; // rain
    if (c >= 51) return 3; // drizzle
    if (c >= 45) return 2; // fog
    if (c === 3)  return 1; // overcast
    if (c === 2)  return 0; // partly cloudy
    return 0; // clear/mainly clear
  };
  const maxTier = Math.max(...codes.map(tier));
  const topCodes = codes.filter(c => tier(c) === maxTier);
  const freq = {};
  topCodes.forEach(c => { freq[c] = (freq[c] || 0) + 1; });
  return parseInt(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
}

function getWeatherDescriptionFromCode(code) {
  if (code === undefined || code === null) return 'Cloudy';
  const map = {
    0: 'Clear Sky',
    1: 'Mainly Clear',
    2: 'Partly Cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Icy Fog',
    51: 'Light Drizzle',
    53: 'Drizzle',
    55: 'Heavy Drizzle',
    56: 'Freezing Drizzle',
    57: 'Heavy Freezing Drizzle',
    61: 'Light Rain',
    63: 'Rain',
    65: 'Heavy Rain',
    66: 'Freezing Rain',
    67: 'Heavy Freezing Rain',
    71: 'Light Snow',
    73: 'Snow',
    75: 'Heavy Snow',
    77: 'Snow Grains',
    80: 'Light Showers',
    81: 'Showers',
    82: 'Heavy Showers',
    85: 'Snow Showers',
    86: 'Heavy Snow Showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with Hail',
    99: 'Thunderstorm with Heavy Hail',
  };
  if (map[code] !== undefined) return map[code];
  if (code >= 45 && code <= 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 85 && code <= 86) return 'Snow Showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Cloudy';
}