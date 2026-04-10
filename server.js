// ============================================================================
// WoW Dashboard - Node.js Server
// ============================================================================
// Reads WoW SavedVariables from disk, serves character data via REST API,
// generates in-game advice (written to WoWDashboard_Advice.lua), and provides
// a web dashboard at http://localhost:3000.
//
// Endpoints:
//   GET  /api/characters       - All character data (also regenerates advice)
//   GET  /api/debug            - Parsed debug data from SavedVariables
//   GET  /api/advice           - Advice data for all characters
//   GET  /api/tracker/:charKey - Weekly tracker for a character
//   POST /api/tracker/:charKey - Update a tracker tick
// ============================================================================

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

// ── Paths (auto-detect WoW install location) ──

function findWoWPath() {
  const common = [
    "C:/Program Files (x86)/World of Warcraft/_retail_",
    "C:/Program Files/World of Warcraft/_retail_",
    "D:/World of Warcraft/_retail_",
    "D:/Games/World of Warcraft/_retail_",
    "E:/World of Warcraft/_retail_",
    process.env.WOW_PATH || "",
  ];
  for (const p of common) {
    if (p && fs.existsSync(path.join(p, "WTF"))) return p;
  }
  // Fallback
  return "C:/Program Files (x86)/World of Warcraft/_retail_";
}

const WOW_ROOT = findWoWPath();
const WOW_BASE = path.join(WOW_ROOT, "WTF");
const SAVED_VARS_FILENAME = "WoWDashboard.lua";
const TRACKER_FILE = path.join(__dirname, "weekly-tracker.json");
const ADDON_DIR = path.join(WOW_ROOT, "Interface/AddOns/WoWDashboard");
const ADVICE_FILE = path.join(ADDON_DIR, "WoWDashboard_Advice.lua");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Helpers ──

// EU realms for weekly reset calculation
const EU_REALMS = ["Draenor", "Frostmane", "Outland", "Tarren Mill"];

/**
 * Get the week key (YYYY-MM-DD of the most recent reset).
 * EU resets Wednesday 07:00 UTC, NA resets Tuesday 15:00 UTC.
 * Defaults to EU since the user's realms are EU.
 */
function getWeekKey() {
  const now = new Date();
  const resetDay = 3; // Wednesday for EU
  const resetHourUTC = 7;

  const d = new Date(now);
  d.setUTCHours(resetHourUTC, 0, 0, 0);

  const currentDay = d.getUTCDay();
  let daysSinceReset = currentDay - resetDay;
  if (daysSinceReset < 0) daysSinceReset += 7;
  if (daysSinceReset === 0 && now < d) daysSinceReset = 7;

  d.setUTCDate(d.getUTCDate() - daysSinceReset);
  return d.toISOString().slice(0, 10);
}

