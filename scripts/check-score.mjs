import assert from "node:assert/strict";
import { scoreConditions, scoreLabel } from "../scoring.js";

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

console.log("Surfscore-grensgevallen zijn geldig", {
  weakNorth,
  weakNorthWest,
  cleanSwell,
  tooWindy,
});
