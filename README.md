# Shadow-View

Python helper scripts for cleaning Shadow View CSV exports.

## Co-Traveler Usage

Run the Co-Traveler CSV Cleaner with standard-library Python:

```bash
python3 scripts/co_traveler_csv_cleaner.py data/dummy_data.csv output/cleaned_dummy_data.csv
```

To also create a color-coded HTML preview:

```bash
python3 scripts/co_traveler_csv_cleaner.py data/dummy_data.csv output/cleaned_dummy_data.csv --html-output output/cleaned_dummy_data.html
```

To create an Excel workbook where the 30-minute color buckets show up in Excel:

```bash
python3 scripts/co_traveler_csv_cleaner.py data/dummy_data.csv output/cleaned_dummy_data.csv --xlsx-output output/cleaned_dummy_data.xlsx
```

You can write all three outputs in one run by using both `--html-output` and `--xlsx-output`.

## Rogue Tower Usage

Run the Rogue Tower CSV Cleaner with standard-library Python:

```bash
python3 scripts/rogue_tower_csv_cleaner.py data/rogue_tower.csv output/cleaned_rogue_tower.csv
```

To create an Excel workbook with Rogue Tower cell colors:

```bash
python3 scripts/rogue_tower_csv_cleaner.py data/rogue_tower.csv output/cleaned_rogue_tower.csv --xlsx-output output/cleaned_rogue_tower.xlsx
```

The Rogue Tower output keeps `Device Name`, `Device Time`, `MCC`, `MNC`, `Serving Cell`, `MGRS`, `PCI`, `ECI`, `RSRP`, `RSRQ`, `TAC`, `Type`, and `Accuracy`. It sorts `Device Time` latest to earliest. In Excel output, `RSRP` values greater than `70` are red, `Serving Cell` values of `true` are green, and `false` values are red.

## Tests

Run the standard-library test suite:

```bash
python3 -m unittest discover -s tests
```

## Configuration

Editable cleanup rules live in:

- `config/co_traveler_csv_cleaner.toml`
- `config/rogue_tower_csv_cleaner.toml`

Use that file to change:

- Raw CSV column aliases, such as renaming `Accuracy` to `Accuracy Meters`.
- Output columns and output header names.
- Sorting rules. The current default sorts `MGRS Unique Count` greatest to least.
- The grouping key used to condense raw rows.
- HTML and Excel color-bucket settings.
- Rogue Tower cell color rules for Excel output.

The current output is condensed to one row per `BSSID`. `MGRS Unique Count` counts distinct non-empty MGRS values for that BSSID.

## Project Layout

The commands in `scripts/co_traveler_csv_cleaner.py` and `scripts/rogue_tower_csv_cleaner.py` are thin entrypoints. The shared cleaner logic lives in the `shadow_view/` package:

- `shadow_view/cli.py`: command-line arguments and user-facing messages.
- `shadow_view/config.py`: TOML config loading and validation.
- `shadow_view/cleaner.py`: top-level CSV cleaning pipeline.
- `shadow_view/sqlite_store.py`: SQLite staging, counting, and sorting.
- `shadow_view/html_preview.py`: optional color-coded HTML output.
- `shadow_view/xlsx_output.py`: optional color-coded Excel workbook output.
- `shadow_view/time_buckets.py`: event-time parsing and color bucket selection.
- `shadow_view/errors.py`: shared cleaner exception.
