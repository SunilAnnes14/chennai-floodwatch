// The map used on every page.
// Tiles: OpenStreetMap (free, with attribution). A CSS filter (".basemap-soft" in index.css)
// makes them calm and greyish, so our coloured flood layers stand out.
import { useEffect } from "react";
import { MapContainer, TileLayer, ZoomControl, useMap } from "react-leaflet";
import { CHENNAI } from "../api";

// preferCanvas = draw shapes on one canvas (much faster when there are thousands of them)
export default function BaseMap({ center = CHENNAI, zoom = 11, children, scrollWheelZoom = true, zoomPosition = "topleft", preferCanvas = false }) {
  return (
    <MapContainer center={center} zoom={zoom} scrollWheelZoom={scrollWheelZoom} zoomControl={false} preferCanvas={preferCanvas}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        className="basemap-soft"
        maxZoom={19}
      />
      <ZoomControl position={zoomPosition} />
      {children}
    </MapContainer>
  );
}

// Zooms the map so that all the given [lat, lon] points are visible (runs when the points change)
export function FitToPoints({ points, maxZoom = 15 }) {
  const map = useMap();
  const key = JSON.stringify(points);
  useEffect(() => {
    if (points.length > 0) map.fitBounds(points, { padding: [40, 40], maxZoom });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
