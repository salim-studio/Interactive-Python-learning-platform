# PyLearn — Interactive Python Learning Platform

Jupyter Notebook + Google Colab + VS Code + Python Academy in one app.

## Run

```bat
pip install -r requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --app-dir .
```

Open http://127.0.0.1:8000

## Features (all real, no mocks)

- **Real Python kernel**: persistent namespace per session (`x=100` in cell 1 → `print(x)` in cell 2 works), stdout/stderr capture, execution time, memory, history, restart/interrupt.
- **Rich outputs (right panel)**: text, errors with type+line+hint+fix+[Install pkg], interactive DataFrame viewer (search/sort/CSV copy/export), matplotlib PNG capture, Plotly/Bokeh/Altair HTML, SymPy LaTeX via KaTeX.
- **Cells**: code/markdown, run / run-above / run-below / run-all, duplicate/move/delete/convert, Shift+Enter / Ctrl+Enter / Alt+Enter.
- **Libraries**: graphical pip manager (install/uninstall/list via PyPI) + one-click marketplace cards.
- **Files**: explorer, upload (csv/xlsx/json/txt/parquet/zip…) with auto `pd.read_csv` suggestion, open-as-DataFrame, dataset EDA preview (shape/dtypes/missing/duplicates/describe/corr + histogram codegen).
- **Courses**: Python (8), Data Science (3), ML (3), DL (2), Stats/Econometrics (2) — each with example → send-to-cell → exercise → mark complete.
- **Exercises + auto-tests**: run/submit/hint/solution, `assert` grading with score.
- **Variables inspector**: type/shape/preview, DataFrame shape/columns/dtypes/missing/memory.
- **AI Tutor (built-in, no key)**: explain/debug/improve/hint/new-exercise, teaches rather than spoon-feeds.
- **Notebooks**: auto-save, save/save-as, open .ipynb/.py, export .ipynb/.py/.html/.md, version-friendly JSON.
- **UI**: 3-zone (sidebar / code / output), draggable divider, dark/light, EN/AR/FR with RTL, beginner (result+explanation) vs pro (env/GPU/terminal-help) modes, CODE|OUTPUT mobile toggle, top toolbar + bottom status bar (python/mem/cpu/exec).
- **GPU detect**: torch.cuda / MPS / TF-GPU / CPU.
- **Security notes**: local trusted mode by default; timeouts + isolated per-session namespaces; documented cloud/sandbox switch point in `kernel_manager.py`.
