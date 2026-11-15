// Draws flooded street sections on a Leaflet map, coloured by road condition:
//  * Dangerous     -> thick red line
//  * Moderate risk -> thick amber line
//  * Unverified    -> thin grey dashed line (not confirmed!)
// If OpenStreetMap had no street shape, we draw a dot at the report instead.
// `highlight` = key of a street to draw extra thick (when the user hovers its card).
import { Polyline, CircleMarker, Popup } from "react-leaflet";
import { formatTime, roadCondition, CONDITIONS } from "../api";

export function streetKey(street) {
  return `${street.street_name}|${street.locality}|${street.segments[0].report_id}`;
}

export default function StreetLines({ streets, highlight }) {
  return streets.flatMap((street) => {
    const condition = roadCondition(street);
    const big = highlight === streetKey(street);
    return street.segments.map((segment) => {
      const verified = segment.status === "VERIFIED";
      const shown = verified ? condition : (street.likely_flooded ? "LIKELY" : "UNVERIFIED");
      const style = verified
        ? { color: CONDITIONS[condition].color, weight: big ? 13 : 8, opacity: 0.9, lineCap: "round" }
        : { color: CONDITIONS[shown].color, weight: big ? 9 : shown === "LIKELY" ? 6 : 4, opacity: 0.85, dashArray: "6 6" };
      const popup = <Popup><StreetPopup street={street} condition={shown} /></Popup>;

      return segment.points ? (
        <Polyline key={segment.report_id} positions={segment.points} pathOptions={style}>{popup}</Polyline>
      ) : (
        <CircleMarker key={segment.report_id} center={[segment.latitude, segment.longitude]} radius={big ? 11 : 7}
                      pathOptions={{ ...style, weight: 2, fillOpacity: 0.6 }}>{popup}</CircleMarker>
      );
    });
  });
}

function StreetPopup({ street, condition }) {
  return (
    <div>
      <p style={{ color: CONDITIONS[condition].color, fontWeight: 700, fontSize: 11, letterSpacing: ".05em" }}>
        {CONDITIONS[condition].label.toUpperCase()}
      </p>
      <strong>{street.street_name}</strong><br />
      {street.locality && <>{street.locality}, </>}{street.area}<br />
      Deepest water reported: {street.max_depth_cm} cm · Worst: {street.worst_severity}<br />
      {street.verified_reports} verified, {street.unverified_reports} unverified report(s)
      {street.independent_reporters > 1 && <> · {street.independent_reporters} different people in the last hour</>}<br />
      {street.prediction?.predicted_level && <>Forecast risk, next 24 h: {street.prediction.predicted_level.replace("_", " ")} (experimental)<br /></>}
      <small>Latest {formatTime(street.latest_report_at)} · citizen reports, street from OpenStreetMap</small>
    </div>
  );
}
