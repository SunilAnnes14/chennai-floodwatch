// Paints rain or temperature as a smooth colour picture laid over the map.
// We draw a small picture (180 x 180 pixels), where each pixel's colour is blended
// between the 4 nearest forecast points, then stretch it over the forecast area.
import { useMemo } from "react";
import { ImageOverlay } from "react-leaflet";
import { valueAt, colourFor, SCALES } from "./grid";

const SIZE = 180;

function paint(table, lats, lons, scale) {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext && canvas.getContext("2d");
  if (!ctx) return null; // very old browsers / test environment
  const image = ctx.createImageData(SIZE, SIZE);
  const { min } = SCALES[scale];
  for (let y = 0; y < SIZE; y++) {
    // row 0 of the picture is the NORTH edge
    const lat = lats[lats.length - 1] - (y / (SIZE - 1)) * (lats[lats.length - 1] - lats[0]);
    for (let x = 0; x < SIZE; x++) {
      const lon = lons[0] + (x / (SIZE - 1)) * (lons[lons.length - 1] - lons[0]);
      const value = valueAt(table, lats, lons, lat, lon);
      const k = (y * SIZE + x) * 4;
      if (value < min) {
        image.data[k + 3] = 0; // dry: fully see-through
        continue;
      }
      const [r, g, b] = colourFor(scale, value);
      // Soft edges: fade out over the outer 10% of the picture, so there is no hard box
      const edge = Math.min(x, SIZE - 1 - x, y, SIZE - 1 - y) / (SIZE * 0.1);
      image.data[k] = r;
      image.data[k + 1] = g;
      image.data[k + 2] = b;
      image.data[k + 3] = Math.round(175 * Math.min(1, edge));
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

export default function FieldLayer({ data, hour, scale }) {
  const table = scale === "rain" ? data.rain_mm[hour] : data.temperature_c[hour];
  const url = useMemo(() => paint(table, data.lats, data.lons, scale), [table, data.lats, data.lons, scale]);
  if (!url) return null;
  const bounds = [[data.lats[0], data.lons[0]], [data.lats[data.lats.length - 1], data.lons[data.lons.length - 1]]];
  return <ImageOverlay url={url} bounds={bounds} opacity={0.85} className="forecast-field" />;
}
