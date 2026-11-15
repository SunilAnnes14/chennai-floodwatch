// App.test.jsx - frontend tests.  Run with:  npm test
// The backend is replaced by a fake "fetch" so tests work without a server.
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App";

// The test browser (jsdom) cannot draw real maps, so map parts become simple <div>s here.
// The real map is checked by opening the website in a browser.
vi.mock("react-leaflet", () => {
  const Box = ({ children }) => <div>{children}</div>;
  const Nothing = () => null;
  const LayersControl = Object.assign(Box, { Overlay: Box });
  return {
    MapContainer: Box, LayerGroup: Box, LayersControl, CircleMarker: Box, Popup: Box,
    TileLayer: Nothing, Polyline: Nothing, ZoomControl: Nothing, Rectangle: Box, ImageOverlay: Nothing,
    useMap: () => ({ flyTo: () => {}, fitBounds: () => {} }), useMapEvents: () => null,
  };
});

const fakeWeather = {
  updated_at: "2026-11-13T23:15",
  source: "Open-Meteo",
  areas: [{
    area_id: 1, name: "Velachery", latitude: 12.98, longitude: 80.22, elevation_m: 9, temperature_c: 26,
    rain_last_1h: 0.5, rain_last_3h: 1, rain_last_24h: 12.5, rain_next_24h: 3, max_chance_next_24h: 40,
    data_time: "2026-11-13T23:15", hourly: [{ time: "2026-11-13T22:00", rain_mm: 0.5, chance: 30 }],
  }],
};
const fakeRisk = {
  updated_at: "2026-11-13T23:15", experimental: true,
  areas: [{ area_id: 1, name: "Velachery", latitude: 12.98, longitude: 80.22, risk_level: "HIGH", reason: "test reason" }],
};

const street = (name, locality, area, status, severity, depth) => ({
  street_name: name, locality, area, status, worst_severity: severity, max_depth_cm: depth,
  verified_reports: status === "VERIFIED" ? 1 : 0, unverified_reports: status === "VERIFIED" ? 0 : 1,
  latitude: 12.98, longitude: 80.22, latest_report_at: "2026-11-13T10:00:00+00:00",
  segments: [{ report_id: depth, status, severity, points: [[12.98, 80.22], [12.981, 80.221]], latitude: 12.98, longitude: 80.22 }],
});
const fakeStreets = {
  generated_at: "2026-11-13T10:00:00+00:00", source: "citizen reports",
  streets: [
    street("Velachery Bypass Road", "Gangai Nagar", "Velachery", "VERIFIED", "SEVERE", 90),
    street("100 Feet Road", "Vijaya Nagar", "Velachery", "UNVERIFIED", "MODERATE", 30),
    street("Gopathi Narayanaswami Road", "Ward 136", "T. Nagar", "VERIFIED", "HIGH", 45),
    { ...street("Taramani Link Road", "Taramani", "Perungudi", "UNVERIFIED", "HIGH", 50),
      likely_flooded: true, independent_reporters: 3 },
  ],
};
const fakeAlerts = [
  { id: 1, title: "Heavy rain warning", message: "Stay safe", alert_type: "OFFICIAL", source: "IMD",
    created_at: "2026-11-13T10:00:00+00:00", area_id: null, area_name: null, is_automatic: 0 },
  { id: 2, title: "High flood risk predicted for Adyar", message: "Model says high", alert_type: "PREDICTION",
    source: "FloodWatch model (automatic)", created_at: "2026-11-13T11:00:00+00:00", area_id: 5, area_name: "Adyar", is_automatic: 1 },
];
const fakeAreas = [{ id: 1, name: "Velachery" }, { id: 5, name: "Adyar" }];
// A tiny 2 x 2 forecast grid with 3 hours; at hour 2 it rains 3 mm/h in the north-east corner
const grid = (a, b, c, d) => [[a, b], [c, d]];
const fakeGrid = {
  lats: [12.9, 13.0], lons: [80.1, 80.2],
  times: ["2026-11-15T00:00", "2026-11-15T01:00", "2026-11-15T02:00"],
  rain_mm: [grid(0, 0, 0, 0), grid(0, 0, 0, 1), grid(0, 0, 0, 3)],
  rain_chance: [grid(10, 10, 10, 10), grid(20, 20, 20, 20), grid(80, 80, 80, 80)],
  wind_kmh: [grid(10, 10, 10, 10), grid(12, 12, 12, 12), grid(15, 15, 15, 15)],
  wind_from_deg: [grid(90, 90, 90, 90), grid(90, 90, 90, 90), grid(180, 180, 180, 180)],
  temperature_c: [grid(26, 26, 27, 27), grid(26, 26, 27, 27), grid(25, 25, 26, 26)],
  source: "Open-Meteo", note: "Approximate: weather models have a resolution of about 10-25 km.",
};

