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
const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Mode Detection ──
// HOSTED mode: runs on a server (Railway/Render), receives data via upload API
// LOCAL mode: runs on user's PC, reads SavedVariables from disk
const MODE = process.env.MODE || "local";
const IS_HOSTED = MODE === "hosted";

// ── Paths ──

function findWoWPath() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const common = [
    // Windows
    "C:/Program Files (x86)/World of Warcraft/_retail_",
    "C:/Program Files/World of Warcraft/_retail_",
    "D:/World of Warcraft/_retail_",
    "D:/Games/World of Warcraft/_retail_",
    "E:/World of Warcraft/_retail_",
    // Mac
    "/Applications/World of Warcraft/_retail_",
    path.join(home, "Applications/World of Warcraft/_retail_"),
    // Custom
    process.env.WOW_PATH || "",
  ];
  for (const p of common) {
    if (p && fs.existsSync(path.join(p, "WTF"))) return p;
  }
  return null;
}

const WOW_ROOT = IS_HOSTED ? null : findWoWPath();
const WOW_BASE = WOW_ROOT ? path.join(WOW_ROOT, "WTF") : null;
const SAVED_VARS_FILENAME = "WoWDashboard.lua";
const TRACKER_FILE = path.join(__dirname, "weekly-tracker.json");
const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_FILE = path.join(DATA_DIR, "uploaded-characters.json");
const CHAT_LOG_FILE = path.join(DATA_DIR, "chat-log.json");
const SUBSCRIBERS_FILE = path.join(DATA_DIR, "subscribers.json");
const ADDON_DIR = WOW_ROOT ? path.join(WOW_ROOT, "Interface/AddOns/WoWDashboard") : null;
const ADVICE_FILE = ADDON_DIR ? path.join(ADDON_DIR, "WoWDashboard_Advice.lua") : null;

// Ensure data directory exists for hosted mode
if (IS_HOSTED && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

app.use(express.json({ limit: "5mb" }));

// CORS for Electron app calling Railway
app.use((req, res, next) => {
  const allowedOrigins = ['http://localhost:3000', 'https://wow-dashboard-production-ca94.up.railway.app'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// ── Uploaded Data Store (hosted mode) ──

function loadUploadedData() {
  try {
    if (fs.existsSync(UPLOADS_FILE)) {
      return JSON.parse(fs.readFileSync(UPLOADS_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("Error loading uploaded data:", err.message);
  }
  return { users: {}, characters: {} };
}

function saveUploadedData(data) {
  try {
    fs.writeFileSync(UPLOADS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving uploaded data:", err.message);
  }
}

// ── Conversation Logging ──

function logConversation(entry) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    let logs = [];
    if (fs.existsSync(CHAT_LOG_FILE)) {
      try { logs = JSON.parse(fs.readFileSync(CHAT_LOG_FILE, "utf-8")); } catch(e) { logs = []; }
    }
    logs.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });
    // Keep last 1000 entries
    if (logs.length > 1000) logs = logs.slice(-1000);
    fs.writeFileSync(CHAT_LOG_FILE, JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error("Log error:", err.message);
  }
}

// ── Subscription Check ──

function isSubscribed(userKey) {
  try {
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
      const subs = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, "utf-8"));
      return subs.includes(userKey);
    }
  } catch (e) {}
  return false;
}

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
  let allCharacters = {};

  if (IS_HOSTED) {
    // Hosted mode: read from uploaded data store
    const uploaded = loadUploadedData();
    // Optional: filter by user key if provided
    const userKey = req.query.user;
    if (userKey && uploaded.users[userKey]) {
      const charKeys = uploaded.users[userKey].characters || [];
      charKeys.forEach(ck => {
        if (uploaded.characters[ck]) allCharacters[ck] = uploaded.characters[ck];
      });
    } else {
      // Return all characters (for browsing)
      allCharacters = uploaded.characters || {};
    }
  } else {
    // Local mode: read from SavedVariables on disk
    const files = findSavedVariablesFiles();
    for (const filePath of files) {
      try {
        const lua = fs.readFileSync(filePath, "utf-8");
        const characters = parseLuaTable(lua);
        Object.assign(allCharacters, characters);
      } catch (err) {
        console.error(`Error reading ${filePath}:`, err.message);
      }
    }

    // Generate and write advice file for in-game addon (local only)
    try {
      const advice = generateAdvice(allCharacters);
      writeAdviceFile(advice);
    } catch (err) {
      console.error("Error generating advice:", err.message);
    }
  }

  res.json(allCharacters);
});

