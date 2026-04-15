# files.py — File I/O endpoints.
# POST /files/save  — writes { filename, content } to /app/outputs/
# GET  /files/list  — lists files in /app/outputs/

import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from config import OUTPUTS_DIR
from middleware.auth import get_current_user
from models import ListFilesResponse, SaveFileRequest, SaveFileResponse

router = APIRouter(prefix="/files")

_outputs = Path(OUTPUTS_DIR)


@router.post("/save", response_model=SaveFileResponse)
async def save_file(body: SaveFileRequest, auth_id: str = Depends(get_current_user)) -> SaveFileResponse:
    # Prevent path traversal
    filename = Path(body.filename).name
    if not filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    _outputs.mkdir(parents=True, exist_ok=True)
    dest = _outputs / filename
    dest.write_text(body.content, encoding="utf-8")
    return SaveFileResponse(path=str(dest))


@router.get("/list", response_model=ListFilesResponse)
async def list_files(auth_id: str = Depends(get_current_user)) -> ListFilesResponse:
    if not _outputs.exists():
        return ListFilesResponse(files=[])
    files = sorted(p.name for p in _outputs.iterdir() if p.is_file())
    return ListFilesResponse(files=files)
