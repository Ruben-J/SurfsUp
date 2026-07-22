const SWELL_COMPONENTS = [
  ["swell_wave_height", "swell_wave_period", "swell_wave_direction"],
  ["secondary_swell_wave_height", "secondary_swell_wave_period", "secondary_swell_wave_direction"],
  ["tertiary_swell_wave_height", "tertiary_swell_wave_period", "tertiary_swell_wave_direction"],
];

// RWS HTE3 represents energy in the 30–100 mHz band: periods of 10–33 s.
// Only model partitions in that same band are useful as a long-swell estimate.
export function longSwellEstimate(hourly, index) {
  const components = SWELL_COMPONENTS.map(([heightKey, periodKey, directionKey]) => ({
    height: hourly[heightKey]?.[index],
    period: hourly[periodKey]?.[index],
    direction: hourly[directionKey]?.[index],
  })).filter(({ height, period }) => (
    Number.isFinite(height)
    && height >= 0
    && Number.isFinite(period)
    && period >= 10
    && period <= 33
  ));

  if (!components.length) return { height: 0, period: null, direction: null };

  const energy = components.reduce((sum, component) => sum + component.height ** 2, 0);
  if (energy === 0) return { height: 0, period: null, direction: null };

  const dominant = components.reduce((best, component) => (
    component.height ** 2 > best.height ** 2 ? component : best
  ));

  return {
    height: Number(Math.sqrt(energy).toFixed(2)),
    period: Number((components.reduce((sum, component) => (
      sum + component.period * component.height ** 2
    ), 0) / energy).toFixed(1)),
    direction: Number.isFinite(dominant.direction) ? dominant.direction : null,
  };
}