// Pretend backend: returns data depending on the URL
function fakeBackend(url) {
  const answers = {
    "/api/weather": fakeWeather,
    "/api/risk": fakeRisk,
    "/api/reports": [],
    "/api/alerts": fakeAlerts,
    "/api/road-closures": [],
    "/api/streets": fakeStreets,
    "/api/areas": fakeAreas,
    "/api/shelters": [],
    "/api/waterlogging": [],
    "/api/terrain": { cells: [], built: false, cell_size_deg: 0.006, source: "", note: "" },
    "/api/tide": { hours: [], turns: [], source: "Open-Meteo Marine", location: "Sea near the Adyar river mouth" },
    "/api/risk/track-record": { levels: {}, total_predictions: 0, note: "few data" },
    "/api/forecast-grid": fakeGrid,
    "/api/radar": { frames: [{ time: 1763200000, tile_url: "https://tiles.example/{z}/{x}/{y}.png" }], note: "Observed radar" },
  };
  const body = answers[url];
  return Promise.resolve({ ok: body !== undefined, status: body ? 200 : 404, text: () => promiseJson(body ?? {}) });
}

// Fake responses give their body as text, like a real server
function promiseJson(body) {
  return Promise.resolve(JSON.stringify(body));
}

function openPage(path) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

beforeEach(() => {
  global.fetch = vi.fn(fakeBackend);
  localStorage.clear();
});

describe("every page opens", () => {
  const pages = [
    ["/", "Chennai FloodWatch"],
    ["/map", "Live Flood Map"],
    ["/streets", "Affected Streets"],
    ["/weather", "Weather Monitoring"],
    ["/report", "Report Flooding"],
    ["/predictions", "Flood Predictions"],
    ["/routes", "Safe Routes"],
    ["/alerts", "Alerts"],
    ["/about", "About Chennai FloodWatch"],
    ["/admin", "Admin Login"],
  ];
  test.each(pages)("%s shows its heading", async (path, heading) => {
    openPage(path);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });
});

test("home page shows real backend data", async () => {
  openPage("/");
  expect(await screen.findByText("12.5 mm")).toBeInTheDocument();
  expect(await screen.findByText("Heavy rain warning")).toBeInTheDocument();
});

test("weather page shows a clear message when the service is down", async () => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 503,
    text: () => promiseJson({ detail: "Open-Meteo is unavailable" }) }));
  openPage("/weather");
  expect(await screen.findByRole("alert")).toHaveTextContent("Open-Meteo is unavailable");
});

test("clear message when the backend is not running", async () => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("") }));
  openPage("/weather");
  expect(await screen.findByRole("alert")).toHaveTextContent("backend is not running");
});

test("every navigation link works", async () => {
  openPage("/");
  const nav = screen.getByRole("navigation");
  const links = within(nav).getAllByRole("link").filter((a) => a.getAttribute("aria-label") !== "FloodWatch home");
  for (const link of links) {
    fireEvent.click(link);
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
  }
});

test("report form needs a location before sending", async () => {
  openPage("/report");
  fireEvent.change(screen.getByLabelText(/Location name/), { target: { value: "Velachery Main Road" } });
  fireEvent.change(screen.getByLabelText(/Water depth/), { target: { value: "30" } });
  fireEvent.click(screen.getByLabelText(/^High/));
  fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("choose the location");
});

