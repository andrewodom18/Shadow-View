#!/usr/bin/env python3
"""Standalone desktop app for Shadow View CSV cleaners."""

from __future__ import annotations

import sys
import tempfile
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from shadow_view import CleanerError, clean_shadow_view_csv, detect_cleaner_profile  # noqa: E402


APP_BG = "#f4f7fb"
CARD_BG = "#ffffff"
TEXT_COLOR = "#1f2937"
MUTED_COLOR = "#5f6b7a"
ACCENT_COLOR = "#2563eb"
ACCENT_ACTIVE = "#1d4ed8"
DISABLED_ACCENT = "#93c5fd"
BORDER_COLOR = "#d5dce7"


class ShadowViewCleanerApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Shadow View CSV Cleaner")
        self.root.geometry("760x460")
        self.root.minsize(680, 420)
        self.root.configure(background=APP_BG)
        self._configure_style()

        self.input_csv: Path | None = None
        self.cleaner_id: str | None = None

        self.status_text = tk.StringVar(value="Select a Shadow View CSV file.")
        self.input_text = tk.StringVar(value="No file selected")
        self.detected_text = tk.StringVar(value="Cleaner: not detected")
        self.csv_enabled = tk.BooleanVar(value=True)
        self.xlsx_enabled = tk.BooleanVar(value=True)
        self.html_enabled = tk.BooleanVar(value=False)

        self._build_ui()

    def _configure_style(self) -> None:
        style = ttk.Style(self.root)
        if "clam" in style.theme_names():
            style.theme_use("clam")

        default_font = ("Segoe UI", 10)
        style.configure(".", font=default_font)
        style.configure("App.TFrame", background=APP_BG)
        style.configure(
            "Title.TLabel",
            background=APP_BG,
            foreground=TEXT_COLOR,
            font=("Segoe UI", 20, "bold"),
        )
        style.configure(
            "Muted.TLabel",
            background=APP_BG,
            foreground=MUTED_COLOR,
        )
        style.configure(
            "Card.TLabelframe",
            background=CARD_BG,
            bordercolor=BORDER_COLOR,
            relief="solid",
        )
        style.configure(
            "Card.TLabelframe.Label",
            background=APP_BG,
            foreground=TEXT_COLOR,
            font=("Segoe UI", 10, "bold"),
        )
        style.configure("Card.TCheckbutton", background=CARD_BG, foreground=TEXT_COLOR)
        style.map("Card.TCheckbutton", background=[("active", CARD_BG)])
        style.configure(
            "Status.TLabel",
            background=CARD_BG,
            foreground=TEXT_COLOR,
            padding=6,
        )
        style.configure("TButton", padding=(12, 7))
        style.configure(
            "Primary.TButton",
            padding=(16, 8),
            foreground="#ffffff",
            background=ACCENT_COLOR,
            font=("Segoe UI", 10, "bold"),
            bordercolor=ACCENT_COLOR,
        )
        style.map(
            "Primary.TButton",
            background=[
                ("disabled", DISABLED_ACCENT),
                ("active", ACCENT_ACTIVE),
                ("pressed", ACCENT_ACTIVE),
            ],
            bordercolor=[
                ("disabled", DISABLED_ACCENT),
                ("active", ACCENT_ACTIVE),
                ("pressed", ACCENT_ACTIVE),
            ],
            foreground=[("disabled", "#eef4ff")],
        )
        style.configure(
            "Horizontal.TProgressbar",
            background=ACCENT_COLOR,
            troughcolor="#e7edf5",
            bordercolor="#e7edf5",
            lightcolor=ACCENT_COLOR,
            darkcolor=ACCENT_COLOR,
        )

    def _build_ui(self) -> None:
        outer = ttk.Frame(self.root, padding=(24, 22), style="App.TFrame")
        outer.grid(row=0, column=0, sticky="nsew")
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        outer.columnconfigure(0, weight=1)

        title = ttk.Label(
            outer,
            text="Shadow View CSV Cleaner",
            style="Title.TLabel",
        )
        title.grid(row=0, column=0, sticky="w")

        select_frame = ttk.Frame(outer, style="App.TFrame")
        select_frame.grid(row=1, column=0, sticky="ew", pady=(18, 8))
        select_frame.columnconfigure(1, weight=1)

        select_button = ttk.Button(
            select_frame, text="Choose CSV...", command=self.choose_input_csv
        )
        select_button.grid(row=0, column=0, sticky="w")

        input_label = ttk.Label(
            select_frame, textvariable=self.input_text, style="Muted.TLabel"
        )
        input_label.grid(row=0, column=1, sticky="ew", padx=(12, 0))

        detected_label = ttk.Label(
            outer, textvariable=self.detected_text, style="Muted.TLabel"
        )
        detected_label.grid(row=2, column=0, sticky="w", pady=(0, 16))

        options = ttk.LabelFrame(
            outer, text="Outputs", padding=14, style="Card.TLabelframe"
        )
        options.grid(row=3, column=0, sticky="ew")
        options.columnconfigure(0, weight=1)
        options.columnconfigure(1, weight=1)
        options.columnconfigure(2, weight=1)

        ttk.Checkbutton(
            options, text="CSV", variable=self.csv_enabled, style="Card.TCheckbutton"
        ).grid(row=0, column=0, sticky="w")
        ttk.Checkbutton(
            options,
            text="Excel (.xlsx)",
            variable=self.xlsx_enabled,
            style="Card.TCheckbutton",
        ).grid(row=0, column=1, sticky="w")
        ttk.Checkbutton(
            options,
            text="HTML preview",
            variable=self.html_enabled,
            style="Card.TCheckbutton",
        ).grid(row=0, column=2, sticky="w")

        actions = ttk.Frame(outer, style="App.TFrame")
        actions.grid(row=4, column=0, sticky="ew", pady=(20, 12))
        actions.columnconfigure(0, weight=1)

        self.clean_button = ttk.Button(
            actions,
            text="Clean CSV",
            command=self.start_cleaning,
            style="Primary.TButton",
        )
        self.clean_button.grid(row=0, column=0, sticky="w")

        self.progress = ttk.Progressbar(actions, mode="indeterminate", length=220)
        self.progress.grid(row=0, column=1, sticky="e")

        status_box = ttk.LabelFrame(
            outer, text="Status", padding=14, style="Card.TLabelframe"
        )
        status_box.grid(row=5, column=0, sticky="nsew", pady=(8, 0))
        outer.rowconfigure(5, weight=1)
        status_box.columnconfigure(0, weight=1)
        status_box.rowconfigure(0, weight=1)

        self.status_label = ttk.Label(
            status_box,
            textvariable=self.status_text,
            anchor="nw",
            justify="left",
            wraplength=640,
            style="Status.TLabel",
        )
        self.status_label.grid(row=0, column=0, sticky="nsew")

    def choose_input_csv(self) -> None:
        selected = filedialog.askopenfilename(
            title="Choose Shadow View CSV",
            filetypes=[("CSV files", "*.csv"), ("All files", "*.*")],
        )
        if not selected:
            return

        self.input_csv = Path(selected)
        self.input_text.set(str(self.input_csv))
        self.status_text.set("Detecting cleaner type...")

        try:
            profile = detect_cleaner_profile(self.input_csv)
        except CleanerError as exc:
            self.cleaner_id = None
            self.detected_text.set("Cleaner: not detected")
            self.status_text.set(str(exc))
            messagebox.showerror("Could not detect cleaner", str(exc))
            return

        self.cleaner_id = profile.cleaner_id
        self.detected_text.set(f"Cleaner: {profile.display_name}")
        self.status_text.set("Choose outputs, then click Clean CSV.")

    def start_cleaning(self) -> None:
        if self.input_csv is None:
            messagebox.showwarning("No CSV selected", "Choose a CSV file first.")
            return
        if self.cleaner_id is None:
            messagebox.showwarning(
                "Cleaner not detected",
                "Choose a CSV file that matches a supported Shadow View export.",
            )
            return
        if not any(
            [self.csv_enabled.get(), self.xlsx_enabled.get(), self.html_enabled.get()]
        ):
            messagebox.showwarning("No outputs selected", "Select at least one output.")
            return

        output_csv = None
        xlsx_output = None
        html_output = None

        if self.csv_enabled.get():
            output_csv = self._ask_save_path(".csv", "Save cleaned CSV")
            if output_csv is None:
                return
        if self.xlsx_enabled.get():
            xlsx_output = self._ask_save_path(".xlsx", "Save Excel workbook")
            if xlsx_output is None:
                return
        if self.html_enabled.get():
            html_output = self._ask_save_path(".html", "Save HTML preview")
            if html_output is None:
                return

        self._set_busy(True)
        self.status_text.set("Cleaning CSV. Large files may take a few minutes.")

        worker = threading.Thread(
            target=self._clean_in_background,
            args=(output_csv, xlsx_output, html_output),
            daemon=True,
        )
        worker.start()

    def _ask_save_path(self, extension: str, title: str) -> Path | None:
        if self.input_csv is None:
            return None
        initial_name = f"{self.input_csv.stem}_cleaned{extension}"
        selected = filedialog.asksaveasfilename(
            title=title,
            defaultextension=extension,
            initialfile=initial_name,
            filetypes=[
                (f"{extension.upper()} files", f"*{extension}"),
                ("All files", "*.*"),
            ],
        )
        return Path(selected) if selected else None

    def _clean_in_background(
        self,
        output_csv: Path | None,
        xlsx_output: Path | None,
        html_output: Path | None,
    ) -> None:
        assert self.input_csv is not None
        assert self.cleaner_id is not None

        try:
            with tempfile.TemporaryDirectory(prefix="shadow_view_app_") as temp_dir:
                hidden_csv = Path(temp_dir) / "cleaned.csv"
                actual_csv = output_csv or hidden_csv
                result = clean_shadow_view_csv(
                    self.cleaner_id,
                    self.input_csv,
                    actual_csv,
                    html_output=html_output,
                    xlsx_output=xlsx_output,
                )
                summary = self._format_success(
                    result.rows_processed,
                    result.rows_written,
                    result.elapsed_seconds,
                )
        except (CleanerError, OSError, ValueError) as exc:
            self.root.after(0, self._finish_with_error, str(exc))
            return

        self.root.after(0, self._finish_success, summary)

    def _format_success(
        self,
        rows_processed: int,
        rows_written: int,
        elapsed_seconds: float | None,
    ) -> str:
        lines = [
            f"Processed {rows_processed:,} input rows.",
            f"Wrote {rows_written:,} cleaned rows.",
            f"Time taken: {format_elapsed_time(elapsed_seconds)}.",
            "Done.",
        ]
        return "\n".join(lines)

    def _finish_success(self, summary: str) -> None:
        self._set_busy(False)
        self.status_text.set(summary)

    def _finish_with_error(self, message: str) -> None:
        self._set_busy(False)
        self.status_text.set(message)
        messagebox.showerror("Cleaning failed", message)

    def _set_busy(self, busy: bool) -> None:
        if busy:
            self.clean_button.state(["disabled"])
            self.progress.start(12)
        else:
            self.clean_button.state(["!disabled"])
            self.progress.stop()


def main() -> int:
    root = tk.Tk()
    ShadowViewCleanerApp(root)
    root.mainloop()
    return 0


def format_elapsed_time(elapsed_seconds: float | None) -> str:
    if elapsed_seconds is None:
        return "unknown"
    if elapsed_seconds < 60:
        return f"{elapsed_seconds:.2f} seconds"

    minutes = int(elapsed_seconds // 60)
    seconds = elapsed_seconds % 60
    return f"{minutes} min {seconds:.2f} sec"


if __name__ == "__main__":
    raise SystemExit(main())
