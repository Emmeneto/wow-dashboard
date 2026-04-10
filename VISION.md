# WoW Dashboard — Longer-Term Vision

## 1. Patch-Day Auto-Refresh

**Goal:** After each WoW patch, automatically update quest IDs, ilvl breakpoints, vault thresholds, and weekly activities.

**How it works:**
- Scheduled Claude Code task runs weekly (or on-demand after patch notes drop)
- Scrapes Wowhead for:
  - Updated quest IDs for Liadrin spark quests (if new ones are added mid-season)
  - Changed ilvl breakpoints per M+ key level or raid difficulty
  - New weekly activities or events
  - Hotfix changes to vault requirements
  - New delve locations or raid wings
- Regenerates `WoWDashboard_Advice.lua` with fresh data
- Updates `server.js` priority constants if thresholds change
- Writes a changelog so you know what changed

**Implementation:**
- Create a `refresh-meta.js` script that Claude Code can run
- Script reads current config, fetches Wowhead data, diffs changes, updates files
- Can be triggered manually (`node refresh-meta.js`) or via scheduled task

---

## 2. Personal Meta-Advisor

**Goal:** Based on your actual equipped ilvl per slot, recommend the specific content that would give you the biggest upgrade.

**Architecture:**
- New addon tracking: scan all 16 equipped gear slots and record ilvl per slot
- Identify weakest slot(s) — e.g., "boots are 246, everything else is 263+"
- Cross-reference with loot tables:
  - Which M+ dungeons drop boots?
  - Which raid bosses drop boots?
  - Can you craft boots with Sparks of Radiance?
  - Are there world quest/delve boots available?
- Recommend the highest-impact activity: "Run Voidspire Boss 3 for Hero boots (ilvl 269)"

**Sub-feature: Best-in-Slot (BiS) Tracker**
- Separate UI section / subcategory in the tracker
- Define BiS list per spec (from Wowhead/IcyVeins class guides)
- Show which BiS pieces you have vs. still need
- Priority-rank missing pieces by impact (trinkets/weapons > other slots)
- Track tier set completion (which tier tokens you need, which bosses drop them)

**Data sources:**
- Wowhead loot tables per dungeon/raid boss
- Wowhead BiS guides per spec
- In-game: C_Item API for equipped gear details
- Adventure Guide loot data (GetEncounterJournalInfo)

**Addon changes needed:**
- New function: ScanEquippedGear() — loops all slots, records itemID, ilvl, enchant status
- Store per-slot data in SavedVariables
- Server generates slot-specific recommendations

---

## 3. Weekly Knowledge File

**Goal:** A `WoWDashboard_Meta.lua` file that the server regenerates with the latest gearing meta, so the in-game addon always has fresh strategy data without code changes.

**Contents:**
```lua
WoWDashboard_Meta = {
    season = "Midnight Season 1",
    maxLevel = 90,
    maxIlvl = 289,
    vaultThresholds = {
        dungeons = {1, 4, 8},
        raid = {2, 4, 6},
        world = {2, 4, 8},
    },
    mplusIlvlBreakpoints = {
        {keyLevel = 2, endOfRun = 250, vault = 259},
        {keyLevel = 6, endOfRun = 259, vault = 266},
        {keyLevel = 10, endOfRun = 266, vault = 272},
    },
    currentRaids = {
        {name = "The Voidspire", bosses = 6, zone = "Voidstorm"},
        {name = "Dreamrift", bosses = 1, zone = "Harandar"},
        {name = "March on Quel'Danas", bosses = 2, zone = "Isle of Quel'Danas"},
    },
    worldBossRotation = {"Lu'ashal", "Cragpine", "Thorm'belan", "Predaxas"},
    sparkQuestIDs = {93766, 93767, 93769, 93889, 93890, 93891, 93892, 93909, 93910, 93911, 93912, 93913, 94457},
    lastUpdated = "2026-04-10",
    patchVersion = "12.0.5",
}
```

**Benefits:**
- Addon reads breakpoints/thresholds from this file instead of hardcoding
- Server can update it without touching addon Lua code
- Easy to version and diff changes
- Claude Code can regenerate it by scraping Wowhead on demand

**Refresh triggers:**
- Weekly: check for hotfix notes on Wowhead
- Patch day: full rescrape of all data
- Manual: `/db refresh` command tells you to run Claude Code refresh
- Seasonal: major overhaul when new season launches

---

## Implementation Priority

1. **Weekly Knowledge File** (foundation) — easiest, enables everything else
2. **Patch-Day Refresh** (automation) — builds on the knowledge file
3. **Personal Meta-Advisor** (intelligence) — the big payoff, needs gear scanning + loot tables
4. **BiS Tracker** (deep feature) — subcategory of meta-advisor, most complex

---

## Data We'd Need to Add to the Addon

| Feature | API Calls | New SavedVariables Fields |
|---------|-----------|--------------------------|
| Gear scanning | GetInventoryItemLink, GetDetailedItemLevelInfo | equippedGear (16 slot table with ilvl, itemID, enchant) |
| Tier set tracking | C_Item.GetItemSetInfo | tierPieces (which set tokens owned) |
| Enchant audit | GetItemStats, tooltip scanning | missingEnchants (list of unenchanted slots) |
| Gem audit | GetSocketInfo | missingGems (list of empty sockets) |
| Crafting tracker | C_TradeSkillUI | sparksAvailable, crestsAvailable |

---

## Future Session Workflow

When you sit down for a gearing session:
1. `/reload` to pick up latest advice file
2. Dashboard shows: "Your weakest slot is boots (246). Voidspire Boss 3 drops Hero boots."
3. Tracker shows weekly priorities with vault progress
4. Click NEXT UP to navigate to the recommended content
5. As you complete activities, tracker updates in real-time
6. After logging out, web dashboard shows full overview across all alts
