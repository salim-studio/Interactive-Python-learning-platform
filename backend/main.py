"""PyLearn backend — FastAPI serving API + frontend."""
import os, sys, json, shutil, subprocess, tempfile, time, uuid, glob, asyncio
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"


def ensure_dir(p: Path) -> Path:
    """Create dir, falling back to /tmp on read-only filesystems (serverless)."""
    try:
        p.mkdir(parents=True, exist_ok=True)
        # prove writability (Vercel: read-only except /tmp)
        probe = p / ".write_test"
        probe.touch()
        probe.unlink(missing_ok=True)
        return p
    except Exception:
        fb = Path(tempfile.gettempdir()) / "pylearn" / p.name
        fb.mkdir(parents=True, exist_ok=True)
        return fb


NB_DIR = ensure_dir(ROOT / "notebooks")
DATA_DIR = ensure_dir(ROOT / "data")
PROJ_DIR = ensure_dir(ROOT / "projects")

sys.path.insert(0, str(Path(__file__).parent))
from kernel_manager import get_kernel, KERNELS, gpu_info

app = FastAPI(title="PyLearn Platform")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class ExecReq(BaseModel):
    session_id: str = ""
    code: str = ""


class TestsReq(BaseModel):
    code: str = ""
    tests: str = ""
    session_id: str = ""


class AIReq(BaseModel):
    code: str = ""
    question: str = ""
    mode: str = "explain"
    error: str = ""


@app.get("/api/health")
def health():
    return {"ok": True, "python": sys.version.split()[0]}


@app.get("/api/system/info")
def sysinfo():
    import psutil
    try:
        mem = psutil.virtual_memory()
        cpu = psutil.cpu_percent(interval=0.1)
    except Exception:
        mem, cpu = None, 0
    return {
        "python": sys.version,
        "python_short": sys.version.split()[0],
        "gpu": gpu_info(),
        "memory": {"percent": getattr(mem, "percent", 0), "total_gb": round(getattr(mem, "total", 0) / 1e9, 1)},
        "cpu_percent": cpu,
    }


@app.post("/api/execute")
def execute(req: ExecReq):
    k = get_kernel(req.session_id or None)
    res = k.execute(req.code or "")
    res["session_id"] = k.id
    return res


@app.post("/api/kernel/restart")
def krestart(d: dict = {}):
    k = get_kernel(d.get("session_id"))
    k.restart()
    return {"session_id": k.id, "status": "restarted"}


@app.post("/api/kernel/interrupt")
def kinterrupt(d: dict = {}):
    k = get_kernel(d.get("session_id"))
    k.status = "ready"
    return {"session_id": k.id, "status": "interrupted"}


@app.get("/api/kernel/status")
def kstatus(session_id: str = ""):
    k = get_kernel(session_id or None)
    return {"session_id": k.id, "status": k.status, "exec_count": k.exec_count, "history": k.history[-20:]}


@app.get("/api/variables")
def variables(session_id: str = ""):
    k = get_kernel(session_id or None)
    return {"session_id": k.id, "variables": k.get_variables()}


# ---------- files ----------
@app.get("/api/files")
def files():
    out = []
    for base, label in ((NB_DIR, "notebooks"), (DATA_DIR, "data"), (PROJ_DIR, "projects")):
        for p in sorted(base.rglob("*")):
            if p.is_file():
                rel = str(p.relative_to(base))
                out.append({"scope": label, "name": rel, "path": str(p), "size": p.stat().st_size})
    return {"files": out}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...), scope: str = Form("data")):
    dest = {"notebooks": NB_DIR, "data": DATA_DIR, "projects": PROJ_DIR}.get(scope, DATA_DIR)
    target = dest / file.filename
    content = await file.read()
    target.write_bytes(content)
    suggest = ""
    if target.suffix.lower() == ".csv":
        suggest = f'import pandas as pd\n\ndf = pd.read_csv("data/{file.filename}")\ndf.head()'
    elif target.suffix.lower() in (".xlsx", ".xls"):
        suggest = f'import pandas as pd\n\ndf = pd.read_excel("data/{file.filename}")\ndf.head()'
    elif target.suffix.lower() == ".json":
        suggest = f'import pandas as pd\n\ndf = pd.read_json("data/{file.filename}")\ndf.head()'
    elif target.suffix.lower() == ".parquet":
        suggest = f'import pandas as pd\n\ndf = pd.read_parquet("data/{file.filename}")\ndf.head()'
    return {"ok": True, "name": file.filename, "size": len(content), "suggest": suggest}


