"""PDF pages to images: 300 DPI for recognition, small JPEG previews for the review screen."""

from __future__ import annotations

import base64
import io
from pathlib import Path

RECOGNITION_DPI = 300
PREVIEW_DPI = 110


class PdfError(ValueError):
    pass


def page_count(pdf_path: Path) -> int:
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(str(pdf_path))
    except Exception as e:  # pdfium raises its own error types
        raise PdfError(f"PDF non leggibile: {e}") from e
    try:
        return len(pdf)
    finally:
        pdf.close()


def render_pages(pdf_path: Path, pages: list[int], out_dir: Path) -> tuple[list[Path], list[str]]:
    """Render the 1-based `pages`; return the PNG paths and the preview data URIs."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(pdf_path))
    images: list[Path] = []
    previews: list[str] = []
    try:
        for n in pages:
            page = pdf[n - 1]
            path = out_dir / f"page-{n:03d}.png"
            page.render(scale=RECOGNITION_DPI / 72).to_pil().convert("RGB").save(path)
            images.append(path)
            buf = io.BytesIO()
            page.render(scale=PREVIEW_DPI / 72).to_pil().convert("RGB").save(
                buf, "JPEG", quality=80
            )
            previews.append("data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode())
    finally:
        pdf.close()
    return images, previews
