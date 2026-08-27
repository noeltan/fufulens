# Fuji Recipes

Save Fujifilm film simulation recipes and send them to your **X100VI**'s
C1–C7 custom settings slots over USB — from a free, no-install web app.

Everything runs in your browser. Recipes are stored locally
(localStorage), photos you drop in are read locally, and the camera is
talked to directly over WebUSB. No server, no account, no data leaves
your machine.

## Features

- **Recipe library** — create, edit, favorite, search. Seeded with seven
  classic community recipes (Kodachrome 64, Portra 400/160, Tri-X 400,
  Reala 100, Superia 800, Velvia).
- **Paste a recipe** — copy recipe text from any blog (Fuji X Weekly
  format and similar) and the fields are parsed automatically.
- **Extract from a photo** — drop a straight-out-of-camera JPEG or RAF
  and the recipe is reconstructed from the Fujifilm maker notes in its
  EXIF data.
- **Import from camera** — read what's currently in C1–C7 and save any
  slot into the library.
- **USB sync** — assign recipes to C1–C7 and write them to the camera,
  with per-property read-back verification.
- **JSON import/export** — back up or share your library.

## Using it with the camera

1. Open the app in **Chrome or Edge** (desktop) or Chrome on Android —
   WebUSB is required for syncing. (The library itself works in any
   browser, including iPhone Safari.)
2. On the camera: `SETTINGS → CONNECTION SETTING → USB MODE →`
   **USB RAW CONV./BACKUP RESTORE**.
3. Connect the camera with a USB-C cable and turn it on.
4. In the app's **Camera** tab, click *Connect camera* and pick the
   camera in the browser dialog.
5. Assign recipes to slots and hit *Send assigned recipes to camera*.

No camera handy? Add `?mock=1` to the URL for a simulated X100VI.

## Development

```bash
npm install
npm run dev       # local dev server
npm test          # unit tests (parser, EXIF extractor, model, sync)
npm run build     # type-check + production build to dist/
```

Deployment: the included GitHub Actions workflow builds and publishes to
GitHub Pages on every push to `main` (enable Pages → Source: GitHub
Actions in the repo settings).

## How the USB protocol works

There is no official Fujifilm API. The camera's C1–C7 presets are
exposed as vendor PTP device properties (`0xD18C`–`0xD1A5`) in the
USB RAW CONV./BACKUP RESTORE mode — the same mechanism FUJIFILM X RAW
STUDIO uses. This app vendors the MIT-licensed protocol implementation
from [FilmKit](https://github.com/eggricesoy/filmkit) (see
`src/vendor/filmkit/`), which reverse-engineered and verified the
property mapping on an X100VI. Writes go one property at a time and are
read back to verify.

Known limitations:

- Dynamic Range "Auto" is written as DR100 (the preset property stores a
  concrete percentage).
- Exposure compensation is a physical dial — it's stored with the recipe
  as guidance but can't be written to the camera.
- A future firmware update could change the protocol; the read-back
  verification will catch mismatches rather than corrupt anything.

## Credits & disclaimers

- Protocol: [FilmKit](https://github.com/eggricesoy/filmkit) (MIT),
  building on [rawji](https://github.com/pinpox/rawji),
  [fudge](https://github.com/petabyt/fudge), and libgphoto2.
- Maker-note tag documentation: [ExifTool](https://exiftool.org/).
- Starter recipes are community creations — most by Ritchie Roesch of
  [Fuji X Weekly](https://fujixweekly.com), a fantastic resource for
  hundreds more.
- Not affiliated with or endorsed by FUJIFILM. Use at your own risk:
  writing presets uses an unofficial, reverse-engineered protocol.
