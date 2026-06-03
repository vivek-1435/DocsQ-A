from pathlib import Path

from langchain_core.documents import Document


def _source_document(file_path: str, content: str) -> Document:
    return Document(page_content=content, metadata={"source": Path(file_path).name})


def _read_text_file(file_path: str) -> str:
    try:
        return Path(file_path).read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return Path(file_path).read_text(encoding="latin-1")


def _row_to_text(row) -> str:
    values = [str(cell).strip() for cell in row if cell is not None and str(cell).strip()]
    return " | ".join(values)


def load_document(file_path: str) -> list:
    ext = Path(file_path).suffix.lower()

    if ext == ".pdf":
        from langchain_community.document_loaders import PyPDFLoader
        return PyPDFLoader(file_path).load()

    elif ext == ".docx":
        from langchain_community.document_loaders import Docx2txtLoader
        return Docx2txtLoader(file_path).load()

    elif ext == ".txt":
        return [_source_document(file_path, _read_text_file(file_path))]

    elif ext == ".csv":
        import csv

        text_lines = []
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                reader = csv.reader(f)
                for row in reader:
                    row_text = _row_to_text(row)
                    if row_text:
                        text_lines.append(row_text)
        except UnicodeDecodeError:
            with open(file_path, "r", encoding="latin-1") as f:
                reader = csv.reader(f)
                for row in reader:
                    row_text = _row_to_text(row)
                    if row_text:
                        text_lines.append(row_text)
        return [_source_document(file_path, "\n".join(text_lines))]

    elif ext == ".xlsx":
        import openpyxl

        wb = openpyxl.load_workbook(file_path, data_only=True)
        text_lines = []
        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            text_lines.append(f"--- Sheet: {sheet_name} ---")
            for row in sheet.iter_rows(values_only=True):
                row_text = _row_to_text(row)
                if row_text:
                    text_lines.append(row_text)
        return [_source_document(file_path, "\n".join(text_lines))]

    elif ext == ".pptx":
        from pptx import Presentation

        prs = Presentation(file_path)
        text_lines = []
        for i, slide in enumerate(prs.slides):
            text_lines.append(f"--- Slide {i+1} ---")
            for shape in slide.shapes:
                try:
                    if hasattr(shape, "text") and shape.text.strip():
                        text_lines.append(shape.text.strip())
                    if hasattr(shape, "has_table") and shape.has_table:
                        table = shape.table
                        for row in table.rows:
                            row_text = _row_to_text(cell.text for cell in row.cells)
                            if row_text:
                                text_lines.append(row_text)
                except Exception as shape_err:
                    print(f"Skipping shape in PPTX slide due to error: {shape_err}")
                    continue
        return [_source_document(file_path, "\n".join(text_lines))]

    raise ValueError(f"Unsupported file type: {ext}")
