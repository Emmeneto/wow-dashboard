// ============================================================================
// WoW Dashboard - Auto-Sync Watcher
// ============================================================================
// Watches your WoW SavedVariables folder for changes and automatically uploads
// character data to the hosted dashboard. Run once and forget — it syncs
// whenever you /reload or log out of WoW.
//
// Usage: node sync.js
// Or double-click sync.bat
// ============================================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HOSTED_URL = "https://wow-dashboard-production-ca94.up.railway.app";
const USERKEY_FILE = path.join(__dirname, ".userkey");
const SAVED_VARS_FILENAME = "WoWDashboard.lua";
const DEBOUNCE_MS = 3000; // Wait 3s after last change before uploading

// ── Auto-detect WoW install (Windows + Mac) ──
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

// ── Get or create user key ──
function getUserKey() {
  if (fs.existsSync(USERKEY_FILE)) {
    return fs.readFileSync(USERKEY_FILE, "utf-8").trim();
  }
  const username = process.env.USERNAME || process.env.USER || "user";
  const hex = crypto.randomBytes(4).toString("hex");
  const key = `${username.toLowerCase()}-${hex}`;
  fs.writeFileSync(USERKEY_FILE, key);
  return key;
}

// ── Parse SavedVariables ──
function parseLuaTable(lua) {
  const characters = {};
  const charPattern = /\["([^"]+)"\]\s*=\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  let match;
  while ((match = charPattern.exec(lua)) !== null) {
    const key = match[1];
    if (!key.includes("-") || key.startsWith("_")) continue;
    const block = match[2];
    const char = {};
    const strP = /\[?"?(\w+)"?\]?\s*=\s*"([^"]*)"/g;
    let sm;
    while ((sm = strP.exec(block)) !== null) char[sm[1]] = sm[2];
    const numP = /\[?"?(\w+)"?\]?\s*=\s*(-?[\d.]+)\s*[,\n}]/g;
    let nm;
    while ((nm = numP.exec(block)) !== null) {
      if (!(nm[1] in char)) char[nm[1]] = parseFloat(nm[2]);
    }
    characters[key] = char;
  }
  return characters;
}

// ── Find all SavedVariables files ──
function findSavedVarsFiles(wowRoot) {
  const files = [];
  const accountDir = path.join(wowRoot, "WTF", "Account");
  try {
    const accounts = fs.readdirSync(accountDir);
    for (const account of accounts) {
      const svPath = path.join(accountDir, account, "SavedVariables", SAVED_VARS_FILENAME);
      if (fs.existsSync(svPath)) files.push(svPath);
    }
  } catch (err) {
    // ignore
  }
  return files;
}

// ── Upload character data ──
async function uploadData(userKey, wowRoot) {
  let allCharacters = {};
  const files = findSavedVarsFiles(wowRoot);

  for (const svPath of files) {
    try {
      const lua = fs.readFileSync(svPath, "utf-8");
      Object.assign(allCharacters, parseLuaTable(lua));
    } catch (err) {
      // File might be mid-write, skip
    }
  }

  const charCount = Object.keys(allCharacters).length;
  if (charCount === 0) return;

  try {
    const res = await fetch(`${HOSTED_URL}/api/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userKey, characters: allCharacters }),
    });
    const data = await res.json();
    if (data.success) {
      const now = new Date().toLocaleTimeString();
      console.log(`[${now}] Synced ${data.characters} character(s)`);
    }
  } catch (err) {
    const now = new Date().toLocaleTimeString();
    console.log(`[${now}] Sync failed: ${err.message}`);
  }
}

// ── Main ──
function main() {
  const wowRoot = findWoWPath();
  if (!wowRoot) {
    console.log("ERROR: Could not find WoW installation.");
    console.log("Set WOW_PATH environment variable to your _retail_ folder.");
    process.exit(1);
  }

  const userKey = getUserKey();
  const dashboardUrl = `${HOSTED_URL}?user=${userKey}`;

  console.log("============================================");
  console.log("  WoW Dashboard - Auto-Sync");
  console.log("============================================");
  console.log(`  User key:  ${userKey}`);
  console.log(`  Dashboard: ${dashboardUrl}`);
  console.log(`  WoW path:  ${wowRoot}`);
  console.log("============================================");
  console.log("");
  console.log("Watching for changes... (keep this running)");
  console.log("Data syncs automatically when you /reload or log out.");
  console.log("");

  // Initial upload
  uploadData(userKey, wowRoot);

  // Watch all SavedVariables directories for changes
  let debounceTimer = null;
  const accountDir = path.join(wowRoot, "WTF", "Account");

  try {
    const accounts = fs.readdirSync(accountDir);
    for (const account of accounts) {
      const svDir = path.join(accountDir, account, "SavedVariables");
      if (!fs.existsSync(svDir)) continue;

      fs.watch(svDir, (eventType, filename) => {
        if (!filename || !filename.includes("WoWDashboard")) return;

        // Debounce: WoW writes the file in chunks, wait for it to finish
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          uploadData(userKey, wowRoot);
        }, DEBOUNCE_MS);
      });

      console.log(`  Watching: ${svDir}`);
    }
  } catch (err) {
    console.log("Error setting up watcher:", err.message);
  }

  // Keep process alive
  process.on("SIGINT", () => {
    console.log("\nSync stopped. Goodbye!");
    process.exit(0);
  });
}

main();
