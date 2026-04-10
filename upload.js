// ============================================================================
// WoW Dashboard - Upload Script
// ============================================================================
// Reads local SavedVariables and uploads character data to the hosted dashboard.
// Generates a unique user key on first run and saves it to .userkey file.
// Run this manually or via start.bat to sync your data.
// ============================================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HOSTED_URL = "https://wow-dashboard-production-ca94.up.railway.app";
const USERKEY_FILE = path.join(__dirname, ".userkey");
const SAVED_VARS_FILENAME = "WoWDashboard.lua";

// ── Auto-detect WoW install ──
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
  return null;
}

// ── Get or create user key ──
function getUserKey() {
  if (fs.existsSync(USERKEY_FILE)) {
    return fs.readFileSync(USERKEY_FILE, "utf-8").trim();
  }
  // Generate a friendly key: username-randomhex
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
    const strPattern = /\[?"?(\w+)"?\]?\s*=\s*"([^"]*)"/g;
    let sm;
    while ((sm = strPattern.exec(block)) !== null) char[sm[1]] = sm[2];
    const numPattern = /\[?"?(\w+)"?\]?\s*=\s*(-?[\d.]+)\s*[,\n}]/g;
    let nm;
    while ((nm = numPattern.exec(block)) !== null) {
      if (!(nm[1] in char)) char[nm[1]] = parseFloat(nm[2]);
    }
    characters[key] = char;
  }
  return characters;
}

// ── Main ──
async function main() {
  const wowRoot = findWoWPath();
  if (!wowRoot) {
    console.log("Could not find WoW installation. Set WOW_PATH environment variable.");
    return;
  }

  const userKey = getUserKey();
  console.log(`User key: ${userKey}`);
  console.log(`Your dashboard: ${HOSTED_URL}?user=${userKey}`);

  // Find SavedVariables
  const accountDir = path.join(wowRoot, "WTF", "Account");
  let allCharacters = {};

  try {
    const accounts = fs.readdirSync(accountDir);
    for (const account of accounts) {
      const svPath = path.join(accountDir, account, "SavedVariables", SAVED_VARS_FILENAME);
      if (fs.existsSync(svPath)) {
        const lua = fs.readFileSync(svPath, "utf-8");
        Object.assign(allCharacters, parseLuaTable(lua));
      }
    }
  } catch (err) {
    console.log("Error reading SavedVariables:", err.message);
    return;
  }

  const charCount = Object.keys(allCharacters).length;
  if (charCount === 0) {
    console.log("No character data found. Make sure you've /reload'd in WoW at least once.");
    return;
  }

  console.log(`Found ${charCount} character(s). Uploading...`);

  try {
    const res = await fetch(`${HOSTED_URL}/api/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userKey, characters: allCharacters }),
    });
    const data = await res.json();
    if (data.success) {
      console.log(`Uploaded ${data.characters} character(s) successfully!`);
      console.log(`\nView your dashboard at:`);
      console.log(`  ${HOSTED_URL}?user=${userKey}`);
    } else {
      console.log("Upload failed:", data.error || "Unknown error");
    }
  } catch (err) {
    console.log("Upload error:", err.message);
    console.log("The hosted dashboard might be down. Your local dashboard still works at http://localhost:3000");
  }
}

main();