function loadTracker() {
  try {
    if (fs.existsSync(TRACKER_FILE)) {
      return JSON.parse(fs.readFileSync(TRACKER_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("Error loading tracker:", err.message);
  }
  return {};
}

function saveTracker(data) {
  try {
    fs.writeFileSync(TRACKER_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving tracker:", err.message);
  }
}

// ── SavedVariables Parsing ──

/**
 * Find all WoWDashboard.lua SavedVariables files across WoW accounts.
 */
function findSavedVariablesFiles() {
  const paths = [];
  try {
    const accountDir = path.join(WOW_BASE, "Account");
    const accounts = fs.readdirSync(accountDir);
    for (const account of accounts) {
      const svPath = path.join(
        accountDir,
        account,
        "SavedVariables",
        SAVED_VARS_FILENAME
      );
      if (fs.existsSync(svPath)) {
        paths.push(svPath);
      }
    }
  } catch (err) {
    console.error("Error scanning for SavedVariables:", err.message);
  }
  return paths;
}

/**
 * Parse a Lua SavedVariables file into a JS object of character data.
 * Only matches top-level ["CharName-Realm"] entries (must contain a hyphen).
 * Skips internal keys (_debug, _framePosition) and nested table garbage.
 */
function parseLuaTable(lua) {
  const characters = {};
  // Only match top-level entries: lines starting with tab + ["key"]
  // Use a smarter approach: find each top-level key and extract its flat values
  const charPattern =
    /\["([^"]+)"\]\s*=\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  let match;

  while ((match = charPattern.exec(lua)) !== null) {
    const key = match[1];
    // Only parse character entries (Name-Realm format with a hyphen)
    // Skip _debug, _framePosition, slot1, enum1, vaultRawData, sparkQuests, etc.
    if (!key.includes("-") || key.startsWith("_")) continue;

    const block = match[2];
    const char = {};

    // Extract string values: key = "value"
    const strPattern = /\[?"?(\w+)"?\]?\s*=\s*"([^"]*)"/g;
    let strMatch;
    while ((strMatch = strPattern.exec(block)) !== null) {
      char[strMatch[1]] = strMatch[2];
    }

    // Extract numeric values: key = 123.45
    const numPattern = /\[?"?(\w+)"?\]?\s*=\s*(-?[\d.]+)\s*[,\n}]/g;
    let numMatch;
    while ((numMatch = numPattern.exec(block)) !== null) {
      if (!(numMatch[1] in char)) {
        char[numMatch[1]] = parseFloat(numMatch[2]);
      }
    }

    characters[key] = char;
  }

  return characters;
}

/**
 * Parse the _debug block from SavedVariables into structured JSON.
 * Handles nested Lua tables (vaultEnums, vaultRawData with slot entries,
 * sparkQuests as an indexed array of quest entries).
 */
