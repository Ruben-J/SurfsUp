import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { longSwellEstimate } from "../long-swell.js";

const RWS_URL =
  "https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen";
const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const OUTPUT = resolve(process.argv[2] || "data/latest.json");

const BUOYS = [
  { id: "e13", code: "eurogeul.e13", name: "Eurogeul E13", lat: 52.009184, lon: 3.741804 },
  { id: "europlatform", code: "europlatform", name: "Europlatform", lat: 51.99781, lon: 3.275071 },
  { id: "j6", code: "j6", name: "J6", lat: 53.816632, lon: 2.95001 },
];

const RWS_PARAMETERS = {
  maxWaveHeight: { code: "Hmax", unit: "m", factor: 0.01 },
  significantWaveHeight: { code: "Hm0", unit: "m", factor: 0.01 },
  wavePeriod: { code: "Tm02", unit: "s", factor: 1 },
  waveDirection: { code: "Th0", unit: "°", factor: 1 },
  swellHeight: { code: "HTE3", unit: "m", factor: 0.01 },
  swellDirection: { code: "Th3", unit: "°", factor: 1 },
};

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function fetchJson(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { Accept: "application/json", ...(options.headers || {}) },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      if (response.status === 204) return { Succesvol: true, WaarnemingenLijst: [] };
      const json = await response.json();
      if (json.error || json.Succesvol === false) {
        throw new Error(json.reason || json.MeldingenLijst?.[0]?.Omschrijving || "Onbekende API-fout");
      }
      return json;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 750);
    }
  }
  throw lastError;
}

function validMeasurement(item) {
  const value = item?.Meetwaarde?.Waarde_Numeriek;
  const quality = item?.WaarnemingMetadata?.Kwaliteitswaardecode;
  return Number.isFinite(value) && Math.abs(value) < 999_999 && quality !== "99";
}

