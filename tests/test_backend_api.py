from __future__ import annotations

import csv
import tempfile
import unittest
from pathlib import Path

from shadow_view import (
    CleanerError,
    available_cleaners,
    clean_shadow_view_csv,
    detect_cleaner_id,
)


def write_co_traveler_csv(path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file, lineterminator="\n")
        writer.writerow(["BSSID", "SSID", "Accuracy", "Event Time", "Device Name", "MGRS"])
        writer.writerow(
            [
                "aa:bb:cc:00:00:01",
                "NET_ONE",
                "10",
                "2026-05-19 12:00:00",
                "Field Sensor",
                "15SWC1234567890",
            ]
        )
        writer.writerow(
            [
                "aa:bb:cc:00:00:01",
                "NET_ONE",
                "12",
                "2026-05-19 12:30:00",
                "Field Sensor",
                "15SWC1234567891",
            ]
        )


def write_rogue_tower_csv(path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file, lineterminator="\n")
        writer.writerow(
            [
                "Device Name",
                "Device Time",
                "MCC",
                "MNC",
                "Serving Cell",
                "MGRS",
                "PCI",
                "ECI",
                "RSRP",
                "RSRQ",
                "TAC",
                "Type",
                "Accuracy",
            ]
        )
        writer.writerow(
            [
                "Tower New",
                "05/19/2026 10:15:00",
                "310",
                "260",
                "true",
                "15SWC9999967890",
                "41",
                "100100",
                "71",
                "-8",
                "5002",
                "LTE",
                "8",
            ]
        )


class BackendApiTests(unittest.TestCase):
    def test_available_cleaners_and_programmatic_run(self) -> None:
        cleaners = {cleaner["cleaner_id"]: cleaner for cleaner in available_cleaners()}
        self.assertIn("co_traveler", cleaners)
        self.assertIn("rogue_tower", cleaners)

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            input_csv = temp_path / "upload.csv"
            output_csv = temp_path / "cleaned.csv"
            xlsx_output = temp_path / "cleaned.xlsx"
            write_co_traveler_csv(input_csv)

            result = clean_shadow_view_csv(
                "co_traveler",
                input_csv,
                output_csv,
                xlsx_output=xlsx_output,
            )

            self.assertEqual(result.cleaner_id, "co_traveler")
            self.assertEqual(result.rows_processed, 2)
            self.assertEqual(result.rows_written, 1)
            self.assertEqual(result.output_csv, output_csv)
            self.assertEqual(result.xlsx_output, xlsx_output)
            self.assertTrue(output_csv.exists())
            self.assertTrue(xlsx_output.exists())
            self.assertEqual(result.to_dict()["xlsx_output"], str(xlsx_output))
            self.assertIsInstance(result.to_dict()["elapsed_seconds"], float)

    def test_auto_detects_and_runs_supported_cleaners(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            co_input = temp_path / "co.csv"
            rogue_input = temp_path / "rogue.csv"
            write_co_traveler_csv(co_input)
            write_rogue_tower_csv(rogue_input)

            self.assertEqual(detect_cleaner_id(co_input), "co_traveler")
            self.assertEqual(detect_cleaner_id(rogue_input), "rogue_tower")

            result = clean_shadow_view_csv(
                "auto",
                rogue_input,
                temp_path / "cleaned_rogue.csv",
            )

            self.assertEqual(result.cleaner_id, "rogue_tower")
            self.assertEqual(result.rows_processed, 1)
            self.assertEqual(result.rows_written, 1)

    def test_unknown_cleaner_id_raises_cleaner_error(self) -> None:
        with self.assertRaises(CleanerError):
            clean_shadow_view_csv("missing", "in.csv", "out.csv")


if __name__ == "__main__":
    unittest.main()
