@echo off
setlocal

cd /d "%~dp0\.."

py -m pip install --upgrade pyinstaller
py -m PyInstaller ^
  --noconfirm ^
  --onefile ^
  --windowed ^
  --name "Shadow View CSV Cleaner" ^
  --add-data "config;config" ^
  scripts\shadow_view_cleaner_app.py

echo.
echo Built app:
echo dist\Shadow View CSV Cleaner.exe
echo.
echo Copy that EXE to the USB drive.

endlocal