async function fetchRwsSeries(locationCode, parameterCode, start, end, processType = "meting") {
  const body = {
    Locatie: { Code: locationCode },
    AquoPlusWaarnemingMetadata: {
      AquoMetadata: { Grootheid: { Code: parameterCode }, ProcesType: processType },
    },
    Periode: { Begindatumtijd: start.toISOString(), Einddatumtijd: end.toISOString() },
  };
  const json = await fetchJson(RWS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const observation = json.WaarnemingenLijst?.[0];
  const unit = observation?.AquoMetadata?.Eenheid?.Code || null;
  return {
    unit,
    values: (observation?.MetingenLijst || [])
      .filter(validMeasurement)
      .map((item) => ({
        time: new Date(item.Tijdstip).toISOString(),
        value: item.Meetwaarde.Waarde_Numeriek,
        quality: item.WaarnemingMetadata?.Kwaliteitswaardecode || null,
      }))
      .sort((a, b) => a.time.localeCompare(b.time)),
  };
}

function latest(series, config) {
  const item = series.values.at(-1);
  if (!item) return { value: null, unit: config.unit, observedAt: null, source: "Rijkswaterstaat" };
  return {
    value: Number((item.value * config.factor).toFixed(config.unit === "m" ? 2 : 1)),
    unit: config.unit,
    observedAt: item.time,
    source: "Rijkswaterstaat",
  };
}

function localHourKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:00`;
}

async function fetchMarine(buoy) {
  const params = new URLSearchParams({
    latitude: String(buoy.lat),
    longitude: String(buoy.lon),
    hourly: [
      "wave_height",
      "wave_direction",
      "wave_period",
      "swell_wave_height",
      "swell_wave_direction",
      "swell_wave_period",
      "secondary_swell_wave_height",
      "secondary_swell_wave_direction",
      "secondary_swell_wave_period",
      "tertiary_swell_wave_height",
      "tertiary_swell_wave_direction",
      "tertiary_swell_wave_period",
      "sea_surface_temperature",
    ].join(","),
    timezone: "Europe/Amsterdam",
    past_days: "1",
    forecast_days: "4",
  });
  return fetchJson(`${MARINE_URL}?${params}`);
}

function marinePoint(json, index) {
  if (index < 0) return null;
  const hourly = json.hourly;
  const longSwell = longSwellEstimate(hourly, index);
  return {
    time: hourly.time[index],
    waveHeight: hourly.wave_height[index],
    waveDirection: hourly.wave_direction[index],
    wavePeriod: hourly.wave_period[index],
    swellHeight: longSwell.height,
    swellDirection: longSwell.direction,
    swellPeriod: longSwell.period,
    seaTemperature: hourly.sea_surface_temperature[index],
  };
}

function compactRwsHistory(series) {
  const byHour = new Map();
  for (const item of series.values) {
    const key = item.time.slice(0, 13);
    byHour.set(key, { time: item.time, value: Number((item.value * 0.01).toFixed(2)) });
  }
  return [...byHour.values()].slice(-25);
}

async function fetchBuoy(buoy, start, end) {
  const metricEntries = [];
  for (const [key, config] of Object.entries(RWS_PARAMETERS)) {
    try {
      metricEntries.push([key, await fetchRwsSeries(buoy.code, config.code, start, end)]);
    } catch (error) {
      console.warn(`${buoy.name} ${config.code}: ${error.message}`);
      metricEntries.push([key, { values: [], unit: null }]);
    }
    await sleep(100);
  }
  const rws = Object.fromEntries(metricEntries);
  const marine = await fetchMarine(buoy);
  const currentIndex = Math.max(0, marine.hourly.time.indexOf(localHourKey()));
  const marineNow = marinePoint(marine, currentIndex);
  const forecast = marine.hourly.time
    .map((_, index) => marinePoint(marine, index))
    .filter((point) => point.time >= localHourKey())
    .slice(0, 73);

  const metrics = Object.fromEntries(
    Object.entries(RWS_PARAMETERS).map(([key, config]) => [key, latest(rws[key], config)]),
  );
  const modelFallbacks = {
    significantWaveHeight: [marineNow?.waveHeight, "m"],
    wavePeriod: [marineNow?.wavePeriod, "s"],
    waveDirection: [marineNow?.waveDirection, "°"],
    swellHeight: [marineNow?.swellHeight, "m"],
    swellDirection: [marineNow?.swellDirection, "°"],
  };
  for (const [key, [value, unit]] of Object.entries(modelFallbacks)) {
    if (metrics[key].value == null && Number.isFinite(value)) {
      metrics[key] = {
        value,
        unit,
        observedAt: marineNow.time,
        source: key.startsWith("swell")
          ? "Open-Meteo model, lange-deiningschatting"
          : "Open-Meteo model",
      };
    }
  }
  metrics.swellPeriod = {
    value: marineNow?.swellPeriod ?? null,
    unit: "s",
    observedAt: marineNow?.time ?? null,
    source: "Open-Meteo model, lange-deiningschatting",
  };

  const observedTimes = Object.values(metrics).map((metric) => metric.observedAt).filter(Boolean);
  return {
    id: buoy.id,
    code: buoy.code,
    name: buoy.name,
    coordinates: { lat: buoy.lat, lon: buoy.lon },
    observedAt: observedTimes.sort().at(-1) || null,
    metrics,
    history: compactRwsHistory(rws.significantWaveHeight),
    forecast,
  };
}

async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    hourly: "temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    daily: "sunrise,sunset",
    timezone: "Europe/Amsterdam",
    past_days: "2",
    forecast_days: "4",
  });
  return fetchJson(`${WEATHER_URL}?${params}`);
}

function findExtrema(values) {
  const extrema = [];
  const radius = 18;
  for (let index = radius; index < values.length - radius; index += 1) {
    const window = values.slice(index - radius, index + radius + 1).map((item) => item.value);
    const current = values[index].value;
    const max = Math.max(...window);
    const min = Math.min(...window);
    if (current !== max && current !== min) continue;
    const type = current === max ? "high" : "low";
    const previous = extrema.at(-1);
    if (previous?.type === type) {
      if ((type === "high" && current > previous.value) || (type === "low" && current < previous.value)) {
        extrema[extrema.length - 1] = { ...values[index], type };
      }
    } else {
      extrema.push({ ...values[index], type });
    }
  }
  return extrema;
}

function amsterdamDateKey(iso) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function tideCoefficient(extrema, todayKey) {
  const daily = new Map();
  for (const item of extrema) {
    const key = amsterdamDateKey(item.time);
    const bucket = daily.get(key) || { highs: [], lows: [] };
    bucket[item.type === "high" ? "highs" : "lows"].push(item.value);
    daily.set(key, bucket);
  }
  const ranges = [...daily.entries()]
    .map(([key, item]) => {
      if (!item.highs.length || !item.lows.length) return null;
      return { key, range: Math.max(...item.highs) - Math.min(...item.lows) };
    })
    .filter(Boolean);
  const target = ranges.find((item) => item.key === todayKey)?.range;
  if (!Number.isFinite(target) || ranges.length < 3) return null;
  const min = Math.min(...ranges.map((item) => item.range));
  const max = Math.max(...ranges.map((item) => item.range));
  return Math.round(20 + (100 * (target - min)) / Math.max(1, max - min));
}

async function fetchTides(now) {
  const start = new Date(now.getTime() - 16 * 86_400_000);
  const end = new Date(now.getTime() + 17 * 86_400_000);
  const series = await fetchRwsSeries("hoekvanholland", "WATHTE", start, end, "astronomisch");
  const extrema = findExtrema(series.values);
  const next = extrema.filter((item) => new Date(item.time) >= now).slice(0, 6);
  return {
    station: "Hoek van Holland",
    note: "Dichtstbijzijnde officiële getijlocatie voor Maasvlakte",
    next,
    coefficient: tideCoefficient(extrema, amsterdamDateKey(now.toISOString())),
    coefficientMethod: "Relatieve astronomische getijslag (20–120) binnen een maancyclus",
    source: "Rijkswaterstaat",
  };
}

function moonPhase(date) {
  const synodicMonth = 29.53058867;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - knownNewMoon) / 86_400_000;
  const fraction = ((days / synodicMonth) % 1 + 1) % 1;
  const illumination = Math.round(((1 - Math.cos(2 * Math.PI * fraction)) / 2) * 100);
  const phases = [
    [0.03, "Nieuwe maan"],
    [0.22, "Wassende sikkel"],
    [0.28, "Eerste kwartier"],
    [0.47, "Wassende maan"],
    [0.53, "Volle maan"],
    [0.72, "Afnemende maan"],
    [0.78, "Laatste kwartier"],
    [0.97, "Afnemende sikkel"],
    [1, "Nieuwe maan"],
  ];
  return {
    phase: fraction,
    name: phases.find(([limit]) => fraction <= limit)[1],
    illumination,
    ageDays: Number((fraction * synodicMonth).toFixed(1)),
  };
}

function buildMaasvlakte(weather, seaTemperatureSeries, tides) {
  const seaMeasurement = seaTemperatureSeries.values.at(-1);
  return {
    coordinates: { lat: 51.926613, lon: 3.978392 },
    observedAt: weather.current.time,
    airTemperature: weather.current.temperature_2m,
    seaTemperature: seaMeasurement?.value ?? null,
    seaTemperatureObservedAt: seaMeasurement?.time ?? null,
    windSpeed: weather.current.wind_speed_10m,
    windGust: weather.current.wind_gusts_10m,
    windDirection: weather.current.wind_direction_10m,
    weatherForecast: weather.hourly.time.map((time, hourlyIndex) => ({
      time,
      airTemperature: weather.hourly.temperature_2m[hourlyIndex],
      windSpeed: weather.hourly.wind_speed_10m[hourlyIndex],
      windGust: weather.hourly.wind_gusts_10m[hourlyIndex],
      windDirection: weather.hourly.wind_direction_10m[hourlyIndex],
    })),
    daylight: weather.daily.time.map((date, dayIndex) => ({
      date,
      sunrise: weather.daily.sunrise[dayIndex],
      sunset: weather.daily.sunset[dayIndex],
    })),
    tides,
    sources: { weather: "Open-Meteo", seaTemperature: "Rijkswaterstaat, Hoek van Holland" },
  };
}

async function main() {
  const now = new Date();
  const rwsStart = new Date(now.getTime() - 30 * 3_600_000);
  const auxiliary = Promise.all([
    fetchWeather(51.926613, 3.978392),
    fetchTides(now),
    fetchRwsSeries("hoekvanholland", "T", rwsStart, now, "meting"),
  ]);
  const buoys = [];
  for (const buoy of BUOYS) buoys.push(await fetchBuoy(buoy, rwsStart, now));
  const [weather, tides, seaTemperatureSeries] = await auxiliary;
  const payload = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    timezone: "Europe/Amsterdam",
    buoys,
    maasvlakte: buildMaasvlakte(weather, seaTemperatureSeries, tides),
    moon: moonPhase(now),
    disclaimer: "Surfadvies is een indicatie, geen veiligheidsadvies. Controleer altijd de lokale omstandigheden.",
  };
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Surfdata opgeslagen in ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
