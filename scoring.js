export function directionDifference(a, b) {
  return 180 - Math.abs(Math.abs(a - b) - 180);
}

export function beaufort(speedKmh) {
  if (!Number.isFinite(speedKmh)) return null;
  const thresholds = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  const force = thresholds.findIndex((limit) => speedKmh < limit);
  return force === -1 ? 12 : force;
}

export const DEFAULT_SCORE_WEIGHTS = Object.freeze({
  height: 30,
  period: 25,
  waveDirection: 20,
  windDirection: 15,
  windSpeed: 10,
});

export function normalizeScoreWeights(weights = DEFAULT_SCORE_WEIGHTS) {
  const values = Object.fromEntries(Object.entries(DEFAULT_SCORE_WEIGHTS).map(([key, defaultValue]) => {
    const value = Number(weights?.[key]);
    return [key, Number.isFinite(value) && value >= 0 ? value : defaultValue];
  }));
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { ...DEFAULT_SCORE_WEIGHTS };
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, (value / total) * 100]));
}

export function rebalanceScoreWeights(weights, changedKey, nextValue) {
  const current = normalizeScoreWeights(weights);
  if (!(changedKey in DEFAULT_SCORE_WEIGHTS)) return current;
  const target = Math.max(0, Math.min(100, Number(nextValue) || 0));
  const remaining = 100 - target;
  const otherKeys = Object.keys(DEFAULT_SCORE_WEIGHTS).filter((key) => key !== changedKey);
  const otherTotal = otherKeys.reduce((sum, key) => sum + current[key], 0);
  const fallbackTotal = otherKeys.reduce((sum, key) => sum + DEFAULT_SCORE_WEIGHTS[key], 0);
  const result = { [changedKey]: target };

  for (const key of otherKeys) {
    const share = otherTotal > 0
      ? current[key] / otherTotal
      : DEFAULT_SCORE_WEIGHTS[key] / fallbackTotal;
    result[key] = share * remaining;
  }
  return result;
}

function heightScore(height) {
  if (height < 0.35) return 2;
  if (height < 0.55) return 8;
  if (height < 0.8) return 15;
  if (height < 1.1) return 23;
  if (height <= 1.8) return 30;
  if (height <= 2.4) return 23;
  if (height <= 3) return 12;
  return 2;
}

function periodScore(period) {
  if (period < 4.5) return 2;
  if (period < 5.5) return 8;
  if (period < 6.5) return 12;
  if (period < 8) return 18;
  if (period < 10) return 23;
  return 25;
}

function waveDirectionScore(direction) {
  const difference = directionDifference(direction, 285);
  if (difference <= 35) return 20;
  if (difference <= 60) return 15;
  if (difference <= 90) return 8;
  return 2;
}

function windDirectionScore(direction) {
  const difference = directionDifference(direction, 95);
  if (difference <= 45) return 15;
  if (difference <= 75) return 11;
  if (difference <= 105) return 5;
  if (difference <= 135) return 2;
  return 0;
}

function windSpeedScore(speed) {
  if (speed <= 8) return 10;
  if (speed <= 14) return 8;
  if (speed <= 20) return 6;
  if (speed <= 28) return 2;
  return 0;
}

export function scoreConditions(wave, weather, weights = DEFAULT_SCORE_WEIGHTS) {
  const height = wave?.waveHeight ?? 0;
  const period = wave?.wavePeriod ?? 0;
  const waveDirection = wave?.waveDirection ?? 0;
  const windSpeed = weather?.windSpeed ?? 99;
  const windDirection = weather?.windDirection ?? 270;

  const normalizedWeights = normalizeScoreWeights(weights);
  let score =
    (heightScore(height) / DEFAULT_SCORE_WEIGHTS.height) * normalizedWeights.height +
    (periodScore(period) / DEFAULT_SCORE_WEIGHTS.period) * normalizedWeights.period +
    (waveDirectionScore(waveDirection) / DEFAULT_SCORE_WEIGHTS.waveDirection) * normalizedWeights.waveDirection +
    (windDirectionScore(windDirection) / DEFAULT_SCORE_WEIGHTS.windDirection) * normalizedWeights.windDirection +
    (windSpeedScore(windSpeed) / DEFAULT_SCORE_WEIGHTS.windSpeed) * normalizedWeights.windSpeed;

  // Korte, lokale windgolven mogen nooit als een sterke surfsessie eindigen.
  if (period < 4.5) score = Math.min(score, 35);
  else if (period < 5.5) score = Math.min(score, 48);
  if (height < 0.5) score = Math.min(score, 42);
  if (windSpeed > 32) score = Math.min(score, 38);
  if (height > 3) score = Math.min(score, 45);

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreLabel(score) {
  if (score >= 78) return ["Erg kansrijk", "excellent"];
  if (score >= 62) return ["Kansrijk", "good"];
  if (score >= 40) return ["Redelijk", "fair"];
  return ["Weinig kans", "poor"];
}
