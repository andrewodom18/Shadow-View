@echo off
setlocal

cd /d "%~dp0\.."

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js before building the web app executable.
  exit /b 1
)

where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher py.exe was not found. Install Python before building the web app executable.
  exit /b 1
)

pushd web_app
if exist package-lock.json (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 exit /b 1

call npm test
if errorlevel 1 exit /b 1

call npm run build
if errorlevel 1 exit /b 1
popd

py -m pip install --upgrade pyinstaller
if errorlevel 1 exit /b 1

py -m PyInstaller ^
  --noconfirm ^
  --onefile ^
  --windowed ^
  --name "Shadow View Web App" ^
  --icon "assets\shadow_view_cleaner_icon.ico" ^
  --add-data "config;config" ^
  --add-data "web_app\dist;web_app\dist" ^
  scripts\shadow_view_web_app.py
if errorlevel 1 exit /b 1

echo.
echo Built app:
echo dist\Shadow View Web App.exe
echo.
echo Copy this EXE together with Shadow View CSV Cleaner.exe to the USB drive,
echo or run:
echo py scripts\create_usb_bundle.py

endlocal
