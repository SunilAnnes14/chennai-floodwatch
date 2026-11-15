"""
risk.py - A simple flood RISK SCORE. This is EXPERIMENTAL.

It is NOT a trained machine-learning model and has NOT been tested against
real floods. It just combines two simple ideas:
  1. More rain (past 24 h + next 24 h) = more risk
  2. Lower ground (elevation) = more risk

Rain levels use India Meteorological Department (IMD) 24-hour categories:
  heavy rain = 64.5 mm or more, very heavy = 115.6 mm or more,
  extremely heavy = 204.5 mm or more.
"""


def rain_points(total_mm):
    if total_mm >= 204.5:
        return 3   # extremely heavy
    if total_mm >= 115.6:
        return 2   # very heavy
    if total_mm >= 64.5:
        return 1   # heavy
    return 0


def calculate_risk(rain_last_24h, rain_next_24h, elevation_m):
    # If data is missing we do NOT guess - we say we can't calculate it.
    if rain_last_24h is None or rain_next_24h is None or elevation_m is None:
        return {"level": None, "reason": "Not enough data to calculate risk"}

    total_rain = rain_last_24h + rain_next_24h
    points = rain_points(total_rain)

    # Low-lying ground floods more easily (much of Chennai is below 10 m)
    if points > 0 and elevation_m < 10:
        points += 1

    levels = ["LOW", "MODERATE", "HIGH", "VERY_HIGH", "VERY_HIGH"]
    return {
        "level": levels[points],
        "reason": f"{total_rain:.1f} mm rain (past 24 h + next 24 h), elevation {elevation_m:.0f} m",
    }