test("report form: GPS location + submit shows confirmation", async () => {
  navigator.geolocation = {
    getCurrentPosition: (success) => success({ coords: { latitude: 12.98, longitude: 80.22, accuracy: 10 } }),
  };
  global.fetch = vi.fn((url, options) => {
    if (url === "/api/reports" && options?.method === "POST") {
      return Promise.resolve({ ok: true, status: 201,
        text: () => promiseJson({ id: 7, status: "PENDING", message: "Thanks" }) });
    }
    return fakeBackend(url);
  });
  openPage("/report");
  fireEvent.change(screen.getByLabelText(/Location name/), { target: { value: "Velachery Main Road" } });
  fireEvent.change(screen.getByLabelText(/Water depth/), { target: { value: "30" } });
  fireEvent.click(screen.getByLabelText(/^High/));
  fireEvent.click(screen.getByRole("button", { name: /Use my GPS/ }));
  fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
  expect(await screen.findByRole("heading", { name: "Report received" })).toBeInTheDocument();
  expect(screen.getByText("#7")).toBeInTheDocument();
});

test("GPS permission denied shows a helpful message", async () => {
  navigator.geolocation = { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) };
  openPage("/report");
  fireEvent.click(screen.getByRole("button", { name: /Use my GPS/ }));
  expect(await screen.findByText(/permission denied/)).toBeInTheDocument();
});

test("admin dashboard redirects to login when not logged in", async () => {
  openPage("/admin/dashboard");
  await waitFor(() => expect(screen.getByRole("heading", { name: "Admin Login" })).toBeInTheDocument());
});

test("wrong admin password shows an error", async () => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 401,
    text: () => promiseJson({ detail: "Wrong email or password" }) }));
  openPage("/admin");
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope" } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password");
});

describe("affected streets page", () => {
  test("lists streets grouped by area", async () => {
    openPage("/streets");
    expect(await screen.findByText("Velachery Bypass Road")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Velachery/ })).toHaveTextContent("2 streets");
    expect(screen.getByRole("heading", { level: 2, name: /T. Nagar/ })).toHaveTextContent("1 street");
    expect(screen.getByText("90 cm")).toBeInTheDocument();
  });

  test("search filters streets", async () => {
    openPage("/streets");
    await screen.findByText("Velachery Bypass Road");
    fireEvent.change(screen.getByLabelText("Search streets"), { target: { value: "gopathi" } });
    expect(screen.getByText("Gopathi Narayanaswami Road")).toBeInTheDocument();
    expect(screen.queryByText("Velachery Bypass Road")).not.toBeInTheDocument();
  });

  test("filter chips show only one road condition", async () => {
    openPage("/streets");
    await screen.findByText("100 Feet Road");
    fireEvent.click(screen.getByRole("button", { name: "Dangerous" }));
    expect(screen.queryByText("100 Feet Road")).not.toBeInTheDocument();
    expect(screen.getByText("Velachery Bypass Road")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unverified" }));
    expect(screen.getByText("100 Feet Road")).toBeInTheDocument();
    expect(screen.queryByText("Velachery Bypass Road")).not.toBeInTheDocument();
  });

  test("streets are classed as dangerous / moderate / unverified, never safe", async () => {
    openPage("/streets");
    const card = (name) => screen.getByText(name).closest("button");
    await screen.findByText("Velachery Bypass Road");
    expect(within(card("Velachery Bypass Road")).getByText("Dangerous")).toBeInTheDocument();  // SEVERE, 90 cm
    expect(within(card("100 Feet Road")).getByText("Unverified")).toBeInTheDocument();
    expect(within(screen.getByRole("main")).queryByText(/safe/i)).not.toBeInTheDocument(); // ("Safe Routes" in the menu is fine)
  });

  test("empty state when nothing is reported", async () => {
    global.fetch = vi.fn((url) => url === "/api/streets"
      ? Promise.resolve({ ok: true, status: 200, text: () => promiseJson({ streets: [], generated_at: null, source: "" }) })
      : fakeBackend(url));
    openPage("/streets");
    expect(await screen.findByText(/No flooded streets have been reported/)).toBeInTheDocument();
  });
});

