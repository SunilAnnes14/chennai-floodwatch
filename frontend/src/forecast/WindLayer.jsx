// Animated wind: hundreds of little particles drift with the forecast wind and leave fading trails.
//
// How it works (every animation frame, ~60 times a second):
//   1. Fade the old picture a little (this makes the trails).
//   2. For each particle: look up the wind (u, v) at its position, move it a small step,
//      and draw a short line from the old to the new position.
//   3. Particles that get old or leave the area restart at a random place.
import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { valueAt, windGrids } from "./grid";

const PARTICLES = 1000;
const MAX_AGE = 90;          // frames before a particle restarts
const SPEED = 0.000035;      // degrees moved per frame for each km/h of wind (just for looks)

export default function WindLayer({ data, hour }) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer?.();
    if (!container) return undefined;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return undefined; // respect the user's "reduce motion" setting

    // A transparent canvas on top of the map (clicks go through it to the map)
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:450";
    container.appendChild(canvas);
    const ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx) {
      canvas.remove();
      return undefined;
    }

    const { lats, lons } = data;
    const { u, v } = windGrids(data, hour);
    const randomParticle = () => ({
      lat: lats[0] + Math.random() * (lats[lats.length - 1] - lats[0]),
      lon: lons[0] + Math.random() * (lons[lons.length - 1] - lons[0]),
      age: Math.floor(Math.random() * MAX_AGE),
    });
    let particles = Array.from({ length: PARTICLES }, randomParticle);

    function resize() {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }
    const clear = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
    resize();
    map.on("movestart zoomstart", clear);
    map.on("resize", resize);

    let frame;
    function step() {
      // 1. fade what is already drawn
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = "rgba(0, 0, 0, 0.93)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";

      // 2. move and draw every particle
      ctx.strokeStyle = "rgba(16, 33, 63, 0.75)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      particles = particles.map((p) => {
        const east = valueAt(u, lats, lons, p.lat, p.lon);
        const north = valueAt(v, lats, lons, p.lat, p.lon);
        const next = {
          lat: p.lat + north * SPEED,
          lon: p.lon + (east * SPEED) / Math.cos((p.lat * Math.PI) / 180),
          age: p.age + 1,
        };
        const from = map.latLngToContainerPoint([p.lat, p.lon]);
        const to = map.latLngToContainerPoint([next.lat, next.lon]);
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        // 3. restart old particles and particles that left the forecast area
        const outside = next.lat < lats[0] || next.lat > lats[lats.length - 1]
          || next.lon < lons[0] || next.lon > lons[lons.length - 1];
        return next.age > MAX_AGE || outside ? randomParticle() : next;
      });
      ctx.stroke();
      frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);

    // Clean up when the hour changes or the page closes
    return () => {
      cancelAnimationFrame(frame);
      map.off("movestart zoomstart", clear);
      map.off("resize", resize);
      canvas.remove();
    };
  }, [map, data, hour]);

  return null;
}
