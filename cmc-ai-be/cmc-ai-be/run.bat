@echo off
REM Chay BE tren Windows: nhap dup file nay hoac go run.bat trong CMD/PowerShell
REM Them tham so, vi du: run.bat --reset-data
REM Dung Python he thong (khong tao .venv): run.bat --system
chcp 65001 >nul
cd /d "%~dp0"

set "USE_SYSTEM=0"
set "ARGS="
:parse
if "%~1"=="" goto parsed
if /I "%~1"=="--system" (
  set "USE_SYSTEM=1"
  shift
  goto parse
)
set "ARGS=%ARGS% %1"
shift
goto parse
:parsed

if "%USE_SYSTEM%"=="1" goto system

if not exist .venv\Scripts\python.exe (
  echo [CMC AI] Tao moi truong Python .venv va cai thu vien, lan dau mat vai phut...
  py -3 -m venv .venv || python -m venv .venv
  .venv\Scripts\python -m pip install --upgrade pip
  .venv\Scripts\python -m pip install -r requirements.txt ultralytics pygrabber
)
echo [CMC AI] Kiem tra moi truong OpenCV...
.venv\Scripts\python -c "from app.webcams import check_env; check_env(force=True)"
.venv\Scripts\python run.py %ARGS%
pause
goto :eof

:system
echo [CMC AI] Dung Python he thong (--system), khong dung .venv.
where py >nul 2>&1
if %ERRORLEVEL%==0 (
  py -3 -m pip install -r requirements.txt pygrabber
  py -3 -c "from app.webcams import check_env; check_env(force=True)"
  py -3 run.py %ARGS%
) else (
  python -m pip install -r requirements.txt pygrabber
  python -c "from app.webcams import check_env; check_env(force=True)"
  python run.py %ARGS%
)
pause