function parseDebugBlock(lua) {
  // Find the _debug block - it's a top-level key in WoWDashboardDB
  // Match the full _debug table including nested tables
  const debugMatch = lua.match(
    /\["_debug"\]\s*=\s*\{([\s\S]*?)\n\t?\}/
  );
  if (!debugMatch) return null;

  const debugBlock = debugMatch[1];
  const result = {};

  // Extract simple string values: key = "value"
  const simpleStrPattern = /^\s*(\w+)\s*=\s*"([^"]*)"/gm;
  let m;
  while ((m = simpleStrPattern.exec(debugBlock)) !== null) {
    result[m[1]] = m[2];
  }

  // Extract simple numeric values: key = 123
  const simpleNumPattern = /^\s*(\w+)\s*=\s*(-?[\d.]+)\s*,/gm;
  while ((m = simpleNumPattern.exec(debugBlock)) !== null) {
    if (!(m[1] in result)) {
      result[m[1]] = parseFloat(m[2]);
    }
  }

  // Parse vaultEnums: { ["Activities"] = "1", ["Raid"] = "3", ... }
  const enumsMatch = debugBlock.match(
    /vaultEnums\s*=\s*\{([\s\S]*?)\}/
  );
  if (enumsMatch) {
    result.vaultEnums = {};
    const kvPattern = /\["([^"]+)"\]\s*=\s*"([^"]*)"/g;
    while ((m = kvPattern.exec(enumsMatch[1])) !== null) {
      result.vaultEnums[m[1]] = m[2];
    }
  }

  // Parse vaultRawData: { ["enum1"] = { ["slot1"] = { field = "val", ... }, ... }, ... }
  const rawDataMatch = debugBlock.match(
    /vaultRawData\s*=\s*\{([\s\S]*?)\n\t{2,3}\}/
  );
  if (rawDataMatch) {
    result.vaultRawData = {};
    // Match each enum entry: ["enumN"] = { ... }
    const enumPattern = /\["(enum\d+)"\]\s*=\s*\{([\s\S]*?)\n\t{3,4}\}/g;
    while ((m = enumPattern.exec(rawDataMatch[1])) !== null) {
      const enumKey = m[1];
      const enumBlock = m[2];
      result.vaultRawData[enumKey] = {};

      // Match each slot: ["slotN"] = { ... }
      const slotPattern = /\["(slot\d+)"\]\s*=\s*\{([\s\S]*?)\}/g;
      let slotMatch;
      while ((slotMatch = slotPattern.exec(enumBlock)) !== null) {
        const slotKey = slotMatch[1];
        const slotBlock = slotMatch[2];
        const slotData = {};

        // Extract key-value pairs from slot
        const fieldPattern = /\["([^"]+)"\]\s*=\s*"([^"]*)"/g;
        let fieldMatch;
        while ((fieldMatch = fieldPattern.exec(slotBlock)) !== null) {
          // Try to parse numeric strings as numbers
          const val = fieldMatch[2];
          slotData[fieldMatch[1]] = isNaN(val) ? val : parseFloat(val);
        }

        result.vaultRawData[enumKey][slotKey] = slotData;
      }
    }
  }

  // Parse sparkQuests: indexed array of quest entries
  const questsMatch = debugBlock.match(
    /sparkQuests\s*=\s*\{([\s\S]*?)\n\t{2,3}\}/
  );
  if (questsMatch) {
    result.sparkQuests = [];
    // Each quest entry is a { ... } block inside the array
    const questPattern = /\{([\s\S]*?)\}/g;
    let questMatch;
    while ((questMatch = questPattern.exec(questsMatch[1])) !== null) {
      const questBlock = questMatch[1];
      const quest = {};

      // String fields
      const qStrPattern = /\["?([^"\]]+)"?\]?\s*=\s*"([^"]*)"/g;
      let qm;
      while ((qm = qStrPattern.exec(questBlock)) !== null) {
        quest[qm[1]] = qm[2];
      }

      // Numeric fields
      const qNumPattern = /\["?([^"\]]+)"?\]?\s*=\s*(-?[\d.]+)\s*[,\n}]/g;
      while ((qm = qNumPattern.exec(questBlock)) !== null) {
        if (!(qm[1] in quest)) {
          quest[qm[1]] = parseFloat(qm[2]);
        }
      }

      if (Object.keys(quest).length > 0) {
        result.sparkQuests.push(quest);
      }
    }
  }

  return result;
}

// ── Advice Generation ──

// Priority order matches WoWDashboard_Priority.lua exactly
const PRIORITY_ORDER = [
  { id: "spark",     field: "sparkDone",     threshold: 1, label: "Liadrin's Spark Quest" },
  { id: "worldboss", field: "worldBossDone", threshold: 1, label: "World Boss" },
  { id: "prey",      field: "preyDone",      threshold: 3, label: "Prey Hunts", },
  { id: "mplus",     field: "vaultDungeons", threshold: 8, label: "M+ Dungeons", slots: [1, 4, 8] },
  { id: "raid",      field: "vaultRaid",     threshold: 6, label: "Raid Bosses", slots: [2, 4, 6] },
  { id: "world",     field: "vaultWorld",    threshold: 8, label: "World Activities", slots: [2, 4, 8] },
  { id: "housing",   field: "housingDone",   threshold: 1, label: "Housing Weekly" },
];

/**
 * Generate contextual advice for each character based on their progress and ilvl.
 */
