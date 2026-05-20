from __future__ import annotations

import csv
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from shadow_view.cleaner import clean_csv


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = PROJECT_ROOT / "config" / "co_traveler_csv_cleaner.toml"
CLI_SCRIPT = PROJECT_ROOT / "scripts" / "co_traveler_csv_cleaner.py"

REAL_EXPORT_HEADER = [
    "Document ID",
    "Display Name",
    "City",
    "Clazz",
    "Country",
    "Event Time",
    "Last Updated",
    "Location (Lat/Lon)",
    "Location (MGRS)",
    "Source",
    "Super Type",
    "Type",
    "_id",
    "_index",
    "Accuracy",
    "Accuracy",
    "Altitude",
    "Altitude",
    "Bandwidth",
    "Bssid",
    "Bssid",
    "Channel",
    "Channel",
    "Device Name",
    "Device Name",
    "Device Serial Number",
    "Device Serial Number",
    "Device Time",
    "Device Time",
    "Encryption Type",
    "Encryption Type",
    "Frequency Mhz",
    "Frequency Mhz",
    "Image Id",
    "Latitude",
    "Latitude",
    "Longitude",
    "Longitude",
    "Mission Id",
    "Mission Id",
    "Mqtt Broker",
    "Mqtt Broker",
    "Passpoint",
    "Record Number",
    "Record Number",
    "Signal Strength",
    "Signal Strength",
    "Snet Username",
    "Speed",
    "Ssid",
    "Ssid",
    "Standard",
    "Username",
    "Wps",
    "Wps",
]


def real_export_row(
    *,
    document_id: str,
    event_time: str,
    mgrs: str,
    accuracy: str,
    bssid: str,
    device_name: str,
    ssid: str,
) -> list[str]:
    row = [""] * len(REAL_EXPORT_HEADER)
    row[0] = document_id
    row[1] = "field-device#ext#"
    row[3] = "NetworkSurveyWifiBeacon"
    row[5] = event_time
    row[6] = event_time[:19]
    row[8] = mgrs
    row[9] = "survey"

    # The first duplicate columns are intentionally left blank. The cleaner
    # should sample duplicates and select the populated matching column.
    row[15] = accuracy
    row[20] = bssid
    row[24] = device_name
    row[50] = ssid
    return row


