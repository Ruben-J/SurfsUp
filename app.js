import { beaufort, directionDifference, scoreConditions, scoreLabel } from "./scoring.js?v=__ASSET_VERSION__";

const state = { data: null, history: null, activeBuoy: "e13", historyHours: 24, chartPoints: [] };

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
  day: new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    weekday: "short",
    day: "numeric",
    month: "short",
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

function localDayKey(date) {
  const parts = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function dayKeyForTime(value) {
  if (!value) return "";
  return /Z$|[+-]\d\d:\d\d$/.test(value) ? localDayKey(parseTime(value)) : value.slice(0, 10);
}

function dayAtOffset(reference, offset) {
  const [year, month, day] = localDayKey(reference).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset, 12));
}

function weatherForTime(time, weatherForecast) {
  if (!weatherForecast?.length) return null;
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

function buildFiveDayOutlook() {
  const e13 = state.data.buoys.find((buoy) => buoy.id === "e13") || state.data.buoys[0];
  const history = state.history?.buoys?.find((buoy) => buoy.id === e13.id)?.series || [];
  const measured = history.map((wave) => ({
    ...wave,
    weather: weatherForTime(wave.time, state.history?.weather),
    source: "measured",
  }));
  const forecast = e13.forecast.map((wave) => ({
    ...wave,
    weather: weatherForTime(wave.time, state.data.maasvlakte.weatherForecast),
    source: "forecast",
  }));
  const reference = new Date(state.data.generatedAt);

  return [-2, -1, 0, 1, 2].map((offset) => {
    const date = dayAtOffset(reference, offset);
    const key = localDayKey(date);
    const pool = offset < 0 ? measured : forecast;
    const candidates = pool
      .filter((point) => dayKeyForTime(point.time) === key)
      .map((point) => ({ ...point, score: scoreConditions(point, point.weather) }));
    const best = candidates.reduce((winner, point) => (!winner || point.score > winner.score ? point : winner), null);
    return { offset, date, key, best };
  });
}

function dayCardMarkup(day) {
  const relativeLabels = { "-2": "Eergisteren", "-1": "Gisteren", 0: "Vandaag", 1: "Morgen", 2: "Overmorgen" };
  const relativeLabel = relativeLabels[day.offset];
  const className = day.offset < 0 ? "past" : day.offset > 0 ? "future" : "today";
  if (!day.best) {
    return `<article class="surf-day ${className} no-data" ${day.offset === 0 ? 'aria-current="date"' : ""}>
      <div class="surf-day-head"><span>${relativeLabel}</span><time datetime="${day.key}">${fmt.day.format(day.date)}</time></div>
      <p>Geen bruikbare gegevens voor deze dag.</p>
    </article>`;
  }
  const [label, tone] = scoreLabel(day.best.score);
  const momentLabel = day.offset < 0 ? "Beste gemeten moment" : day.offset === 0 ? "Beste kans vandaag" : "Beste verwachte moment";
  return `<article class="surf-day ${className}" ${day.offset === 0 ? 'aria-current="date"' : ""}>
    <div class="surf-day-head"><span>${relativeLabel}</span><time datetime="${day.key}">${fmt.day.format(day.date)}</time></div>
    <div class="day-score ${tone}"><strong>${day.best.score}</strong><span>/100</span></div>
    <p class="day-rating">${label}</p>
    <div class="day-best"><span>${momentLabel}</span><strong>${fmt.time.format(parseTime(day.best.time))}</strong></div>
    <div class="day-facts">
      <span><b>${round(day.best.waveHeight, 1)} m</b> golf</span>
      <span><b>${round(day.best.wavePeriod, 1)} s</b> periode</span>
      <span><b>${directionName(day.best.weather?.windDirection)} ${beaufort(day.best.weather?.windSpeed)}</b> Bft wind</span>
    </div>
  </article>`;
}

function renderFiveDayOutlook() {
  const container = document.querySelector("#five-day-outlook");
  container.innerHTML = buildFiveDayOutlook().map(dayCardMarkup).join("");
  container.classList.remove("loading-card");
  container.setAttribute("aria-busy", "false");
  const today = container.querySelector(".surf-day.today");
  if (today && container.scrollWidth > container.clientWidth) {
    container.scrollLeft = today.offsetLeft - (container.clientWidth - today.clientWidth) / 2;
  }
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
    `<span class="condition-chip ${directionDifference(current.weather.windDirection, 95) <= 65 ? "good" : "warn"}">${directionName(current.weather.windDirection)} ${beaufort(current.weather.windSpeed)} Bft</span>`,
  ].join("");
  document.querySelector("#best-window strong").textContent = `${fmt.dateTime.format(parseTime(best.time))} · score ${best.score}`;
  document.querySelector("#surf-card").classList.remove("loading");

  const e13 = state.data.buoys.find((buoy) => buoy.id === "e13");
  const measured = e13.metrics.significantWaveHeight;
  document.querySelector("#hero-meta").innerHTML = `
    <span><strong>${round(measured.value, 2)} m</strong> gemeten bij E13</span>
    <span class="meta-divider"></span>
    <span><strong>${beaufort(state.data.maasvlakte.windSpeed)} Bft</strong> wind uit ${directionName(state.data.maasvlakte.windDirection)}</span>
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
    ? `<span class="direction-arrow" style="--direction:${(metric.value + 180) % 360}deg" aria-label="Komt uit ${directionName(metric.value)}, beweegt naar ${directionName((metric.value + 180) % 360)}">↑</span>`
    : "";
  return `<div class="metric" title="Bron: ${metric.source}">
    <span class="metric-label">${label}${model}</span>
    <span class="metric-value">${display}${arrow}<small>${isDirection ? `${Math.round(metric.value ?? 0)}°` : metric.unit}</small></span>
  </div>`;
}

function chartMarkup(buoy) {
  const storedHistory = state.history?.buoys?.find((item) => item.id === buoy.id)?.series;
  const completeHistory = storedHistory?.length
    ? storedHistory
    : buoy.history.map((item) => ({ time: item.time, waveHeight: item.value }));
  const lastHistoryTime = Math.max(...completeHistory.map((item) => parseTime(item.time)?.getTime() || 0));
  const cutoff = lastHistoryTime - state.historyHours * 60 * 60 * 1000;
  const history = completeHistory.filter((item) => (parseTime(item.time)?.getTime() || 0) >= cutoff);
  const forecast = buoy.forecast
    .filter((item) => (parseTime(item.time)?.getTime() || 0) > lastHistoryTime)
    .slice(0, 72);
  const historyPoints = history.map((item) => {
    const weather = weatherForTime(item.time, state.history?.weather);
    return {
      time: item.time,
      height: item.waveHeight,
      period: item.wavePeriod,
      direction: item.waveDirection,
      swell: item.swellHeight,
      score: scoreConditions(item, weather),
      type: "history",
      weather,
    };
  });
  const forecastPoints = forecast.map((item) => {
    const weather = weatherForTime(item.time, state.data.maasvlakte.weatherForecast);
    return {
      time: item.time,
      height: item.waveHeight,
      period: item.wavePeriod,
      direction: item.waveDirection,
      swell: item.swellHeight,
      score: scoreConditions(item, weather),
      type: "forecast",
      weather,
    };
  });
  const points = [...historyPoints, ...forecastPoints];
  if (points.length < 2) return `<p class="model-note">Er zijn nog niet genoeg punten voor de grafiek.</p>`;
  const width = 1000;
  const height = 220;
  const pad = { left: 34, right: 42, top: 14, bottom: 28 };
  const maxY = Math.max(1, Math.ceil(Math.max(...points.map((point) => point.height || 0)) * 2) / 2);
  const pointTimes = points.map((point) => parseTime(point.time)?.getTime()).filter(Number.isFinite);
  const firstPointTime = Math.min(...pointTimes);
  const lastPointTime = Math.max(...pointTimes);
  const timeSpan = Math.max(1, lastPointTime - firstPointTime);
  const x = (point) => {
    const timestamp = parseTime(point.time)?.getTime() ?? firstPointTime;
    return pad.left + ((timestamp - firstPointTime) / timeSpan) * (width - pad.left - pad.right);
  };
  const y = (value) => pad.top + (1 - (value || 0) / maxY) * (height - pad.top - pad.bottom);
  const scoreY = (value) => pad.top + (1 - (value || 0) / 100) * (height - pad.top - pad.bottom);
  const line = (items, key, scale = y) => items.map((item, index) => `${index ? "L" : "M"}${x(item).toFixed(1)},${scale(item[key]).toFixed(1)}`).join(" ");
  const lineWithGaps = (items, key, scale = y) => {
    let drawing = false;
    return items.map((item) => {
      if (!Number.isFinite(item[key])) {
        drawing = false;
        return "";
      }
      const command = drawing ? "L" : "M";
      drawing = true;
      return `${command}${x(item).toFixed(1)},${scale(item[key]).toFixed(1)}`;
    }).join(" ");
  };
  const historyPath = line(historyPoints, "height");
  const bridge = forecastPoints.length && historyPoints.length ? [historyPoints.at(-1), ...forecastPoints] : forecastPoints;
  const forecastPath = line(bridge, "height");
  // RWS HTE3 is low-frequency swell (10–33 s). Open-Meteo's swell partition
  // also contains much shorter waves, so it must not continue the same line.
  const swellPath = lineWithGaps(historyPoints, "swell");
  const scorePath = line(points, "score", scoreY);
  const nowX = x(historyPoints.at(-1) || points[0]);
  const grid = [0, .5, 1].map((ratio) => {
    const value = maxY * ratio;
    return `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}" />
      <text class="axis-label" x="0" y="${y(value) + 3}">${round(value)} m</text>`;
  }).join("");
  const scoreAxis = [0, 50, 100].map((value) => `<text class="score-axis-label" text-anchor="end" x="${width}" y="${scoreY(value) + 3}">${value}</text>`).join("");
  const labelStep = Math.max(1, Math.ceil(points.length / 7));
  const labels = points.map((point, index) => {
    if (index % labelStep && index !== points.length - 1) return "";
    const date = parseTime(point.time);
    const label = state.historyHours > 24
      ? new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" }).format(date)
      : `${new Intl.DateTimeFormat("nl-NL", { weekday: "short" }).format(date)}, ${new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", hourCycle: "h23" }).format(date)}u`;
    return `<text class="axis-label" text-anchor="middle" x="${x(point)}" y="216">${label}</text>`;
  }).join("");
  const area = historyPoints.length > 1 ? `${historyPath} L${x(historyPoints.at(-1))},${y(0)} L${x(historyPoints[0])},${y(0)} Z` : "";
  state.chartPoints = points.map((point) => ({ ...point, x: x(point), y: y(point.height), scoreY: scoreY(point.score) }));
  const rangeButtons = [[24, "24 uur"], [168, "7 dagen"], [720, "30 dagen"]].map(([hours, label]) => `
    <button class="range-button" data-range-hours="${hours}" aria-pressed="${state.historyHours === hours}">${label}</button>`).join("");

  return `<div class="chart-wrap">
    <div class="chart-head">
      <div><strong>Golfhoogte & surfscore per uur</strong><div class="chart-legend"><span>Meting</span><span class="forecast">Verwachting</span><span class="swell">Lange deining (meting)</span><span class="score">Surfscore</span></div></div>
      <div class="range-switch" aria-label="Kies periode">${rangeButtons}</div>
    </div>
    <div class="chart-scroll">
    <svg class="wave-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Golfhoogte en surfscore per uur van de afgelopen ${state.historyHours} uur en verwachting voor 72 uur">
      <defs><linearGradient id="historyGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c5d68" stop-opacity=".16"/><stop offset="1" stop-color="#0c5d68" stop-opacity="0"/></linearGradient></defs>
      ${grid}${scoreAxis}<path class="history-area" d="${area}"/><path class="history-line" d="${historyPath}"/><path class="forecast-line" d="${forecastPath}"/><path class="swell-line" d="${swellPath}"/><path class="score-line" d="${scorePath}"/>
      <line class="now-line" x1="${nowX}" x2="${nowX}" y1="${pad.top}" y2="${height-pad.bottom}"/><text class="now-label" x="${nowX+5}" y="12">Nu</text>${labels}
      <line class="hover-line" x1="0" x2="0" y1="${pad.top}" y2="${height-pad.bottom}"/><circle class="hover-dot" cx="0" cy="0" r="5"/><circle class="hover-score-dot" cx="0" cy="0" r="5"/>
    </svg>
    </div>
    <div class="chart-readout" aria-live="polite"><span>Beweeg over de grafiek voor de surfscore en condities per uur.</span></div>
    <p class="model-note">* Modelwaarde. Golfverwachting van Open-Meteo Marine. De deiningslijn toont alleen de vergelijkbare laagfrequente Rijkswaterstaat-metingen; hiervoor is geen gelijkwaardige forecast beschikbaar.</p>
  </div>`;
}