function generateAdvice(characterData) {
  const advice = {};

  for (const [charKey, data] of Object.entries(characterData)) {
    if ((data.level || 0) < 90) continue;

    const charAdvice = { nextUp: "", tips: {} };
    let nextUpSet = false;
    const ilvl = data.ilvl || 0;

    for (const task of PRIORITY_ORDER) {
      const current = data[task.field] || 0;
      const done = current >= task.threshold;

      // Set "next up" advice for the first incomplete task
      if (!done && !nextUpSet) {
        if (task.id === "spark") {
          charAdvice.nextUp =
            "Spark quest is quick and gives the best reward per time invested.";
        } else if (task.id === "worldboss") {
          charAdvice.nextUp =
            "World boss is a fast group kill for free Champion-tier gear.";
        } else if (task.id === "prey") {
          const remaining = 3 - current;
          charAdvice.nextUp = `${remaining} prey hunt${remaining > 1 ? "s" : ""} left. Coffer Keys are essential for Bountiful Delves.`;
        } else if (task.id === "mplus") {
          const nextSlot = task.slots.find((s) => current < s);
          if (nextSlot) {
            const needed = nextSlot - current;
            charAdvice.nextUp = `${needed} more M+ for next vault slot. Push highest key you can time.`;
          }
        } else if (task.id === "raid") {
          const nextSlot = task.slots.find((s) => current < s);
          if (nextSlot) {
            const needed = nextSlot - current;
            charAdvice.nextUp = `${needed} more raid bosses for next vault slot. Join a Normal or Heroic pug.`;
          }
        } else if (task.id === "world") {
          charAdvice.nextUp =
            "Do Delves (Tier 8+) or zone events for world vault progress.";
        } else if (task.id === "housing") {
          charAdvice.nextUp =
            "Housing weekly is low priority but still gives Hero Dawncrests.";
        }
        nextUpSet = true;
      }

      // ilvl-aware tips for M+ and Raid
      if (task.id === "mplus" && !done) {
        if (ilvl < 240) {
          charAdvice.tips.mplus =
            "At your ilvl, run +2 to +5 keys to build a base set.";
        } else if (ilvl < 255) {
          charAdvice.tips.mplus =
            "Push into +7 to +9 range for Champion vault rewards.";
        } else {
          charAdvice.tips.mplus =
            "Push +10 and above for Hero-track vault rewards (ilvl 272).";
        }
      }
      if (task.id === "raid" && !done) {
        if (ilvl < 246) {
          charAdvice.tips.raid =
            "Start with LFR for tier set pieces, then move to Normal.";
        } else if (ilvl < 259) {
          charAdvice.tips.raid =
            "Normal raid gives Champion gear. Push for Heroic when ready.";
        } else {
          charAdvice.tips.raid =
            "Heroic raid for Hero-track gear. Consider Mythic prog for best ilvl.";
        }
      }
    }

    if (!nextUpSet) {
      charAdvice.nextUp =
        "All weekly gearing tasks done! Great work. Consider pushing higher keys or alts.";
    }

    advice[charKey] = charAdvice;
  }

  return advice;
}

/**
 * Escape a string for safe embedding in a Lua string literal.
 */
function escapeLuaString(str) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Write the advice data as a Lua file that the addon loads on /reload.
 */
function writeAdviceFile(advice) {
  let lua = "-- Auto-generated by WoW Dashboard server. Do not edit.\n";
  lua += "-- Reload UI in-game (/reload) to pick up new advice.\n\n";
  lua += "WoWDashboard_AdviceData = {\n";

  for (const [charKey, data] of Object.entries(advice)) {
    lua += `    ["${charKey}"] = {\n`;
    lua += `        nextUp = "${escapeLuaString(data.nextUp || "")}",\n`;

    if (data.tips && Object.keys(data.tips).length > 0) {
      lua += "        tips = {\n";
      for (const [taskId, tip] of Object.entries(data.tips)) {
        lua += `            ["${taskId}"] = "${escapeLuaString(tip)}",\n`;
      }
      lua += "        },\n";
    }

    lua += "    },\n";
  }

  lua += "}\n";

  try {
    fs.writeFileSync(ADVICE_FILE, lua);
    console.log("Advice file updated:", ADVICE_FILE);
  } catch (err) {
    console.error("Error writing advice file:", err.message);
  }
}

// ── API Routes ──

/**
 * GET /api/characters - Return all character data and regenerate advice.
 */
