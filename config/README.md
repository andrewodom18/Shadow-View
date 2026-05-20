# Shadow View CSV Cleaner Config Guide

The cleaners read settings from tool-specific config files:

- `config/co_traveler_csv_cleaner.toml`
- `config/rogue_tower_csv_cleaner.toml`

Use these files when Shadow View changes raw CSV headers, when the cleaned output needs different columns, or when sorting/color rules change. The Python script should not need edits for normal column and sorting changes.

## Canonical Names

The script uses internal canonical names such as:

- `bssid`
- `ssid`
- `accuracy`
- `event_time`
- `device_name`
- `mgrs`
- `device_time`
- `serving_cell`
- `rsrp`

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

If an export contains duplicate matching headers, the cleaner samples the first rows and uses the matching column with the most non-empty values. This handles exports that include repeated headers such as `Bssid`, `Accuracy`, `Device Name`, or `Ssid`.

## Grouping Rows

Grouped output is controlled by `[grouping]`.

```toml
[grouping]
enabled = true
key = "bssid"
multi_value_separator = " | "
```

With this enabled, the cleaner writes one output row per BSSID. `Total Sightings`
shows how many raw CSV rows were grouped into that BSSID. If a regular text field
has more than one value for the same BSSID, the values are combined into a
separated list.

Example output:

```text
CoffeeGuest | CoffeeGuest-Backup
```

Change `multi_value_separator` if another separator is preferred.

## Output Column Aggregates

Each cleaned output column is defined by one `[[output_columns]]` block.

When grouping is enabled, source columns can define an `aggregate`.

Supported aggregates:

- `group_key`: use the grouped value directly. Use this for `BSSID`.
- `distinct_list`: combine unique non-empty values into a separated list.
- `average`: average numeric values and round to the nearest whole number. Use this for `Accuracy`.
- `datetime_range`: output the first-to-last event datetime range. Use this for `Event Time`.

Current examples:

```toml
[[output_columns]]
source = "bssid"
header = "BSSID"
aggregate = "group_key"

[[output_columns]]
source = "accuracy"
header = "Accuracy"
aggregate = "average"

[[output_columns]]
source = "event_time"
header = "Event Time"
aggregate = "datetime_range"
```

If `aggregate` is omitted while grouped output is enabled, the cleaner defaults to:

- `group_key` for the configured grouping key.
- `average` for `accuracy`.
- `datetime_range` for `event_time`.
- `distinct_list` for other source columns.

## Computed Columns

Computed columns are values created by the script instead of copied directly from the raw CSV.

Current supported computed columns:

```toml
[[output_columns]]
computed = "total_sightings"
header = "Total Sightings"

[[output_columns]]
computed = "unique_mgrs_count"
header = "MGRS Unique Count"
```

`total_sightings` counts raw CSV rows per grouped BSSID.

`unique_mgrs_count` counts unique valid MGRS locations for each grouped BSSID.
Blank or invalid MGRS values are ignored. Locations within the configured
distance threshold count as the same location, so minor MGRS differences do not
inflate the count. A moving path still creates a new unique location once it is
outside the threshold from the first location in that bucket.

```toml
[mgrs_unique_count]
distance_threshold_meters = 50
```

If `[mgrs_unique_count]` is omitted, `distance_threshold_meters` defaults to `50`.
Set it lower or higher if you want a tighter or looser location range.

`[sighting_count]` is kept for the non-grouped mode. With the current grouped output, leave `[grouping].key` set to `bssid` unless the grouping behavior itself should change.

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
aggregate = "distinct_list"
```

## Removing An Output Column

To stop exporting `SSID`, remove or comment out this block:

```toml
[[output_columns]]
source = "ssid"
header = "SSID"
aggregate = "distinct_list"
```

If a removed column is also listed in `[sort].rules`, remove that sort rule too.

## Renaming An Output Header

Change the `header` value in the relevant `[[output_columns]]` block.

Example:

```toml
[[output_columns]]
source = "accuracy"
header = "Average Accuracy"
aggregate = "average"
```

This changes only the cleaned output header. It does not change which raw input column is read.

## Changing Sort Rules

Sorting is controlled by `[sort]`. The current default sorts `MGRS Unique Count`
greatest to least, then `Total Sightings` greatest to least.

Current setting:

```toml
[sort]
enabled = true
case_sensitive = false
rules = [
  { column = "MGRS Unique Count", direction = "desc", value_type = "number" },
  { column = "Total Sightings", direction = "desc", value_type = "number" }
]
```

To turn sorting off and keep grouped rows in first-seen BSSID order, change only this line:

```toml
enabled = false
```

Sort rules use:

- `column`: a canonical source name such as `bssid`, or an output header such as `MGRS Unique Count`.
- `direction`: `asc` or `desc`.
- `value_type`: `text`, `number`, or `datetime`.

To sort by BSSID A-Z instead:

```toml
[sort]
enabled = true
case_sensitive = false
rules = [
  { column = "bssid", direction = "asc", value_type = "text" }
]
```

When grouped output is enabled, sort columns should refer to output columns by canonical source name or output header.

## Changing Row Color Coding

Color coding is used for the optional HTML preview and optional Excel workbook. CSV files cannot store colors.

```toml
[color_coding]
enabled = true
event_time_column = "event_time"
bucket_minutes = 30
```

For grouped rows, the color is based on the first event time in the event-time range.

To change color buckets from 30 minutes to 15 minutes:

```toml
bucket_minutes = 15
```

To disable row color coding in HTML and Excel outputs:

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

Colors should be hex values such as `#fff2cc` if the workbook should show the same fills in Excel.

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
aggregate = "distinct_list"
```

3. Add this output block:

```toml
[[output_columns]]
source = "device_battery"
header = "Device Battery"
aggregate = "distinct_list"
```

4. Remove `ssid` from the sort list if it is no longer needed:

```toml
columns = ["device_name", "bssid", "event_time"]
```

## Running With A Custom Config

Each script has its own default config. Co-Traveler uses `config/co_traveler_csv_cleaner.toml`, and Rogue Tower uses `config/rogue_tower_csv_cleaner.toml`.

To use another config file:

```bash
./scripts/co_traveler_csv_cleaner.py raw.csv cleaned.csv --config config/my_custom_config.toml
```

## Excel Output

Use `--xlsx-output` when the cleaned file needs visible colors in Excel:

```bash
./scripts/co_traveler_csv_cleaner.py raw.csv cleaned.csv --xlsx-output cleaned.xlsx
```

```bash
./scripts/rogue_tower_csv_cleaner.py raw.csv cleaned.csv --xlsx-output cleaned.xlsx
```

The workbook uses the same `[color_coding]` settings as the HTML preview. The regular CSV is still written because it is the simplest file for backend workflows and imports.

## Changing Excel Cell Color Rules

Rogue Tower cell colors are controlled by `[cell_color_rules]`.

```toml
[cell_color_rules]
enabled = true

[[cell_color_rules.rules]]
column = "RSRP"
operator = "greater_than"
value = 70
color = "#f4cccc"
```

Supported operators are:

- `greater_than`
- `greater_than_or_equal`
- `less_than`
- `less_than_or_equal`
- `equals`
- `not_equals`

The `column` value must match a cleaned output header, such as `RSRP` or `Serving Cell`. Cell color rules are applied to the optional Excel workbook written with `--xlsx-output`.
