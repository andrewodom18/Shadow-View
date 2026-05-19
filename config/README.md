# Shadow View Cleaner Config Guide

The cleaner reads settings from `config/shadow_view_cleaner.toml`.

Use this file when Shadow View changes raw CSV headers, when the cleaned output needs different columns, or when sorting/color rules change. The Python script should not need edits for normal column and sorting changes.

## Canonical Names

The script uses internal canonical names such as:

- `bssid`
- `ssid`
- `accuracy`
- `event_time`
- `device_name`
- `mgrs`

These names are stable handles used by the config. Raw CSV headers can change, but the canonical names should usually stay the same.

## Adding Column Aliases

Aliases live under `[input_columns]`.

Example:

```toml
[input_columns]
accuracy = ["Accuracy", "Accuracy Meters", "Accuracy (m)"]
```

With this setting, the cleaner will accept any of these raw CSV headers for the same field:

- `Accuracy`
- `Accuracy Meters`
- `Accuracy (m)`

Aliases are matched case-insensitively and extra spaces around headers are ignored.

## Adding A New Raw Column

If Shadow View adds a new raw column, add a new canonical name under `[input_columns]`.

Example for a new battery column:

```toml
[input_columns]
device_battery = ["Device Battery", "Battery", "Battery %"]
```

Then add it to the output if it should appear in the cleaned CSV:

```toml
[[output_columns]]
source = "device_battery"
header = "Device Battery"
```

## Removing An Output Column

Each cleaned output column is defined by one `[[output_columns]]` block.

To stop exporting `SSID`, remove or comment out this block:

```toml
[[output_columns]]
source = "ssid"
header = "SSID"
```

If a removed column is also listed in `[sort]`, remove it from `sort.columns` too.

## Renaming An Output Header

Change the `header` value in the relevant `[[output_columns]]` block.

Example:

```toml
[[output_columns]]
source = "accuracy"
header = "Accuracy Meters"
```

This changes only the cleaned output header. It does not change which raw input column is read.

## Computed Columns

Computed columns are values created by the script instead of copied directly from the raw CSV.

Current supported computed column:

```toml
[[output_columns]]
computed = "total_sightings"
header = "MGRS Unique Count"
```

Right now, `MGRS Unique Count` is intentionally configured as total sightings per device. The device is grouped by the value in `[sighting_count].device_key`.

To make the header clearer, rename it:

```toml
[[output_columns]]
computed = "total_sightings"
header = "Total Sightings"
```

## Changing The Sighting Device Key

The sighting count groups rows by this canonical column:

```toml
[sighting_count]
device_key = "bssid"
```

For example, changing this to `device_name` would count total sightings per device name instead of per BSSID:

```toml
[sighting_count]
device_key = "device_name"
```

Use `bssid` unless there is a strong reason to group by something else.

## Changing Sort Rules

Sorting is controlled by `[sort]`.

Current sort:

```toml
[sort]
columns = ["device_name", "ssid", "bssid", "event_time"]
case_sensitive = false
```

This sorts A-Z by:

1. Device Name
2. SSID
3. BSSID
4. Event Time

To sort by BSSID first:

```toml
[sort]
columns = ["bssid", "event_time"]
case_sensitive = false
```

Sort columns can be canonical names like `device_name`, or output headers like `Device Name`.

## Changing Color Coding

Color coding is used only for the optional HTML preview. CSV files cannot store colors.

```toml
[color_coding]
enabled = true
event_time_column = "event_time"
bucket_minutes = 30
```

To change color buckets from 30 minutes to 15 minutes:

```toml
bucket_minutes = 15
```

To disable HTML row color coding:

```toml
enabled = false
```

To change colors, edit the `palette` list:

```toml
palette = [
  "#fff2cc",
  "#d9ead3",
  "#cfe2f3"
]
```

Colors must be valid HTML color values.

## Example: Replace SSID With Device Battery

1. Add the battery input alias:

```toml
device_battery = ["Device Battery", "Battery", "Battery %"]
```

2. Remove this output block:

```toml
[[output_columns]]
source = "ssid"
header = "SSID"
```

3. Add this output block:

```toml
[[output_columns]]
source = "device_battery"
header = "Device Battery"
```

4. Remove `ssid` from the sort list if it is no longer needed:

```toml
columns = ["device_name", "bssid", "event_time"]
```

## Running With A Custom Config

The default config is `config/shadow_view_cleaner.toml`.

To use another config file:

```bash
./scripts/clean_shadow_view_csv.py raw.csv cleaned.csv --config config/my_custom_config.toml
```