// ── Upload Endpoint (hosted mode) ──

/**
 * POST /api/upload - Upload character data from a companion app.
 * Body: { userKey: "abc123", characters: { "Name-Realm": { ...data } } }
 * Each user gets a unique key they generate locally (no auth needed for beta).
 */
app.post("/api/upload", (req, res) => {
  const { userKey, characters } = req.body;

  if (!userKey || !characters || typeof characters !== "object") {
    return res.status(400).json({ error: "userKey and characters object required" });
  }

  const charKeys = Object.keys(characters);
  if (charKeys.length > 50) {
    return res.status(400).json({ error: "Too many characters (max 50)" });
  }
  const bodySize = JSON.stringify(characters).length;
  if (bodySize > 500000) {
    return res.status(400).json({ error: "Upload too large (max 500KB)" });
  }

  const data = loadUploadedData();

  // Register user if new
  if (!data.users[userKey]) {
    data.users[userKey] = {
      firstSeen: new Date().toISOString(),
      characters: [],
    };
  }
  data.users[userKey].lastUpload = new Date().toISOString();

  // Merge character data
  for (const ck of charKeys) {
    if (!ck.includes("-")) continue; // skip non-character keys
    data.characters[ck] = {
      ...characters[ck],
      _uploadedBy: userKey,
      _uploadedAt: new Date().toISOString(),
    };
    if (!data.users[userKey].characters.includes(ck)) {
      data.users[userKey].characters.push(ck);
    }
  }

  saveUploadedData(data);

  console.log(`Upload from ${userKey}: ${charKeys.length} characters`);
  res.json({
    success: true,
    characters: charKeys.length,
    message: `Uploaded ${charKeys.length} character(s) successfully`,
  });
});

/**
 * GET /api/users - List all users who have uploaded data (hosted mode).
 */
app.get("/api/users", (req, res) => {
  if (!IS_HOSTED) return res.json({ mode: "local", users: [] });
  const data = loadUploadedData();
  const users = Object.entries(data.users).map(([key, info]) => ({
    userKey: key,
    characters: info.characters,
    lastUpload: info.lastUpload,
  }));
  res.json({ users });
});

/**
 * GET /api/mode - Return current server mode.
 */
app.get("/api/mode", (req, res) => {
  res.json({ mode: MODE, hosted: IS_HOSTED });
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
  let allCharacters = {};

  if (IS_HOSTED) {
    const uploaded = loadUploadedData();
    allCharacters = uploaded.characters || {};
  } else {
    const files = findSavedVariablesFiles();
    for (const filePath of files) {
      try {
        const lua = fs.readFileSync(filePath, "utf-8");
        Object.assign(allCharacters, parseLuaTable(lua));
      } catch (err) {
        console.error(`Error reading ${filePath}:`, err.message);
      }
    }
  }

  const advice = generateAdvice(allCharacters);
  if (!IS_HOSTED) writeAdviceFile(advice);
  res.json(advice);
});

// ── Generation Rate Limiting ──
const generationCooldown = {}; // { specKey: lastGeneratedTimestamp }
function canGenerate(specKey) {
  const last = generationCooldown[specKey];
  if (!last) return true;
  return (Date.now() - last) > 60000; // 1 minute cooldown between generations for same spec
}
function markGenerated(specKey) {
  generationCooldown[specKey] = Date.now();
}

// ── Auto-generating BiS Data ──
const BIS_FILE = path.join(__dirname, "bis-data.json");
const bisGenerating = {}; // track in-progress generations to avoid duplicates

function loadBisData() {
  try {
    if (fs.existsSync(BIS_FILE)) return JSON.parse(fs.readFileSync(BIS_FILE, "utf-8"));
  } catch (e) {}
  return {};
}

function saveBisData(data) {
  fs.writeFileSync(BIS_FILE, JSON.stringify(data, null, 2));
}