@app.get("/api/notebooks/{name}")
def nb_load(name: str):
    p = NB_DIR / name
    if not p.exists():
        raise HTTPException(404, "not found")
    return json.loads(p.read_text(encoding="utf-8"))


@app.post("/api/notebooks/save")
def nb_save(d: dict):
    name = d.get("name", "untitled.ipynb")
    if not name.endswith(".ipynb"):
        name += ".ipynb"
    nb = d.get("notebook", {"cells": [], "metadata": {}})
    (NB_DIR / name).write_text(json.dumps(nb, indent=2), encoding="utf-8")
    return {"ok": True, "name": name}


@app.get("/api/dataset/preview")
def preview(scope: str = "data", name: str = ""):
    base = {"notebooks": NB_DIR, "data": DATA_DIR, "projects": PROJ_DIR}.get(scope, DATA_DIR)
    p = base / name
    if not p.exists():
        raise HTTPException(404, "not found")
    try:
        import pandas as pd
        if p.suffix.lower() == ".csv":
            df = pd.read_csv(p, nrows=5000)
        elif p.suffix.lower() in (".xlsx", ".xls"):
            df = pd.read_excel(p, nrows=5000)
        elif p.suffix.lower() == ".json":
            df = pd.read_json(p)
        elif p.suffix.lower() == ".parquet":
            df = pd.read_parquet(p)
        elif p.suffix.lower() == ".txt":
            return {"kind": "text", "text": p.read_text(encoding="utf-8", errors="ignore")[:8000]}
        else:
            return {"kind": "unsupported"}
        full = len(df)
        desc = df.describe(include="all").fillna("").to_dict()
        corr = {}
        try:
            corr = df.select_dtypes(include="number").corr(numeric_only=True).fillna(0).to_dict()
        except Exception:
            pass
        return {
            "kind": "dataframe", "shape": list(df.shape),
            "columns": list(map(str, df.columns)),
            "dtypes": {str(c): str(d) for c, d in df.dtypes.items()},
            "missing": {str(c): int(df[c].isna().sum()) for c in df.columns},
            "duplicates": int(df.duplicated().sum()),
            "head": df.head(20).to_dict(orient="records"),
            "describe": desc, "corr": corr,
            "csv": df.head(200).to_csv(index=False),
        }
    except Exception as e:
        return {"kind": "error", "message": str(e)}


@app.post("/api/export/py")
def export_py(d: dict):
    nb = d.get("notebook", {})
    lines = []
    for c in nb.get("cells", []):
        if c.get("type") == "code":
            lines.append(c.get("source", ""))
            lines.append("\n# ---\n")
        else:
            for ln in c.get("source", "").splitlines():
                lines.append("# " + ln)
            lines.append("\n")
    return {"code": "".join(l if l.endswith("\n") else l + "\n" for l in lines)}


# ---------- packages ----------
@app.get("/api/packages")
def pkgs():
    try:
        out = subprocess.run([sys.executable, "-m", "pip", "list", "--format=json"],
                             capture_output=True, text=True, timeout=30)
        pkgs = json.loads(out.stdout or "[]")
        return {"packages": pkgs}
    except Exception as e:
        return {"packages": [], "error": str(e)}


@app.post("/api/packages/install")
def pkg_install(d: dict):
    name = (d.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "package name required")
    try:
        p = subprocess.run([sys.executable, "-m", "pip", "install", name],
                           capture_output=True, text=True, timeout=300)
        return {"ok": p.returncode == 0, "stdout": p.stdout[-4000:], "stderr": p.stderr[-4000:]}
    except Exception as e:
        return {"ok": False, "stderr": str(e)}


@app.post("/api/packages/uninstall")
def pkg_uninstall(d: dict):
    name = (d.get("name") or "").strip()
    p = subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", name],
                       capture_output=True, text=True, timeout=120)
    return {"ok": p.returncode == 0, "stdout": p.stdout[-3000:], "stderr": p.stderr[-3000:]}


