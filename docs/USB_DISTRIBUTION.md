# Shadow View USB Distribution

Use this when preparing a USB drive for nontechnical Windows users.

## What Users Receive

The complete USB bundle should contain these files at the top level:

- `START HERE - Shadow View.txt`
- `Shadow View CSV Cleaner.exe`
- `Shadow View Web App.exe`

Users can run either tool:

- `Shadow View CSV Cleaner.exe` is the quick desktop cleaner.
- `Shadow View Web App.exe` starts the local backend, opens the browser frontend, and keeps the cleaner API running while the launcher window stays open.

## Build The Bundle From GitHub

The easiest handoff path is the GitHub Actions artifact:

1. Open the repository on GitHub.
2. Open **Actions**.
3. Run **Build Windows App** on the branch or tag you want to ship.
4. Download **Shadow View USB Bundle - Windows**.
5. Unzip the downloaded artifact.
6. Copy the unzipped contents to the USB drive.

When the workflow runs from a published GitHub release, it also attaches these release assets:

- `Shadow View CSV Cleaner.exe`
- `Shadow View Web App.exe`
- `Shadow View USB Bundle.zip`

For a release handoff, download `Shadow View USB Bundle.zip`, unzip it, and copy the unzipped `Shadow View USB Bundle` folder to the USB drive.

## Build Locally On Windows

From the repository root:

```bat
scripts\build_windows_app.bat
scripts\build_windows_web_app.bat
py scripts\create_usb_bundle.py
```

The final bundle is written to:

```text
dist\Shadow View USB Bundle
```

The zip file is written to:

```text
dist\Shadow View USB Bundle.zip
```

## Pre-Handoff Test

Before giving the USB to a user:

1. Copy the bundle folder to a Windows computer that does not have this repository.
2. Double-click `Shadow View CSV Cleaner.exe`.
3. Clean a known Co-Traveler or Rogue Tower CSV and confirm the expected outputs are created.
4. Double-click `Shadow View Web App.exe`.
5. Confirm the browser opens to `http://127.0.0.1:8765/` or a nearby local port.
6. Load a CSV, review BSSIDs, and run **Clean & Export**.
7. Close the browser tab and click **Stop & Close** in the launcher.

## Notes

- Target users do not need Python, Node, npm, or this repository.
- CSV cleaning and export happen locally.
- Online basemap tiles may require internet access, but the frontend and backend are served from the user's computer.
- If Windows SmartScreen appears, the user instructions explain **More info** then **Run anyway**.