async function generateBisForSpec(specKey) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (bisGenerating[specKey]) return null; // already generating
  if (!canGenerate(specKey)) return null; // rate limited

  bisGenerating[specKey] = true;
  console.log(`Generating BiS data for ${specKey}...`);

  try {
    const client = new Anthropic({ apiKey });
    const [spec, ...classParts] = specKey.split("-");
    const className = classParts.join(" ");
    const specName = spec.charAt(0).toUpperCase() + spec.slice(1);
    const classNameCap = className.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: `You are a World of Warcraft: Midnight Season 1 gearing expert. Generate the Best-in-Slot gear list for ${specName} ${classNameCap} (PvE, raid/M+ focused).

Return ONLY valid JSON with no markdown, no code blocks, no explanation. The JSON must match this exact structure:

{
  "specName": "${specName} ${classNameCap}",
  "tierSet": {
    "name": "TIER_SET_NAME",
    "bonus2pc": "2pc bonus description",
    "bonus4pc": "4pc bonus description",
    "slots": [1, 5, 10, 7],
    "flexSlot": 3
  },
  "statPriority": "STAT >= STAT >> STAT >= STAT",
  "upgradePriority": "Weapon > Trinkets > Helm/Chest/Legs > ...",
  "embellishments": "EMBELLISHMENT_1 + EMBELLISHMENT_2",
  "craftPriority": "1. ITEM > 2. ITEM > 3. ITEM",
  "slots": {
    "1": {"slotName":"Head","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":282,"source":"BOSS/DUNGEON","sourceType":"raid","isTier":true,"notes":"WHY_BIS","usage":80,"wowheadUrl":""},
    "2": {"slotName":"Neck","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":282,"source":"SOURCE","sourceType":"raid","isTier":false,"notes":"WHY_BIS","usage":50,"wowheadUrl":""},
    "3": {"slotName":"Shoulder","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":272,"source":"SOURCE","sourceType":"mythicplus","isTier":false,"notes":"WHY_BIS","usage":40,"wowheadUrl":""},
    "5": {"slotName":"Chest","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":282,"source":"SOURCE","sourceType":"raid","isTier":true,"notes":"WHY_BIS","usage":90,"wowheadUrl":""},
    "6": {"slotName":"Waist","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":282,"source":"SOURCE","sourceType":"raid","isTier":false,"notes":"WHY_BIS","usage":45,"wowheadUrl":""},
    "7": {"slotName":"Legs","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":282,"source":"SOURCE","sourceType":"raid","isTier":true,"notes":"WHY_BIS","usage":90,"wowheadUrl":""},
    "8": {"slotName":"Feet","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":282,"source":"SOURCE","sourceType":"raid","isTier":false,"notes":"WHY_BIS","usage":45,"wowheadUrl":""},
    "9": {"slotName":"Wrist","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":272,"source":"SOURCE","sourceType":"crafted","isTier":false,"notes":"WHY_BIS","usage":50,"wowheadUrl":""},
    "10": {"slotName":"Hands","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":282,"source":"SOURCE","sourceType":"raid","isTier":true,"notes":"WHY_BIS","usage":90,"wowheadUrl":""},
    "11": {"slotName":"Ring 1","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":272,"source":"SOURCE","sourceType":"mythicplus","isTier":false,"notes":"WHY_BIS","usage":50,"wowheadUrl":""},
    "12": {"slotName":"Ring 2","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":272,"source":"SOURCE","sourceType":"dungeon","isTier":false,"notes":"WHY_BIS","usage":35,"wowheadUrl":""},
    "13": {"slotName":"Trinket 1","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":282,"source":"SOURCE","sourceType":"raid","isTier":false,"notes":"WHY_BIS","usage":60,"wowheadUrl":""},
    "14": {"slotName":"Trinket 2","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":282,"source":"SOURCE","sourceType":"raid","isTier":false,"notes":"WHY_BIS","usage":55,"wowheadUrl":""},
    "15": {"slotName":"Back","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":272,"source":"SOURCE","sourceType":"crafted","isTier":false,"notes":"WHY_BIS","usage":30,"wowheadUrl":""},
    "16": {"slotName":"Main Hand","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":272,"source":"SOURCE","sourceType":"crafted","isTier":false,"notes":"WHY_BIS","usage":90,"wowheadUrl":""},
    "17": {"slotName":"Off Hand","bisName":"ITEM_NAME","bisItemID":0,"bisIlvl":0,"source":"N/A if using 2H","sourceType":"none","isTier":false,"notes":"NOTES","usage":0,"wowheadUrl":""}
  }
}

Context: Midnight Season 1 raids are The Voidspire (6 bosses), Dreamrift (1 boss: Chimaerus), March on Quel'Danas (2 bosses). M+ pool includes Windrunner Spire, Murder Row, Den of Nalorakk, Maisara Caverns, Seat of the Triumvirate, Skyreach, Magister's Terrace, Pit of Saron. Max ilvl is 282 (Myth 6/6 raid) or 272 (M+ vault / crafted). Tier tokens are from Voidspire + Dreamrift + Quel'Danas.

sourceType must be one of: "raid", "mythicplus", "crafted", "dungeon", "none".
Set bisItemID to 0 (we don't have IDs).
Fill in real item names, sources, and reasoning for ${specName} ${classNameCap}.
Return ONLY the JSON object, nothing else.`
      }],
    });

    const text = response.content[0]?.text || "";
    // Parse JSON from response (handle potential markdown wrapping)
    const jsonStr = text.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
    const bisResult = JSON.parse(jsonStr);

    // Save to bis-data.json
    const allBis = loadBisData();
    allBis[specKey] = {
      ...bisResult,
      _generatedAt: new Date().toISOString(),
      _generatedBy: "claude-auto",
    };
    saveBisData(allBis);

    console.log(`BiS data generated and saved for ${specKey}`);
    markGenerated(specKey);
    logConversation({
      type: "bis-generation",
      spec: specKey,
      slotsGenerated: Object.keys(bisResult.slots || {}).length,
    });

    return bisResult;
  } catch (err) {
    console.error(`Failed to generate BiS for ${specKey}:`, err.message);
    return null;
  } finally {
    delete bisGenerating[specKey];
  }
}

