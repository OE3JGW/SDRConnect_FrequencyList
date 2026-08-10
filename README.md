# SDRconnect FrequencyList

Horizontal frequency-list panel for [SDRconnect](https://www.sdrplay.com/sdrconnect/). Frameless Electron window, portable `config.json`, remembered bounds, WebSocket tune-on-click.

## Features

- Multi-format lists: ILG/dBASE (`.dbf`), EiBi (txt/csv), RWW/Classaxe CSV, AOKI, HFCC, AM/FMLIST, Numbers & Oddities
- Switch the active list from the sidebar
- Column visibility + drag-reorder in Settings (per list)
- Sidebar left or right
- Download known sources (EiBi, RWW, N&O) into `data/`
- Connect to SDRconnect and tune by clicking a row
- Satellite map window for station coordinates (when the list provides lat/lon)

## Data

Place optional `ILGADATA.DBF` next to the app (or use **Settings → Download** / add your own list files). List sources are third-party; check their terms before redistributing.

## Run

```bash
npm install
npm start
```

## Build

```bash
npm run build
```

Portable EXE lands in `release/<version>/`.

