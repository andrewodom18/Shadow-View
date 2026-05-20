@echo off
setlocal

cd /d "%~dp0\.."

py -m pip install --upgrade pyinstaller
py -m PyInstaller ^
  --noconfirm ^
  --onefile ^
  --windowed ^
  --name "Shadow View CSV Cleaner" ^
  --icon "assets\shadow_view_cleaner_icon.ico" ^
  --add-data "config;config" ^
  scripts\shadow_view_cleaner_app.py

echo.
echo Built app:
echo dist\Shadow View CSV Cleaner.exe
echo.
echo Build the web app executable with scripts\build_windows_web_app.bat,
echo then run py scripts\create_usb_bundle.py to make the USB-ready folder.

endlocal