test("road condition rules", async () => {
  const { roadCondition } = await import("./api");
  const base = { status: "VERIFIED", worst_severity: "MODERATE", max_depth_cm: 15 };
  expect(roadCondition(base)).toBe("MODERATE");
  expect(roadCondition({ ...base, max_depth_cm: 30 })).toBe("DANGEROUS");     // 30 cm or deeper
  expect(roadCondition({ ...base, worst_severity: "HIGH" })).toBe("DANGEROUS");
  expect(roadCondition({ ...base, status: "UNVERIFIED", max_depth_cm: 100 })).toBe("UNVERIFIED");
});

test("alerts can be filtered by type", async () => {
  openPage("/alerts");
  expect(await screen.findByText("Heavy rain warning")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Model prediction" }));
  expect(screen.queryByText("Heavy rain warning")).not.toBeInTheDocument();
  expect(screen.getByText("High flood risk predicted for Adyar")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Verified citizen report" }));
  expect(screen.getByText(/no active alerts/)).toBeInTheDocument();
});

test("home page shows the Predict, Detect, Alert steps", async () => {
  openPage("/");
  for (const step of ["Predict", "Detect", "Alert"]) {
    expect(await screen.findByRole("heading", { level: 3, name: step })).toBeInTheDocument();
  }
});

// ---------------- Predict -> Detect -> Alert improvements ----------------

// Answers one extra URL (starting with `prefix`), everything else from the normal fake backend
function withExtra(prefix, body, ok = true) {
  global.fetch = vi.fn((url) => (url.startsWith(prefix)
    ? Promise.resolve({ ok, status: ok ? 200 : 404, text: () => promiseJson(body) })
    : fakeBackend(url)));
}

test("streets reported by 3+ people show as 'Likely flooded'", async () => {
  openPage("/streets");
  const card = (await screen.findByText("Taramani Link Road")).closest("button");
  expect(within(card).getByText("Likely flooded")).toBeInTheDocument();
  expect(within(card).getByText(/3 different people/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Likely flooded" }));
  expect(screen.queryByText("100 Feet Road")).not.toBeInTheDocument();
});

test("check your street shows the street-level prediction and its reasons", async () => {
  withExtra("/api/street-risk", {
    predicted_level: "HIGH", explanation: "96 mm rain; flood-prone spot raises the level one step", flood_history: 2,
    weather_available: true, reported_nearby: [],
    susceptibility: { level: "HIGH", score: 0.8, reasons: ["about 1 m above the nearby water level"] },
  });
  openPage("/predictions");
  fireEvent.change(await screen.findByLabelText("Street name"), { target: { value: "Velachery Bypass Road" } });
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
  expect(await screen.findByText(/flood-prone spot raises the level/)).toBeInTheDocument();
  expect(screen.getByText("about 1 m above the nearby water level", { exact: false })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith("/api/street-risk?q=Velachery%20Bypass%20Road", expect.anything());
});

test("my areas filter hides alerts for other areas", async () => {
  openPage("/alerts");
  expect(await screen.findByText("High flood risk predicted for Adyar")).toBeInTheDocument();
  expect(screen.getByText("Automatic")).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Velachery" }));   // my area = Velachery
  fireEvent.click(screen.getByLabelText("Only my areas"));
  expect(screen.queryByText("High flood risk predicted for Adyar")).not.toBeInTheDocument();
  expect(screen.getByText("Heavy rain warning")).toBeInTheDocument();          // all-Chennai alerts stay
  expect(JSON.parse(localStorage.getItem("myAreas"))).toEqual([1]);
});

test("evacuation mode routes to the nearest shelter", async () => {
  withExtra("/api/evacuate", {
    start: [12.91, 80.07], end: [12.92, 80.08], has_road_info: false, warning: "No route is guaranteed safe.",
    shelter: { id: 1, name: "Corporation School Mudichur", capacity: 300, source: "GCC list" }, other_shelters: [],
    routes: [{ distance_km: 2.1, duration_min: 6, coordinates: [[12.91, 80.07], [12.92, 80.08]],
               closures_on_route: [], verified_floods_on_route: [], is_detour: false }],
  });
  openPage("/routes");
  fireEvent.click(screen.getByRole("tab", { name: /Evacuate to shelter/ }));
  fireEvent.change(screen.getByLabelText("Where are you?"), { target: { value: "Mudichur" } });
  fireEvent.click(screen.getByRole("button", { name: /Route to nearest shelter/ }));
  expect(await screen.findByText("Corporation School Mudichur")).toBeInTheDocument();
  expect(screen.getByText(/2.1 km/)).toBeInTheDocument();
});

test("a detour route is labelled", async () => {
  withExtra("/api/route", {
    start: [12.98, 80.22], end: [13.04, 80.23], has_road_info: true, warning: "No route is guaranteed safe.",
    routes: [{ distance_km: 9.5, duration_min: 15, coordinates: [], closures_on_route: [], verified_floods_on_route: [], is_detour: true }],
  });
  openPage("/routes");
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "Velachery" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "T. Nagar" } });
  fireEvent.click(screen.getByRole("button", { name: "Find routes" }));
  expect(await screen.findByText("Detour")).toBeInTheDocument();
});

test("weather page shows tides", async () => {
  openPage("/weather");
  expect(await screen.findByRole("heading", { name: /Sea level/ })).toBeInTheDocument();
});

// ---------------- Forecast Map ----------------

test("forecast map shows when the heaviest rain is expected and can jump there", async () => {
  openPage("/forecast");
  expect(await screen.findByRole("heading", { level: 1, name: "Forecast Map" })).toBeInTheDocument();
  expect(screen.getByText(/up to 3.0 mm\/h/)).toBeInTheDocument();
  const slider = screen.getByLabelText("Forecast hour");
  fireEvent.click(screen.getByRole("button", { name: "Show on map" }));
  expect(slider.value).toBe("2");
  fireEvent.change(slider, { target: { value: "0" } });
  expect(slider.value).toBe("0");
});

test("forecast map layer buttons and play button", async () => {
  openPage("/forecast");
  const temperature = await screen.findByRole("radio", { name: /Temperature/ });
  fireEvent.click(temperature);
  expect(temperature).toHaveAttribute("aria-checked", "true");
  expect(screen.getByText("Temperature (°C)")).toBeInTheDocument();     // legend changed
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Radar \(observed\)/ }));
  expect(screen.getByText(/Observed radar/)).toBeInTheDocument();
});

