"""Excel workbook output for cleaned Shadow View rows."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

from .time_buckets import color_for_event_time


HEX_COLOR_PATTERN = re.compile(r"^#?([0-9a-fA-F]{6})$")


def column_letter(index: int) -> str:
    letters = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def clean_xml_text(value: str) -> str:
    return "".join(
        char
        for char in value
        if char in "\t\n\r"
        or 0x20 <= ord(char) <= 0xD7FF
        or 0xE000 <= ord(char) <= 0xFFFD
        or 0x10000 <= ord(char) <= 0x10FFFF
    )


def normalize_rgb(value: str) -> str | None:
    match = HEX_COLOR_PATTERN.match(value.strip())
    if match is None:
        return None
    return match.group(1).upper()


def cell_xml(row_number: int, column_number: int, value: str, style_id: int) -> str:
    cell_ref = f"{column_letter(column_number)}{row_number}"
    style = f' s="{style_id}"' if style_id else ""
    text = escape(clean_xml_text(value))
    return (
        f'<c r="{cell_ref}"{style} t="inlineStr">'
        f'<is><t xml:space="preserve">{text}</t></is>'
        "</c>"
    )


class XlsxOutput:
    """Minimal standard-library XLSX writer with row color styles."""

    def __init__(
        self,
        path: Path,
        headers: list[str],
        event_index: int | None,
        bucket_minutes: int,
        palette: list[str],
        color_enabled: bool,
    ) -> None:
        self.path = path
        self.headers = headers
        self.event_index = event_index
        self.bucket_minutes = bucket_minutes
        self.palette = palette
        self.color_enabled = color_enabled
        self.rows: list[str] = []
        self.row_count = 0
        self.widths = [max(10, len(header) + 2) for header in headers]
        self.color_styles: dict[str, int] = {}
        self.style_colors: list[str] = []

        self._append_row(headers, style_id=1)

    def write_row(self, values: list[str]) -> None:
        style_id = self._style_for_values(values)
        self._append_row(values, style_id)

    def close(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(self.path, "w", compression=ZIP_DEFLATED) as workbook:
            workbook.writestr("[Content_Types].xml", self._content_types_xml())
            workbook.writestr("_rels/.rels", self._root_rels_xml())
            workbook.writestr("docProps/app.xml", self._app_props_xml())
            workbook.writestr("docProps/core.xml", self._core_props_xml())
            workbook.writestr("xl/workbook.xml", self._workbook_xml())
            workbook.writestr("xl/_rels/workbook.xml.rels", self._workbook_rels_xml())
            workbook.writestr("xl/styles.xml", self._styles_xml())
            workbook.writestr("xl/worksheets/sheet1.xml", self._worksheet_xml())

    def _append_row(self, values: list[str], style_id: int) -> None:
        self.row_count += 1
        cells = []
        for index, value in enumerate(values[: len(self.headers)], start=1):
            self.widths[index - 1] = max(
                self.widths[index - 1], min(len(value) + 2, 48)
            )
            cells.append(cell_xml(self.row_count, index, value, style_id))
        self.rows.append(f'<row r="{self.row_count}">{"".join(cells)}</row>')

    def _style_for_values(self, values: list[str]) -> int:
        if not self.color_enabled or self.event_index is None:
            return 0
        if self.event_index >= len(values):
            return 0

        bucket = color_for_event_time(
            values[self.event_index], self.bucket_minutes, self.palette
        )
        if bucket is None:
            return 0

        rgb = normalize_rgb(bucket[1])
        if rgb is None:
            return 0
        if rgb not in self.color_styles:
            self.color_styles[rgb] = len(self.style_colors) + 2
            self.style_colors.append(rgb)
        return self.color_styles[rgb]

    def _content_types_xml(self) -> str:
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            "</Types>"
        )

    def _root_rels_xml(self) -> str:
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
            '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
            "</Relationships>"
        )

    def _app_props_xml(self) -> str:
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
            'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
            "<Application>Co-Traveler CSV Cleaner</Application>"
            "</Properties>"
        )

    def _core_props_xml(self) -> str:
        timestamp = datetime.now(UTC).replace(microsecond=0).isoformat()
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" '
            'xmlns:dcterms="http://purl.org/dc/terms/" '
            'xmlns:dcmitype="http://purl.org/dc/dcmitype/" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            "<dc:creator>Co-Traveler CSV Cleaner</dc:creator>"
            "<cp:lastModifiedBy>Co-Traveler CSV Cleaner</cp:lastModifiedBy>"
            f'<dcterms:created xsi:type="dcterms:W3CDTF">{timestamp}</dcterms:created>'
            f'<dcterms:modified xsi:type="dcterms:W3CDTF">{timestamp}</dcterms:modified>'
            "</cp:coreProperties>"
        )

    def _workbook_xml(self) -> str:
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            "<sheets>"
            '<sheet name="Cleaned Data" sheetId="1" r:id="rId1"/>'
            "</sheets>"
            "</workbook>"
        )

    def _workbook_rels_xml(self) -> str:
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            "</Relationships>"
        )

    def _styles_xml(self) -> str:
        fills = [
            '<fill><patternFill patternType="none"/></fill>',
            '<fill><patternFill patternType="gray125"/></fill>',
            '<fill><patternFill patternType="solid"><fgColor rgb="FF1F2933"/><bgColor indexed="64"/></patternFill></fill>',
        ]
        fills.extend(
            f'<fill><patternFill patternType="solid"><fgColor rgb="FF{rgb}"/><bgColor indexed="64"/></patternFill></fill>'
            for rgb in self.style_colors
        )

        cell_xfs = [
            '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>',
            '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>',
        ]
        cell_xfs.extend(
            f'<xf numFmtId="0" fontId="0" fillId="{index}" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>'
            for index in range(3, 3 + len(self.style_colors))
        )

        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<fonts count="2">'
            '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'
            '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
            "</fonts>"
            f'<fills count="{len(fills)}">{"".join(fills)}</fills>'
            '<borders count="2">'
            '<border><left/><right/><top/><bottom/><diagonal/></border>'
            '<border><left style="thin"><color rgb="FFD0D7DE"/></left><right style="thin"><color rgb="FFD0D7DE"/></right><top style="thin"><color rgb="FFD0D7DE"/></top><bottom style="thin"><color rgb="FFD0D7DE"/></bottom><diagonal/></border>'
            "</borders>"
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            f'<cellXfs count="{len(cell_xfs)}">{"".join(cell_xfs)}</cellXfs>'
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            "</styleSheet>"
        )

    def _worksheet_xml(self) -> str:
        last_column = column_letter(len(self.headers))
        last_row = max(1, self.row_count)
        dimension = f"A1:{last_column}{last_row}"
        cols = "".join(
            f'<col min="{index}" max="{index}" width="{min(max(width, 10), 48)}" customWidth="1"/>'
            for index, width in enumerate(self.widths, start=1)
        )
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<dimension ref="{dimension}"/>'
            "<sheetViews><sheetView workbookViewId=\"0\">"
            '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            "</sheetView></sheetViews>"
            "<sheetFormatPr defaultRowHeight=\"15\"/>"
            f"<cols>{cols}</cols>"
            f'<sheetData>{"".join(self.rows)}</sheetData>'
            f'<autoFilter ref="{dimension}"/>'
            "</worksheet>"
        )
