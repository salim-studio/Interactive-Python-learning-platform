@echo off
echo Installing PyLearn dependencies...
pip install -r requirements.txt
echo Starting PyLearn on http://127.0.0.1:8000
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --app-dir "%~dp0"
