"""Real Python kernel manager — persistent namespace per session, rich output capture."""
import ast
import base64
import html
import io
import sys
import time
import traceback
import uuid
import contextlib
import threading
import psutil
import os

KERNELS = {}

FRIENDLY_HINTS = {
    "ModuleNotFoundError": "Python cannot find this library. Install it from the Libraries panel.",
    "NameError": "You used a variable or name that is not defined yet. Check spelling or run the cell that creates it first.",
    "SyntaxError": "There is a syntax error. Check colons, parentheses, quotes and indentation.",
    "IndentationError": "Indentation problem. Python blocks must be indented with 4 spaces.",
    "TypeError": "Wrong type used. Check function arguments and data types.",
    "ValueError": "Right type but wrong value. Check your inputs.",
    "ZeroDivisionError": "Division by zero is not allowed. Check denominators.",
    "IndexError": "Index out of range. Check list/array length.",
    "KeyError": "Dictionary/DataFrame key not found. Check column names.",
    "FileNotFoundError": "File not found. Upload the file first or check the path.",
    "AttributeError": "Object has no such attribute. Check spelling, e.g. df.head() not df.Head().",
}

SUGGESTED_FIX = {
    "ModuleNotFoundError": "pip install <package>  — or click Install in the Libraries panel.",
    "NameError": "Define the variable first, e.g. x = 10, before using it.",
    "SyntaxError": "Look at the highlighted line — often a missing : ) ] or quote.",
}


def _friendly_error(etype, msg, lineno=None, code=""):
    hint = FRIENDLY_HINTS.get(etype, "Read the error message carefully and check the highlighted line.")
    fix = SUGGESTED_FIX.get(etype, "")
    install_pkg = ""
    if etype == "ModuleNotFoundError":
        import re
        m = re.search(r"No module named '([^']+)'", msg)
        if m:
            install_pkg = m.group(1).split(".")[0]
    return {"hint": hint, "fix": fix, "install_package": install_pkg}


