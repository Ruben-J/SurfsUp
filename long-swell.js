const SWELL_COMPONENTS = [
  {
    height: "swell_wave_height",
    period: "swell_wave_period",
    peakPeriod: "swell_wave_peak_period",
    direction: "swell_wave_direction",
  },
  {
    height: "secondary_swell_wave_height",
    period: "secondary_swell_wave_period",
    direction: "secondary_swell_wave_direction",
  },
  {
    height: "tertiary_swell_wave_height",
    period: "tertiary_swell_wave_period",
    direction: "tertiary_swell_wave_direction",
  },
];

const LONG_SWELL_MIN_FREQUENCY = 0.03;
const LONG_SWELL_MAX_FREQUENCY = 0.1;
const SPECTRUM_MIN_FREQUENCY = 0.01;
const SPECTRUM_MAX_FREQUENCY = 1;
const SPECTRUM_STEPS = 800;

function jonswapShape(frequency, peakFrequency) {
  const sigma = frequency <= peakFrequency ? 0.07 : 0.09;
  const peakShape = Math.exp(
    -((frequency - peakFrequency) ** 2) / (2 * (sigma * peakFrequency) ** 2),
  );
  return frequency ** -5
    * Math.exp(-1.25 * (peakFrequency / frequency) ** 4)
    * 3.3 ** peakShape;
}

function energyInLongSwellBand(period) {
  const peakFrequency = 1 / period;
  let totalEnergy = 0;
  let bandEnergy = 0;
  let bandPeriodEnergy = 0;

  for (let step = 0; step < SPECTRUM_STEPS; step += 1) {
    const frequencyStart = SPECTRUM_MIN_FREQUENCY
      * (SPECTRUM_MAX_FREQUENCY / SPECTRUM_MIN_FREQUENCY) ** (step / SPECTRUM_STEPS);
    const frequencyEnd = SPECTRUM_MIN_FREQUENCY
      * (SPECTRUM_MAX_FREQUENCY / SPECTRUM_MIN_FREQUENCY) ** ((step + 1) / SPECTRUM_STEPS);
    const frequency = Math.sqrt(frequencyStart * frequencyEnd);
    const energy = jonswapShape(frequency, peakFrequency) * (frequencyEnd - frequencyStart);
    totalEnergy += energy;
    if (frequency >= LONG_SWELL_MIN_FREQUENCY && frequency <= LONG_SWELL_MAX_FREQUENCY) {
      bandEnergy += energy;
      bandPeriodEnergy += energy / frequency;
    }
  }

  if (!Number.isFinite(totalEnergy) || totalEnergy <= 0 || bandEnergy <= 0) {
    return { fraction: 0, period: null };
  }
  return {
    fraction: Math.min(1, bandEnergy / totalEnergy),
    period: bandPeriodEnergy / bandEnergy,
  };
}

// RWS HTE3 represents energy in the 30–100 mHz band: periods of 10–33 s.
// Open-Meteo only exposes summary values, so a JONSWAP-shaped spectrum estimates
// how much energy from each model partition falls inside that same frequency band.
export function longSwellEstimate(hourly, index) {
  const components = SWELL_COMPONENTS.map((keys) => {
    const height = hourly[keys.height]?.[index];
    const meanPeriod = hourly[keys.period]?.[index];
    const peakPeriod = keys.peakPeriod ? hourly[keys.peakPeriod]?.[index] : null;
    const period = Number.isFinite(peakPeriod) ? peakPeriod : meanPeriod;
    if (!Number.isFinite(height) || height < 0 || !Number.isFinite(period) || period <= 0) {
      return null;
    }
    const band = energyInLongSwellBand(period);
    return {
      height: height * Math.sqrt(band.fraction),
      period: band.period,
      direction: hourly[keys.direction]?.[index],
    };
  }).filter(Boolean);

  if (!components.length) return { height: 0, period: null, direction: null };

  const energy = components.reduce((sum, component) => sum + component.height ** 2, 0);
  const roundedHeight = Number(Math.sqrt(energy).toFixed(2));
  if (roundedHeight === 0) return { height: 0, period: null, direction: null };

  const dominant = components.reduce((best, component) => (
    component.height ** 2 > best.height ** 2 ? component : best
  ));

  return {
    height: roundedHeight,
    period: Number((components.reduce((sum, component) => (
      sum + component.period * component.height ** 2
    ), 0) / energy).toFixed(1)),
    direction: Number.isFinite(dominant.direction) ? dominant.direction : null,
  };
}
