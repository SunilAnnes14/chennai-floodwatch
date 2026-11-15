"""
train.py - OPTIONAL. Trains a simple machine-learning model, but ONLY if you have REAL data.

The website does not use this yet. It uses the simple rule in backend/risk.py.

What you need: a CSV file of REAL past observations, one row per area per day:
    rain_24h, elevation_m, flooded
    132.5,    6,           1        <- flooded = 1 if flooding was really recorded that day
    12.0,     15,          0

Where real flood records can come from: Greater Chennai Corporation water-stagnation
complaints, news reports with dates and places, or government flood maps.
Do NOT invent rows - the accuracy numbers would be meaningless.

Setup:  pip install pandas scikit-learn
Usage:  python train.py my_real_data.csv
"""
import sys

import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report

if len(sys.argv) != 2:
    print(__doc__)
    sys.exit(1)

data = pd.read_csv(sys.argv[1]).dropna()  # drop rows with missing values (no guessing)
if data["flooded"].sum() < 20:
    print("Fewer than 20 real flood records - not enough to train a trustworthy model.")
    sys.exit(1)

# Split by time: train on the older 80%, test on the newest 20% (rows must be in date order)
split = int(len(data) * 0.8)
train, test = data.iloc[:split], data.iloc[split:]
features = ["rain_24h", "elevation_m"]

model = LogisticRegression(class_weight="balanced")
model.fit(train[features], train["flooded"])

print("Results on the held-out test data:")
print(classification_report(test["flooded"], model.predict(test[features]), zero_division=0))