app.get("/api/characters", (req, res) => {
  const files = findSavedVariablesFiles();
  let allCharacters = {};

  for (const filePath of files) {
    try {
      const lua = fs.readFileSync(filePath, "utf-8");
      const characters = parseLuaTable(lua);
      Object.assign(allCharacters, characters);
    } catch (err) {
      console.error(`Error reading ${filePath}:`, err.message);
    }
  }

  // Generate and write advice file for in-game addon
  try {
    const advice = generateAdvice(allCharacters);
    writeAdviceFile(advice);
  } catch (err) {
    console.error("Error generating advice:", err.message);
  }

  res.json(allCharacters);
});

/**
 * GET /api/debug - Parse and return the _debug block as structured JSON.
 * The debug data contains vault enum values, raw vault slot data,
 * and spark quest information collected by the addon.
 */
app.get("/api/debug", (req, res) => {
  const files = findSavedVariablesFiles();
  for (const filePath of files) {
    try {
      const lua = fs.readFileSync(filePath, "utf-8");
      const debugData = parseDebugBlock(lua);
      if (debugData) {
        res.json({
          source: filePath,
          parsedAt: new Date().toISOString(),
          data: debugData,
        });
        return;
      }
    } catch (err) {
      console.error(`Error reading ${filePath}:`, err.message);
    }
  }
  res.status(404).json({
    error: "No debug data found",
    hint: "/reload in WoW twice (once to collect, once to save to disk).",
  });
});

/**
 * GET /api/advice - Generate and return advice for all characters.
 */
app.get("/api/advice", (req, res) => {
  const files = findSavedVariablesFiles();
  let allCharacters = {};
  for (const filePath of files) {
    try {
      const lua = fs.readFileSync(filePath, "utf-8");
      Object.assign(allCharacters, parseLuaTable(lua));
    } catch (err) {
      console.error(`Error reading ${filePath}:`, err.message);
    }
  }
  const advice = generateAdvice(allCharacters);
  writeAdviceFile(advice);
  res.json(advice);
});

// Get BiS data for a spec
app.get("/api/bis/:spec", (req, res) => {
  const spec = req.params.spec;
  try {
    const bisData = JSON.parse(fs.readFileSync(path.join(__dirname, "bis-data.json"), "utf-8"));
    if (bisData[spec]) {
      res.json(bisData[spec]);
    } else {
      res.status(404).json({ error: "Spec not found", available: Object.keys(bisData) });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to load BiS data" });
  }
});

/**
 * GET /api/tracker/:charKey - Get weekly tracker data for a character.
 * Auto-cleans old weeks (keeps current + last 4).
 */
app.get("/api/tracker/:charKey", (req, res) => {
  const weekKey = getWeekKey();
  const data = loadTracker();
  const charKey = req.params.charKey;

  // Auto-clean old weeks (keep current + last 4 weeks)
  if (data[charKey]) {
    const weeks = Object.keys(data[charKey]).sort();
    while (weeks.length > 5) {
      delete data[charKey][weeks.shift()];
    }
  }

  const charData = data[charKey]?.[weekKey] || {};
  res.json({ weekKey, tracker: charData });
});

/**
 * POST /api/tracker/:charKey - Update a single tracker tick.
 */
app.post("/api/tracker/:charKey", (req, res) => {
  const weekKey = getWeekKey();
  const data = loadTracker();
  const charKey = req.params.charKey;
  const { taskId, value } = req.body;

  if (!taskId) {
    return res.status(400).json({ error: "taskId is required" });
  }

  if (!data[charKey]) data[charKey] = {};
  if (!data[charKey][weekKey]) data[charKey][weekKey] = {};

  data[charKey][weekKey][taskId] = value;
  saveTracker(data);

  res.json({ success: true, weekKey });
});

// ── Server Start ──

app.listen(PORT, () => {
  console.log(`WoW Dashboard running at http://localhost:${PORT}`);
  console.log("Scanning for SavedVariables in:", WOW_BASE);
  console.log("Current week key:", getWeekKey());
});
