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
- Sorting rules. Sorting is currently disabled by default, with an available rule for `MGRS Unique Count` greatest to least.
- The grouping key used to condense raw rows.
- HTML color-bucket settings.

The current output is condensed to one row per `BSSID`. `MGRS Unique Count` counts distinct non-empty MGRS values for that BSSID.

## Project Layout

The command in `scripts/clean_shadow_view_csv.py` is a thin entrypoint. The cleaner logic lives in the `shadow_view/` package:

- `shadow_view/cli.py`: command-line arguments and user-facing messages.
- `shadow_view/config.py`: TOML config loading and validation.
- `shadow_view/cleaner.py`: top-level CSV cleaning pipeline.
- `shadow_view/sqlite_store.py`: SQLite staging, counting, and sorting.
- `shadow_view/html_preview.py`: optional color-coded HTML output.
- `shadow_view/time_buckets.py`: event-time parsing and color bucket selection.
- `shadow_view/errors.py`: shared cleaner exception.
