# Shadow-View

Python helper scripts for cleaning Shadow View CSV exports.

## Local Folders

The command examples use these local folders:

- `data/`: put raw Shadow View CSV exports here.
- `output/`: cleaned files are written here.

Create them before running the CLI examples:

```bash
mkdir -p data output
```

The Windows desktop app does not require these folders. It lets the user choose the input CSV and save locations through the UI.

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

Build the USB-ready Windows bundle from GitHub on any computer, including a Mac:

1. Push the repo to GitHub.
2. Open the repo's **Actions** tab.
3. Select **Build Windows App**.
4. Click **Run workflow**.
5. To also attach the files to an existing GitHub release, enter that release tag in `release_tag`.
6. Open the completed run.
7. Download the artifact named **Shadow View USB Bundle - Windows**.
8. Unzip the downloaded artifact and copy its contents to the USB drive.

The bundle includes:

```text
START HERE - Shadow View.txt
Shadow View CSV Cleaner.exe
Shadow View Web App.exe
```

Target computers do not need Python, Node, npm, or this repository.

The cleaner logic remains in the importable `shadow_view` package, so the same code is still ready for the future Shadow View website backend.

The Windows build uses `assets/shadow_view_cleaner_icon.ico` as the app icon. To regenerate the icon assets:

```bash
python3 scripts/generate_app_icon.py
```

## USB Handoff

Use the complete USB bundle when giving the tools to a nontechnical Windows user. It provides both workflows:

- `Shadow View CSV Cleaner.exe`: quick desktop CSV cleaner.
- `Shadow View Web App.exe`: starts the local backend, opens the browser frontend, and supports map review plus **Clean & Export** downloads.

The user should copy the bundle folder from the USB drive to their Desktop, open `START HERE - Shadow View.txt`, then double-click whichever tool they want to use.

Detailed distribution steps are in `docs/USB_DISTRIBUTION.md`.

## Shadow View Map Web App

The Kepler.gl map MVP lives in `web_app/`. It lets a user upload a raw Shadow View CSV, choose a BSSID, and view:

- Scanner locations where the selected BSSID was seen.
- Detection-radius rings around scanner locations, based on the CSV `Accuracy` value.
- A time-ordered scanner trail between sightings.
- Original CSV row details for the selected sighting.
- Parse status, rows scanned, rows mapped, skipped rows, and time taken.
- Cleaner downloads generated by the Python cleaner API as CSV, Excel, and HTML outputs.
- Threat indicator detection for BSSIDs that appear near the scanner across
  multiple MGRS scanner locations over time. The CSV `Accuracy` value is treated
  as the detection radius from the scanner to the BSSID, not as the BSSID's exact
  coordinate.

Run the frontend locally:

```bash
cd web_app
npm install
npm run dev
```

Open the local URL printed by Vite, usually:

```text
http://127.0.0.1:5173/
```

The map works by itself in the browser. To enable **Clean & Export** downloads during frontend development, keep the Python API running from the repository root in a second terminal:

```bash
python3 -m shadow_view.web_server
```

If you are already inside `web_app/`, the same server is available as:

```bash
npm run api
```

Vite proxies `/api` to `http://127.0.0.1:8765/`.

Build the production web bundle:

```bash
cd web_app
npm run build
```

Serve the built web app and cleaner API together:

```bash
cd ..
python3 -m shadow_view.web_server
```

Then open:

```text
http://127.0.0.1:8765/
```

For nontechnical Windows users, ship `Shadow View Web App.exe` from the USB bundle instead of asking them to run these commands.

Use Kepler's native map-style tool to switch basemaps. The app provides Street, Satellite Imagery, and Dark styles there. Street and Dark use Carto online styles, and Satellite Imagery uses online raster tiles, so those basemaps require network access.

Threat detection defaults are loaded from:

```text
web_app/public/threat-detection-config.json
```

Each severity can define minimum and maximum unique scanner-location clusters with
the `minScans*` and `maxScans*` fields. Set a `maxScans*` value to `null` for no
upper limit. The web app also lets users adjust the active threat criteria in
the sidebar and stores those changes in the browser.

Run the web app smoke test:

```bash
cd web_app
npm test
```

## Configuration

Editable cleanup rules live in:

- `config/co_traveler_csv_cleaner.toml`
- `config/rogue_tower_csv_cleaner.toml`

Use that file to change:

- Raw CSV column aliases, such as renaming `Accuracy` to `Accuracy Meters`.
- Output columns and output header names.
- Sorting rules. The current default sorts `MGRS Unique Count` greatest to least,
  then `Total Sightings` greatest to least.
- The grouping key used to condense raw rows.
- The MGRS unique-location distance threshold. The default is `50` meters,
  matching leadership's 40-50 meter range.
- HTML and Excel color-bucket settings.
- Rogue Tower cell color rules for Excel output.

The current output is condensed to one row per `BSSID`. `Total Sightings` shows
how many raw rows were grouped into that BSSID, and `MGRS Unique Count` counts
unique valid scanner MGRS locations for that BSSID, ignoring blank or invalid
MGRS values and treating locations within the configured meter threshold as the
same location.

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
