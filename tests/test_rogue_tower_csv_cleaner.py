from __future__ import annotations

import csv
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CLI_SCRIPT = PROJECT_ROOT / "scripts" / "rogue_tower_csv_cleaner.py"

ROGUE_HEADER = [
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
    "Ignored Column",
]


def write_rogue_csv(path: Path) -> None:
    rows = [
        [
            "Tower Old",
            "05/18/2026 09:00:00",
            "310",
            "410",
            "false",
            "15SWC1234567890",
            "22",
            "100200",
            "65",
            "-10",
            "5001",
            "LTE",
            "12",
            "ignored",
        ],
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
            "ignored",
        ],
        [
            "Tower Mid",
            "05/19/2026 09:30:00",
            "311",
            "480",
            "false",
            "15SWC5555567890",
            "19",
            "100150",
            "75",
            "-12",
            "5003",
            "NR",
            "10",
            "ignored",
        ],
    ]
    with path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file, lineterminator="\n")
        writer.writerow(ROGUE_HEADER)
        writer.writerows(rows)


def workbook_cell_fills(path: Path) -> dict[str, str]:
    namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(path) as workbook:
        styles_root = ElementTree.fromstring(workbook.read("xl/styles.xml"))
        sheet_root = ElementTree.fromstring(workbook.read("xl/worksheets/sheet1.xml"))

    fills = []
    for fill in styles_root.findall("x:fills/x:fill", namespace):
        fg_color = fill.find(".//x:fgColor", namespace)
        fills.append(fg_color.attrib.get("rgb", "") if fg_color is not None else "")

    fill_by_style_id: dict[str, str] = {}
    for style_index, style in enumerate(
        styles_root.findall("x:cellXfs/x:xf", namespace)
    ):
        fill_id = int(style.attrib.get("fillId", "0"))
        fill_by_style_id[str(style_index)] = fills[fill_id] if fill_id < len(fills) else ""

    cell_fills: dict[str, str] = {}
    for cell in sheet_root.findall(".//x:c", namespace):
        style_id = cell.attrib.get("s")
        if style_id is not None:
            cell_fills[cell.attrib["r"]] = fill_by_style_id.get(style_id, "")

    return cell_fills


class RogueTowerCleanerTests(unittest.TestCase):
    def test_cli_filters_sorts_and_colors_rogue_tower_csv(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            input_csv = temp_path / "rogue.csv"
            output_csv = temp_path / "cleaned_rogue.csv"
            xlsx_output = temp_path / "cleaned_rogue.xlsx"
            write_rogue_csv(input_csv)

            completed = subprocess.run(
                [
                    sys.executable,
                    str(CLI_SCRIPT),
                    str(input_csv),
                    str(output_csv),
                    "--xlsx-output",
                    str(xlsx_output),
                ],
                cwd=PROJECT_ROOT,
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn("Processed 3 rows", completed.stdout)
            self.assertTrue(output_csv.exists())
            self.assertTrue(xlsx_output.exists())

            with output_csv.open(newline="", encoding="utf-8") as csv_file:
                rows = list(csv.DictReader(csv_file))

            self.assertEqual(
                list(rows[0]),
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
                ],
            )
            self.assertEqual(
                [row["Device Name"] for row in rows],
                ["Tower New", "Tower Mid", "Tower Old"],
            )

            cell_fills = workbook_cell_fills(xlsx_output)
            self.assertEqual(cell_fills["E2"], "FFD9EAD3")
            self.assertEqual(cell_fills["I2"], "FFF4CCCC")
            self.assertEqual(cell_fills["E3"], "FFF4CCCC")
            self.assertEqual(cell_fills["I3"], "FFF4CCCC")
            self.assertEqual(cell_fills["E4"], "FFF4CCCC")
            self.assertNotEqual(cell_fills.get("I4", ""), "FFF4CCCC")


if __name__ == "__main__":
    unittest.main()
