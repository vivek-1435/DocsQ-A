import os
from pathlib import Path
from langchain_core.documents import Document

def load_document(file_path: str) -> list:
    ext = Path(file_path).suffix.lower()

    if ext == ".pdf":
        from langchain_community.document_loaders import PyPDFLoader
        return PyPDFLoader(file_path).load()

    elif ext == ".docx":
        from langchain_community.document_loaders import Docx2txtLoader
        return Docx2txtLoader(file_path).load()

    elif ext == ".txt":
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
        except UnicodeDecodeError:
            with open(file_path, "r", encoding="latin-1") as f:
                content = f.read()
        return [Document(page_content=content, metadata={"source": Path(file_path).name})]

    elif ext == ".csv":
        import csv
        text_lines = []
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                reader = csv.reader(f)
                for row in reader:
                    row_vals = [str(cell).strip() for cell in row if cell is not None and str(cell).strip()]
                    if row_vals:
                        text_lines.append(" | ".join(row_vals))
        except UnicodeDecodeError:
            with open(file_path, "r", encoding="latin-1") as f:
                reader = csv.reader(f)
                for row in reader:
                    row_vals = [str(cell).strip() for cell in row if cell is not None and str(cell).strip()]
                    if row_vals:
                        text_lines.append(" | ".join(row_vals))
        content = "\n".join(text_lines)
        return [Document(page_content=content, metadata={"source": Path(file_path).name})]

    elif ext == ".xlsx":
        import openpyxl
        wb = openpyxl.load_workbook(file_path, data_only=True)
        text_lines = []
        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            text_lines.append(f"--- Sheet: {sheet_name} ---")
            for row in sheet.iter_rows(values_only=True):
                row_vals = [str(cell).strip() for cell in row if cell is not None and str(cell).strip()]
                if row_vals:
                    text_lines.append(" | ".join(row_vals))
        content = "\n".join(text_lines)
        return [Document(page_content=content, metadata={"source": Path(file_path).name})]

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
                            row_vals = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                            if row_vals:
                                text_lines.append(" | ".join(row_vals))
                except Exception as shape_err:
                    # Defensive: Skip any corrupted or non-standard PPTX vector shapes
                    print(f"Skipping shape in PPTX slide due to error: {shape_err}")
                    continue
        content = "\n".join(text_lines)
        return [Document(page_content=content, metadata={"source": Path(file_path).name})]

    raise ValueError(f"Unsupported file type: {ext}")
