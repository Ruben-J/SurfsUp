import { directionDifference, scoreConditions, scoreLabel } from "./scoring.js";

const state = { data: null, activeBuoy: "e13" };

const fmt = {
  time: new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" }),
  dateTime: new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }),
  updated: new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }),
};

const METRICS = [
  ["maxWaveHeight", "Maximale golfhoogte"],
  ["significantWaveHeight", "Significante golfhoogte"],
  ["wavePeriod", "Golfperiode"],
  ["waveDirection", "Golfrichting"],
  ["swellHeight", "Deiningshoogte"],
  ["swellPeriod", "Deiningsperiode"],
  ["swellDirection", "Deiningsrichting"],
];

function parseTime(value) {
  if (!value) return null;
  const hasZone = /Z$|[+-]\d\d:\d\d$/.test(value);
  return new Date(hasZone ? value : `${value}:00+02:00`);
}

function directionName(degrees) {
  if (!Number.isFinite(degrees)) return "–";
  const names = ["N", "NO", "O", "ZO", "Z", "ZW", "W", "NW"];
  return names[Math.round(((degrees % 360) / 45)) % 8];
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return "–";
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function weatherForTime(time, weatherForecast) {
  const exact = weatherForecast.find((item) => item.time === time);
  if (exact) return exact;
  const target = parseTime(time)?.getTime();
  return weatherForecast.reduce((best, item) => {
    const difference = Math.abs(parseTime(item.time).getTime() - target);
    return !best || difference < best.difference ? { ...item, difference } : best;
  }, null);
}

function buildOutlook(data) {
  const e13 = data.buoys.find((buoy) => buoy.id === "e13") || data.buoys[0];
  return e13.forecast.slice(0, 49).map((wave) => {
    const weather = weatherForTime(wave.time, data.maasvlakte.weatherForecast);
    return { ...wave, weather, score: scoreConditions(wave, weather) };
  });
}

function explainScore(point) {
  const facts = [];
  const windDiff = directionDifference(point.weather.windDirection, 95);
  if (point.wavePeriod >= 7) facts.push(`mooie periode van ${round(point.wavePeriod)} s`);
  else facts.push(`korte periode van ${round(point.wavePeriod)} s`);
  if (windDiff <= 65) facts.push("offshore wind");
  else if (windDiff > 120) facts.push("onshore wind");
  if (point.waveHeight < 0.5) facts.push("weinig golfhoogte");
  else facts.push(`${round(point.waveHeight)} m golf`);
  return `${facts[0][0].toUpperCase()}${facts[0].slice(1)}, ${facts.slice(1).join(" en ")}.`;
}

function renderHero() {
  const outlook = buildOutlook(state.data);
  const current = outlook[0];
  const best = outlook.reduce((winner, item) => (item.score > winner.score ? item : winner), current);
  const [label] = scoreLabel(current.score);
  document.querySelector("#score-value").textContent = current.score;
  document.querySelector("#score-label").textContent = label;
  document.querySelector("#score-bar").style.width = `${current.score}%`;
  document.querySelector("#score-summary").textContent = explainScore(current);
  document.querySelector("#condition-chips").innerHTML = [
    `<span class="condition-chip ${current.waveHeight >= .55 ? "good" : "warn"}">${round(current.waveHeight)} m golven</span>`,
    `<span class="condition-chip ${current.wavePeriod >= 7 ? "good" : "warn"}">${round(current.wavePeriod)} s periode</span>`,
    `<span class="condition-chip ${directionDifference(current.weather.windDirection, 95) <= 65 ? "good" : "warn"}">${directionName(current.weather.windDirection)} ${round(current.weather.windSpeed, 0)} km/u</span>`,
  ].join("");
  document.querySelector("#best-window strong").textContent = `${fmt.dateTime.format(parseTime(best.time))} · score ${best.score}`;
  document.querySelector("#surf-card").classList.remove("loading");

  const e13 = state.data.buoys.find((buoy) => buoy.id === "e13");
  const measured = e13.metrics.significantWaveHeight;
  document.querySelector("#hero-meta").innerHTML = `
    <span><strong>${round(measured.value, 2)} m</strong> gemeten bij E13</span>
    <span class="meta-divider"></span>
    <span><strong>${round(state.data.maasvlakte.windSpeed, 0)} km/u</strong> wind uit ${directionName(state.data.maasvlakte.windDirection)}</span>
    <span class="meta-divider"></span>
    <span>Bijgewerkt ${fmt.time.format(new Date(state.data.generatedAt))}</span>`;
}

function renderTabs() {
  const tabs = document.querySelector("#buoy-tabs");
  tabs.innerHTML = state.data.buoys.map((buoy) => `
    <button class="buoy-tab" role="tab" aria-selected="${buoy.id === state.activeBuoy}" data-buoy="${buoy.id}">
      ${buoy.name}
    </button>`).join("");
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-buoy]");
    if (!button) return;
    state.activeBuoy = button.dataset.buoy;
    [...tabs.children].forEach((tab) => tab.setAttribute("aria-selected", String(tab === button)));
    renderBuoy();
  });
}