def write_real_format_csv(path: Path, rows: list[list[str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file, lineterminator="\n")
        writer.writerow(REAL_EXPORT_HEADER)
        writer.writerows(rows)


class ShadowViewCleanerTests(unittest.TestCase):
    def test_real_export_shape_groups_by_bssid_and_uses_unique_mgrs_count(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            input_csv = temp_path / "real_format.csv"
            output_csv = temp_path / "cleaned.csv"

            write_real_format_csv(
                input_csv,
                [
                    real_export_row(
                        document_id="1",
                        event_time="2026-04-30 15:33:53.693291",
                        mgrs="36RXU8673215097",
                        accuracy="10",
                        bssid="aa:bb:cc:00:00:01",
                        device_name="Field Sensor",
                        ssid="NET_ONE",
                    ),
                    real_export_row(
                        document_id="2",
                        event_time="2026-04-30 15:43:53.693291",
                        mgrs="36RXU8673215097",
                        accuracy="11",
                        bssid="aa:bb:cc:00:00:01",
                        device_name="Field Sensor",
                        ssid="NET_TWO",
                    ),
                    real_export_row(
                        document_id="3",
                        event_time="2026-04-30 16:03:53.693291",
                        mgrs="36RXU8680015097",
                        accuracy="12",
                        bssid="aa:bb:cc:00:00:01",
                        device_name="Field Sensor",
                        ssid="NET_TWO",
                    ),
                    real_export_row(
                        document_id="4",
                        event_time="2026-04-30 16:13:53.693291",
                        mgrs="36RXU0000000001",
                        accuracy="5",
                        bssid="dd:ee:ff:00:00:02",
                        device_name="Mobile AP",
                        ssid="TRUCK_WIFI",
                    ),
                    real_export_row(
                        document_id="5",
                        event_time="2026-04-30 16:23:53.693291",
                        mgrs="36RXU0006000001",
                        accuracy="6",
                        bssid="dd:ee:ff:00:00:02",
                        device_name="Mobile AP",
                        ssid="TRUCK_WIFI",
                    ),
                    real_export_row(
                        document_id="6",
                        event_time="2026-04-30 16:33:53.693291",
                        mgrs="36RXU0012000001",
                        accuracy="7",
                        bssid="dd:ee:ff:00:00:02",
                        device_name="Mobile AP",
                        ssid="TRUCK_WIFI",
                    ),
                    real_export_row(
                        document_id="7",
                        event_time="2026-04-30 16:43:53.693291",
                        mgrs="36RXU9999999999",
                        accuracy="8",
                        bssid="11:22:33:44:55:66",
                        device_name="Half Round",
                        ssid="ROUND_TEST",
                    ),
                    real_export_row(
                        document_id="8",
                        event_time="2026-04-30 16:53:53.693291",
                        mgrs="36RXU9999999999",
                        accuracy="9",
                        bssid="11:22:33:44:55:66",
                        device_name="Half Round",
                        ssid="ROUND_TEST",
                    ),
                ],
            )

            result = clean_csv(input_csv, output_csv, DEFAULT_CONFIG, None)

            self.assertEqual(result.rows_processed, 8)
            with output_csv.open(newline="", encoding="utf-8") as csv_file:
                rows = list(csv.DictReader(csv_file))

            self.assertEqual(len(rows), 3)
            self.assertEqual(
                list(rows[0]),
                [
                    "BSSID",
                    "SSID",
                    "Accuracy",
                    "Event Time",
                    "Device Name",
                    "MGRS Unique Count",
                ],
            )

            # Default config sorts MGRS Unique Count greatest to least.
            self.assertEqual(
                [row["MGRS Unique Count"] for row in rows], ["3", "2", "1"]
            )

            first = rows[0]
            self.assertEqual(first["BSSID"], "dd:ee:ff:00:00:02")
            self.assertEqual(first["SSID"], "TRUCK_WIFI")
            self.assertEqual(first["Accuracy"], "6")
            self.assertEqual(first["Device Name"], "Mobile AP")
            self.assertEqual(
                first["Event Time"],
                "2026-04-30 16:13:53 to 2026-04-30 16:33:53",
            )

            second = rows[1]
            self.assertEqual(second["BSSID"], "aa:bb:cc:00:00:01")
            self.assertEqual(second["SSID"], "NET_ONE | NET_TWO")
            self.assertEqual(second["Accuracy"], "11")
            self.assertEqual(second["MGRS Unique Count"], "2")
            self.assertEqual(
                second["Event Time"],
                "2026-04-30 15:33:53 to 2026-04-30 16:03:53",
            )

            third = rows[2]
            self.assertEqual(third["BSSID"], "11:22:33:44:55:66")
            self.assertEqual(third["Accuracy"], "9")

    def test_mgrs_unique_count_collapses_locations_within_default_distance(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            input_csv = temp_path / "real_format.csv"
            output_csv = temp_path / "cleaned.csv"

            write_real_format_csv(
                input_csv,
                [
                    real_export_row(
                        document_id="1",
                        event_time="2026-04-30 15:00:00",
                        mgrs="36RXU1000010000",
                        accuracy="10",
                        bssid="aa:bb:cc:00:00:01",
                        device_name="Near Device",
                        ssid="NEAR",
                    ),
                    real_export_row(
                        document_id="2",
                        event_time="2026-04-30 15:10:00",
                        mgrs="36RXU1004010000",
                        accuracy="10",
                        bssid="aa:bb:cc:00:00:01",
                        device_name="Near Device",
                        ssid="NEAR",
                    ),
                    real_export_row(
                        document_id="3",
                        event_time="2026-04-30 15:20:00",
                        mgrs="36RXU2000020000",
                        accuracy="10",
                        bssid="dd:ee:ff:00:00:02",
                        device_name="Far Device",
                        ssid="FAR",
                    ),
                    real_export_row(
                        document_id="4",
                        event_time="2026-04-30 15:30:00",
                        mgrs="36RXU2006020000",
                        accuracy="10",
                        bssid="dd:ee:ff:00:00:02",
                        device_name="Far Device",
                        ssid="FAR",
                    ),
                ],
            )

            clean_csv(input_csv, output_csv, DEFAULT_CONFIG, None)

            with output_csv.open(newline="", encoding="utf-8") as csv_file:
                rows = {
                    row["BSSID"]: row
                    for row in csv.DictReader(csv_file)
                }

            self.assertEqual(rows["aa:bb:cc:00:00:01"]["MGRS Unique Count"], "1")
            self.assertEqual(rows["dd:ee:ff:00:00:02"]["MGRS Unique Count"], "2")

    def test_mgrs_unique_count_does_not_collapse_location_chains(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            input_csv = temp_path / "real_format.csv"
            output_csv = temp_path / "cleaned.csv"

            write_real_format_csv(
                input_csv,
                [
                    real_export_row(
                        document_id="1",
                        event_time="2026-04-30 15:00:00",
                        mgrs="36RXU1000010000",
                        accuracy="10",
                        bssid="aa:bb:cc:00:00:01",
                        device_name="Moving Device",
                        ssid="MOVE",
                    ),
                    real_export_row(
                        document_id="2",
                        event_time="2026-04-30 15:10:00",
                        mgrs="36RXU1004010000",
                        accuracy="10",
                        bssid="aa:bb:cc:00:00:01",
                        device_name="Moving Device",
                        ssid="MOVE",
                    ),
                    real_export_row(
                        document_id="3",
                        event_time="2026-04-30 15:20:00",
                        mgrs="36RXU1008010000",
                        accuracy="10",
                        bssid="aa:bb:cc:00:00:01",
                        device_name="Moving Device",
                        ssid="MOVE",
                    ),
                ],
            )

            clean_csv(input_csv, output_csv, DEFAULT_CONFIG, None)

            with output_csv.open(newline="", encoding="utf-8") as csv_file:
                rows = list(csv.DictReader(csv_file))

            self.assertEqual(rows[0]["MGRS Unique Count"], "2")

    def test_mgrs_unique_count_uses_configured_distance_threshold(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            input_csv = temp_path / "real_format.csv"
            output_csv = temp_path / "cleaned.csv"
            config_path = temp_path / "co_traveler.toml"
            config_path.write_text(
                DEFAULT_CONFIG.read_text(encoding="utf-8").replace(
                    "distance_threshold_meters = 50",
                    "distance_threshold_meters = 100",
                ),
                encoding="utf-8",
            )

            write_real_format_csv(
                input_csv,
                [
                    real_export_row(
                        document_id="1",
                        event_time="2026-04-30 15:00:00",
                        mgrs="36RXU2000020000",
                        accuracy="10",
                        bssid="dd:ee:ff:00:00:02",
                        device_name="Far Device",
                        ssid="FAR",
                    ),
                    real_export_row(
                        document_id="2",
                        event_time="2026-04-30 15:30:00",
                        mgrs="36RXU2006020000",
                        accuracy="10",
                        bssid="dd:ee:ff:00:00:02",
                        device_name="Far Device",
                        ssid="FAR",
                    ),
                ],
            )

            clean_csv(input_csv, output_csv, config_path, None)

            with output_csv.open(newline="", encoding="utf-8") as csv_file:
                rows = list(csv.DictReader(csv_file))

            self.assertEqual(rows[0]["MGRS Unique Count"], "1")

    def test_mgrs_unique_count_ignores_invalid_mgrs_values(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            input_csv = temp_path / "real_format.csv"
            output_csv = temp_path / "cleaned.csv"

            write_real_format_csv(
                input_csv,
                [
                    real_export_row(
                        document_id="1",
                        event_time="2026-04-30 15:00:00",
                        mgrs="36RXU2000020000",
                        accuracy="10",
                        bssid="aa:bb:cc:00:00:01",
                        device_name="Valid Device",
                        ssid="VALID",
                    ),
                    real_export_row(
                        document_id="2",
                        event_time="2026-04-30 15:30:00",
                        mgrs="NOT-MGRS",
                        accuracy="10",
                        bssid="aa:bb:cc:00:00:01",
                        device_name="Valid Device",
                        ssid="VALID",
                    ),
                    real_export_row(
                        document_id="3",
                        event_time="2026-04-30 16:00:00",
                        mgrs="NOT-MGRS",
                        accuracy="10",
                        bssid="dd:ee:ff:00:00:02",
                        device_name="Invalid Device",
                        ssid="INVALID",
                    ),
                ],
            )

            clean_csv(input_csv, output_csv, DEFAULT_CONFIG, None)

            with output_csv.open(newline="", encoding="utf-8") as csv_file:
                rows = {row["BSSID"]: row for row in csv.DictReader(csv_file)}

            self.assertEqual(rows["aa:bb:cc:00:00:01"]["MGRS Unique Count"], "1")
            self.assertEqual(rows["dd:ee:ff:00:00:02"]["MGRS Unique Count"], "0")

    def test_cli_writes_csv_and_html_preview_for_real_export_shape(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            input_csv = temp_path / "real_format.csv"
            output_csv = temp_path / "cleaned.csv"
            html_output = temp_path / "cleaned.html"
            xlsx_output = temp_path / "cleaned.xlsx"

            write_real_format_csv(
                input_csv,
                [
                    real_export_row(
                        document_id="1",
                        event_time="2026-04-30 15:00:00.123456",
                        mgrs="36RXU1111111111",
                        accuracy="8",
                        bssid="aa:bb:cc:00:00:01",
                        device_name="Field Sensor",
                        ssid="NET_ONE",
                    )
                ],
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(CLI_SCRIPT),
                    str(input_csv),
                    str(output_csv),
                    "--html-output",
                    str(html_output),
                    "--xlsx-output",
                    str(xlsx_output),
                ],
                cwd=PROJECT_ROOT,
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertRegex(completed.stdout, r"Processed 1 rows in \d+\.\d{2}s\.")
            self.assertTrue(output_csv.exists())
            self.assertTrue(html_output.exists())
            self.assertTrue(xlsx_output.exists())
            self.assertIn("30-minute bucket", html_output.read_text(encoding="utf-8"))
            self.assertIn(f"Wrote Excel workbook: {xlsx_output}", completed.stdout)

            with zipfile.ZipFile(xlsx_output) as workbook:
                self.assertIn("xl/worksheets/sheet1.xml", workbook.namelist())
                self.assertIn("xl/styles.xml", workbook.namelist())
                styles_xml = workbook.read("xl/styles.xml").decode("utf-8")
                sheet_xml = workbook.read("xl/worksheets/sheet1.xml").decode("utf-8")

            self.assertIn("<autoFilter", sheet_xml)
            self.assertTrue(
                any(
                    color in styles_xml
                    for color in (
                        "FFFFF2CC",
                        "FFD9EAD3",
                        "FFCFE2F3",
                        "FFEADCF8",
                        "FFF4CCCC",
                        "FFD0E0E3",
                        "FFFCE5CD",
                        "FFD9D2E9",
                    )
                )
            )


if __name__ == "__main__":
    unittest.main()
