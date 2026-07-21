import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const RWS_URL =
  "https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const OUTPUT = resolve(process.argv[2] || "data/history.json");
const RANGE_DAYS = 31;

const BUOYS = [
  { id: "e13", code: "eurogeul.e13", name: "Eurogeul E13" },
  { id: "europlatform", code: "europlatform", name: "Europlatform" },
  { id: "j6", code: "j6", name: "J6" },
];

const PARAMETERS = {
  waveHeight: { code: "Hm0", factor: 0.01 },
  wavePeriod: { code: "Tm02", factor: 1 },
  waveDirection: { code: "Th0", factor: 1 },
  swellHeight: { code: "HTE3", factor: 0.01 },
};

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function fetchJson(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { Accept: "application/json", ...(options.headers || {}) },
        signal: AbortSignal.timeout(45_000),
      });
      if (response.status === 204) return { Succesvol: true, WaarnemingenLijst: [] };
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const json = await response.json();
      if (json.error || json.Succesvol === false) {
        throw new Error(json.reason || json.MeldingenLijst?.[0]?.Omschrijving || "Onbekende API-fout");
      }
      return json;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 900);
    }
  }
  throw lastError;
}

async function fetchRwsSeries(locationCode, parameterCode, start, end) {
  const body = {
    Locatie: { Code: locationCode },
    AquoPlusWaarnemingMetadata: {
      AquoMetadata: {
        Compartiment: { Code: "OW" },
        Grootheid: { Code: parameterCode },
        ProcesType: "meting",
      },
    },
    Periode: { Begindatumtijd: start.toISOString(), Einddatumtijd: end.toISOString() },
  };
  const json = await fetchJson(RWS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (json.WaarnemingenLijst?.[0]?.MetingenLijst || [])
    .filter((item) => {
      const value = item?.Meetwaarde?.Waarde_Numeriek;
      return Number.isFinite(value) && Math.abs(value) < 999_999 && item?.WaarnemingMetadata?.Kwaliteitswaardecode !== "99";
    })
    .map((item) => ({ time: new Date(item.Tijdstip).toISOString(), value: item.Meetwaarde.Waarde_Numeriek }));
}

function hourKey(time) {
  return `${new Date(time).toISOString().slice(0, 13)}:00:00.000Z`;
}

function mergeMetric(buckets, values, key, factor) {
  for (const item of values) {
    const hour = hourKey(item.time);
    const bucket = buckets.get(hour) || { time: hour };
    bucket[key] = Number((item.value * factor).toFixed(key.includes("Height") ? 2 : 1));
    buckets.set(hour, bucket);
  }
}

async function fetchBuoyHistory(buoy, start, end) {
  const buckets = new Map();
  for (const [key, parameter] of Object.entries(PARAMETERS)) {
    try {
      const values = await fetchRwsSeries(buoy.code, parameter.code, start, end);
      mergeMetric(buckets, values, key, parameter.factor);
    } catch (error) {
      console.warn(`${buoy.name} ${parameter.code}: ${error.message}`);
    }
    await sleep(125);
  }
  return {
    id: buoy.id,
    code: buoy.code,
    name: buoy.name,
    series: [...buckets.values()]
      .filter((item) => Number.isFinite(item.waveHeight))
      .sort((a, b) => a.time.localeCompare(b.time)),
  };
}

async function fetchHistoricalWeather() {
  const params = new URLSearchParams({
    latitude: "51.926613",
    longitude: "3.978392",
    hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    timezone: "UTC",
    past_days: String(RANGE_DAYS),
    forecast_days: "1",
  });
  const json = await fetchJson(`${WEATHER_URL}?${params}`);
  return json.hourly.time.map((time, index) => ({
    time: `${time}:00.000Z`,
    windSpeed: json.hourly.wind_speed_10m[index],
    windDirection: json.hourly.wind_direction_10m[index],
    windGust: json.hourly.wind_gusts_10m[index],
  }));
}

async function main() {
  const now = new Date();
  const start = new Date(now.getTime() - RANGE_DAYS * 86_400_000);
  const weatherPromise = fetchHistoricalWeather();
  const buoys = [];
  for (const buoy of BUOYS) buoys.push(await fetchBuoyHistory(buoy, start, now));
  const payload = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    rangeDays: RANGE_DAYS,
    timezone: "Europe/Amsterdam",
    buoys,
    weather: await weatherPromise,
  };
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(`30-dagenhistorie opgeslagen in ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
