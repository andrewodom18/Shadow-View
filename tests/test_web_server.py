from __future__ import annotations

import csv
import io
import json
import tempfile
import threading
import unittest
import urllib.request
import zipfile
from pathlib import Path

from shadow_view.web_server import create_server


def co_traveler_csv_bytes() -> bytes:
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
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
    return output.getvalue().encode("utf-8")


def multipart_body(
    fields: dict[str, str],
    files: dict[str, tuple[str, bytes, str]],
) -> tuple[bytes, str]:
    boundary = "----ShadowViewTestBoundary"
    body = io.BytesIO()

    for name, value in fields.items():
        body.write(f"--{boundary}\r\n".encode("utf-8"))
        body.write(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        body.write(value.encode("utf-8"))
        body.write(b"\r\n")

    for name, (filename, content, content_type) in files.items():
        body.write(f"--{boundary}\r\n".encode("utf-8"))
        body.write(
            (
                f'Content-Disposition: form-data; name="{name}"; '
                f'filename="{filename}"\r\n'
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode("utf-8")
        )
        body.write(content)
        body.write(b"\r\n")

    body.write(f"--{boundary}--\r\n".encode("utf-8"))
    return body.getvalue(), f"multipart/form-data; boundary={boundary}"


class WebServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.static_dir = tempfile.TemporaryDirectory()
        Path(self.static_dir.name, "index.html").write_text("<!doctype html><p>Shadow View</p>", encoding="utf-8")
        self.server = create_server("127.0.0.1", 0, self.static_dir.name)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address
        self.base_url = f"http://{host}:{port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.static_dir.cleanup()

    def test_cleaners_endpoint_lists_auto_and_profiles(self) -> None:
        with urllib.request.urlopen(f"{self.base_url}/api/cleaners", timeout=5) as response:
            self.assertEqual(response.status, 200)
            payload = json.loads(response.read())

        cleaner_ids = {cleaner["cleaner_id"] for cleaner in payload["cleaners"]}
        self.assertIn("auto", cleaner_ids)
        self.assertIn("co_traveler", cleaner_ids)
        self.assertIn("rogue_tower", cleaner_ids)

    def test_clean_endpoint_returns_requested_outputs_zip(self) -> None:
        body, content_type = multipart_body(
            {
                "cleaner_id": "auto",
                "include_csv": "true",
                "include_xlsx": "false",
                "include_html": "true",
            },
            {
                "file": ("upload.csv", co_traveler_csv_bytes(), "text/csv"),
            },
        )
        request = urllib.request.Request(
            f"{self.base_url}/api/clean",
            data=body,
            headers={"Content-Type": content_type},
            method="POST",
        )

        with urllib.request.urlopen(request, timeout=5) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_type(), "application/zip")
            archive_bytes = response.read()

        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            names = set(archive.namelist())
            result = json.loads(archive.read("result.json"))

        self.assertIn("upload_cleaned.csv", names)
        self.assertIn("upload_cleaned.html", names)
        self.assertIn("result.json", names)
        self.assertEqual(result["cleaner_id"], "co_traveler")
        self.assertEqual(result["rows_processed"], 2)
        self.assertEqual(result["rows_written"], 1)


if __name__ == "__main__":
    unittest.main()
