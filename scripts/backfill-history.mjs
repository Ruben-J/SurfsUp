import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const RWS_URL =
  "https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen";
const OUTPUT = resolve(process.argv[2] || "data/archive.json");
const YEARS_PER_BUOY = Math.max(1, Number(process.env.ARCHIVE_YEARS_PER_RUN || 1));
const CURRENT_YEAR = new Date().getUTCFullYear();
const BUOYS = [
  { id: "europlatform", code: "europlatform", name: "Europlatform", startYear: 1982 },
  { id: "e13", code: "eurogeul.e13", name: "Eurogeul E13", startYear: 2002 },
  { id: "j6", code: "j6", name: "J6", startYear: 2009 },
];

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function loadArchive() {
  try {
    return JSON.parse(await readFile(OUTPUT, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      schemaVersion: 1,
      generatedAt: null,
      metric: "significantWaveHeight",
      unit: "m",
      aggregation: "monthly",
      buoys: BUOYS.map((buoy) => ({ ...buoy, completedYears: [], months: [] })),
    };
  }
}

async function fetchYear(code, year) {
  const body = {
    Locatie: { Code: code },
    AquoPlusWaarnemingMetadata: {
      AquoMetadata: {
        Compartiment: { Code: "OW" },
        Grootheid: { Code: "Hm0" },
        ProcesType: "meting",
      },
    },
    Periode: {
      Begindatumtijd: `${year}-01-01T00:00:00.000Z`,
      Einddatumtijd: `${year + 1}-01-01T00:00:00.000Z`,
    },
  };
  const response = await fetch(RWS_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (response.status === 204) return [];
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const json = await response.json();
  return (json.WaarnemingenLijst?.[0]?.MetingenLijst || [])
    .map((item) => ({ time: item.Tijdstip, value: item?.Meetwaarde?.Waarde_Numeriek }))
    .filter((item) => Number.isFinite(item.value) && Math.abs(item.value) < 999_999)
    .map((item) => ({ time: new Date(item.time), value: item.value * 0.01 }))
    .filter((item) => item.time.getUTCFullYear() === year);
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function aggregateMonths(values, year) {
  const months = new Map();
  for (const item of values) {
    const key = item.time.toISOString().slice(0, 7);
    const bucket = months.get(key) || [];
    bucket.push(item.value);
    months.set(key, bucket);
  }
  return [...months.entries()].map(([month, raw]) => {
    const sorted = raw.sort((a, b) => a - b);
    const expected = new Date(Date.UTC(year, Number(month.slice(5, 7)), 0)).getUTCDate() * 24 * 6;
    return {
      month,
      mean: Number((sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(2)),
      max: Number(Math.max(...sorted).toFixed(2)),
      p90: Number(percentile(sorted, 0.9).toFixed(2)),
      samples: sorted.length,
      coverage: Number(((sorted.length / expected) * 100).toFixed(1)),
    };
  });
}

async function save(archive) {
  archive.generatedAt = new Date().toISOString();
  for (const buoy of archive.buoys) {
    buoy.completedYears.sort((a, b) => a - b);
    buoy.months.sort((a, b) => a.month.localeCompare(b.month));
  }
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(archive)}\n`, "utf8");
}

async function main() {
  const archive = await loadArchive();
  for (const config of BUOYS) {
    const buoy = archive.buoys.find((item) => item.id === config.id);
    buoy.months = buoy.months.filter((month) =>
      buoy.completedYears.includes(Number(month.month.slice(0, 4))),
    );
    const pending = [];
    for (let year = config.startYear; year <= CURRENT_YEAR; year += 1) {
      if (!buoy.completedYears.includes(year)) pending.push(year);
    }
    for (const year of pending.slice(0, YEARS_PER_BUOY)) {
      console.log(`${config.name}: ${year}`);
      const values = await fetchYear(config.code, year);
      buoy.months.push(...aggregateMonths(values, year));
      buoy.completedYears.push(year);
      await save(archive);
      await sleep(500);
    }
  }
  await save(archive);
  console.log(`Archief bijgewerkt in ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
