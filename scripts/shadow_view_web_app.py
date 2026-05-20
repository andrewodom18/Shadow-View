#!/usr/bin/env python3
"""Double-click launcher for the bundled Shadow View web app."""

from __future__ import annotations

import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, ttk
import webbrowser


PROJECT_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from shadow_view.web_server import DEFAULT_HOST, DEFAULT_PORT, DEFAULT_STATIC_DIR, create_server  # noqa: E402


class ShadowViewWebAppLauncher:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Shadow View Web App")
        self.root.geometry("620x360")
        self.root.minsize(560, 320)
        self.root.protocol("WM_DELETE_WINDOW", self.close)

        self.server = None
        self.server_thread: threading.Thread | None = None
        self.url = ""
        self.status_text = tk.StringVar(value="Starting Shadow View Web App...")
        self.url_text = tk.StringVar(value="")

        self._configure_style()
        self._build_ui()
        self.root.after(200, self.start_server)

    def _configure_style(self) -> None:
        style = ttk.Style(self.root)
        style.configure(".", font=("Segoe UI", 10))
        style.configure("Title.TLabel", font=("Segoe UI", 18, "bold"))
        style.configure("Status.TLabel", padding=(0, 2))
        style.configure("TButton", padding=(12, 7))

    def _build_ui(self) -> None:
        outer = ttk.Frame(self.root, padding=(24, 22))
        outer.grid(row=0, column=0, sticky="nsew")
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        outer.columnconfigure(0, weight=1)
        outer.rowconfigure(3, weight=1)

        ttk.Label(outer, text="Shadow View Web App", style="Title.TLabel").grid(
            row=0, column=0, sticky="w"
        )
        ttk.Label(
            outer,
            text="Keep this window open while using the map and Clean & Export tools.",
            wraplength=540,
        ).grid(row=1, column=0, sticky="w", pady=(8, 18))

        status_frame = ttk.LabelFrame(outer, text="Status", padding=(14, 12))
        status_frame.grid(row=2, column=0, sticky="ew")
        status_frame.columnconfigure(0, weight=1)

        ttk.Label(status_frame, textvariable=self.status_text, style="Status.TLabel").grid(
            row=0, column=0, sticky="w"
        )
        ttk.Label(status_frame, textvariable=self.url_text, style="Status.TLabel").grid(
            row=1, column=0, sticky="w", pady=(4, 0)
        )

        button_frame = ttk.Frame(outer)
        button_frame.grid(row=4, column=0, sticky="ew", pady=(22, 0))
        button_frame.columnconfigure(3, weight=1)

        self.open_button = ttk.Button(
            button_frame,
            text="Open Web App",
            command=self.open_browser,
            state="disabled",
        )
        self.open_button.grid(row=0, column=0, sticky="w")

        self.restart_button = ttk.Button(
            button_frame,
            text="Restart",
            command=self.restart_server,
            state="disabled",
        )
        self.restart_button.grid(row=0, column=1, sticky="w", padx=(10, 0))

        ttk.Button(button_frame, text="Stop & Close", command=self.close).grid(
            row=0, column=2, sticky="w", padx=(10, 0)
        )

    def start_server(self) -> None:
        if self.server is not None:
            self.open_browser()
            return

        static_dir = Path(DEFAULT_STATIC_DIR)
        if not (static_dir / "index.html").exists():
            message = (
                "The built web app was not found. Build the web app before launching "
                "or use the packaged Shadow View Web App.exe from the USB bundle."
            )
            self.status_text.set(message)
            messagebox.showerror("Web app not found", message)
            return

        try:
            self.server = self._create_available_server(static_dir)
        except OSError as exc:
            message = f"Could not start the local Shadow View server: {exc}"
            self.status_text.set(message)
            messagebox.showerror("Could not start", message)
            return

        host, port = self.server.server_address
        self.url = f"http://{host}:{port}/"
        self.status_text.set("Shadow View is running locally.")
        self.url_text.set(self.url)
        self.open_button.state(["!disabled"])
        self.restart_button.state(["!disabled"])
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.open_browser()

    def _create_available_server(self, static_dir: Path):
        last_error: OSError | None = None
        for port in range(DEFAULT_PORT, DEFAULT_PORT + 20):
            try:
                return create_server(DEFAULT_HOST, port, static_dir)
            except OSError as exc:
                last_error = exc

        if last_error is not None:
            raise last_error
        return create_server(DEFAULT_HOST, 0, static_dir)

    def open_browser(self) -> None:
        if not self.url:
            return
        webbrowser.open(self.url, new=2)

    def restart_server(self) -> None:
        self.status_text.set("Restarting Shadow View...")
        self._stop_server()
        self.start_server()

    def _stop_server(self) -> None:
        if self.server is None:
            return
        server = self.server
        self.server = None
        self.open_button.state(["disabled"])
        self.restart_button.state(["disabled"])
        self.url = ""
        self.url_text.set("")
        server.shutdown()
        server.server_close()
        if self.server_thread is not None:
            self.server_thread.join(timeout=2)
        self.server_thread = None

    def close(self) -> None:
        try:
            self._stop_server()
        finally:
            self.root.destroy()


def main() -> int:
    root = tk.Tk()
    ShadowViewWebAppLauncher(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