# ---------- exercises auto-test ----------
@app.post("/api/exercises/test")
def ex_test(req: TestsReq):
    k = get_kernel(req.session_id or None)
    combined = (req.code or "") + "\n\n" + (req.tests or "")
    res = k.execute(combined)
    passed, total = 0, 0
    detail = []
    for line in (req.tests or "").splitlines():
        line = line.strip()
        if line.startswith("assert"):
            total += 1
            detail.append(line)
    if res.get("error"):
        return {"ok": False, "passed": 0, "total": max(total, 1), "error": res["error"],
                "elapsed": res["elapsed"], "session_id": k.id}
    passed = max(total, 1)
    score = 100 if total == 0 else 100
    return {"ok": True, "passed": passed, "total": max(total, 1), "score": score,
            "outputs": res["outputs"], "elapsed": res["elapsed"], "session_id": k.id}


# ---------- local AI tutor (rule-based, no key needed) ----------
@app.post("/api/ai/ask")
def ai_ask(req: AIReq):
    code = req.code or ""
    mode = req.mode or "explain"
    err = req.error or ""
    q = req.question or ""
    if mode == "debug" or (err and mode == "explain"):
        txt = f"### Debug analysis\n\nI looked at your code{' and the error' if err else ''}.\n\n"
        if err:
            txt += f"**Error:** `{err[:300]}`\n\n"
        txt += "Steps to fix:\n1. Read the error type — it tells you the category (NameError = undefined name, etc.).\n2. Check the exact line number reported.\n3. Verify variable names, colons, brackets and indentation.\n4. Run cells from top to bottom so earlier variables exist.\n\n"
        if "ModuleNotFoundError" in err or "No module named" in err:
            txt += "This is a missing library — install it from the **Libraries** panel.\n"
        if "NameError" in err:
            txt += "A `NameError` means you used a name before creating it. Define it first or check spelling.\n"
        if "SyntaxError" in err or "IndentationError" in err:
            txt += "Check `:`, `()`, quotes and 4-space indentation on the reported line.\n"
        return {"answer": txt}
    if mode == "improve":
        return {"answer": "### Improve suggestions\n\n1. Use descriptive variable names.\n2. Add comments/docstrings.\n3. Avoid repeated code — write functions.\n4. For pandas: prefer vectorized ops over loops.\n5. Handle errors with try/except where user input or files are involved.\n\nPaste a function and I will suggest a cleaner rewrite step by step."}
    if mode == "hint":
        return {"answer": f"### Hint\n\nBreak the task into 3 small steps and solve each in its own cell:\n1. Prepare the data (list, array or DataFrame).\n2. Write the core operation (loop / function / model).\n3. Print and verify the result.\n\nYour current code:\n```python\n{code[:800]}\n```\nWhat should the *next single line* do? Try writing just that line and press Run."}
    if mode == "exercise":
        return {"answer": "### Practice exercise\n\n**Task:** Write `average(numbers)` returning the mean of a list (0 for empty list).\n\n```python\ndef average(numbers):\n    # your code here\n```\n\nTests:\n```python\nassert average([1,2,3]) == 2\nassert average([10,20]) == 15\n```\nClick **Submit** in the Exercises tab to auto-grade."}
    # default explain
    lines = len(code.splitlines()) if code else 0
    return {"answer": f"### Code explanation ({lines} lines)\n\n```python\n{code[:1200]}\n```\n\n**What it does (line by line):**\n- Imports load libraries into memory.\n- Assignments (`=`) store values in the kernel so later cells can reuse them.\n- `print()` / a final expression produces the output you see on the right.\n- If a chart appears, the code created a matplotlib/plotly figure which the platform captures automatically.\n\n**Key concept:** the kernel keeps state — variables from Cell 1 are visible in Cell 2.\n\n{f'**Your question:** {q}' if q else ''}\n\nTry: change one value, re-run, and observe the output. That is the fastest way to learn."}


# ---------- static frontend ----------
if FRONTEND.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")

    @app.get("/")
    def index():
        return FileResponse(str(FRONTEND / "index.html"))
else:
    @app.get("/")
    def index():
        return {"msg": "frontend missing"}
