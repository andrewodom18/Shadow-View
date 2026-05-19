# Shadow-View

Python helper script for cleaning Shadow View CSV exports.

## Usage

Run the cleaner with standard-library Python:

```bash
python3 scripts/clean_shadow_view_csv.py data/dummy_data.csv output/cleaned_dummy_data.csv
```

To also create a color-coded HTML preview:

```bash
python3 scripts/clean_shadow_view_csv.py data/dummy_data.csv output/cleaned_dummy_data.csv --html-output output/cleaned_dummy_data.html
```

## Configuration

Editable cleanup rules live in `config/shadow_view_cleaner.toml`.

Use that file to change:

- Raw CSV column aliases, such as renaming `Accuracy` to `Accuracy Meters`.
- Output columns and output header names.
- Sort order.
- The device key used for total sighting counts.
- HTML color-bucket settings.

The current `MGRS Unique Count` output column is configured as total sightings per `BSSID`.
