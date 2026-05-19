# Shadow View CSV Cleaning Project Plan

## Goal

Create a Python cleaning script for Shadow View raw CSV exports. The script will prepare device scan data before user download by retaining only the fields users need, adding a device-level MGRS count, sorting the results A-Z, and applying 30-minute time-bucket color coding for review.

## Dependency Approach

Use Python's standard library wherever possible. The first implementation should avoid external packages such as `pandas` and `openpyxl`.

Primary standard-library modules:

- `argparse` for command-line options.
- `csv` for reading and writing CSV files.
- `datetime` for parsing event times and creating 30-minute buckets.
- `collections` for in-memory counters and grouping helpers.
- `sqlite3` for scalable sorting and unique-count handling when files are too large to hold in memory.
- `tempfile` and `os` for safe temporary working files.
- `zipfile` and `xml.etree.ElementTree` only if a dependency-free XLSX writer is needed later.

## Input

Raw Shadow View CSV exports may contain thousands to millions of rows and 10 or more columns. Each row represents one device observation.

Required input columns:

- `BSSID`
- `SSID`
- `Accuracy`
- `Event Time`
- `Device Name`
- `MGRS`

The raw file may also contain extra fields such as latitude, longitude, RSSI, channel, manufacturer, source, scan ID, and notes. Those fields are useful during processing but should not appear in the final cleaned CSV unless requirements change.

## Output

The cleaned dataset should keep these columns:

- `BSSID`
- `SSID`
- `Accuracy`
- `Event Time`
- `Device Name`
- `MGRS Unique Count`

Recommended output formats:

- `.csv` for lightweight machine-readable download.
- `.html` for dependency-free visible color coding in a browser.
- `.xlsx` only if spreadsheet-native color coding is required. CSV files cannot store row colors or formatting, and Python's standard library does not include a high-level XLSX writer. If XLSX is required without external dependencies, generate the XLSX package manually with `zipfile` and XML templates.

## Processing Rules

1. Load the raw CSV with the standard-library `csv` module using a streaming approach so very large exports can be handled without loading the entire file into memory.
2. Validate that all required columns are present before processing.
3. Normalize column names by trimming leading and trailing whitespace.
4. Parse `Event Time` as a datetime.
5. Derive a 30-minute time bucket from `Event Time`.
6. Calculate `MGRS Unique Count` per device by grouping rows by `BSSID` and counting distinct non-empty `MGRS` values for that BSSID.
7. Keep only the final output columns.
8. Sort A-Z by `Device Name`, then `SSID`, then `BSSID`, then `Event Time`.
9. Export the cleaned CSV.
10. If visible color coding is required, export a styled HTML table by default. If XLSX is required, generate a minimal styled XLSX file with standard-library `zipfile` and XML.

## Color Coding Plan

Color coding should be based on 30-minute increments from each row's `Event Time`.

Example buckets:

- `2026-05-19 08:00:00` to `2026-05-19 08:29:59`
- `2026-05-19 08:30:00` to `2026-05-19 08:59:59`
- `2026-05-19 09:00:00` to `2026-05-19 09:29:59`

Implementation note: keep the bucket calculation inside the script even if the final CSV does not include the bucket column. The bucket can drive HTML row styles or optional XLSX row formatting.

## Scale Considerations

- Use `csv.DictReader` for streaming reads instead of loading the whole file.
- For small and medium files, perform the MGRS unique count in a first pass by tracking unique MGRS values per BSSID.
- For very large files, use `sqlite3` as a local temporary store so sorting and distinct MGRS counts can be handled without keeping all rows in memory.
- Perform final cleanup and output in a second pass.
- Avoid storing full rows in memory for million-row exports.
- Add clear errors for missing required columns, invalid timestamps, and unreadable files.

## Validation Checklist

- Raw files with extra columns are accepted.
- Missing required columns fail with a clear message.
- Repeated BSSIDs receive the same `MGRS Unique Count`.
- Empty MGRS values are ignored in the unique count.
- Output columns appear in the required order.
- Output rows are sorted A-Z.
- Event times across different 30-minute windows receive different colors in the styled HTML output or optional XLSX output.
- Large CSVs can process without memory spikes.

## Open Decisions

- Confirm whether `MGRS Unique Count` should count distinct MGRS grid locations per `BSSID`, or total sightings per `BSSID`.
- Confirm whether the final user-facing download should be CSV only, CSV plus styled HTML, or optional XLSX.
- Confirm whether A-Z sorting should prioritize `Device Name`, `SSID`, or `BSSID`.
