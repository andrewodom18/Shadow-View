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


def system_color(root: tk.Tk, name: str, fallback: str) -> str:
    try:
        root.winfo_rgb(name)
    except tk.TclError:
        return fallback
    return name


def draw_rounded_rectangle(
    canvas: tk.Canvas,
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    radius: int,
    *,
    fill: str,
    outline: str,
) -> None:
    radius = min(radius, max(0, (x2 - x1) // 2), max(0, (y2 - y1) // 2))
    points = [
        x1 + radius,
        y1,
        x2 - radius,
        y1,
        x2,
        y1,
        x2,
        y1 + radius,
        x2,
        y2 - radius,
        x2,
        y2,
        x2 - radius,
        y2,
        x1 + radius,
        y2,
        x1,
        y2,
        x1,
        y2 - radius,
        x1,
        y1 + radius,
        x1,
        y1,
    ]
    canvas.create_polygon(
        points,
        smooth=True,
        splinesteps=18,
        fill=fill,
        outline=outline,
        tags="panel",
    )


class RoundedPanel(tk.Canvas):
    def __init__(
        self,
        master: tk.Widget,
        *,
        background: str,
        fill: str,
        outline: str,
        radius: int = 16,
        padding: int = 16,
        min_height: int = 86,
    ) -> None:
        super().__init__(
            master,
            background=background,
            highlightthickness=0,
            borderwidth=0,
            height=min_height,
        )
        self.fill = fill
        self.outline = outline
        self.radius = radius
        self.padding = padding
        self.content = tk.Frame(self, background=fill, borderwidth=0)
        self.content_window = self.create_window(
            padding,
            padding,
            anchor="nw",
            window=self.content,
        )
        self.bind("<Configure>", self._redraw)

    def _redraw(self, event: tk.Event) -> None:
        self.delete("panel")
        width = max(1, int(event.width))
        height = max(1, int(event.height))
        draw_rounded_rectangle(
            self,
            1,
            1,
            width - 2,
            height - 2,
            self.radius,
            fill=self.fill,
            outline=self.outline,
        )
        self.tag_lower("panel")
        inner_width = max(1, width - self.padding * 2)
        inner_height = max(1, height - self.padding * 2)
        self.itemconfigure(
            self.content_window,
            width=inner_width,
            height=inner_height,
        )


class ShadowViewCleanerApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Shadow View CSV Cleaner")
        self.root.geometry("760x480")
        self.root.minsize(680, 440)
        self._configure_style()
        self.root.configure(background=self.window_bg)

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
        default_font = ("Segoe UI", 10)
        style.configure(".", font=default_font)

        frame_bg = style.lookup("TFrame", "background") or self.root.cget("background")
        label_fg = style.lookup("TLabel", "foreground") or "#000000"
        self.window_bg = system_color(self.root, "SystemButtonFace", frame_bg)
        self.panel_bg = system_color(self.root, "SystemWindow", frame_bg)
        self.text_color = system_color(self.root, "SystemWindowText", label_fg)
        self.muted_color = system_color(self.root, "SystemGrayText", label_fg)
        self.border_color = system_color(self.root, "SystemButtonShadow", "#c8c8c8")

        style.configure("App.TFrame", background=self.window_bg)
        style.configure(
            "Title.TLabel",
            background=self.window_bg,
            foreground=self.text_color,
            font=("Segoe UI", 20, "bold"),
        )
        style.configure(
            "Muted.TLabel",
            background=self.window_bg,
            foreground=self.muted_color,
        )
        style.configure(
            "Section.TLabel",
            background=self.window_bg,
            foreground=self.text_color,
            font=("Segoe UI", 10, "bold"),
        )
        style.configure(
            "Panel.TCheckbutton",
            background=self.panel_bg,
            foreground=self.text_color,
        )
        style.map("Panel.TCheckbutton", background=[("active", self.panel_bg)])
        style.configure(
            "Status.TLabel",
            background=self.panel_bg,
            foreground=self.text_color,
            padding=0,
        )
        style.configure("TButton", padding=(12, 7))

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

        outputs_title = ttk.Label(outer, text="Outputs", style="Section.TLabel")
        outputs_title.grid(row=3, column=0, sticky="w", pady=(0, 6))

        outputs_panel = RoundedPanel(
            outer,
            background=self.window_bg,
            fill=self.panel_bg,
            outline=self.border_color,
            min_height=74,
        )
        outputs_panel.grid(row=4, column=0, sticky="ew")
        options = outputs_panel.content
        options.columnconfigure(0, weight=1)
        options.columnconfigure(1, weight=1)
        options.columnconfigure(2, weight=1)

        ttk.Checkbutton(
            options, text="CSV", variable=self.csv_enabled, style="Panel.TCheckbutton"
        ).grid(row=0, column=0, sticky="w")
        ttk.Checkbutton(
            options,
            text="Excel (.xlsx)",
            variable=self.xlsx_enabled,
            style="Panel.TCheckbutton",
        ).grid(row=0, column=1, sticky="w")
        ttk.Checkbutton(
            options,
            text="HTML preview",
            variable=self.html_enabled,
            style="Panel.TCheckbutton",
        ).grid(row=0, column=2, sticky="w")

        actions = ttk.Frame(outer, style="App.TFrame")
        actions.grid(row=5, column=0, sticky="ew", pady=(20, 12))
        actions.columnconfigure(0, weight=1)

        self.clean_button = ttk.Button(
            actions,
            text="Clean CSV",
            command=self.start_cleaning,
        )
        self.clean_button.grid(row=0, column=0, sticky="w")

        self.progress = ttk.Progressbar(actions, mode="indeterminate", length=220)
        self.progress.grid(row=0, column=1, sticky="e")
        self.progress.grid_remove()

        status_title = ttk.Label(outer, text="Status", style="Section.TLabel")
        status_title.grid(row=6, column=0, sticky="w", pady=(0, 6))

        status_panel = RoundedPanel(
            outer,
            background=self.window_bg,
            fill=self.panel_bg,
            outline=self.border_color,
            min_height=130,
        )
        status_panel.grid(row=7, column=0, sticky="nsew")
        outer.rowconfigure(7, weight=1)
        status_box = status_panel.content
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
            self.progress.grid()
            self.progress.start(12)
            self.root.update_idletasks()
        else:
            self.clean_button.state(["!disabled"])
            self.progress.stop()
            self.progress.grid_remove()


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
