// Runs on every page (it draws nothing). If the user turned notifications on, it checks for
// new alerts every minute and shows a browser notification for alerts in "my areas".
// Works while the website is open in a tab.
import { useEffect } from "react";
import { api, getMyAreas } from "../api";

const CHECK_EVERY_MS = 60 * 1000;
const LABELS = { OFFICIAL: "Official warning", VERIFIED_REPORT: "Verified report", PREDICTION: "Model prediction (not official)" };

function readSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem("seenAlerts") || "[]"));
  } catch {
    return new Set();
  }
}

export function notificationsOn() {
  try {
    return localStorage.getItem("notify") === "on" && "Notification" in window && Notification.permission === "granted";
  } catch {
    return false;
  }
}

export async function checkForNewAlerts({ silent = false } = {}) {
  const alerts = await api("/api/alerts");
  const seen = readSeen();
  const mine = getMyAreas();
  for (const alert of alerts) {
    if (seen.has(alert.id)) continue;
    seen.add(alert.id);
    const forMe = !mine.length || alert.area_id === null || mine.includes(alert.area_id);
    if (!silent && forMe) {
      new Notification(`${LABELS[alert.alert_type] || "Alert"}: ${alert.title}`, {
        body: `${alert.area_name ? alert.area_name + " · " : ""}${alert.message}`.slice(0, 200),
        tag: `floodwatch-${alert.id}`,
      });
    }
  }
  try {
    localStorage.setItem("seenAlerts", JSON.stringify([...seen].slice(-500)));
  } catch {
    /* ignore */
  }
}

export default function AlertWatcher() {
  useEffect(() => {
    const timer = setInterval(() => {
      if (notificationsOn()) checkForNewAlerts().catch(() => {});
    }, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);
  return null;
}