// Get BiS data for a spec — auto-generates if missing
app.get("/api/bis/:spec", async (req, res) => {
  const spec = req.params.spec;
  const allBis = loadBisData();

  // Check if we have cached data that's less than 7 days old
  if (allBis[spec]) {
    const generatedAt = allBis[spec]._generatedAt;
    if (generatedAt) {
      const ageMs = Date.now() - new Date(generatedAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < 7) {
        return res.json(allBis[spec]);
      }
      // Stale — regenerate in background, serve cached for now
      generateBisForSpec(spec);
      return res.json(allBis[spec]);
    }
    return res.json(allBis[spec]);
  }

  // No cached data — try to generate
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(404).json({ error: "Spec not found and no API key to generate", available: Object.keys(allBis) });
  }

  // Generate on the fly
  const result = await generateBisForSpec(spec);
  if (result) {
    res.json(result);
  } else {
    res.status(503).json({ error: "BiS data is being generated. Refresh in a few seconds.", generating: true });
  }
});

// ── Auto-generating Consumables Data ──
const CONSUMABLES_FILE = path.join(__dirname, "consumables-data.json");
const consumablesGenerating = {};

function loadConsumablesData() {
  try {
    if (fs.existsSync(CONSUMABLES_FILE)) return JSON.parse(fs.readFileSync(CONSUMABLES_FILE, "utf-8"));
  } catch(e) {}
  return {};
}

function saveConsumablesData(data) {
  fs.writeFileSync(CONSUMABLES_FILE, JSON.stringify(data, null, 2));
}