test("forecast map says clearly when the forecast service is down", async () => {
  global.fetch = vi.fn((url) => (url === "/api/forecast-grid"
    ? Promise.resolve({ ok: false, status: 503, text: () => promiseJson({ detail: "Open-Meteo is unavailable" }) })
    : fakeBackend(url)));
  openPage("/forecast");
  expect(await screen.findByRole("alert")).toHaveTextContent("Forecast unavailable");
});

test("forecast maths: blending between points and wind direction", async () => {
  const { valueAt, windVector, colourFor, compassName } = await import("./forecast/grid");
  const lats = [12.9, 13.0], lons = [80.1, 80.2];
  const table = [[0, 0], [0, 4]];
  expect(valueAt(table, lats, lons, 13.0, 80.2)).toBeCloseTo(4);     // exactly on a point
  expect(valueAt(table, lats, lons, 12.95, 80.15)).toBeCloseTo(1);   // middle: (0+0+0+4)/4
  expect(valueAt(table, lats, lons, 14, 81)).toBeCloseTo(4);         // outside -> nearest edge
  const fromEast = windVector(10, 90);                                // wind FROM the east blows WEST
  expect(fromEast.u).toBeCloseTo(-10);
  expect(fromEast.v).toBeCloseTo(0);
  expect(windVector(10, 0).v).toBeCloseTo(-10);                       // from the north blows south
  expect(compassName(225)).toBe("SW");
  expect(colourFor("rain", 0.1)).toEqual([134, 182, 239]);           // lightest blue for light rain
  expect(colourFor("rain", 100)).toEqual([13, 54, 107]);             // darkest for very heavy rain
});
