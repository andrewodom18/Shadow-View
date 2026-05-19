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

## Backend Integration

The website backend should call the package directly instead of shelling out to the scripts:

```python
from pathlib import Path

from shadow_view import CleanerError, clean_shadow_view_csv

try:
    result = clean_shadow_view_csv(
        "rogue_tower",
        input_csv=Path("/tmp/uploads/raw.csv"),
        output_csv=Path("/tmp/downloads/cleaned.csv"),
        xlsx_output=Path("/tmp/downloads/cleaned.xlsx"),
    )
except CleanerError as exc:
    # Return this as a validation error to the user.
    message = str(exc)
else:
    payload = result.to_dict()
```

Stable cleaner IDs:

- `co_traveler`
- `rogue_tower`

The result object includes `rows_processed`, `rows_written`, `elapsed_seconds`, output paths, headers, cleaner ID, and tool name. `available_cleaners()` returns the registered cleaner metadata for a backend dropdown or validation layer.

## Windows Desktop App

The standalone desktop app entrypoint is:

```bash
python3 scripts/shadow_view_cleaner_app.py
```

The app is designed for offline use. A Windows user can choose a CSV, the app auto-detects whether it is Co-Traveler or Rogue Tower data, then the user chooses which outputs to create and where to save each file.

Build a Windows `.exe` on a Windows machine:

```bat
scripts\build_windows_app.bat
```

That creates:

```text
dist\Shadow View CSV Cleaner.exe
```

Copy that `.exe` to the USB drive. Target computers do not need Python installed.

The cleaner logic remains in the importable `shadow_view` package, so the same code is still ready for the future Shadow View website backend.

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
