// api.js - one place for talking to the Python backend, plus small shared helpers.
import { useEffect, useState, useCallback } from "react";

// Call the backend. Throws an Error with a readable message if something fails.
export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = localStorage.getItem("token");
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error("Cannot reach the FloodWatch server. Is the backend running?");
  }
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  // An empty 500 answer comes from Vite when the Python backend is not running
  if (response.status === 500 && !text) {
    throw new Error("The backend is not running. Start it: open the backend folder and run  uvicorn main:app --reload");
  }
  if (!response.ok) {
    // FastAPI sends either a text message or a list of validation errors
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d) => `${d.loc?.at(-1)}: ${d.msg}`).join(", ")
      : data.detail;
    const error = new Error(detail || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

// React hook: loads data when a page opens. Returns { data, error, loading, reload }.
export function useApi(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    api(path)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(reload, [reload]);
  return { data, error, loading, reload };
}

// Show times in Indian time, e.g. "13 Nov, 11:15 pm"
export function formatTime(text) {
  if (!text) return "unknown time";
  return new Date(text).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  });
}

// Open-Meteo times are already Indian time, like "2026-11-13T23:15" -> "13 Nov, 23:15"
export function formatLocal(text) {
  if (!text) return "–";
  const [date, time] = text.split("T");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(date.slice(5, 7)) - 1];
  return `${Number(date.slice(8, 10))} ${month}, ${time.slice(0, 5)}`;
}

// Colours for risk levels: green / yellow / orange / red
export const RISK_COLORS = {
  LOW: "#16a34a",
  MODERATE: "#eab308",
  HIGH: "#f97316",
  VERY_HIGH: "#dc2626",
};
export const RISK_ORDER = { LOW: 1, MODERATE: 2, HIGH: 3, VERY_HIGH: 4 };

// Colours for how bad the flooding on a street is
export const SEVERITY_COLORS = {
  LOW: "#16a34a",
  MODERATE: "#eab308",
  HIGH: "#f97316",
  SEVERE: "#dc2626",
};

/*
  Road condition (the "Detect" step). We sort every reported street into one class:
    DANGEROUS   - verified, and HIGH/SEVERE or water 30 cm or deeper
                  (general flood-safety guidance: ~30 cm of water can float a car)
    MODERATE    - verified, but shallower / less severe
    LIKELY      - not verified yet, but 3+ different people reported it in the last hour
    UNVERIFIED  - only unchecked citizen reports
  We never call a road "safe": a street with no reports only has "no known issues".
*/
export function roadCondition(street) {
  if (street.status !== "VERIFIED") return street.likely_flooded ? "LIKELY" : "UNVERIFIED";
  if (["HIGH", "SEVERE"].includes(street.worst_severity) || street.max_depth_cm >= 30) return "DANGEROUS";
  return "MODERATE";
}

export const CONDITIONS = {
  DANGEROUS: { label: "Dangerous", color: "#dc2626", soft: "bg-red-50 text-red-700 ring-red-600/20" },
  MODERATE: { label: "Moderate risk", color: "#f59e0b", soft: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  LIKELY: { label: "Likely flooded", color: "#9333ea", soft: "bg-purple-50 text-purple-700 ring-purple-600/20" },
  UNVERIFIED: { label: "Unverified", color: "#64748b", soft: "bg-slate-100 text-slate-600 ring-slate-500/20" },
};

// Terrain susceptibility squares: one blue hue, light -> dark (more likely to collect water)
export const TERRAIN_COLORS = { LOW: "#86b6ef", MEDIUM: "#3987e5", HIGH: "#104281" };

// Alerts are for everyone, or for one area. "My areas" are saved in this browser only.
export function getMyAreas() {
  try {
    return JSON.parse(localStorage.getItem("myAreas") || "[]");
  } catch {
    return [];
  }
}
export function setMyAreas(ids) {
  try {
    localStorage.setItem("myAreas", JSON.stringify(ids));
  } catch {
    /* private browsing: just don't remember */
  }
}

export const CHENNAI = [13.0827, 80.2707];