async function generateConsumablesForSpec(specKey) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (consumablesGenerating[specKey]) return null;
  if (!canGenerate(specKey)) return null; // rate limited
  consumablesGenerating[specKey] = true;
  console.log(`Generating consumables for ${specKey}...`);

  try {
    const client = new Anthropic({ apiKey });
    const [spec, ...classParts] = specKey.split("-");
    const className = classParts.join(" ");
    const specName = spec.charAt(0).toUpperCase() + spec.slice(1);
    const classNameCap = className.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: `You are a WoW Midnight Season 1 expert. Generate the optimal consumables, enchants, and gems for ${specName} ${classNameCap} (PvE).

Return ONLY valid JSON, no markdown, no code blocks:

{
  "specName": "${specName} ${classNameCap}",
  "enchants": {
    "weapon": {"name": "ENCHANT_NAME", "stat": "WHAT_IT_GIVES"},
    "head": {"name": "ENCHANT_NAME", "stat": "WHAT_IT_GIVES"},
    "chest": {"name": "ENCHANT_NAME", "stat": "WHAT_IT_GIVES"},
    "legs": {"name": "ENCHANT_NAME", "stat": "WHAT_IT_GIVES"},
    "boots": {"name": "ENCHANT_NAME", "stat": "WHAT_IT_GIVES"},
    "wrist": {"name": "ENCHANT_NAME", "stat": "WHAT_IT_GIVES"},
    "ring1": {"name": "ENCHANT_NAME", "stat": "WHAT_IT_GIVES"},
    "ring2": {"name": "ENCHANT_NAME", "stat": "WHAT_IT_GIVES"},
    "cloak": {"name": "ENCHANT_NAME", "stat": "WHAT_IT_GIVES"}
  },
  "gems": {
    "primary": {"name": "GEM_NAME", "stat": "WHAT_IT_GIVES"},
    "secondary": [
      {"name": "GEM_NAME", "stat": "WHAT_IT_GIVES"}
    ],
    "note": "Mix requirement note"
  },
  "consumables": {
    "flask": {"name": "FLASK_NAME", "stat": "WHAT_IT_GIVES", "duration": "DURATION"},
    "potion": {"name": "POTION_NAME", "stat": "WHAT_IT_GIVES", "usage": "WHEN_TO_USE"},
    "healthPotion": {"name": "POTION_NAME"},
    "food": {"name": "FOOD_NAME", "stat": "WHAT_IT_GIVES"},
    "augmentRune": {"name": "RUNE_NAME", "stat": "WHAT_IT_GIVES"},
    "weaponBuff": {"name": "OIL_OR_STONE_NAME", "stat": "WHAT_IT_GIVES"},
    "tea": {"name": "TEA_NAME", "stat": "WHAT_IT_GIVES", "note": "Stacks with food"}
  }
}

Context: WoW Midnight Season 1 (patch 12.0, April 2026). Thalassian-themed consumables, Eversong gems. Return ONLY the JSON.`
      }],
    });

    const text = response.content[0]?.text || "";
    const jsonStr = text.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
    const result = JSON.parse(jsonStr);

    const allData = loadConsumablesData();
    allData[specKey] = { ...result, _generatedAt: new Date().toISOString() };
    saveConsumablesData(allData);
    markGenerated(specKey);
    console.log(`Consumables generated for ${specKey}`);
    return result;
  } catch (err) {
    console.error(`Failed to generate consumables for ${specKey}:`, err.message);
    return null;
  } finally {
    delete consumablesGenerating[specKey];
  }
}