function metricMarkup(key, label, metric) {
  const isDirection = key.toLowerCase().includes("direction");
  const display = metric.value == null ? "–" : isDirection ? directionName(metric.value) : round(metric.value, metric.unit === "m" ? 2 : 1);
  const model = metric.source.includes("model") ? " *" : "";
  const arrow = isDirection && metric.value != null
    ? `<span class="direction-arrow" style="--direction:${metric.value}deg" aria-label="${Math.round(metric.value)} graden">↑</span>`
    : "";
  return `<div class="metric" title="Bron: ${metric.source}">
    <span class="metric-label">${label}${model}</span>
    <span class="metric-value">${display}${arrow}<small>${isDirection ? `${Math.round(metric.value ?? 0)}°` : metric.unit}</small></span>
  </div>`;
}

function chartMarkup(buoy) {
  const history = buoy.history.slice(-25);
  const forecast = buoy.forecast.slice(0, 49);
  const points = [
    ...history.map((item) => ({ time: item.time, height: item.value, type: "history", swell: null })),
    ...forecast.map((item) => ({ time: item.time, height: item.waveHeight, swell: item.swellHeight, type: "forecast" })),
  ];
  if (points.length < 2) return `<p class="model-note">Er zijn nog niet genoeg punten voor de grafiek.</p>`;
  const width = 1000;
  const height = 220;
  const pad = { left: 34, right: 12, top: 14, bottom: 28 };
  const maxY = Math.max(1, Math.ceil(Math.max(...points.map((point) => point.height || 0)) * 2) / 2);
  const x = (index) => pad.left + (index / (points.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value || 0) / maxY) * (height - pad.top - pad.bottom);
  const line = (items, offset, key) => items.map((item, index) => `${index ? "L" : "M"}${x(index + offset).toFixed(1)},${y(item[key]).toFixed(1)}`).join(" ");
  const historyPath = line(history.map((item) => ({ height: item.value })), 0, "height");
  const bridge = forecast.length && history.length ? [{ waveHeight: history.at(-1).value }, ...forecast] : forecast;
  const forecastOffset = Math.max(0, history.length - 1);
  const forecastPath = line(bridge, forecastOffset, "waveHeight");
  const swellPath = line(forecast, history.length, "swellHeight");
  const nowX = x(Math.max(0, history.length - 1));
  const grid = [0, .5, 1].map((ratio) => {
    const value = maxY * ratio;
    return `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}" />
      <text class="axis-label" x="0" y="${y(value) + 3}">${round(value)} m</text>`;
  }).join("");
  const labels = points.map((point, index) => {
    if (index % 12 || index === points.length - 1) return "";
    const date = parseTime(point.time);
    const label = new Intl.DateTimeFormat("nl-NL", { weekday: "short", hour: "2-digit" }).format(date);
    return `<text class="axis-label" text-anchor="middle" x="${x(index)}" y="216">${label}</text>`;
  }).join("");
  const area = history.length > 1 ? `${historyPath} L${x(history.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : "";

  return `<div class="chart-wrap">
    <div class="chart-head"><strong>Golfhoogte: historie & verwachting</strong><div class="chart-legend"><span>Meting</span><span class="forecast">Verwachting</span><span class="swell">Deining</span></div></div>
    <svg class="wave-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Golfhoogte van de afgelopen 24 uur en verwachting voor 48 uur">
      <defs><linearGradient id="historyGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c5d68" stop-opacity=".16"/><stop offset="1" stop-color="#0c5d68" stop-opacity="0"/></linearGradient></defs>
      ${grid}<path class="history-area" d="${area}"/><path class="history-line" d="${historyPath}"/><path class="forecast-line" d="${forecastPath}"/><path class="swell-line" d="${swellPath}"/>
      <line class="now-line" x1="${nowX}" x2="${nowX}" y1="${pad.top}" y2="${height-pad.bottom}"/><text class="now-label" x="${nowX+5}" y="12">Nu</text>${labels}
    </svg>
    <p class="model-note">* Modelwaarde. Metingen komen van Rijkswaterstaat; verwachting en ontbrekende deiningswaarden van Open-Meteo Marine.</p>
  </div>`;
}

function renderBuoy() {
  const buoy = state.data.buoys.find((item) => item.id === state.activeBuoy) || state.data.buoys[0];
  document.querySelector("#buoy-panel").innerHTML = `
    <div class="buoy-title-row">
      <div><h3>${buoy.name}</h3><p>${buoy.coordinates.lat.toFixed(3)}° N · ${buoy.coordinates.lon.toFixed(3)}° O · meting ${fmt.time.format(parseTime(buoy.observedAt))}</p></div>
      <span class="source-badge">Rijkswaterstaat meetboei</span>
    </div>
    <div class="metrics-grid">${METRICS.map(([key, label]) => metricMarkup(key, label, buoy.metrics[key])).join("")}</div>
    ${chartMarkup(buoy)}`;
}

function nextTide(type) {
  return state.data.maasvlakte.tides.next.find((item) => item.type === type);
}

function renderCoast() {
  const coast = state.data.maasvlakte;
  const high = nextTide("high");
  const low = nextTide("low");
  const moon = state.data.moon;
  const moonShift = moon.phase <= .5 ? 58 - moon.phase * 116 : -((moon.phase - .5) * 116);
  document.querySelector("#coast-grid").innerHTML = `
    <article class="coast-card tide-card">
      <h3>Getij <span>↕</span></h3>
      <div class="tide-now">
        <div class="tide-event"><span>Volgend hoogwater</span><strong>${high ? fmt.time.format(parseTime(high.time)) : "–"}</strong><small>${high ? `${round(high.value / 100, 2)} m MSL` : "geen data"}</small></div>
        <div class="tide-event"><span>Volgend laagwater</span><strong>${low ? fmt.time.format(parseTime(low.time)) : "–"}</strong><small>${low ? `${round(low.value / 100, 2)} m MSL` : "geen data"}</small></div>
      </div>
      <div class="tide-coefficient"><p>Getijcoëfficiënt<br/><span title="${coast.tides.coefficientMethod}">relatieve getijkracht · 20–120</span></p><strong>${coast.tides.coefficient ?? "–"}</strong></div>
    </article>
    <article class="coast-card weather-card">
      <h3>Weer & water <span>☼</span></h3>
      <div class="weather-main">
        <div class="weather-value"><span>Wind</span><strong>${round(coast.windSpeed, 0)} <small>km/u</small></strong><small>vlagen ${round(coast.windGust, 0)} km/u</small></div>
        <div class="weather-value"><span>Richting</span><strong>${directionName(coast.windDirection)} <i class="wind-compass" style="--direction:${coast.windDirection}deg">↑</i></strong><small>${Math.round(coast.windDirection)}°</small></div>
        <div class="weather-value"><span>Luchttemperatuur</span><strong>${round(coast.airTemperature)}°</strong><small>Celsius</small></div>
        <div class="weather-value"><span>Zeewater</span><strong>${round(coast.seaTemperature)}°</strong><small>meting Hoek v. Holland</small></div>
      </div>
    </article>
    <article class="coast-card moon-card">
      <h3>Maanstand <span>◐</span></h3>
      <div class="moon-visual"><span class="moon-shadow" style="--moon-shift:${moonShift}%"></span></div>
      <strong>${moon.name}</strong><p>${moon.illumination}% verlicht · dag ${round(moon.ageDays)}</p>
    </article>`;
}

function showError(error) {
  console.error(error);
  const template = document.querySelector("#error-template");
  document.querySelector("#buoy-panel").replaceChildren(template.content.cloneNode(true));
  document.querySelector("#hero-meta").textContent = "Actuele gegevens zijn tijdelijk niet bereikbaar.";
  document.querySelector("#coast-grid").replaceChildren(template.content.cloneNode(true));
}

async function init() {
  try {
    const response = await fetch(`data/latest.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Data laden mislukt (${response.status})`);
    state.data = await response.json();
    renderHero();
    renderTabs();
    renderBuoy();
    renderCoast();
    document.querySelector("#footer-update").textContent = `Laatste update: ${fmt.updated.format(new Date(state.data.generatedAt))}`;
  } catch (error) {
    showError(error);
  }
}

init();