function setupChartInteractions() {
  const chart = document.querySelector(".wave-chart");
  const readout = document.querySelector(".chart-readout");
  const hoverLine = chart?.querySelector(".hover-line");
  const hoverDot = chart?.querySelector(".hover-dot");
  const hoverScoreDot = chart?.querySelector(".hover-score-dot");
  if (!chart || !readout || !hoverLine || !hoverDot || !hoverScoreDot || !state.chartPoints.length) return;

  const showPoint = (event) => {
    const rect = chart.getBoundingClientRect();
    const viewX = ((event.clientX - rect.left) / rect.width) * 1000;
    const point = state.chartPoints.reduce((nearest, item) => (
      Math.abs(item.x - viewX) < Math.abs(nearest.x - viewX) ? item : nearest
    ));
    hoverLine.setAttribute("x1", point.x);
    hoverLine.setAttribute("x2", point.x);
    hoverDot.setAttribute("cx", point.x);
    hoverDot.setAttribute("cy", point.y);
    hoverScoreDot.setAttribute("cx", point.x);
    hoverScoreDot.setAttribute("cy", point.scoreY);
    hoverLine.classList.add("visible");
    hoverDot.classList.add("visible");
    hoverScoreDot.classList.add("visible");
    const wind = point.weather;
    const direction = Number.isFinite(point.direction) ? `${directionName(point.direction)} · ${Math.round(point.direction)}°` : "–";
    const windText = wind ? `${directionName(wind.windDirection)} ${beaufort(wind.windSpeed)} Bft` : "–";
    readout.innerHTML = `<strong>${fmt.dateTime.format(parseTime(point.time))}</strong><span>${point.type === "history" ? "Gemeten" : "Verwachting"}</span><span class="score-readout"><b>${point.score}/100</b> surfscore</span><span><b>${round(point.height, 2)} m</b> golf</span><span><b>${round(point.period)} s</b> periode</span><span><b>${direction}</b> richting</span><span><b>${windText}</b> wind</span>`;
  };
  chart.addEventListener("pointermove", showPoint);
  chart.addEventListener("click", showPoint);
  chart.addEventListener("pointerleave", () => {
    hoverLine.classList.remove("visible");
    hoverDot.classList.remove("visible");
    hoverScoreDot.classList.remove("visible");
  });
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
  document.querySelectorAll("[data-range-hours]").forEach((button) => {
    button.addEventListener("click", () => {
      state.historyHours = Number(button.dataset.rangeHours);
      renderBuoy();
    });
  });
  setupChartInteractions();
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
        <div class="weather-value"><span>Wind</span><strong>${beaufort(coast.windSpeed)} <small>Bft</small></strong><small>vlagen ${beaufort(coast.windGust)} Bft</small></div>
        <div class="weather-value"><span>Richting</span><strong>${directionName(coast.windDirection)} <i class="wind-compass" style="--direction:${(coast.windDirection + 180) % 360}deg" aria-label="Wind uit ${directionName(coast.windDirection)}, waait naar ${directionName((coast.windDirection + 180) % 360)}">↑</i></strong><small>${Math.round(coast.windDirection)}°</small></div>
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
  document.querySelector("#five-day-outlook").textContent = "De vijfdaagse surfinschatting kan tijdelijk niet worden berekend.";
}

async function init() {
  try {
    const [latestResponse, historyResponse] = await Promise.all([
      fetch(`data/latest.json?v=${Date.now()}`, { cache: "no-store" }),
      fetch(`data/history.json?v=${Date.now()}`, { cache: "no-store" }).catch(() => null),
    ]);
    if (!latestResponse.ok) throw new Error(`Data laden mislukt (${latestResponse.status})`);
    state.data = await latestResponse.json();
    if (historyResponse?.ok) state.history = await historyResponse.json();
    renderHero();
    renderFiveDayOutlook();
    renderTabs();
    renderBuoy();
    renderCoast();
    document.querySelector("#footer-update").textContent = `Laatste update: ${fmt.updated.format(new Date(state.data.generatedAt))}`;
  } catch (error) {
    showError(error);
  }
}

init();