app.get("/api/consumables/:spec", async (req, res) => {
  const spec = req.params.spec;
  const allData = loadConsumablesData();

  if (allData[spec]) {
    const generatedAt = allData[spec]._generatedAt;
    if (generatedAt) {
      const ageDays = (Date.now() - new Date(generatedAt).getTime()) / (1000*60*60*24);
      if (ageDays < 7) return res.json(allData[spec]);
      generateConsumablesForSpec(spec);
      return res.json(allData[spec]);
    }
    return res.json(allData[spec]);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(404).json({ error: "No consumables data and no API key" });

  const result = await generateConsumablesForSpec(spec);
  if (result) res.json(result);
  else res.status(503).json({ error: "Generating consumables. Refresh in a few seconds.", generating: true });
});

// ── AI Rate Limiting ──
const aiUsage = {}; // { userKey: { date: 'YYYY-MM-DD', count: 0 } }

function checkAIRateLimit(userKey, isLocal) {
  if (isLocal) return true; // localhost = unlimited
  const today = new Date().toISOString().slice(0, 10);
  if (!aiUsage[userKey]) aiUsage[userKey] = { date: today, count: 0 };
  if (aiUsage[userKey].date !== today) { aiUsage[userKey] = { date: today, count: 0 }; }
  if (aiUsage[userKey].count >= 2) return false;
  aiUsage[userKey].count++;
  return true;
}

/**
 * POST /api/smart-advice - Generate AI-powered recommendations using Claude API.
 * Takes character data + BiS data and returns personalized gearing advice.
 * Requires ANTHROPIC_API_KEY environment variable.
 */
app.post("/api/smart-advice", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.json({ advice: null, error: "No API key configured. Set ANTHROPIC_API_KEY." });
  }

  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  const userKey = req.body.userKey || 'anonymous';
  if (!checkAIRateLimit(userKey, isLocal)) {
    return res.json({ advice: null, error: 'Daily AI limit reached (2/day). Try again tomorrow!', rateLimited: true });
  }

  const { character, bisData, weeklyProgress } = req.body;
  if (!character) {
    return res.status(400).json({ error: "character data required" });
  }

  try {
    const client = new Anthropic({ apiKey });

    // Build a concise character summary for Claude
    const gearSummary = [];
    for (let slot = 1; slot <= 17; slot++) {
      const name = character[`gear_${slot}_name`];
      const ilvl = character[`gear_${slot}_ilvl`];
      if (name && ilvl) gearSummary.push(`Slot ${slot}: ${name} (${ilvl})`);
    }

    const prompt = `You are a World of Warcraft: Midnight Season 1 gearing advisor. Analyze this character and give 3-4 specific, actionable recommendations for what they should do RIGHT NOW to improve their gear most efficiently. Be concise (2-3 sentences each).

CHARACTER:
- Name: ${character.name}, ${character.spec} ${character.class}
- Item Level: ${character.ilvl}
- Level: ${character.level}
- Realm: ${character.realm}

WEEKLY PROGRESS:
- Vault Dungeons: ${character.vaultDungeons || 0}/8
- Vault Raid: ${character.vaultRaid || 0}/6
- Vault World: ${character.vaultWorld || 0}/8
- Spark Quest: ${character.sparkDone ? 'Done' : 'Not done'}
- World Boss: ${character.worldBossDone ? 'Done' : 'Not done'}
- Prey Hunts: ${character.preyDone || 0}/3

EQUIPPED GEAR:
${gearSummary.join('\n') || 'No gear data available'}

${bisData ? `BIS DATA AVAILABLE: ${bisData.specName}\nTier Set: ${bisData.tierSet?.name || 'Unknown'}` : 'No BiS data for this spec yet.'}

Give specific advice like "Run Voidspire boss 3 for your BiS legs" not generic tips like "do more M+". Prioritize by impact. Format each recommendation with a bold title and explanation.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const adviceText = response.content[0]?.text || "";

    logConversation({
      type: 'smart-advice',
      userKey,
      character: character.name + '-' + character.realm,
      ilvl: character.ilvl,
      spec: (character.spec || '') + ' ' + (character.class || ''),
      response: adviceText.substring(0, 500),
    });

    res.json({ advice: adviceText });
  } catch (err) {
    console.error("Claude API error:", err.message);
    res.json({ advice: null, error: "Failed to generate recommendations. Try again." });
  }
});

/**
 * POST /api/chat - AI chatbot endpoint for conversational gearing advice.
 * Maintains conversation context via chatHistory in the request body.
 * Requires ANTHROPIC_API_KEY environment variable.
 */
app.post("/api/chat", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.json({ reply: null, error: "No API key" });

  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  const userKey = req.body.userKey || 'anonymous';

  // Subscription check: localhost bypasses
  if (!isLocal && !isSubscribed(userKey)) {
    return res.json({ reply: null, error: "Subscribe to unlock AI chat", requiresSubscription: true });
  }

  if (!checkAIRateLimit(userKey, isLocal)) {
    return res.json({ reply: null, error: 'Daily AI limit reached (2/day). Try again tomorrow!', rateLimited: true });
  }

  const { message, character, bisData, chatHistory } = req.body;
  if (!message || !character) return res.status(400).json({ error: "message and character required" });

  try {
    const client = new Anthropic({ apiKey });

    const gearSummary = [];
    for (let slot = 1; slot <= 17; slot++) {
      const name = character[`gear_${slot}_name`];
      const ilvl = character[`gear_${slot}_ilvl`];
      if (name && ilvl) gearSummary.push(`Slot ${slot}: ${name} (${ilvl})`);
    }

    const systemPrompt = `You are a friendly, expert World of Warcraft: Midnight Season 1 gearing coach. You know everything about the current meta, BiS gear, M+ dungeons, raids, delves, prey hunts, and the fastest ways to gear up.

CHARACTER:
- ${character.name}, ${character.spec} ${character.class}, Level ${character.level}
- Item Level: ${character.ilvl}, Realm: ${character.realm}
- Vault: Dungeons ${character.vaultDungeons || 0}/8, Raid ${character.vaultRaid || 0}/6, World ${character.vaultWorld || 0}/8
- Spark Quest: ${character.sparkDone ? 'Done' : 'Not done'}, World Boss: ${character.worldBossDone ? 'Done' : 'Not done'}
- Prey Hunts: ${character.preyDone || 0}/3

GEAR: ${gearSummary.join(', ') || 'No data'}
${bisData ? `SPEC: ${bisData.specName}, Tier: ${bisData.tierSet?.name || '?'}` : ''}

Be concise (2-3 sentences per response). Ask follow-up questions about their available time and preferences. Give SPECIFIC recommendations (name bosses, dungeons, activities). Be encouraging and fun.`;

    // Build messages from history
    const messages = [];
    if (chatHistory && Array.isArray(chatHistory)) {
      chatHistory.forEach(msg => {
        messages.push({ role: msg.role, content: msg.content });
      });
    }
    messages.push({ role: "user", content: message });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: systemPrompt,
      messages: messages,
    });

    const reply = response.content[0]?.text || "";

    logConversation({
      type: 'chat',
      userKey,
      character: character.name + '-' + character.realm,
      message: message.substring(0, 200),
      reply: reply.substring(0, 500),
    });

    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.json({ reply: null, error: "Failed to get response. Try again." });
  }
});

// ── Subscription Endpoints ──

/**
 * POST /api/subscribe - Subscribe a user (no payment for now, just a flag).
 */
app.post("/api/subscribe", (req, res) => {
  const { userKey } = req.body;
  if (!userKey) return res.status(400).json({ error: "userKey required" });

  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    let subs = [];
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
      try { subs = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, "utf-8")); } catch (e) { subs = []; }
    }
    if (!subs.includes(userKey)) subs.push(userKey);
    fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subs, null, 2));
    res.json({ subscribed: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

/**
 * GET /api/subscription/:userKey - Check subscription status.
 */
app.get("/api/subscription/:userKey", (req, res) => {
  res.json({ subscribed: isSubscribed(req.params.userKey) });
});

/**
 * GET /api/logs - View conversation logs (localhost only).
 */
app.get("/api/logs", (req, res) => {
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  if (!isLocal) return res.status(403).json({ error: "Logs only accessible from localhost" });
  try {
    if (fs.existsSync(CHAT_LOG_FILE)) {
      res.json(JSON.parse(fs.readFileSync(CHAT_LOG_FILE, "utf-8")));
    } else {
      res.json([]);
    }
  } catch (err) { res.json([]); }
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

// ── Self-service Data Deletion ──

app.delete("/api/user/:userKey", (req, res) => {
  const userKey = req.params.userKey;

  // Remove from uploaded characters
  const uploaded = loadUploadedData();
  if (uploaded.users[userKey]) {
    const charKeys = uploaded.users[userKey].characters || [];
    charKeys.forEach(ck => delete uploaded.characters[ck]);
    delete uploaded.users[userKey];
    saveUploadedData(uploaded);
  }

  // Remove from subscribers
  try {
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
      let subs = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, "utf-8"));
      subs = subs.filter(s => s !== userKey);
      fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subs, null, 2));
    }
  } catch(e) {}

  // Remove chat logs for this user
  try {
    if (fs.existsSync(CHAT_LOG_FILE)) {
      let logs = JSON.parse(fs.readFileSync(CHAT_LOG_FILE, "utf-8"));
      logs = logs.filter(l => l.userKey !== userKey);
      fs.writeFileSync(CHAT_LOG_FILE, JSON.stringify(logs, null, 2));
    }
  } catch(e) {}

  res.json({ deleted: true, userKey });
});

// ── Server Start ──

app.listen(PORT, () => {
  console.log(`WoW Dashboard running at http://localhost:${PORT}`);
  console.log(`Mode: ${MODE.toUpperCase()}`);
  if (IS_HOSTED) {
    console.log("Hosted mode: accepting uploads via POST /api/upload");
    console.log("Data stored at:", UPLOADS_FILE);
  } else {
    console.log("Local mode: reading SavedVariables from:", WOW_BASE);
  }
  console.log("Current week key:", getWeekKey());
});
