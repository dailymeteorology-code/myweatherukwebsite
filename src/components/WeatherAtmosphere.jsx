import React, { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── SKY GRADIENT CONFIGS ────────────────────────────────────────────────────
const SKY_CONFIGS = {
  'Sunny': { day: 'linear-gradient(180deg, #1a6bc8 0%, #2d8de0 40%, #87ceeb 80%, #dff2ff 100%)', night: 'linear-gradient(180deg, #020b18 0%, #071a30 40%, #0d2545 100%)', sunrise: 'linear-gradient(180deg, #1a3a6e 0%, #e8794a 40%, #f5c06a 70%, #fffbe8 100%)', sunset: 'linear-gradient(180deg, #2a1a5e 0%, #8b3a8b 30%, #e8562a 55%, #f5a040 75%, #ffd580 100%)', clouds: 0, celestial: true },
  'Clear Night': { day: 'linear-gradient(180deg, #020b18 0%, #071a30 40%, #0d2545 100%)', night: 'linear-gradient(180deg, #020b18 0%, #071a30 40%, #0d2545 100%)', sunrise: 'linear-gradient(180deg, #0d1a2e 0%, #c05a30 50%, #f0a040 80%, #ffd580 100%)', sunset: 'linear-gradient(180deg, #200d40 0%, #6b2a6b 30%, #c0401a 55%, #e07030 80%, #ffd580 100%)', clouds: 0, celestial: true },
  'Sunny Intervals': { day: 'linear-gradient(180deg, #2070c0 0%, #4090d8 40%, #90c8e8 80%, #d8f0ff 100%)', night: 'linear-gradient(180deg, #060e1e 0%, #0e2238 50%, #182f50 100%)', sunrise: 'linear-gradient(180deg, #1a3a6e 0%, #d87040 40%, #f0c060 70%, #fff8d0 100%)', sunset: 'linear-gradient(180deg, #2a2060 0%, #904870 30%, #d85030 55%, #f0a030 78%, #f8d880 100%)', clouds: 0.35, celestial: true },
  'Sunny Intervals Night': { day: 'linear-gradient(180deg, #060e1e 0%, #0e2238 50%, #182f50 100%)', night: 'linear-gradient(180deg, #060e1e 0%, #0e2238 50%, #182f50 100%)', sunrise: 'linear-gradient(180deg, #0a1828 0%, #b04828 50%, #e09040 80%, #fad070 100%)', sunset: 'linear-gradient(180deg, #180c30 0%, #581848 30%, #a03018 55%, #d07020 80%, #f0c050 100%)', clouds: 0.35, celestial: true },
  'Sunny Intervals V2': { day: 'linear-gradient(180deg, #2070c0 0%, #4090d8 40%, #90c8e8 80%, #d8f0ff 100%)', night: 'linear-gradient(180deg, #060e1e 0%, #0e2238 50%, #182f50 100%)', sunrise: 'linear-gradient(180deg, #1a3a6e 0%, #d87040 40%, #f0c060 70%, #fff8d0 100%)', sunset: 'linear-gradient(180deg, #2a2060 0%, #904870 30%, #d85030 55%, #f0a030 78%, #f8d880 100%)', clouds: 0.35, celestial: true },
  'Partly Cloudy': { day: 'linear-gradient(180deg, #2a78c8 0%, #5098d8 40%, #98cce8 80%, #d8efff 100%)', night: 'linear-gradient(180deg, #080f20 0%, #101a30 50%, #182840 100%)', sunrise: 'linear-gradient(180deg, #203868 0%, #d06838 40%, #e8a850 70%, #fff0d0 100%)', sunset: 'linear-gradient(180deg, #302268 0%, #904878 30%, #d04828 55%, #e89030 78%, #f8d870 100%)', clouds: 0.45, celestial: true },
  'Partly Cloudy Night': { day: 'linear-gradient(180deg, #080f20 0%, #101a30 50%, #182840 100%)', night: 'linear-gradient(180deg, #080f20 0%, #101a30 50%, #182840 100%)', sunrise: 'linear-gradient(180deg, #0c1428 0%, #b04030 50%, #d88040 80%, #f0c060 100%)', sunset: 'linear-gradient(180deg, #200a38 0%, #601838 30%, #a02818 55%, #c86818 80%, #e8b040 100%)', clouds: 0.45, celestial: true },
  'Cloudy': { day: 'linear-gradient(180deg, #6a7f8e 0%, #8098a8 40%, #a0b8c8 80%, #c8d8e0 100%)', night: 'linear-gradient(180deg, #1a1f28 0%, #252c38 50%, #303848 100%)', sunrise: 'linear-gradient(180deg, #3a4858 0%, #987060 40%, #c8a870 70%, #e0c898 100%)', sunset: 'linear-gradient(180deg, #3a3050 0%, #806070 30%, #a06050 55%, #c08050 78%, #d8a870 100%)', clouds: 0.75 },
  'Overcast': { day: 'linear-gradient(180deg, #5a6878 0%, #707e8e 40%, #8898a8 80%, #a0b0be 100%)', night: 'linear-gradient(180deg, #141820 0%, #1e2430 50%, #282e3c 100%)', sunrise: 'linear-gradient(180deg, #303840 0%, #806858 40%, #a08868 70%, #c0a878 100%)', sunset: 'linear-gradient(180deg, #302838 0%, #685060 30%, #885060 55%, #a07055 78%, #c09068 100%)', clouds: 0.95 },
  'Mist': { day: 'linear-gradient(180deg, #8898a8 0%, #9eb0c0 50%, #b8cad8 100%)', night: 'linear-gradient(180deg, #202830 0%, #2c3840 50%, #364048 100%)', sunrise: 'linear-gradient(180deg, #606878 0%, #989080 40%, #c0a888 70%, #d8c0a0 100%)', sunset: 'linear-gradient(180deg, #383038 0%, #786070 30%, #907060 55%, #a08060 78%, #b89870 100%)', clouds: 0.5, fog: true },
  'Fog': { day: 'linear-gradient(180deg, #9aaab8 0%, #b0c0cc 50%, #c8d4dc 100%)', night: 'linear-gradient(180deg, #282e34 0%, #333c44 50%, #3e4850 100%)', sunrise: 'linear-gradient(180deg, #686e76 0%, #a09080 40%, #c0a888 70%, #d8c0a0 100%)', sunset: 'linear-gradient(180deg, #403848 0%, #806070 30%, #907060 55%, #a08060 78%, #b09070 100%)', clouds: 0.65, fog: true },
  'Windy': { day: 'linear-gradient(180deg, #2068b8 0%, #4088d0 40%, #80bce0 80%, #c0e0f8 100%)', night: 'linear-gradient(180deg, #06101e 0%, #0e1e30 50%, #181e30 100%)', sunrise: 'linear-gradient(180deg, #182860 0%, #c06040 40%, #e0a050 70%, #ffe8c0 100%)', sunset: 'linear-gradient(180deg, #281858 0%, #804068 30%, #c03828 55%, #e08028 78%, #f0c060 100%)', clouds: 0.3, wind: true, celestial: true },
  // Rain
  'Drizzle': { day: 'linear-gradient(180deg, #5a6e80 0%, #6e8090 45%, #8298a8 80%, #9ab0be 100%)', night: 'linear-gradient(180deg, #0e1620 0%, #18222e 50%, #222e3c 100%)', sunrise: 'linear-gradient(180deg, #303c48 0%, #806858 40%, #a08068 70%, #c09878 100%)', sunset: 'linear-gradient(180deg, #282030 0%, #605060 30%, #806058 55%, #9c7858 78%, #b09068 100%)', clouds: 0.7, rain: 'drizzle' },
  'Drizzle Night': { day: 'linear-gradient(180deg, #0e1620 0%, #18222e 50%, #222e3c 100%)', night: 'linear-gradient(180deg, #0e1620 0%, #18222e 50%, #222e3c 100%)', sunrise: 'linear-gradient(180deg, #303c48 0%, #806858 40%, #a08068 70%, #c09878 100%)', sunset: 'linear-gradient(180deg, #282030 0%, #605060 30%, #806058 55%, #9c7858 78%, #b09068 100%)', clouds: 0.7, rain: 'drizzle' },
  'Light Rain': { day: 'linear-gradient(180deg, #485e70 0%, #5c7080 45%, #7088a0 80%, #8898b0 100%)', night: 'linear-gradient(180deg, #0c1420 0%, #141e2c 50%, #1e2838 100%)', sunrise: 'linear-gradient(180deg, #283040 0%, #705850 40%, #907060 70%, #b09070 100%)', sunset: 'linear-gradient(180deg, #201828 0%, #584860 30%, #785055 55%, #906855 78%, #a08060 100%)', clouds: 0.8, rain: 'light' },
  'Light Rain Night': { day: 'linear-gradient(180deg, #0c1420 0%, #141e2c 50%, #1e2838 100%)', night: 'linear-gradient(180deg, #0c1420 0%, #141e2c 50%, #1e2838 100%)', sunrise: 'linear-gradient(180deg, #283040 0%, #705850 40%, #907060 70%, #b09070 100%)', sunset: 'linear-gradient(180deg, #201828 0%, #584860 30%, #785055 55%, #906855 78%, #a08060 100%)', clouds: 0.8, rain: 'light' },
  'Moderate Rain': { day: 'linear-gradient(180deg, #384e60 0%, #4c6070 45%, #606880 80%, #78808e 100%)', night: 'linear-gradient(180deg, #080e18 0%, #101822 50%, #181e2c 100%)', sunrise: 'linear-gradient(180deg, #202830 0%, #605048 40%, #786858 70%, #908868 100%)', sunset: 'linear-gradient(180deg, #181028 0%, #483848 30%, #604040 55%, #785048 78%, #907058 100%)', clouds: 0.85, rain: 'moderate' },
  'Moderate Rain Night': { day: 'linear-gradient(180deg, #080e18 0%, #101822 50%, #181e2c 100%)', night: 'linear-gradient(180deg, #080e18 0%, #101822 50%, #181e2c 100%)', sunrise: 'linear-gradient(180deg, #202830 0%, #605048 40%, #786858 70%, #908868 100%)', sunset: 'linear-gradient(180deg, #181028 0%, #483848 30%, #604040 55%, #785048 78%, #907058 100%)', clouds: 0.85, rain: 'moderate' },
  'Heavy Rain': { day: 'linear-gradient(180deg, #283040 0%, #384050 45%, #485060 80%, #585e6e 100%)', night: 'linear-gradient(180deg, #050a10 0%, #0c1018 50%, #121620 100%)', sunrise: 'linear-gradient(180deg, #181e28 0%, #503830 40%, #685040 70%, #806050 100%)', sunset: 'linear-gradient(180deg, #100a20 0%, #382838 30%, #502828 55%, #683830 78%, #785040 100%)', clouds: 0.95, rain: 'heavy' },
  'Heavy Rain Night': { day: 'linear-gradient(180deg, #050a10 0%, #0c1018 50%, #121620 100%)', night: 'linear-gradient(180deg, #050a10 0%, #0c1018 50%, #121620 100%)', sunrise: 'linear-gradient(180deg, #181e28 0%, #503830 40%, #685040 70%, #806050 100%)', sunset: 'linear-gradient(180deg, #100a20 0%, #382838 30%, #502828 55%, #683830 78%, #785040 100%)', clouds: 0.95, rain: 'heavy' },
  'Torrential Rain': { day: 'linear-gradient(180deg, #1e2830 0%, #283038 45%, #303840 80%, #404048 100%)', night: 'linear-gradient(180deg, #040608 0%, #080c10 50%, #0c1018 100%)', sunrise: 'linear-gradient(180deg, #101418 0%, #3c2820 40%, #503830 70%, #604838 100%)', sunset: 'linear-gradient(180deg, #0c0818 0%, #282028 30%, #38181c 55%, #4c2820 78%, #5c3828 100%)', clouds: 1, rain: 'torrential' },
  'Torrential Rain Night': { day: 'linear-gradient(180deg, #040608 0%, #080c10 50%, #0c1018 100%)', night: 'linear-gradient(180deg, #040608 0%, #080c10 50%, #0c1018 100%)', sunrise: 'linear-gradient(180deg, #101418 0%, #3c2820 40%, #503830 70%, #604838 100%)', sunset: 'linear-gradient(180deg, #0c0818 0%, #282028 30%, #38181c 55%, #4c2820 78%, #5c3828 100%)', clouds: 1, rain: 'torrential' },
  'Rain Shower': { day: 'linear-gradient(180deg, #4a6070 0%, #607280 45%, #7890a0 80%, #8ca0ae 100%)', night: 'linear-gradient(180deg, #0a1218 0%, #141e28 50%, #1c2830 100%)', sunrise: 'linear-gradient(180deg, #283040 0%, #726050 40%, #8c7860 70%, #a89070 100%)', sunset: 'linear-gradient(180deg, #201828 0%, #584860 30%, #705050 55%, #8a6850 78%, #a08060 100%)', clouds: 0.7, rain: 'shower' },
  'Rain Shower Night': { day: 'linear-gradient(180deg, #0a1218 0%, #141e28 50%, #1c2830 100%)', night: 'linear-gradient(180deg, #0a1218 0%, #141e28 50%, #1c2830 100%)', sunrise: 'linear-gradient(180deg, #283040 0%, #726050 40%, #8c7860 70%, #a89070 100%)', sunset: 'linear-gradient(180deg, #201828 0%, #584860 30%, #705050 55%, #8a6850 78%, #a08060 100%)', clouds: 0.7, rain: 'shower' },
  'Rain Shower Cloud': { day: 'linear-gradient(180deg, #5a7080 0%, #6e8090 45%, #8098a8 80%, #90a8b8 100%)', night: 'linear-gradient(180deg, #0e1620 0%, #18222e 50%, #202c38 100%)', sunrise: 'linear-gradient(180deg, #2c3848 0%, #786860 40%, #908070 70%, #a89878 100%)', sunset: 'linear-gradient(180deg, #201828 0%, #604858 30%, #706050 55%, #887060 78%, #a08870 100%)', clouds: 0.85, rain: 'shower' },
  'Heavy Showers': { day: 'linear-gradient(180deg, #384858 0%, #485868 45%, #586070 80%, #686870 100%)', night: 'linear-gradient(180deg, #080e18 0%, #101820 50%, #181e28 100%)', sunrise: 'linear-gradient(180deg, #202830 0%, #604848 40%, #785858 70%, #906868 100%)', sunset: 'linear-gradient(180deg, #180e28 0%, #503040 30%, #684040 55%, #7c5040 78%, #906050 100%)', clouds: 0.9, rain: 'heavy' },
  'Heavy Showers Night': { day: 'linear-gradient(180deg, #080e18 0%, #101820 50%, #181e28 100%)', night: 'linear-gradient(180deg, #080e18 0%, #101820 50%, #181e28 100%)', sunrise: 'linear-gradient(180deg, #202830 0%, #604848 40%, #785858 70%, #906868 100%)', sunset: 'linear-gradient(180deg, #180e28 0%, #503040 30%, #684040 55%, #7c5040 78%, #906050 100%)', clouds: 0.9, rain: 'heavy' },
  'Heavy Showers Cloud': { day: 'linear-gradient(180deg, #485868 0%, #586070 45%, #686878 80%, #787880 100%)', night: 'linear-gradient(180deg, #0a1018 0%, #121820 50%, #1a2028 100%)', sunrise: 'linear-gradient(180deg, #242c38 0%, #645a50 40%, #806860 70%, #987870 100%)', sunset: 'linear-gradient(180deg, #1c1028 0%, #564048 30%, #684848 55%, #7c5848 78%, #906860 100%)', clouds: 0.95, rain: 'heavy' },
  // Snow
  'Flurry': { day: 'linear-gradient(180deg, #6e8098 0%, #8498a8 45%, #9ab0c0 80%, #b0c4d0 100%)', night: 'linear-gradient(180deg, #121820 0%, #1c2430 50%, #242c38 100%)', sunrise: 'linear-gradient(180deg, #383e48 0%, #907868 40%, #a89080 70%, #c0a890 100%)', sunset: 'linear-gradient(180deg, #2a2038 0%, #685868 30%, #806860 55%, #988070 78%, #b09880 100%)', clouds: 0.5, snow: 'flurry' },
  'Flurry Night': { day: 'linear-gradient(180deg, #121820 0%, #1c2430 50%, #242c38 100%)', night: 'linear-gradient(180deg, #121820 0%, #1c2430 50%, #242c38 100%)', sunrise: 'linear-gradient(180deg, #383e48 0%, #907868 40%, #a89080 70%, #c0a890 100%)', sunset: 'linear-gradient(180deg, #2a2038 0%, #685868 30%, #806860 55%, #988070 78%, #b09880 100%)', clouds: 0.5, snow: 'flurry' },
  'Light Snow': { day: 'linear-gradient(180deg, #7888a0 0%, #8a9ab0 45%, #9eb0c0 80%, #b0c0ce 100%)', night: 'linear-gradient(180deg, #101820 0%, #1a2430 50%, #222c38 100%)', sunrise: 'linear-gradient(180deg, #3a4050 0%, #988878 40%, #b09888 70%, #c8b098 100%)', sunset: 'linear-gradient(180deg, #2c2240 0%, #706070 30%, #887068 55%, #a08878 78%, #b8a088 100%)', clouds: 0.6, snow: 'light' },
  'Light Snow Night': { day: 'linear-gradient(180deg, #101820 0%, #1a2430 50%, #222c38 100%)', night: 'linear-gradient(180deg, #101820 0%, #1a2430 50%, #222c38 100%)', sunrise: 'linear-gradient(180deg, #3a4050 0%, #988878 40%, #b09888 70%, #c8b098 100%)', sunset: 'linear-gradient(180deg, #2c2240 0%, #706070 30%, #887068 55%, #a08878 78%, #b8a088 100%)', clouds: 0.6, snow: 'light' },
  'Light Snow Cloud': { day: 'linear-gradient(180deg, #8898b0 0%, #9aaac0 45%, #aabace 80%, #b8c8d8 100%)', night: 'linear-gradient(180deg, #161e28 0%, #202a34 50%, #28323e 100%)', sunrise: 'linear-gradient(180deg, #3c4450 0%, #9a8880 40%, #b09888 70%, #c8b098 100%)', sunset: 'linear-gradient(180deg, #2e2440 0%, #726070 30%, #8a7268 55%, #a28878 78%, #b8a088 100%)', clouds: 0.8, snow: 'light' },
  'Snow': { day: 'linear-gradient(180deg, #8090a8 0%, #909eb8 45%, #a0b0c4 80%, #b0bed0 100%)', night: 'linear-gradient(180deg, #121a22 0%, #1c2630 50%, #242e38 100%)', sunrise: 'linear-gradient(180deg, #3e4658 0%, #9c9080 40%, #b4a090 70%, #c8b8a0 100%)', sunset: 'linear-gradient(180deg, #302448 0%, #746470 30%, #8c7470 55%, #a48878 78%, #b8a088 100%)', clouds: 0.7, snow: 'moderate' },
  'Snow Night': { day: 'linear-gradient(180deg, #121a22 0%, #1c2630 50%, #242e38 100%)', night: 'linear-gradient(180deg, #121a22 0%, #1c2630 50%, #242e38 100%)', sunrise: 'linear-gradient(180deg, #3e4658 0%, #9c9080 40%, #b4a090 70%, #c8b8a0 100%)', sunset: 'linear-gradient(180deg, #302448 0%, #746470 30%, #8c7470 55%, #a48878 78%, #b8a088 100%)', clouds: 0.7, snow: 'moderate' },
  'Snow Cloud': { day: 'linear-gradient(180deg, #909ab0 0%, #a0aac0 45%, #b0bace 80%, #c0c8d8 100%)', night: 'linear-gradient(180deg, #181e28 0%, #222c36 50%, #2c3440 100%)', sunrise: 'linear-gradient(180deg, #404858 0%, #9e9282 40%, #b6a492 70%, #caba9e 100%)', sunset: 'linear-gradient(180deg, #322648 0%, #766670 30%, #8e7670 55%, #a68878 78%, #baa088 100%)', clouds: 0.85, snow: 'moderate' },
  'Heavy Snow': { day: 'linear-gradient(180deg, #8898b0 0%, #9aa8c0 45%, #a8b8cc 80%, #b8c4d4 100%)', night: 'linear-gradient(180deg, #141c24 0%, #1e2830 50%, #283038 100%)', sunrise: 'linear-gradient(180deg, #404858 0%, #a09080 40%, #b8a090 70%, #ccb8a0 100%)', sunset: 'linear-gradient(180deg, #302448 0%, #786870 30%, #907870 55%, #a88c80 78%, #bcaa90 100%)', clouds: 0.9, snow: 'heavy' },
  'Heavy Snow Night': { day: 'linear-gradient(180deg, #141c24 0%, #1e2830 50%, #283038 100%)', night: 'linear-gradient(180deg, #141c24 0%, #1e2830 50%, #283038 100%)', sunrise: 'linear-gradient(180deg, #404858 0%, #a09080 40%, #b8a090 70%, #ccb8a0 100%)', sunset: 'linear-gradient(180deg, #302448 0%, #786870 30%, #907870 55%, #a88c80 78%, #bcaa90 100%)', clouds: 0.9, snow: 'heavy' },
  'Heavy Snow Cloud': { day: 'linear-gradient(180deg, #98a0b8 0%, #a8b0c4 45%, #b4bcd0 80%, #c4cce0 100%)', night: 'linear-gradient(180deg, #181e28 0%, #222a34 50%, #2c3440 100%)', sunrise: 'linear-gradient(180deg, #444c58 0%, #a29282 40%, #baa292 70%, #cebaa0 100%)', sunset: 'linear-gradient(180deg, #342848 0%, #7a6a70 30%, #927870 55%, #aa8e80 78%, #bea890 100%)', clouds: 1, snow: 'heavy' },
  'Blizzard': { day: 'linear-gradient(180deg, #707888 0%, #808890 45%, #909098 80%, #9898a0 100%)', night: 'linear-gradient(180deg, #0c1018 0%, #141820 50%, #1c2028 100%)', sunrise: 'linear-gradient(180deg, #303840 0%, #807060 40%, #988070 70%, #b09888 100%)', sunset: 'linear-gradient(180deg, #201a30 0%, #604858 30%, #785858 55%, #8c6858 78%, #a08068 100%)', clouds: 1, snow: 'blizzard', wind: true },
  'Blizzard Night': { day: 'linear-gradient(180deg, #0c1018 0%, #141820 50%, #1c2028 100%)', night: 'linear-gradient(180deg, #0c1018 0%, #141820 50%, #1c2028 100%)', sunrise: 'linear-gradient(180deg, #303840 0%, #807060 40%, #988070 70%, #b09888 100%)', sunset: 'linear-gradient(180deg, #201a30 0%, #604858 30%, #785858 55%, #8c6858 78%, #a08068 100%)', clouds: 1, snow: 'blizzard', wind: true },
  // Sleet
  'Light Sleet': { day: 'linear-gradient(180deg, #607080 0%, #708090 45%, #8090a0 80%, #90a0ae 100%)', night: 'linear-gradient(180deg, #0e1620 0%, #181e2c 50%, #202830 100%)', sunrise: 'linear-gradient(180deg, #2c3440 0%, #786860 40%, #909070 70%, #a89880 100%)', sunset: 'linear-gradient(180deg, #241820 0%, #605060 30%, #787060 55%, #8a7860 78%, #a09070 100%)', clouds: 0.75, snow: 'flurry', rain: 'light' },
  'Light Sleet Night': { day: 'linear-gradient(180deg, #0e1620 0%, #181e2c 50%, #202830 100%)', night: 'linear-gradient(180deg, #0e1620 0%, #181e2c 50%, #202830 100%)', sunrise: 'linear-gradient(180deg, #2c3440 0%, #786860 40%, #909070 70%, #a89880 100%)', sunset: 'linear-gradient(180deg, #241820 0%, #605060 30%, #787060 55%, #8a7860 78%, #a09070 100%)', clouds: 0.75, snow: 'flurry', rain: 'light' },
  'Light Sleet Cloud': { day: 'linear-gradient(180deg, #708090 0%, #8090a0 45%, #90a0b0 80%, #a0b0be 100%)', night: 'linear-gradient(180deg, #141e28 0%, #1e2830 50%, #283038 100%)', sunrise: 'linear-gradient(180deg, #303c48 0%, #7c7068 40%, #949278 70%, #acaa88 100%)', sunset: 'linear-gradient(180deg, #282030 0%, #645860 30%, #7c7062 55%, #8e7c62 78%, #a29272 100%)', clouds: 0.85, snow: 'flurry', rain: 'light' },
  'Sleet': { day: 'linear-gradient(180deg, #586070 0%, #687080 45%, #788090 80%, #888e9e 100%)', night: 'linear-gradient(180deg, #0c1418 0%, #141c24 50%, #1c242c 100%)', sunrise: 'linear-gradient(180deg, #283038 0%, #706258 40%, #888070 70%, #a09888 100%)', sunset: 'linear-gradient(180deg, #201620 0%, #584858 30%, #705858 55%, #887060 78%, #9c8870 100%)', clouds: 0.8, snow: 'flurry', rain: 'moderate' },
  'Sleet Night': { day: 'linear-gradient(180deg, #0c1418 0%, #141c24 50%, #1c242c 100%)', night: 'linear-gradient(180deg, #0c1418 0%, #141c24 50%, #1c242c 100%)', sunrise: 'linear-gradient(180deg, #283038 0%, #706258 40%, #888070 70%, #a09888 100%)', sunset: 'linear-gradient(180deg, #201620 0%, #584858 30%, #705858 55%, #887060 78%, #9c8870 100%)', clouds: 0.8, snow: 'flurry', rain: 'moderate' },
  'Sleet Cloud': { day: 'linear-gradient(180deg, #6a7888 0%, #788898 45%, #8898a8 80%, #9aa8b8 100%)', night: 'linear-gradient(180deg, #101820 0%, #1a2430 50%, #222c3a 100%)', sunrise: 'linear-gradient(180deg, #2c3440 0%, #726868 40%, #8a8272 70%, #a09a82 100%)', sunset: 'linear-gradient(180deg, #221828 0%, #5c4a5a 30%, #726060 55%, #887870 78%, #9e9080 100%)', clouds: 0.9, snow: 'flurry', rain: 'moderate' },
  'Heavy Sleet': { day: 'linear-gradient(180deg, #485668 0%, #586070 45%, #686e80 80%, #787e8e 100%)', night: 'linear-gradient(180deg, #0a1018 0%, #121820 50%, #1a1e28 100%)', sunrise: 'linear-gradient(180deg, #242c38 0%, #645e58 40%, #80786a 70%, #988e7a 100%)', sunset: 'linear-gradient(180deg, #1e1428 0%, #544858 30%, #686060 55%, #807862 78%, #969070 100%)', clouds: 0.95, snow: 'light', rain: 'heavy' },
  'Heavy Sleet Night': { day: 'linear-gradient(180deg, #0a1018 0%, #121820 50%, #1a1e28 100%)', night: 'linear-gradient(180deg, #0a1018 0%, #121820 50%, #1a1e28 100%)', sunrise: 'linear-gradient(180deg, #242c38 0%, #645e58 40%, #80786a 70%, #988e7a 100%)', sunset: 'linear-gradient(180deg, #1e1428 0%, #544858 30%, #686060 55%, #807862 78%, #969070 100%)', clouds: 0.95, snow: 'light', rain: 'heavy' },
  'Heavy Sleet Cloud': { day: 'linear-gradient(180deg, #58687a 0%, #687282 45%, #788086 80%, #888e96 100%)', night: 'linear-gradient(180deg, #0e1420 0%, #18202a 50%, #20282e 100%)', sunrise: 'linear-gradient(180deg, #282e3a 0%, #685e58 40%, #82786c 70%, #9a9078 100%)', sunset: 'linear-gradient(180deg, #201428 0%, #564858 30%, #6a6060 55%, #80786a 78%, #989070 100%)', clouds: 1, snow: 'light', rain: 'heavy' },
  // Hail
  'Light Hail': { day: 'linear-gradient(180deg, #5a7080 0%, #6a8090 45%, #7a90a0 80%, #8aa0ae 100%)', night: 'linear-gradient(180deg, #0e1620 0%, #181e2c 50%, #202830 100%)', sunrise: 'linear-gradient(180deg, #2c3440 0%, #746860 40%, #8c8270 70%, #a49a80 100%)', sunset: 'linear-gradient(180deg, #221828 0%, #5c5060 30%, #746860 55%, #8a7e60 78%, #9e9470 100%)', clouds: 0.7, hail: 'light' },
  'Light Hail Night': { day: 'linear-gradient(180deg, #0e1620 0%, #181e2c 50%, #202830 100%)', night: 'linear-gradient(180deg, #0e1620 0%, #181e2c 50%, #202830 100%)', sunrise: 'linear-gradient(180deg, #2c3440 0%, #746860 40%, #8c8270 70%, #a49a80 100%)', sunset: 'linear-gradient(180deg, #221828 0%, #5c5060 30%, #746860 55%, #8a7e60 78%, #9e9470 100%)', clouds: 0.7, hail: 'light' },
  'Light Hail Cloud': { day: 'linear-gradient(180deg, #6a8090 0%, #7a9098 45%, #8a9ea8 80%, #9aaab4 100%)', night: 'linear-gradient(180deg, #141e28 0%, #1e2830 50%, #283038 100%)', sunrise: 'linear-gradient(180deg, #303c48 0%, #7a7268 40%, #928c78 70%, #aca490 100%)', sunset: 'linear-gradient(180deg, #261828 0%, #605860 30%, #787268 55%, #8e8468 78%, #a29878 100%)', clouds: 0.85, hail: 'light' },
  'Hail': { day: 'linear-gradient(180deg, #485e70 0%, #586070 45%, #687080 80%, #787a88 100%)', night: 'linear-gradient(180deg, #0c1420 0%, #141e28 50%, #1c2630 100%)', sunrise: 'linear-gradient(180deg, #283040 0%, #6c6060 40%, #847872 70%, #9c9082 100%)', sunset: 'linear-gradient(180deg, #201828 0%, #584c58 30%, #706060 55%, #887868 78%, #9c9070 100%)', clouds: 0.85, hail: 'moderate' },
  'Hail Night': { day: 'linear-gradient(180deg, #0c1420 0%, #141e28 50%, #1c2630 100%)', night: 'linear-gradient(180deg, #0c1420 0%, #141e28 50%, #1c2630 100%)', sunrise: 'linear-gradient(180deg, #283040 0%, #6c6060 40%, #847872 70%, #9c9082 100%)', sunset: 'linear-gradient(180deg, #201828 0%, #584c58 30%, #706060 55%, #887868 78%, #9c9070 100%)', clouds: 0.85, hail: 'moderate' },
  'Hail Cloud': { day: 'linear-gradient(180deg, #586878 0%, #687280 45%, #788088 80%, #888a90 100%)', night: 'linear-gradient(180deg, #101820 0%, #181e28 50%, #202830 100%)', sunrise: 'linear-gradient(180deg, #2a3240 0%, #6e6460 40%, #867e72 70%, #9e9882 100%)', sunset: 'linear-gradient(180deg, #221828 0%, #5c5060 30%, #726060 55%, #887c68 78%, #9e9470 100%)', clouds: 0.9, hail: 'moderate' },
  'Heavy Hail': { day: 'linear-gradient(180deg, #384858 0%, #485060 45%, #565e6a 80%, #646870 100%)', night: 'linear-gradient(180deg, #080e18 0%, #101620 50%, #181e28 100%)', sunrise: 'linear-gradient(180deg, #202830 0%, #605458 40%, #786a68 70%, #908070 100%)', sunset: 'linear-gradient(180deg, #180e28 0%, #4e3a50 30%, #644848 55%, #7c6050 78%, #907868 100%)', clouds: 0.95, hail: 'heavy' },
  'Heavy Hail Night': { day: 'linear-gradient(180deg, #080e18 0%, #101620 50%, #181e28 100%)', night: 'linear-gradient(180deg, #080e18 0%, #101620 50%, #181e28 100%)', sunrise: 'linear-gradient(180deg, #202830 0%, #605458 40%, #786a68 70%, #908070 100%)', sunset: 'linear-gradient(180deg, #180e28 0%, #4e3a50 30%, #644848 55%, #7c6050 78%, #907868 100%)', clouds: 0.95, hail: 'heavy' },
  'Heavy Hail Cloud': { day: 'linear-gradient(180deg, #485868 0%, #586068 45%, #646870 80%, #727078 100%)', night: 'linear-gradient(180deg, #0c1020 0%, #141820 50%, #1c2028 100%)', sunrise: 'linear-gradient(180deg, #242c38 0%, #625858 40%, #7a6e6a 70%, #928270 100%)', sunset: 'linear-gradient(180deg, #1c1028 0%, #524050 30%, #664a4a 55%, #7e6252 78%, #928068 100%)', clouds: 1, hail: 'heavy' },
  // Thunder
  'Thundery Shower': { day: 'linear-gradient(180deg, #202a38 0%, #2c3848 45%, #384050 80%, #444858 100%)', night: 'linear-gradient(180deg, #060810 0%, #0c1018 50%, #10141c 100%)', sunrise: 'linear-gradient(180deg, #181e28 0%, #483830 40%, #584840 70%, #685850 100%)', sunset: 'linear-gradient(180deg, #100c20 0%, #3a2838 30%, #4c3038 55%, #5c3e38 78%, #704e40 100%)', clouds: 0.9, rain: 'shower', lightning: true },
  'Thundery Shower Night': { day: 'linear-gradient(180deg, #060810 0%, #0c1018 50%, #10141c 100%)', night: 'linear-gradient(180deg, #060810 0%, #0c1018 50%, #10141c 100%)', sunrise: 'linear-gradient(180deg, #181e28 0%, #483830 40%, #584840 70%, #685850 100%)', sunset: 'linear-gradient(180deg, #100c20 0%, #3a2838 30%, #4c3038 55%, #5c3e38 78%, #704e40 100%)', clouds: 0.9, rain: 'shower', lightning: true },
  'Thundery Shower Cloud': { day: 'linear-gradient(180deg, #282e3a 0%, #343a48 45%, #404858 80%, #4e5460 100%)', night: 'linear-gradient(180deg, #080c18 0%, #10141e 50%, #14181e 100%)', sunrise: 'linear-gradient(180deg, #1c2030 0%, #4c3c38 40%, #5c4c40 70%, #6c5c50 100%)', sunset: 'linear-gradient(180deg, #140a20 0%, #3e2c3c 30%, #4e3438 55%, #604040 78%, #724e44 100%)', clouds: 0.95, rain: 'moderate', lightning: true },
  'Isolated Thunderstorms': { day: 'linear-gradient(180deg, #1a2230 0%, #262e3c 45%, #32384a 80%, #3e4050 100%)', night: 'linear-gradient(180deg, #04060e 0%, #080c14 50%, #0c1018 100%)', sunrise: 'linear-gradient(180deg, #141a28 0%, #402e28 40%, #4e3c30 70%, #5e4c3e 100%)', sunset: 'linear-gradient(180deg, #0e0c1e 0%, #322234 30%, #402a30 55%, #503836 78%, #624840 100%)', clouds: 0.9, rain: 'moderate', lightning: true },
  'Scattered Thunderstorms': { day: 'linear-gradient(180deg, #141e2c 0%, #202830 45%, #2c3040 80%, #38383e 100%)', night: 'linear-gradient(180deg, #020408 0%, #060810 50%, #0a0e14 100%)', sunrise: 'linear-gradient(180deg, #10161e 0%, #382820 40%, #463430 70%, #584040 100%)', sunset: 'linear-gradient(180deg, #0c0a1a 0%, #2c1c28 30%, #38222a 55%, #482e2e 78%, #584038 100%)', clouds: 0.95, rain: 'heavy', lightning: true },
  'Thunderstorms': { day: 'linear-gradient(180deg, #10181e 0%, #1a2028 45%, #222830 80%, #2c2c34 100%)', night: 'linear-gradient(180deg, #020406 0%, #040608 50%, #080c10 100%)', sunrise: 'linear-gradient(180deg, #0e1218 0%, #302018 40%, #3c2c24 70%, #4c3c30 100%)', sunset: 'linear-gradient(180deg, #080618 0%, #24182c 30%, #30201e 55%, #3e2c28 78%, #4c3a30 100%)', clouds: 1, rain: 'torrential', lightning: true },
};

function getTimePhase(sunriseISO, sunsetISO) {
  if (!sunriseISO || !sunsetISO) return 'day';
  const now = Date.now();
  const rise = new Date(sunriseISO).getTime();
  const set = new Date(sunsetISO).getTime();
  const WINDOW = 45 * 60 * 1000;
  if (now >= rise - WINDOW && now < rise + WINDOW) return 'sunrise';
  if (now >= set - WINDOW && now < set + WINDOW) return 'sunset';
  if (now < rise || now >= set) return 'night';
  return 'day';
}

// ─── REALISTIC CLOUD LAYER ───────────────────────────────────────────────────
function CloudLayer({ coverage, phase, isDark }) {
  const clouds = useMemo(() => {
    const n = Math.round(coverage * 8 + 2);
    return Array.from({ length: n }, (_, i) => {
      const puffs = 3 + Math.floor(Math.random() * 4);
      const speed = 55 + Math.random() * 80;
      // Spread clouds across the full width initially so they don't all start from same side
      const initialFrac = Math.random(); // 0..1 position in the loop
      return {
        id: i,
        top: 3 + (i / n) * 42 + Math.random() * 8,
        speed,
        initialFrac,
        puffs: Array.from({ length: puffs }, (_, j) => ({
          ox: j * 55 + Math.random() * 25 - 10,
          oy: (Math.random() - 0.5) * 18,
          rx: 55 + Math.random() * 50,
          ry: 28 + Math.random() * 22,
          op: 0.55 + Math.random() * 0.35,
        })),
      };
    });
  }, [coverage]);  // only recompute when coverage changes, not on every render

  const cloudColor = isDark || phase === 'night'
    ? { r: 80, g: 95, b: 115 }
    : phase === 'sunrise'
    ? { r: 230, g: 195, b: 160 }
    : phase === 'sunset'
    ? { r: 210, g: 160, b: 120 }
    : { r: 245, g: 250, b: 255 };

  const { r, g, b } = cloudColor;
  const darken = coverage > 0.85;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {clouds.map(cloud => {
        // Start position: spread across screen, loop from left (-340px) to far right (110vw)
        const startVw = -25 + cloud.initialFrac * 130; // -25vw to 105vw
        const loopDuration = cloud.speed;
        // How far into the loop we already are based on initial position
        const elapsed = ((startVw + 25) / 140) * loopDuration;

        return (
          <motion.div
            key={cloud.id}
            className="absolute"
            style={{ top: `${cloud.top}%`, left: 0, height: 80, width: 340 }}
            initial={{ x: `${startVw}vw`, opacity: 0 }}
            animate={{ x: ['−25vw', '115vw'], opacity: 1 }}
            transition={{
              x: { duration: loopDuration, repeat: Infinity, ease: 'linear', delay: -elapsed },
              opacity: { duration: 1.2, ease: 'easeIn' },
            }}
          >
            <svg width="340" height="80" viewBox="0 0 340 80" style={{ overflow: 'visible' }}>
              {darken && cloud.puffs.map((p, j) => (
                <ellipse key={`s${j}`} cx={p.ox} cy={p.oy + 66} rx={p.rx * 0.85} ry={6} fill="rgba(0,0,0,0.1)" />
              ))}
              {cloud.puffs.map((p, j) => (
                <ellipse
                  key={j}
                  cx={p.ox} cy={p.oy + 42}
                  rx={p.rx} ry={p.ry}
                  fill={`rgba(${r},${g},${b},${p.op * (darken ? 1.1 : 1)})`}
                />
              ))}
              {cloud.puffs.map((p, j) => (
                <ellipse
                  key={`h${j}`}
                  cx={p.ox - p.rx * 0.15} cy={p.oy + 42 - p.ry * 0.35}
                  rx={p.rx * 0.5} ry={p.ry * 0.42}
                  fill={`rgba(${Math.min(r + 22, 255)},${Math.min(g + 22, 255)},${Math.min(b + 22, 255)},${p.op * 0.3})`}
                />
              ))}
            </svg>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── STAR FIELD ──────────────────────────────────────────────────────────────
function renderStars(canvas, count = 130) {
  const ctx = canvas.getContext('2d');
  const stars = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height * 0.65,
    r: 0.3 + Math.random() * 1.2,
    brightness: 0.4 + Math.random() * 0.6,
    phase: Math.random() * Math.PI * 2,
    speed: 0.004 + Math.random() * 0.01,
  }));
  let animId, t = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    t += 0.016;
    stars.forEach(s => {
      const a = s.brightness * (0.65 + 0.35 * Math.sin(t * s.speed + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,248,230,${a})`;
      ctx.fill();
    });
    animId = requestAnimationFrame(draw);
  }
  draw();
  return () => cancelAnimationFrame(animId);
}

// ─── LIGHTNING BOLT on CANVAS ────────────────────────────────────────────────
function drawLightningBolt(ctx, x1, y1, x2, y2, branches, color) {
  if (branches <= 0) return;
  const dx = x2 - x1, dy = y2 - y1;
  const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * Math.abs(dy) * 0.6;
  const my = (y1 + y2) / 2 + (Math.random() - 0.5) * Math.abs(dx) * 0.2;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(mx, my);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = branches * 0.8;
  ctx.stroke();

  if (Math.random() > 0.5 && branches > 1) {
    const bx = mx + (Math.random() - 0.3) * 80;
    const by = my + Math.random() * 60;
    drawLightningBolt(ctx, mx, my, bx, by, branches - 1, `rgba(180,200,255,0.5)`);
  }
  drawLightningBolt(ctx, mx, my, x2, y2, branches - 1, color);
}

function useLightningStrikes(active, canvasRef) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!active) return;
    let t;
    function schedule() {
      const delay = 3000 + Math.random() * 9000;
      t = setTimeout(() => {
        // Draw bolt on canvas
        const canvas = canvasRef?.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          const W = canvas.width, H = canvas.height;
          const sx = 0.1 * W + Math.random() * 0.8 * W;
          ctx.clearRect(0, 0, W, H);
          ctx.shadowBlur = 12;
          ctx.shadowColor = 'rgba(180,210,255,0.9)';
          drawLightningBolt(ctx, sx, 0, sx + (Math.random() - 0.5) * 120, H * (0.5 + Math.random() * 0.4), 4, 'rgba(220,235,255,0.95)');
          ctx.shadowBlur = 0;
        }
        setFlash(true);
        setTimeout(() => {
          setFlash(false);
          if (canvasRef?.current) {
            const ctx = canvasRef.current.getContext('2d');
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          }
          // occasional double-flash
          if (Math.random() > 0.55) {
            setTimeout(() => {
              setFlash(true);
              setTimeout(() => setFlash(false), 70);
            }, 120);
          }
        }, 100);
        schedule();
      }, delay);
    }
    schedule();
    return () => clearTimeout(t);
  }, [active]);
  return flash;
}

// ─── SUN / MOON DISC ─────────────────────────────────────────────────────────
function CelestialBody({ phase, sunriseISO, sunsetISO }) {
  const isNight = phase === 'night';
  const isSunrise = phase === 'sunrise';
  const isSunset = phase === 'sunset';

  const now = Date.now();
  const rise = sunriseISO ? new Date(sunriseISO).getTime() : now - 6 * 3600000;
  const set = sunsetISO ? new Date(sunsetISO).getTime() : now + 6 * 3600000;
  const elapsed = Math.max(0, Math.min(1, (now - rise) / (set - rise)));
  const angle = elapsed * Math.PI;
  const bodyLeft = `${10 + elapsed * 80}%`;
  const bodyTop = isNight ? '7%' : `${52 - Math.sin(angle) * 44}%`;

  if (isNight) {
    return (
      <div className="absolute pointer-events-none" style={{ left: '13%', top: '7%' }}>
        <div className="relative w-11 h-11">
          <div className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle at 38% 38%, #e8f0f8 0%, #b0c8e0 55%, #7a9ab8 100%)', boxShadow: '0 0 18px 6px rgba(160,200,240,0.18), 0 0 40px 10px rgba(120,170,220,0.08)' }} />
          {/* crater detail */}
          <div className="absolute rounded-full" style={{ width: '28%', height: '28%', top: '20%', left: '55%', background: 'rgba(80,110,140,0.35)' }} />
          <div className="absolute rounded-full" style={{ width: '18%', height: '18%', top: '55%', left: '25%', background: 'rgba(80,110,140,0.25)' }} />
          {/* shadow bite */}
          <div className="absolute rounded-full" style={{ width: '72%', height: '72%', top: '-4%', left: '22%', background: 'rgba(8,20,40,0.88)' }} />
        </div>
      </div>
    );
  }

  const glowColor = isSunrise ? 'rgba(255,175,70,0.45)' : isSunset ? 'rgba(255,110,40,0.45)' : 'rgba(255,230,120,0.35)';
  const discGrad = isSunrise
    ? 'radial-gradient(circle at 40% 40%, #fffbe8 0%, #ffe070 45%, #f4a030 100%)'
    : isSunset
    ? 'radial-gradient(circle at 40% 40%, #fff5d0 0%, #ff9030 45%, #e84020 100%)'
    : 'radial-gradient(circle at 38% 35%, #fffef0 0%, #ffe878 45%, #f5c020 100%)';

  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{ left: bodyLeft, top: bodyTop, transform: 'translate(-50%,-50%)' }}
      animate={{ opacity: [0.85, 1, 0.85] }}
      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
    >
      <div className="relative" style={{ width: 48, height: 48 }}>
        {/* outer corona */}
        <div className="absolute inset-0 rounded-full" style={{ background: glowColor, filter: 'blur(22px)', transform: 'scale(3.2)' }} />
        {/* rays (day only) */}
        {!isSunrise && !isSunset && (
          <div className="absolute inset-0 rounded-full" style={{ background: 'rgba(255,230,100,0.12)', filter: 'blur(8px)', transform: 'scale(2)' }} />
        )}
        {/* disc */}
        <div className="absolute inset-0 rounded-full" style={{ background: discGrad, boxShadow: `0 0 28px 8px ${glowColor}` }} />
      </div>
    </motion.div>
  );
}

// ─── WIND STREAKS (windy + blizzard) ─────────────────────────────────────────
function WindStreaks({ intensity = 1 }) {
  const [streaks, setStreaks] = useState([]);

  useEffect(() => {
    function spawn() {
      const id = Math.random();
      const y = Math.random() * 85 + 5;
      const len = 80 + Math.random() * 180;
      const speed = 0.5 + Math.random() * 0.6;
      const op = 0.08 + Math.random() * 0.14 * intensity;
      const delay = Math.random() * 3000;
      setTimeout(() => {
        setStreaks(s => [...s.slice(-12), { id, y, len, op, speed }]);
        setTimeout(() => setStreaks(s => s.filter(x => x.id !== id)), speed * 2200);
      }, delay);
    }
    const interval = setInterval(spawn, 600 / intensity);
    return () => clearInterval(interval);
  }, [intensity]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {streaks.map(s => (
        <motion.div
          key={s.id}
          className="absolute"
          style={{ top: `${s.y}%`, left: '-10%', height: 1.5, width: s.len, background: `rgba(200,220,255,${s.op})`, borderRadius: 2 }}
          initial={{ x: '-5vw', opacity: 0 }}
          animate={{ x: '120vw', opacity: [0, s.op, 0] }}
          transition={{ duration: s.speed * 2, ease: 'easeIn' }}
        />
      ))}
    </div>
  );
}

// ─── PARTICLE SYSTEM (canvas) ─────────────────────────────────────────────────
function createParticleSystem(canvas, type, windDeg, intensity) {
  const ctx = canvas.getContext('2d');
  let animId;
  const W = canvas.width, H = canvas.height;
  const windAngle = ((windDeg ?? 180) * Math.PI) / 180;
  const windX = Math.sin(windAngle) * (intensity === 'heavy' ? 2.5 : intensity === 'moderate' ? 1.5 : 0.7);

  // Blizzard: random wind angle shifts
  let blizzardAngle = windX;
  let blizzardTarget = windX;
  let blizzardTimer = 0;

  function mkParticle(initSpread = false) {
    const base = {
      x: Math.random() * W,
      y: initSpread ? Math.random() * H : -8,
      opacity: 0.3 + Math.random() * 0.55,
    };

    if (type === 'rain' || type === 'drizzle' || type === 'shower' || type === 'torrential') {
      const speed = type === 'torrential' ? 15 + Math.random() * 5
        : type === 'heavy' ? 11 + Math.random() * 4
        : type === 'moderate' ? 8 + Math.random() * 3
        : type === 'drizzle' ? 3 + Math.random() * 2
        : 6 + Math.random() * 3;
      const len = type === 'torrential' ? 22 : type === 'heavy' ? 17 : type === 'drizzle' ? 6 : 11;
      return { ...base, vy: speed, vx: windX * 0.5, len, depth: 0.35 + Math.random() * 0.65 };
    }

    if (type === 'blizzard') {
      const r = 1.2 + Math.random() * 2.5;
      return { ...base, r, vy: 1.5 + Math.random() * 2.5, vx: blizzardAngle, depth: 0.4 + Math.random() * 0.6, phase: Math.random() * Math.PI * 2 };
    }

    if (type === 'snow' || type === 'flurry') {
      const r = type === 'flurry' ? 1 + Math.random() * 1.8 : 1.2 + Math.random() * 2.5;
      return { ...base, r, vy: 0.4 + Math.random() * 1.4, vx: (Math.random() - 0.5) * 0.4, depth: 0.3 + Math.random() * 0.7, phase: Math.random() * Math.PI * 2 };
    }

    if (type === 'hail') {
      return { ...base, r: 2 + Math.random() * 3, vy: 9 + Math.random() * 5, vx: windX * 0.3 };
    }

    if (type === 'fog') {
      return { x: Math.random() * W, y: Math.random() * H, vy: 0.04 + Math.random() * 0.08, vx: 0.08 + Math.random() * 0.18, w: 90 + Math.random() * 180, opacity: 0.025 + Math.random() * 0.055 };
    }

    return base;
  }

  const count = type === 'fog' ? 14 : type === 'torrential' ? 260 : type === 'blizzard' ? 220
    : type === 'heavy' ? 190 : type === 'moderate' ? 125 : type === 'light' ? 75
    : type === 'drizzle' ? 65 : type === 'flurry' ? 45 : type === 'snow' ? 85
    : type === 'shower' ? 95 : type === 'hail' ? 55 : 65;

  const particles = Array.from({ length: count }, () => mkParticle(true));

  let t = 0;
  function draw() {
    ctx.clearRect(0, 0, W, H);
    t += 0.016;

    // blizzard wind shift
    if (type === 'blizzard') {
      blizzardTimer += 0.016;
      if (blizzardTimer > 3 + Math.random() * 4) {
        blizzardTarget = (Math.random() - 0.3) * 3.5;
        blizzardTimer = 0;
      }
      blizzardAngle += (blizzardTarget - blizzardAngle) * 0.01;
    }

    for (const p of particles) {
      if (type === 'fog') {
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.w);
        grd.addColorStop(0, `rgba(255,255,255,${p.opacity})`);
        grd.addColorStop(1, `rgba(255,255,255,0)`);
        ctx.fillStyle = grd;
        ctx.fillRect(p.x - p.w, p.y - p.w * 0.5, p.w * 2, p.w);
        p.x += p.vx; p.y += p.vy;
        if (p.x > W + p.w) p.x = -p.w;
        if (p.y > H + p.w) p.y = -p.w;
        continue;
      }

      if (type === 'blizzard') {
        p.vx += (blizzardAngle - p.vx) * 0.005;
        p.x += p.vx + Math.sin(t * 0.7 + p.phase) * 0.35;
        p.y += p.vy;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * p.depth, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(225,238,255,${p.opacity * p.depth})`;
        ctx.fill();
        if (p.y > H + 5 || p.x < -10 || p.x > W + 10) Object.assign(p, mkParticle());
        continue;
      }

      if (type === 'snow' || type === 'flurry') {
        p.x += p.vx + Math.sin(t * 0.5 + p.phase) * 0.35;
        p.y += p.vy;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * p.depth, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(220,236,255,${p.opacity * p.depth})`;
        ctx.fill();
        if (p.y > H + 5) Object.assign(p, mkParticle());
        continue;
      }

      if (type === 'hail') {
        p.x += p.vx; p.y += p.vy;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(210,235,255,${p.opacity})`;
        ctx.strokeStyle = `rgba(160,210,245,${p.opacity * 0.7})`;
        ctx.lineWidth = 0.8; ctx.fill(); ctx.stroke();
        if (p.y > H + 10) Object.assign(p, mkParticle());
        continue;
      }

      // Rain streaks
      p.x += p.vx; p.y += p.vy;
      const alpha = p.opacity * p.depth;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - (p.vx / p.vy) * p.len, p.y - p.len);
      ctx.strokeStyle = type === 'drizzle'
        ? `rgba(185,215,245,${alpha * 0.5})`
        : type === 'torrential'
        ? `rgba(100,145,205,${alpha * 0.85})`
        : `rgba(145,185,235,${alpha * 0.72})`;
      ctx.lineWidth = type === 'drizzle' ? 0.7 * p.depth : type === 'torrential' ? 2 * p.depth : 1.4 * p.depth;
      ctx.stroke();
      if (p.y > H + 20) Object.assign(p, mkParticle());
    }

    animId = requestAnimationFrame(draw);
  }
  draw();
  return () => cancelAnimationFrame(animId);
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function WeatherAtmosphere({ condition, windDeg, windSpeed, sunrise, sunset, soundEnabled, onSoundToggle, reducedMotion }) {
  const canvasRef = useRef(null);
  const starsCanvasRef = useRef(null);
  const lightningCanvasRef = useRef(null);

  const resolvedCondition = SKY_CONFIGS[condition]
    ? condition
    : SKY_CONFIGS[condition?.replace(' Night', '')]
    ? condition.replace(' Night', '')
    : 'Cloudy';
  const config = SKY_CONFIGS[resolvedCondition];
  const phase = getTimePhase(sunrise, sunset);
  const isNight = phase === 'night';

  const gradient = config[phase] || config.day;

  const cloudTint = phase === 'sunrise' ? 'rgba(255,180,100,0.22)' : phase === 'sunset' ? 'rgba(255,120,60,0.22)' : null;

  // Particle type
  const particleType = config.rain
    || (config.snow ? (config.snow === 'blizzard' ? 'blizzard' : config.snow === 'heavy' ? 'snow' : config.snow === 'moderate' ? 'snow' : 'flurry') : null)
    || (config.hail ? config.hail : null)
    || (config.fog ? 'fog' : null);

  // Lightning with real bolt canvas
  const lightningFlash = useLightningStrikes(!reducedMotion && !!config.lightning, lightningCanvasRef);

  // Stars canvas
  useEffect(() => {
    const canvas = starsCanvasRef.current;
    if (!canvas || !isNight) return;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    return renderStars(canvas, 140);
  }, [isNight, condition]);

  // Particle canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !particleType || reducedMotion) return;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const intensity = config.rain || config.snow || config.hail || 'light';
    return createParticleSystem(canvas, particleType, windDeg, intensity);
  }, [particleType, condition, windDeg, reducedMotion]);

  // Lightning canvas resize
  useEffect(() => {
    const canvas = lightningCanvasRef.current;
    if (!canvas) return;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }, [condition]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
      {/* Sky gradient */}
      <AnimatePresence mode="wait">
        <motion.div
          key={gradient}
          className="absolute inset-0"
          style={{ background: gradient }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: 'easeInOut' }}
        />
      </AnimatePresence>

      {/* Atmospheric depth haze */}
      <div className="absolute inset-x-0 bottom-0 h-1/3" style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.18) 0%, transparent 100%)' }} />

      {/* Stars (night, low cloud) */}
      {isNight && config.clouds < 0.75 && (
        <canvas ref={starsCanvasRef} className="absolute inset-0 w-full h-full opacity-90" />
      )}

      {/* Celestial body (sun / moon) - only for flagged conditions */}
      {config.celestial && (
        <CelestialBody phase={phase} sunriseISO={sunrise} sunsetISO={sunset} />
      )}

      {/* Cloud layers - all conditions with clouds > 0 */}
      {config.clouds > 0 && !reducedMotion && (
        <CloudLayer coverage={config.clouds} phase={phase} isDark={isNight} tintColor={cloudTint} />
      )}

      {/* Fog overlay */}
      {config.fog && (
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(200,215,225,0.12) 0%, rgba(200,215,225,0.3) 50%, rgba(200,215,225,0.15) 100%)', backdropFilter: 'blur(2px)' }} />
      )}

      {/* Wind streaks (windy or blizzard) */}
      {(config.wind || config.snow === 'blizzard') && !reducedMotion && (
        <WindStreaks intensity={config.snow === 'blizzard' ? 2.5 : 1.2} />
      )}

      {/* Particles */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ opacity: reducedMotion ? 0 : 1 }} />

      {/* Lightning bolt canvas */}
      {config.lightning && (
        <canvas ref={lightningCanvasRef} className="absolute inset-0 w-full h-full" style={{ opacity: reducedMotion ? 0 : 1 }} />
      )}

      {/* Lightning screen flash */}
      <AnimatePresence>
        {lightningFlash && (
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(210,225,255,0.22)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.04 }}
          />
        )}
      </AnimatePresence>

      {/* Sunrise/Sunset horizon glow */}
      {(phase === 'sunrise' || phase === 'sunset') && (
        <motion.div
          className="absolute inset-x-0 bottom-0"
          style={{
            height: '40%',
            background: phase === 'sunrise'
              ? 'linear-gradient(0deg, rgba(255,160,60,0.3) 0%, rgba(255,200,100,0.1) 60%, transparent 100%)'
              : 'linear-gradient(0deg, rgba(255,80,20,0.38) 0%, rgba(200,80,120,0.12) 60%, transparent 100%)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 2 }}
        />
      )}

      {/* Sound toggle */}
      <div className="absolute top-4 right-16 pointer-events-auto z-10">
        <button
          onClick={onSoundToggle}
          className="w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-sm transition-all"
          style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.15)' }}
          title={soundEnabled ? 'Mute weather sounds' : 'Enable weather sounds'}
        >
          {soundEnabled ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
          )}
        </button>
      </div>
    </div>
  );
}