// grid.js - small maths helpers for the Forecast Map.

/*
  The forecast comes as a grid of points (rows = latitudes south->north, cols = longitudes west->east).
  To get a value BETWEEN points we blend the 4 nearest points ("bilinear interpolation"):
  the closer a point is, the more it counts.
*/
export function valueAt(table, lats, lons, lat, lon) {
  const fi = clamp((lat - lats[0]) / (lats[1] - lats[0]), 0, lats.length - 1);
  const fj = clamp((lon - lons[0]) / (lons[1] - lons[0]), 0, lons.length - 1);
  const i0 = Math.floor(fi), j0 = Math.floor(fj);
  const i1 = Math.min(i0 + 1, lats.length - 1), j1 = Math.min(j0 + 1, lons.length - 1);
  const ti = fi - i0, tj = fj - j0;
  const v = (i, j) => table[i][j] ?? 0;
  const south = v(i0, j0) * (1 - tj) + v(i0, j1) * tj;
  const north = v(i1, j0) * (1 - tj) + v(i1, j1) * tj;
  return south * (1 - ti) + north * ti;
}

export function clamp(x, low, high) {
  return Math.max(low, Math.min(high, x));
}

/*
  Weather data gives wind as "speed, coming FROM direction" (e.g. 90 deg = from the east).
  For drawing we need where it GOES: u = east-west part, v = north-south part (km/h).
  Wind from the east (90 deg) blows towards the west -> u is negative.
*/
export function windVector(speedKmh, fromDeg) {
  const rad = (fromDeg * Math.PI) / 180;
  return { u: -speedKmh * Math.sin(rad), v: -speedKmh * Math.cos(rad) };
}

// Make u/v grids for one hour (so particles can blend them between points)
export function windGrids(data, hour) {
  const u = [], v = [];
  data.wind_kmh[hour].forEach((row, i) => {
    u.push([]);
    v.push([]);
    row.forEach((speed, j) => {
      const w = windVector(speed ?? 0, data.wind_from_deg[hour][i][j] ?? 0);
      u[i].push(w.u);
      v[i].push(w.v);
    });
  });
  return { u, v };
}

export function compassName(fromDeg) {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(fromDeg / 45) % 8];
}

/*
  Colour scales. Each uses ONE hue from light to dark, so "more" always looks "darker".
  stops = [value, [r, g, b]]; values in between are blended.
*/
export const SCALES = {
  rain: {
    label: "Rain (mm per hour)",
    min: 0.1, // less than this = no colour (dry)
    stops: [[0.1, [134, 182, 239]], [1, [57, 135, 229]], [4, [28, 92, 171]], [10, [16, 66, 129]], [25, [13, 54, 107]]],
    ticks: [0.1, 1, 4, 10, 25],
  },
  temperature: {
    label: "Temperature (°C)",
    min: -Infinity,
    stops: [[22, [253, 231, 217]], [26, [246, 179, 143]], [30, [235, 104, 52]], [34, [184, 70, 27]], [38, [122, 42, 12]]],
    ticks: [22, 26, 30, 34, 38],
  },
};

export function colourFor(scale, value) {
  const { stops } = SCALES[scale];
  if (value <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    const [v1, c1] = stops[k];
    const [v0, c0] = stops[k - 1];
    if (value <= v1) {
      const t = (value - v0) / (v1 - v0);
      return c0.map((c, n) => Math.round(c + (c1[n] - c) * t));
    }
  }
  return stops[stops.length - 1][1];
}

// The hour in the forecast that matches "now" (forecast times are Indian time, like "2026-11-15T21:00")
export function currentHourIndex(times) {
  const nowIst = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }).slice(0, 13).replace(" ", "T");
  const index = times.findIndex((t) => t.slice(0, 13) >= nowIst);
  return index === -1 ? 0 : index;
}

export function formatHour(time) {
  const date = new Date(`${time}:00+05:30`);
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric" });
}
