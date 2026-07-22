import assert from "node:assert/strict";
import { longSwellEstimate } from "../long-swell.js";
import { beaufort, scoreConditions, scoreLabel } from "../scoring.js";

assert.equal(beaufort(0), 0);
assert.equal(beaufort(1), 1);
assert.equal(beaufort(5.9), 1);
assert.equal(beaufort(6), 2);
assert.equal(beaufort(17), 3);
assert.equal(beaufort(20), 4);
assert.equal(beaufort(118), 12);
assert.equal(beaufort(null), null);

const score = (waveHeight, wavePeriod, waveDirection, windSpeed, windDirection) =>
  scoreConditions(
    { waveHeight, wavePeriod, waveDirection },
    { windSpeed, windDirection },
  );

const weakNorth = score(0.7, 5.3, 0, 17, 0);
assert.equal(weakNorth, 42);
assert.equal(scoreLabel(weakNorth)[0], "Redelijk");

const weakNorthWest = score(0.7, 5.3, 342, 17, 0);
assert.equal(weakNorthWest, 48);
assert.equal(scoreLabel(weakNorthWest)[0], "Redelijk");

const cleanSwell = score(1.2, 8.5, 285, 8, 95);
assert.equal(cleanSwell, 98);
assert.equal(scoreLabel(cleanSwell)[0], "Erg kansrijk");

const tooWindy = score(1.2, 8.5, 285, 38, 95);
assert.equal(tooWindy, 38);
assert.equal(scoreLabel(tooWindy)[0], "Weinig kans");

const noLongSwell = longSwellEstimate({
  swell_wave_height: [1.2],
  swell_wave_period: [5.5],
  swell_wave_direction: [300],
}, 0);
assert.deepEqual(noLongSwell, { height: 0, period: null, direction: null });

const spectralTail = longSwellEstimate({
  swell_wave_height: [1],
  swell_wave_period: [5.75],
  swell_wave_peak_period: [7.65],
  swell_wave_direction: [300],
}, 0);
assert.deepEqual(spectralTail, { height: 0.13, period: 10.6, direction: 300 });

const combinedLongSwell = longSwellEstimate({
  swell_wave_height: [0.3],
  swell_wave_period: [12],
  swell_wave_direction: [310],
  secondary_swell_wave_height: [0.4],
  secondary_swell_wave_period: [14],
  secondary_swell_wave_direction: [285],
}, 0);
assert.deepEqual(combinedLongSwell, { height: 0.44, period: 13.2, direction: 285 });

console.log("Surfscore-grensgevallen zijn geldig", {
  weakNorth,
  weakNorthWest,
  cleanSwell,
  tooWindy,
  noLongSwell,
  spectralTail,
  combinedLongSwell,
});
