"""HTTP API and the web app.

POST /api/triage streams Server-Sent Events: a `step` event per progress change, then
one `result` event.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import agent, audit
from .config import settings

app = FastAPI(title="Materials Triage")


class TriageRequest(BaseModel):
    request: str = Field(min_length=1, max_length=4000)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/ui")
def ui() -> dict:
    user = settings().user
    return {"examples": user["examples"], "view": user.get("view", "summary")}


@app.get("/api/history")
def history() -> list[dict]:
    return audit.recent()


@app.get("/api/results/{request_id}")
def result(request_id: str) -> dict:
    res = audit.load(request_id)
    if not res:
        raise HTTPException(404, "not found")
    return json.loads(res.model_dump_json())


@app.post("/api/triage")
async def triage(body: TriageRequest) -> StreamingResponse:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def emit(event: dict) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, event)

    def work() -> None:
        res = agent.run(body.request, emit)
        emit({"type": "result", "result": json.loads(res.model_dump_json())})
        emit({"type": "end"})

    threading.Thread(target=work, daemon=True).start()

    async def stream():
        while (event := await queue.get())["type"] != "end":
            yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


_dist = Path(os.environ.get("TRIAGE_FRONTEND_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if _dist.exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        return FileResponse(_dist / "index.html")