class KernelSession:
    def __init__(self, sid=None):
        self.id = sid or uuid.uuid4().hex[:12]
        self.namespace = {}
        self.exec_count = 0
        self.history = []
        self.status = "ready"  # ready | running
        self.started_at = time.time()
        self._init_namespace()

    def _init_namespace(self):
        ns = self.namespace
        try:
            import matplotlib
            matplotlib.use("Agg")
        except Exception:
            pass
        ns["__builtins__"] = __builtins__

    def restart(self):
        self.namespace = {}
        self.exec_count = 0
        self.history = []
        self.status = "ready"
        self._init_namespace()

    def get_variables(self):
        varlist = []
        for k, v in self.namespace.items():
            if k.startswith("_") or k in ("In", "Out"):
                continue
            try:
                t = type(v).__name__
                mod = type(v).__module__
                full = f"{mod}.{t}" if mod not in ("builtins", "__main__") else t
                preview = repr(v)[:120]
                shape = None
                extra = {}
                try:
                    import pandas as pd
                    if isinstance(v, pd.DataFrame):
                        shape = f"{v.shape[0]} x {v.shape[1]}"
                        extra = {
                            "columns": list(map(str, v.columns)),
                            "dtypes": {str(c): str(d) for c, d in v.dtypes.items()},
                            "missing": int(v.isna().sum().sum()),
                            "memory_kb": round(float(v.memory_usage(deep=True).sum()) / 1024, 1),
                            "head": v.head(5).to_dict(orient="records"),
                            "describe": v.describe(include="all").fillna("").to_dict(),
                        }
                    elif isinstance(v, pd.Series):
                        shape = f"{len(v)}"
                except Exception:
                    pass
                try:
                    import numpy as np
                    if isinstance(v, np.ndarray):
                        shape = " x ".join(map(str, v.shape))
                        extra["dtype"] = str(v.dtype)
                except Exception:
                    pass
                if isinstance(v, (list, tuple, dict, set, str)):
                    try:
                        shape = str(len(v))
                    except Exception:
                        pass
                if isinstance(v, (int, float)):
                    pass
                size = sys.getsizeof(v) if not isinstance(v, type(os)) else 0
                varlist.append({
                    "name": k, "type": full, "preview": preview,
                    "shape": shape, "size_bytes": int(size), "extra": extra,
                })
            except Exception:
                continue
        return sorted(varlist, key=lambda x: x["name"])

    def execute(self, code, timeout=60):
        self.status = "running"
        self.exec_count += 1
        n = self.exec_count
        t0 = time.time()
        stdout = io.StringIO()
        stderr = io.StringIO()
        outputs = []
        error = None
        # Capture matplotlib figures: close existing first
        try:
            import matplotlib.pyplot as plt
            plt.close("all")
        except Exception:
            pass
        result_repr = None
        display_data = []
        try:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                # Split last expression for display (like Jupyter)
                try:
                    tree = ast.parse(code)
                except SyntaxError:
                    raise
                last_expr = None
                body = tree.body
                if body and isinstance(body[-1], ast.Expr):
                    last_node = body[-1]
                    mod = ast.Module(body[:-1], type_ignores=[])
                    if mod.body:
                        exec(compile(mod, f"<cell-{n}>", "exec"), self.namespace)
                    val = eval(compile(ast.Expression(last_node.value), f"<cell-{n}>", "eval"), self.namespace)
                    self.namespace["_"] = val
                    if val is not None:
                        last_expr = val
                elif body:
                    exec(compile(tree, f"<cell-{n}>", "exec"), self.namespace)
                else:
                    pass
                # rich display of last expression
                if last_expr is not None:
                    display_data = self._format_value(last_expr)
                    result_repr = repr(last_expr)[:5000]
        except Exception as e:
            etype = type(e).__name__
            tb = traceback.format_exc()
            # find lineno in cell
            lineno = None
            try:
                tb_list = traceback.extract_tb(e.__traceback__)
                for fr in reversed(tb_list):
                    if fr.filename.startswith("<cell-"):
                        lineno = fr.lineno
                        break
            except Exception:
                pass
            msg = f"{etype}: {e}"
            friendly = _friendly_error(etype, str(e), lineno, code)
            error = {
                "type": etype, "message": str(e), "traceback": tb,
                "lineno": lineno, "hint": friendly["hint"],
                "fix": friendly["fix"], "install_package": friendly["install_package"],
            }
        # collect stdout/stderr
        text_out = stdout.getvalue()
        text_err = stderr.getvalue()
        if text_out:
            outputs.append({"type": "text", "text": text_out[-20000:]})
        if text_err and not error:
            outputs.append({"type": "stderr", "text": text_err[-5000:]})
        # matplotlib figures
        try:
            import matplotlib.pyplot as plt
            for fignum in plt.get_fignums():
                fig = plt.figure(fignum)
                buf = io.BytesIO()
                fig.savefig(buf, format="png", dpi=130, bbox_inches="tight")
                buf.seek(0)
                b64 = base64.b64encode(buf.read()).decode()
                outputs.append({"type": "image", "format": "png", "base64": b64})
            plt.close("all")
        except Exception:
            pass
        # plotly / bokeh / altair fallback: if last_expr has _repr_html_
        for item in display_data:
            outputs.append(item)
        # DataFrame textual fallback already in display_data
        elapsed = time.time() - t0
        mem = 0
        try:
            mem = psutil.Process(os.getpid()).memory_info().rss // (1024 * 1024)
        except Exception:
            pass
        self.history.append({"n": n, "code": code[:2000], "elapsed": round(elapsed, 3), "error": bool(error)})
        if len(self.history) > 200:
            self.history = self.history[-200:]
        self.status = "ready"
        return {
            "exec_count": n, "outputs": outputs, "error": error,
            "elapsed": round(elapsed, 3), "memory_mb": mem,
            "result": result_repr,
        }

    def _format_value(self, val):
        items = []
        try:
            import pandas as pd
            if isinstance(val, pd.DataFrame):
                items.append({
                    "type": "dataframe",
                    "shape": list(val.shape),
                    "columns": list(map(str, val.columns)),
                    "dtypes": {str(c): str(d) for c, d in val.dtypes.items()},
                    "html": val.head(100).to_html(classes="df-table", max_rows=100),
                    "records": val.head(100).to_dict(orient="records"),
                    "json": val.head(100).to_json(orient="records"),
                    "csv": val.head(1000).to_csv(index=False),
                })
                return items
            if isinstance(val, pd.Series):
                items.append({"type": "text", "text": val.to_string()[:5000]})
                return items
        except Exception:
            pass
        try:
            import numpy as np
            if isinstance(val, np.ndarray):
                items.append({"type": "text", "text": repr(val)[:5000]})
                return items
        except Exception:
            pass
        # sympy pretty
        try:
            import sympy as sp
            if isinstance(val, (sp.Basic, sp.MatrixBase)):
                items.append({"type": "latex", "latex": sp.latex(val), "text": str(val)[:2000]})
                return items
        except Exception:
            pass
        # plotly
        try:
            mod = type(val).__module__
            if "plotly" in mod:
                try:
                    h = val.to_html(include_plotlyjs="cdn", full_html=False)
                    items.append({"type": "plotly", "html": h})
                    return items
                except Exception:
                    pass
            if "bokeh" in mod or "altair" in mod:
                try:
                    h = val._repr_html_()
                    if h:
                        items.append({"type": "html", "html": h})
                        return items
                except Exception:
                    pass
            if hasattr(val, "_repr_html_"):
                try:
                    h = val._repr_html_()
                    if h and len(str(h)) < 200000:
                        items.append({"type": "html", "html": str(h)})
                        return items
                except Exception:
                    pass
            if hasattr(val, "_repr_latex_"):
                try:
                    lx = val._repr_latex_()
                    if lx:
                        items.append({"type": "latex", "latex": str(lx), "text": repr(val)[:2000]})
                        return items
                except Exception:
                    pass
        except Exception:
            pass
        # fallback plain repr
        items.append({"type": "text", "text": repr(val)[:8000]})
        return items


def get_kernel(sid):
    if not sid or sid not in KERNELS:
        k = KernelSession(sid)
        KERNELS[k.id] = k
        return k
    return KERNELS[sid]


def gpu_info():
    info = {"cpu": os.cpu_count(), "cuda": False, "mps": False, "devices": []}
    try:
        import torch
        info["torch"] = torch.__version__
        try:
            info["cuda"] = torch.cuda.is_available()
            if info["cuda"]:
                info["devices"].append(f"CUDA: {torch.cuda.get_device_name(0)}")
        except Exception:
            pass
        try:
            info["mps"] = getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available()
            if info["mps"]:
                info["devices"].append("MPS (Apple Silicon)")
        except Exception:
            pass
    except Exception:
        info["torch"] = None
    try:
        import tensorflow as tf
        gpus = tf.config.list_physical_devices("GPU")
        info["tf_gpus"] = len(gpus)
        if gpus:
            info["devices"].append(f"TF GPUs: {len(gpus)}")
    except Exception:
        pass
    if not info["devices"]:
        info["devices"].append(f"CPU x{info['cpu']}")
    return info
