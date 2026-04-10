# WoW Dashboard

A weekly gearing tracker and Best-in-Slot companion for World of Warcraft: Midnight Season 1.

## What It Does

- **In-Game Tracker** — Draggable frame showing weekly tasks, vault progress, and smart "Next Up" recommendations with TomTom waypoint integration
- **Web Dashboard** — Browser-based dashboard with character tiles, weekly gearing tracker, BiS gear comparison, and smart recommendations
- **Auto-Synced** — Reads your game data via SavedVariables. Tracks vault progress, quest completion, and equipped gear automatically

## Components

### 1. Addon (Required)
The WoW addon that collects your character data. Install by dropping the `addon/WoWDashboard/` folder into your `World of Warcraft/_retail_/Interface/AddOns/` directory.

### 2. Companion App (Optional)
A local Node.js server that powers the web dashboard. Run it on your PC to see the full dashboard at `http://localhost:3000`.

## Quick Install

### Addon Only
1. Download the latest release
2. Extract the `WoWDashboard` folder into `World of Warcraft/_retail_/Interface/AddOns/`
3. `/reload` in game
4. Type `/db` to toggle the tracker, `/db help` for all commands

### Addon + Web Dashboard
1. Install the addon (above)
2. Install [Node.js](https://nodejs.org/) (v18+)
3. Download the companion files
4. Double-click `start.bat` (Windows) or run `npm start`
5. Open `http://localhost:3000` in your browser

## In-Game Commands

| Command | Action |
|---------|--------|
| `/db` | Toggle the tracker frame |
| `/db next` | Show and navigate to next priority task |
| `/db go` | Set waypoint for next task |
| `/db mark worldboss` | Manually mark world boss as done |
| `/db mark prey` | Cycle prey hunt count (0→1→2→3→0) |
| `/db vault` | Print raw Great Vault API data (debug) |
| `/db help` | Show all commands |

## Features

- **Smart Priority Engine** — Recommends the fastest gearing path based on Midnight Season 1 meta
- **Great Vault Tracking** — Auto-detects dungeon, raid, and world activity progress
- **Liadrin Spark Quest Tracking** — Detects all 13 weekly quest variants with objective progress
- **Best-in-Slot Comparison** — Per-slot gear comparison with BiS data from Wowhead/Archon
- **TomTom Integration** — Click any task to set a waypoint (requires TomTom addon)
- **Time Estimates** — Shows how long remaining weekly tasks will take
- **Multi-Character Support** — Tracks all your characters, switch between them on the dashboard
- **Weekly Auto-Reset** — Tracker resets on EU Wednesday / NA Tuesday

## Blizzard Policy Compliance

This addon is fully compliant with Blizzard's UI Add-On Development Policy:
- No external server communication from the addon
- No combat automation or decision-making
- All code is visible and unobfuscated
- Free to use, no paid features

The companion app is a separate desktop tool (not an addon) that reads local files only.

## Tech Stack

- **Addon:** Lua (WoW API)
- **Companion:** Node.js + Express
- **Dashboard:** Vanilla HTML/CSS/JS

## License

MIT
