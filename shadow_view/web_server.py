"""Local web server for the Shadow View cleaner API and built web app."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from email import policy
from email.parser import BytesParser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import tempfile
from typing import Any
from urllib.parse import urlparse
import zipfile

from .backend import AUTO_CLEANER_ID, available_cleaners, clean_shadow_view_csv
from .errors import CleanerError


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STATIC_DIR = PROJECT_ROOT / "web_app" / "dist"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
MAX_UPLOAD_BYTES = 250 * 1024 * 1024


@dataclass(frozen=True)
class UploadedFile:
    filename: str
    content_type: str
    content: bytes


class MultipartError(ValueError):
    """Raised when an upload request cannot be parsed."""


class ShadowViewServer(ThreadingHTTPServer):
    daemon_threads = True


def auto_cleaner_metadata() -> dict[str, str]:
    return {
        "cleaner_id": AUTO_CLEANER_ID,
        "display_name": "Auto-detect cleaner",
        "input_description": "Detect Co-Traveler or Rogue Tower from the CSV header",
        "config_path": "",
    }


def cleaner_metadata_payload() -> dict[str, Any]:
    return {"cleaners": [auto_cleaner_metadata(), *available_cleaners()]}


def safe_stem(filename: str) -> str:
    stem = Path(filename or "shadow_view_upload").stem
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", stem).strip("._")
    return cleaned or "shadow_view_upload"


def truthy_form_value(fields: dict[str, str], name: str, default: bool) -> bool:
    raw = fields.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def parse_multipart_form(headers: Any, body: bytes) -> tuple[dict[str, str], dict[str, UploadedFile]]:
    content_type = headers.get("Content-Type", "")
    if not content_type.lower().startswith("multipart/form-data"):
        raise MultipartError("Expected multipart/form-data upload.")

    message_bytes = (
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8")
        + body
    )
    message = BytesParser(policy=policy.default).parsebytes(message_bytes)
    if not message.is_multipart():
        raise MultipartError("Upload did not contain multipart form data.")

    fields: dict[str, str] = {}
    files: dict[str, UploadedFile] = {}

    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue

        payload = part.get_payload(decode=True) or b""
        filename = part.get_filename()
        if filename:
            files[name] = UploadedFile(
                filename=filename,
                content_type=part.get_content_type(),
                content=payload,
            )
            continue

        charset = part.get_content_charset() or "utf-8"
        fields[name] = payload.decode(charset, errors="replace")

    return fields, files


def build_cleaner_zip(
    upload: UploadedFile,
    fields: dict[str, str],
) -> tuple[bytes, str]:
    if not upload.content:
        raise MultipartError("Uploaded CSV was empty.")

    cleaner_id = fields.get("cleaner_id", AUTO_CLEANER_ID).strip() or AUTO_CLEANER_ID
    include_csv = truthy_form_value(fields, "include_csv", True)
    include_xlsx = truthy_form_value(fields, "include_xlsx", True)
    include_html = truthy_form_value(fields, "include_html", False)

    if not any([include_csv, include_xlsx, include_html]):
        raise MultipartError("Choose at least one output format.")

    stem = safe_stem(upload.filename)
    zip_name = f"{stem}_shadow_view_outputs.zip"

    with tempfile.TemporaryDirectory(prefix="shadow_view_web_") as temp_dir:
        temp_path = Path(temp_dir)
        input_csv = temp_path / f"{stem}.csv"
        input_csv.write_bytes(upload.content)

        output_csv = temp_path / f"{stem}_cleaned.csv"
        html_output = temp_path / f"{stem}_cleaned.html" if include_html else None
        xlsx_output = temp_path / f"{stem}_cleaned.xlsx" if include_xlsx else None

        result = clean_shadow_view_csv(
            cleaner_id,
            input_csv,
            output_csv,
            html_output=html_output,
            xlsx_output=xlsx_output,
        )

        archive_path = temp_path / zip_name
        downloaded_outputs: list[str] = []

        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            if include_csv:
                archive_name = output_csv.name
                archive.write(output_csv, archive_name)
                downloaded_outputs.append(archive_name)
            if xlsx_output is not None:
                archive_name = xlsx_output.name
                archive.write(xlsx_output, archive_name)
                downloaded_outputs.append(archive_name)
            if html_output is not None:
                archive_name = html_output.name
                archive.write(html_output, archive_name)
                downloaded_outputs.append(archive_name)

            result_payload = {
                **result.to_dict(),
                "source_filename": upload.filename,
                "downloaded_outputs": downloaded_outputs,
            }
            archive.writestr("result.json", json.dumps(result_payload, indent=2))

        return archive_path.read_bytes(), zip_name


class ShadowViewWebHandler(SimpleHTTPRequestHandler):
    server_version = "ShadowViewWeb/0.1"

    def log_message(self, format: str, *args: Any) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path

        if path == "/api/cleaners":
            self.respond_json(HTTPStatus.OK, cleaner_metadata_payload())
            return

        if path.startswith("/api/"):
            self.respond_json(HTTPStatus.NOT_FOUND, {"error": "API route not found."})
            return

        translated = Path(self.translate_path(self.path))
        if translated.exists():
            super().do_GET()
            return

        index_path = Path(self.directory) / "index.html"
        if index_path.exists():
            original_path = self.path
            try:
                self.path = "/index.html"
                super().do_GET()
            finally:
                self.path = original_path
            return

        self.respond_json(
            HTTPStatus.NOT_FOUND,
            {
                "error": "Web app build not found.",
                "detail": "Run `npm run build` in web_app before using the bundled server.",
            },
        )

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/api/clean":
            self.respond_json(HTTPStatus.NOT_FOUND, {"error": "API route not found."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.respond_json(HTTPStatus.LENGTH_REQUIRED, {"error": "Invalid Content-Length header."})
            return

        if content_length <= 0:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"error": "Upload body was empty."})
            return
        if content_length > MAX_UPLOAD_BYTES:
            self.respond_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"error": f"Upload exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit."},
            )
            return

        try:
            body = self.rfile.read(content_length)
            fields, files = parse_multipart_form(self.headers, body)
            upload = files.get("file")
            if upload is None:
                raise MultipartError("Upload field `file` is required.")

            archive_bytes, archive_name = build_cleaner_zip(upload, fields)
        except MultipartError as exc:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        except CleanerError as exc:
            self.respond_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"error": str(exc)})
            return
        except Exception as exc:  # pragma: no cover - defensive HTTP boundary.
            self.respond_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Length", str(len(archive_bytes)))
        self.send_header("Content-Disposition", f'attachment; filename="{archive_name}"')
        self.end_headers()
        self.wfile.write(archive_bytes)

    def respond_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def create_server(
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    static_dir: Path | str = DEFAULT_STATIC_DIR,
) -> ShadowViewServer:
    from functools import partial

    static_path = Path(static_dir).resolve()
    handler = partial(ShadowViewWebHandler, directory=str(static_path))
    server = ShadowViewServer((host, port), handler)
    server.static_dir = static_path  # type: ignore[attr-defined]
    return server


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Serve the Shadow View web app and cleaner API.")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"Host to bind. Default: {DEFAULT_HOST}")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Port to bind. Default: {DEFAULT_PORT}")
    parser.add_argument(
        "--static-dir",
        type=Path,
        default=DEFAULT_STATIC_DIR,
        help="Directory containing the built web app. Default: web_app/dist",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    server = create_server(args.host, args.port, args.static_dir)
    print(f"Serving Shadow View at http://{args.host}:{args.port}/")
    print(f"Static files: {Path(args.static_dir).resolve()}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Shadow View server.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
