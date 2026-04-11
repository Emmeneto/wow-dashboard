const CLASS_COLORS = {
  'WARRIOR':'#C69B6D','PALADIN':'#F48CBA','HUNTER':'#AAD372','ROGUE':'#FFF468',
  'PRIEST':'#FFFFFF','DEATHKNIGHT':'#C41E3A','DEATH KNIGHT':'#C41E3A',
  'SHAMAN':'#0070DD','MAGE':'#3FC7EB','WARLOCK':'#8788EE','MONK':'#00FF98',
  'DRUID':'#FF7C0A','DEMONHUNTER':'#A330C9','DEMON HUNTER':'#A330C9','EVOKER':'#33937F',
};
const CLASS_CSS = {
  'Warrior':'class-warrior','Paladin':'class-paladin','Hunter':'class-hunter',
  'Rogue':'class-rogue','Priest':'class-priest','Death Knight':'class-deathknight',
  'Shaman':'class-shaman','Mage':'class-mage','Warlock':'class-warlock',
  'Monk':'class-monk','Druid':'class-druid','Demon Hunter':'class-demonhunter',
  'Evoker':'class-evoker',
};
// Class icon slugs for Wowhead CDN
const CLASS_ICON_SLUG = {
  'WARRIOR':'warrior','PALADIN':'paladin','HUNTER':'hunter','ROGUE':'rogue',
  'PRIEST':'priest','DEATHKNIGHT':'deathknight','DEATH KNIGHT':'deathknight',
  'SHAMAN':'shaman','MAGE':'mage','WARLOCK':'warlock','MONK':'monk',
  'DRUID':'druid','DEMONHUNTER':'demonhunter','DEMON HUNTER':'demonhunter','EVOKER':'evoker',
};

function sanitizeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const EU_REALMS = ['Draenor','Frostmane','Outland','Tarren Mill'];
const VAULT = {
  dungeons: { max: 8, slots: [1, 4, 8], timePerActivity: 45, unit: 'min' },
  raid:     { max: 6, slots: [2, 4, 6], timePerActivity: 25, unit: 'min' },
  world:    { max: 8, slots: [2, 4, 8], timePerActivity: 12, unit: 'min' },
};
// Time estimates (minutes): M+ ~45 (inc queue), Raid boss ~25 (inc trash),
// Delve/World ~12, Prey ~15, Spark ~15, World Boss ~5, Housing ~10
const WEEKLY_TASKS = [
  { id:'spark',    name:"Liadrin's Spark Quest",  detail:'Apex Cache + Spark of Radiance', time: 15 },
  { id:'worldboss',name:'World Boss',             detail:'Champion 4/6 (ilvl 256) Warbound', time: 5 },
  { id:'prey1',    name:'Nightmare Prey Hunt #1', detail:'Champion crests + Hero vault', time: 15 },
  { id:'prey2',    name:'Nightmare Prey Hunt #2', detail:'Champion crests + Hero vault', time: 15 },
  { id:'prey3',    name:'Nightmare Prey Hunt #3', detail:'Champion crests + Hero vault', time: 15 },
  { id:'housing',  name:'Housing Weekly',         detail:'Upgrade crests from Vaeli', time: 10 },
];

let characters = {};
let selectedKey = '';
let trackerData = {};
let manualOverrides = {};

function mergeAddonData() {
  const c = characters[selectedKey];
  if (!c || c.level < 90) return;
  autoFillTicks('dungeon', 8, c.vaultDungeons || 0);
  autoFillTicks('raid', 6, c.vaultRaid || 0);
  autoFillTicks('world', 8, c.vaultWorld || 0);
  if ((c.sparkDone || c.sparkAccepted) && !manualOverrides['spark']) trackerData['spark'] = true;
  if (c.worldBossDone && !manualOverrides['worldboss']) trackerData['worldboss'] = true;
  if (c.housingDone && !manualOverrides['housing']) trackerData['housing'] = true;
  const preyCount = c.preyDone || 0;
  if (preyCount >= 1 && !manualOverrides['prey1']) trackerData['prey1'] = true;
  if (preyCount >= 2 && !manualOverrides['prey2']) trackerData['prey2'] = true;
  if (preyCount >= 3 && !manualOverrides['prey3']) trackerData['prey3'] = true;
}

function autoFillTicks(prefix, max, count) {
  for (let i = 1; i <= max; i++) {
    const key = `${prefix}_${i}`;
    if (i <= count && !manualOverrides[key]) trackerData[key] = true;
  }
}

function getNextReset(realm) {
  const now = new Date();
  const isEU = EU_REALMS.some(r => realm && realm.includes(r));
  const resetDay = isEU ? 3 : 2, resetHourUTC = isEU ? 7 : 15;
  const next = new Date(now);
  next.setUTCHours(resetHourUTC, 0, 0, 0);
  let daysUntil = resetDay - next.getUTCDay();
  if (daysUntil < 0 || (daysUntil === 0 && now >= next)) daysUntil += 7;
  next.setUTCDate(next.getUTCDate() + daysUntil);
  const diff = next - now;
  return `${Math.floor(diff/86400000)}d ${Math.floor((diff%86400000)/3600000)}h ${Math.floor((diff%3600000)/60000)}m`;
}

function updateResetBanner() {
  const c = characters[selectedKey];
  const realm = c ? c.realm : '';
  const isEU = EU_REALMS.some(r => realm && realm.includes(r));
  const region = isEU ? 'EU' : 'NA';
  const resetDay = isEU ? 'Wednesday 07:00 UTC' : 'Tuesday 15:00 UTC';
  document.getElementById('resetBanner').innerHTML =
    `Weekly Reset in <strong>${getNextReset(realm)}</strong> <span style="font-size:10px;color:#4a4038;">&middot; ${region} &middot; ${resetDay}</span>`;
}

function formatPlayedTime(s) {
  if (!s || s <= 0) return 'Unknown';
  const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function getWeeklyProgress(c) {
  if (!c || c.level < 90) return { done: 0, total: 28, pct: 0 };
  const dungeons = c.vaultDungeons || 0;
  const raid = c.vaultRaid || 0;
  const world = c.vaultWorld || 0;
  let weekly = 0;
  if (c.sparkDone || c.sparkAccepted) weekly++;
  if (c.worldBossDone) weekly++;
  if (c.housingDone) weekly++;
  weekly += Math.min(c.preyDone || 0, 3);
  const done = Math.min(dungeons,8) + Math.min(raid,6) + Math.min(world,8) + weekly;
  const total = 28;
  return { done, total, pct: Math.round((done/total)*100) };
}

// ── User Key (from URL param or local storage) ──
const urlParams = new URLSearchParams(window.location.search);
const userKey = urlParams.get('user') || localStorage.getItem('wowdash_userKey') || '';
if (userKey) localStorage.setItem('wowdash_userKey', userKey);

// ── Data Fetching ──
async function fetchCharacters() {
  try {
    const url = userKey ? `/api/characters?user=${encodeURIComponent(userKey)}` : '/api/characters';
    const res = await fetch(url);
    characters = await res.json();
    renderTiles();
    updateResetBanner();
    if (selectedKey && characters[selectedKey] && characters[selectedKey].level >= 90) {
      await fetchTracker();
      fetchAdvice();
      fetchBiS();
    } else {
      document.getElementById('tracker').innerHTML = '';
      document.getElementById('advice').innerHTML = '';
      document.getElementById('bis').innerHTML = '';
      document.getElementById('crests').innerHTML = '';
      document.getElementById('extra').innerHTML = '';
      document.getElementById('consumables').innerHTML = '';
    }
  } catch (err) { console.error('Failed to fetch:', err); }
}

async function fetchTracker() {
  try {
    const res = await fetch(`/api/tracker/${encodeURIComponent(selectedKey)}`);
    const data = await res.json();
    trackerData = data.tracker || {};
    manualOverrides = data.tracker?._manualOverrides || {};
    mergeAddonData();
    renderTracker(data.weekKey);
  } catch (err) { console.error('Failed to fetch tracker:', err); }
}

async function toggleTick(taskId, value) {
  trackerData[taskId] = value;
  manualOverrides[taskId] = true;
  try {
    await fetch(`/api/tracker/${encodeURIComponent(selectedKey)}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ taskId, value }),
    });
    await fetch(`/api/tracker/${encodeURIComponent(selectedKey)}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ taskId:'_manualOverrides', value: manualOverrides }),
    });
  } catch (err) { console.error('Failed to save:', err); }
}

// ── Character Tiles ──
function renderTiles() {
  const el = document.getElementById('charArea');
  const landing = document.getElementById('landing');
  const keys = Object.keys(characters).filter(k => characters[k].name);

  if (keys.length === 0) {
    el.innerHTML = '';
    landing.innerHTML = `
      <div class="card" style="padding:30px;text-align:center;margin-bottom:20px;">
        <h2 style="font-family:'Cinzel',serif;color:#ffd700;font-size:20px;margin-bottom:12px;">Welcome to WoW Dashboard</h2>
        <p style="color:#8a7e6a;margin-bottom:20px;line-height:1.6;">No character data found yet. Follow these steps to get started:</p>
        <div style="text-align:left;max-width:500px;margin:0 auto;font-size:13px;color:#c8c0b0;line-height:2;">
          <p><span style="color:#ffd700;font-weight:700;">1.</span> Download the addon from <a href="https://github.com/Emmeneto/wow-dashboard" target="_blank" style="color:#3fc7eb;">GitHub</a></p>
          <p><span style="color:#ffd700;font-weight:700;">2.</span> Copy the <code style="background:#1a1528;padding:2px 6px;border-radius:3px;">addon/WoWDashboard/</code> folder into your <code style="background:#1a1528;padding:2px 6px;border-radius:3px;">Interface/AddOns/</code></p>
          <p><span style="color:#ffd700;font-weight:700;">3.</span> Log into WoW and type <code style="background:#1a1528;padding:2px 6px;border-radius:3px;">/reload</code></p>
          <p><span style="color:#ffd700;font-weight:700;">4.</span> Run <code style="background:#1a1528;padding:2px 6px;border-radius:3px;">start.bat</code> from the companion folder</p>
          <p><span style="color:#ffd700;font-weight:700;">5.</span> Your characters will appear here automatically!</p>
        </div>
        ${userKey ? `<p style="margin-top:16px;font-size:11px;color:#4a4038;">Your user key: <code style="background:#1a1528;padding:2px 6px;border-radius:3px;color:#ffd700;">${userKey}</code></p>` : `
          <div style="margin-top:20px;padding-top:16px;border-top:1px solid #2a2235;">
            <p style="color:#5a5545;font-size:11px;margin-bottom:8px;">Already uploaded? Enter your user key:</p>
            <div style="display:flex;gap:8px;justify-content:center;">
              <input id="userKeyInput" type="text" placeholder="your-user-key" style="background:#1a1528;border:1px solid #2a2235;border-radius:6px;padding:8px 12px;color:#c8c0b0;font-size:13px;width:200px;outline:none;">
              <button onclick="const k=document.getElementById('userKeyInput').value.trim();if(k){window.location.href='?user='+encodeURIComponent(k);}" style="background:#ffd700;color:#1a0e00;border:none;border-radius:6px;padding:8px 16px;font-weight:600;font-size:13px;cursor:pointer;">Load</button>
            </div>
          </div>
        `}
      </div>`;
    return;
  }

  landing.innerHTML = '';
  if (!selectedKey || !keys.includes(selectedKey)) selectedKey = keys[0];

  const selChar = characters[selectedKey];
  const selColor = CLASS_COLORS[selChar.class?.toUpperCase()] || '#888';
  const selIcon = CLASS_ICON_SLUG[selChar.class?.toUpperCase()] || 'warrior';
  const selIconUrl = `https://wow.zamimg.com/images/wow/icons/large/classicon_${selIcon}.jpg`;
  const selClassName = selChar.class ? selChar.class.charAt(0) + selChar.class.slice(1).toLowerCase() : '';
  const prog = getWeeklyProgress(selChar);

  // Merged character detail data
  const gold = selChar.gold||0;
  const totalBags = selChar.totalBagSlots||1, freeBags = selChar.freeBagSlots||0;
  const bagPct = Math.round(((totalBags-freeBags)/totalBags)*100);
  const bagColor = bagPct > 90 ? '#e74c3c' : bagPct > 70 ? '#f39c12' : '#2ecc71';
  const prof1 = selChar.prof1Name ? `${selChar.prof1Name} (${selChar.prof1Rank}/${selChar.prof1Max})` : 'None';
  const prof2 = selChar.prof2Name ? `${selChar.prof2Name} (${selChar.prof2Rank}/${selChar.prof2Max})` : 'None';
  const location = selChar.subZone && selChar.subZone !== selChar.zone ? `${selChar.subZone}, ${selChar.zone}` : (selChar.zone || 'Unknown');

  const otherKeys = keys.filter(k => k !== selectedKey);

  const sidebarHtml = otherKeys.map(key => {
    const ch = characters[key];
    const color = CLASS_COLORS[ch.class?.toUpperCase()] || '#888';
    const icon = CLASS_ICON_SLUG[ch.class?.toUpperCase()] || 'warrior';
    const iconUrl = `https://wow.zamimg.com/images/wow/icons/large/classicon_${icon}.jpg`;
    const cn = ch.class ? ch.class.charAt(0) + ch.class.slice(1).toLowerCase() : '';
    return `
      <div class="char-side-tile" data-key="${key}" style="border-left:3px solid ${color};">
        <div class="char-side-portrait"><img src="${iconUrl}" onerror="this.style.display='none'"></div>
        <div>
          <div class="char-side-name" style="color:${color}">${ch.name}</div>
          <div class="char-side-info">${ch.spec || ''} ${cn} · ${ch.level}</div>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="char-area">
      <div class="char-main-card" style="--class-color:${selColor}">
        <div class="char-main-top">
          <div class="char-main-portrait" style="border-color:${selColor}">
            <img src="${selIconUrl}" onerror="this.style.display='none'">
          </div>
          <div>
            <div class="char-main-name" style="color:${selColor}">${selChar.name}</div>
            <div class="char-main-info">${selChar.spec || ''} ${selClassName} · ${selChar.realm}</div>
            <div class="char-main-info">${selChar.guildName ? '&lt;' + selChar.guildName + '&gt; ' + (selChar.guildRank||'') : 'No Guild'}</div>
          </div>
        </div>
        <div class="char-main-stats">
          <div><div class="char-main-stat-label">Level</div><div class="char-main-stat-value">${selChar.level}</div></div>
          <div><div class="char-main-stat-label">Item Level</div><div class="char-main-stat-value" style="color:#a335ee">${selChar.ilvl || 0}</div></div>
          <div><div class="char-main-stat-label">Gold</div><div class="char-main-stat-value" style="color:#ffd700">${(gold).toLocaleString()}g</div></div>
          <div><div class="char-main-stat-label">Weekly</div><div class="char-main-stat-value" style="color:#2ecc71">${prog.pct}%</div></div>
        </div>
        <div class="char-detail-grid">
          <div class="char-detail-item"><span class="char-detail-label">Location</span><span class="char-detail-value zone-value">${location}</span></div>
          <div class="char-detail-item"><span class="char-detail-label">Time Played</span><span class="char-detail-value played-value">${formatPlayedTime(selChar.playedTotal)}</span></div>
          <div class="char-detail-item"><span class="char-detail-label">Profession 1</span><span class="char-detail-value prof-value">${prof1}</span></div>
          <div class="char-detail-item"><span class="char-detail-label">Profession 2</span><span class="char-detail-value prof-value">${prof2}</span></div>
          <div class="char-detail-item"><span class="char-detail-label">Mounts</span><span class="char-detail-value mount-value">${selChar.mountsCollected||0} / ${selChar.mountsTotal||0}</span></div>
          <div class="char-detail-item"><span class="char-detail-label">Pets</span><span class="char-detail-value mount-value">${selChar.petsOwned||0}</span></div>
          <div class="char-detail-item">
            <span class="char-detail-label">Bag Space</span>
            <span class="char-detail-value">${freeBags} free / ${totalBags}</span>
            <div class="bag-bar"><div class="bag-bar-fill" style="width:${bagPct}%;background:${bagColor};"></div></div>
          </div>
          <div class="char-detail-item">
            <span class="char-detail-label">Rested XP</span>
            ${selChar.level >= 90 ? '<span class="char-detail-value" style="color:#3a3530;">Max Level</span>'
              : `<span class="char-detail-value" style="color:#a335ee;">${selChar.restedPct||0}%</span>
                 <div class="rested-bar"><div class="rested-bar-fill" style="width:${Math.min(selChar.restedPct||0,100)}%;"></div></div>`}
          </div>
        </div>
        <div style="margin-top:10px;font-size:10px;color:#3a3530;text-align:right;">${selChar.realm} · Updated: ${selChar.lastUpdated||'Unknown'}</div>
      </div>
      ${otherKeys.length > 0 ? `<div class="char-others">${sidebarHtml}</div>` : ''}
    </div>`;

  el.querySelectorAll('.char-side-tile').forEach(tile => {
    tile.addEventListener('click', async () => {
      selectedKey = tile.dataset.key;
      renderTiles();
      updateResetBanner();
      const ch = characters[selectedKey];
      if (ch && ch.level >= 90) { await fetchTracker(); fetchAdvice(); fetchBiS(); }
      else {
        document.getElementById('tracker').innerHTML = '';
        document.getElementById('advice').innerHTML = '';
        document.getElementById('bis').innerHTML = '';
        document.getElementById('crests').innerHTML = '';
        document.getElementById('extra').innerHTML = '';
        document.getElementById('consumables').innerHTML = '';
      }
    });
  });
}

// ── Tracker ──
function renderTracker(weekKey) {
  const el = document.getElementById('tracker');
  const c = characters[selectedKey];
  if (!c || c.level < 90) { el.innerHTML = ''; return; }
  const dc = countTicks('dungeon',8), rc = countTicks('raid',6), wc = countTicks('world',8);
  let wd = 0, weeklyTimeLeft = 0;
  WEEKLY_TASKS.forEach(t => { if (trackerData[t.id]) wd++; else weeklyTimeLeft += t.time; });
  const total = 8+6+8+WEEKLY_TASKS.length, done = dc+rc+wc+wd;
  const pct = Math.round((done/total)*100);

  // Calculate total time remaining
  const dungeonTimeLeft = (8 - dc) * VAULT.dungeons.timePerActivity;
  const raidTimeLeft = (6 - rc) * VAULT.raid.timePerActivity;
  const worldTimeLeft = (8 - wc) * VAULT.world.timePerActivity;
  const totalTimeLeft = dungeonTimeLeft + raidTimeLeft + worldTimeLeft + weeklyTimeLeft;
  const timeHrs = Math.floor(totalTimeLeft / 60);
  const timeMins = totalTimeLeft % 60;
  const timeStr = timeHrs > 0 ? `~${timeHrs}h ${timeMins}m remaining` : `~${timeMins}m remaining`;

  el.innerHTML = `
    <div class="tracker-card" data-panel="tracker">
      <div class="tracker-header">
        <h2><span class="panel-drag-handle">&#8942;&#8942;</span> Weekly Gearing Tracker</h2>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="text-align:right;">
            <span class="week-label">Week of ${weekKey}</span>
            <div style="font-size:10px;color:#f39c12;margin-top:3px;">${totalTimeLeft > 0 ? timeStr : 'All done!'}</div>
          </div>
          <button class="panel-min-btn">&#8722;</button>
        </div>
      </div>
      ${renderVaultSection('dungeons','Dungeons','Heroic / M0 / M+ / Timewalking',dc,8,VAULT.dungeons,'dungeon')}
      ${renderVaultSection('raid','Raid Bosses','Voidspire (6) + Dreamrift (1) + Quel\'Danas (2)',rc,6,VAULT.raid,'raid')}
      ${renderVaultSection('world','World Activities','Bountiful Delves (T8+), Prey Hunts, Zone Events',wc,8,VAULT.world,'world')}
      <div class="vault-section">
        <div class="vault-row-header">
          <div><span class="vault-row-title weekly">Weekly Must-Dos</span><div class="vault-row-detail">${wd}/${WEEKLY_TASKS.length} completed${weeklyTimeLeft>0?' &middot; ~'+weeklyTimeLeft+'m left':''}</div></div>
        </div>
        ${WEEKLY_TASKS.map(t => renderTaskRow(t)).join('')}
      </div>
      <div class="tracker-summary">
        <span class="summary-pct">${pct}%</span>
        <div class="summary-bar"><div class="summary-bar-fill" style="width:${pct}%"></div></div>
        <span class="summary-label">${done}/${total} done</span>
      </div>
    </div>`;

  el.querySelectorAll('[data-tick]').forEach(box => {
    box.addEventListener('click', async () => {
      await toggleTick(box.dataset.tick, !trackerData[box.dataset.tick]);
      await fetchTracker();
    });
  });
}

function countTicks(p, max) { let c=0; for(let i=1;i<=max;i++){if(trackerData[`${p}_${i}`])c++;} return c; }

function renderVaultSection(css, title, detail, count, max, vaultConfig, prefix) {
  const slots = vaultConfig.slots;
  const pct = Math.round((count/max)*100);
  const remaining = max - count;
  const timeLeft = remaining * vaultConfig.timePerActivity;
  const timeStr = timeLeft > 60 ? `~${Math.floor(timeLeft/60)}h ${timeLeft%60}m` : `~${timeLeft}m`;
  const slotsUnlocked = slots.filter(t => count >= t).length;
  const slotsHtml = `<span style="font-size:10px;color:${slotsUnlocked===slots.length?'#2ecc71':slotsUnlocked>0?'#ffd700':'#4a4038'};font-weight:600;">${slotsUnlocked}/${slots.length} slots</span>`;
  let ticks = '';
  for (let i=1; i<=max; i++) {
    const k=`${prefix}_${i}`, ch=!!trackerData[k], auto=ch&&!manualOverrides[k];
    ticks += `<div class="tick-box ${ch?(auto?'auto':'checked'):''}" data-tick="${k}">${ch?'&#10003;':i}</div>`;
  }
  return `<div class="vault-section">
    <div class="vault-row-header">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span class="vault-row-title ${css}">${title}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            ${remaining > 0 ? `<span style="font-size:10px;color:#f39c12;white-space:nowrap;">${timeStr}</span>` : ''}
            ${slotsHtml}
          </div>
        </div>
        <div class="vault-row-detail">${detail}</div>
      </div>
    </div>
    <div class="vault-progress-bar"><div class="vault-progress-fill ${css}" style="width:${pct}%"></div></div>
    <div class="tick-grid">${ticks}</div></div>`;
}

function renderTaskRow(task) {
  const ch = !!trackerData[task.id], auto = ch && !manualOverrides[task.id];
  const c = characters[selectedKey];
  let extra = '';
  if (task.id === 'spark' && c) {
    const p = c.sparkProgress||0, mx = c.sparkProgressMax||0, txt = c.sparkObjectiveText||'';
    if (mx > 0 && p < mx) {
      const pc = Math.round((p/mx)*100);
      extra = `<div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
        <div style="flex:1;height:3px;background:#1a1528;border-radius:2px;overflow:hidden;">
          <div style="width:${pc}%;height:100%;background:#f39c12;border-radius:2px;"></div>
        </div><span style="font-size:10px;color:#f39c12;font-weight:600;">${p}/${mx}</span></div>`;
      if (txt && txt !== 'Completed') extra = `<div style="font-size:10px;color:#5a5545;margin-top:2px;">${txt}</div>` + extra;
    }
  }
  // "Synced" badge = auto-detected from in-game data (not manually ticked)
  const badge = auto ? '<span class="auto-badge">Synced</span>' : '';
  return `<div class="task-row">
    <div class="task-check ${ch?(auto?'auto':'checked'):''}" data-tick="${task.id}">${ch?'&#10003;':''}</div>
    <div class="task-info">
      <div style="display:flex;align-items:center;gap:4px;">
        <span class="task-name ${ch?'done':''}">${task.name}</span>${badge}
      </div>
      <div class="task-detail">${task.detail}${!ch && task.time ? ` · ~${task.time}m` : ''}</div>
      ${extra}
    </div></div>`;
}

// ── Advice ──
let adviceData = {};
let aiAdvice = null;
let aiAdviceLoading = false;
let inlineChatHistory = [];

async function fetchAdvice() {
  try { const r = await fetch('/api/advice'); adviceData = await r.json(); renderAdvice(); }
  catch(e) { console.error(e); }
}

async function fetchAIAdvice() {
  inlineChatHistory = [];
  const c = characters[selectedKey];
  if (!c || c.level < 90 || aiAdviceLoading) return;
  aiAdviceLoading = true;
  renderAdvice(); // show loading state
  try {
    const res = await fetch('/api/smart-advice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character: c, bisData, weeklyProgress: { dungeons: c.vaultDungeons, raid: c.vaultRaid, world: c.vaultWorld } }),
    });
    const data = await res.json();
    aiAdvice = data.advice || data.error || null;
  } catch (err) { aiAdvice = null; }
  aiAdviceLoading = false;
  renderAdvice();
}

async function sendInlineChat() {
  const input = document.getElementById('inlineChatInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  const messagesEl = document.getElementById('inlineChatMessages');
  messagesEl.innerHTML += `<div style="align-self:flex-end;background:#1a3a5c;color:#c8c0b0;padding:6px 10px;border-radius:8px;border-bottom-right-radius:3px;font-size:11px;max-width:80%;">${sanitizeHTML(msg)}</div>`;
  messagesEl.innerHTML += `<div id="inlineThinking" style="align-self:flex-start;color:#4a4038;font-size:10px;font-style:italic;">Thinking...</div>`;
  messagesEl.scrollTop = messagesEl.scrollHeight;

  inlineChatHistory.push({ role: 'user', content: msg });

  const c = characters[selectedKey];
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        character: c,
        bisData,
        chatHistory: [
          { role: 'assistant', content: aiAdvice || '' },
          ...inlineChatHistory.slice(-8)
        ],
        userKey: localStorage.getItem('wowdash_userKey') || 'local',
      }),
    });
    const data = await res.json();

    const thinking = document.getElementById('inlineThinking');
    if (thinking) thinking.remove();

    if (data.reply) {
      const safereply = sanitizeHTML(data.reply).replace(/\*\*(.*?)\*\*/g, '<strong style="color:#ffd700;">$1</strong>');
      messagesEl.innerHTML += `<div style="align-self:flex-start;background:#1a1528;border:1px solid #2a2235;color:#c8c0b0;padding:6px 10px;border-radius:8px;border-bottom-left-radius:3px;font-size:11px;max-width:85%;line-height:1.5;">${safereply}</div>`;
      inlineChatHistory.push({ role: 'assistant', content: data.reply });
    } else if (data.rateLimited) {
      messagesEl.innerHTML += `<div style="align-self:center;color:#e74c3c;font-size:10px;">${data.error}</div>`;
    } else {
      messagesEl.innerHTML += `<div style="align-self:center;color:#4a4038;font-size:10px;">Could not get response.</div>`;
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch (err) {
    const thinking = document.getElementById('inlineThinking');
    if (thinking) thinking.remove();
    messagesEl.innerHTML += `<div style="align-self:center;color:#4a4038;font-size:10px;">Connection error.</div>`;
  }
}

function renderAdvice() {
  const el = document.getElementById('advice');
  const c = characters[selectedKey];
  if (!c || c.level < 90 || !adviceData[selectedKey]) { el.innerHTML = ''; return; }
  const adv = adviceData[selectedKey];

  // Build DYNAMIC tips based on actual character state
  let tips = '';
  const ilvl = c.ilvl || 0;
  const dungeons = c.vaultDungeons || 0;
  const raid = c.vaultRaid || 0;
  const world = c.vaultWorld || 0;

  // M+ tip — based on actual vault progress
  if (dungeons < 8) {
    const nextSlot = [1,4,8].find(t => dungeons < t);
    const need = nextSlot - dungeons;
    const slotNum = nextSlot === 1 ? 1 : nextSlot === 4 ? 2 : 3;
    tips += `<div class="advice-tip"><div class="advice-tip-label">M+ Priority</div>${need} more dungeon${need>1?'s':''} for vault slot ${slotNum}. ${ilvl < 255 ? 'Run +2-5 keys for quick completions.' : ilvl < 270 ? 'Push +7-9 for better vault rewards.' : 'Push +10 or higher for Myth-track vault gear (ilvl 272).'}</div>`;
  } else {
    tips += `<div class="advice-tip"><div class="advice-tip-label">M+ Complete</div>All 3 dungeon vault slots unlocked! Push higher keys for better ilvl options in the vault.</div>`;
  }

  // Raid tip — based on actual vault progress
  if (raid < 6) {
    const nextSlot = [2,4,6].find(t => raid < t);
    const need = nextSlot - raid;
    const slotNum = nextSlot === 2 ? 1 : nextSlot === 4 ? 2 : 3;
    const difficulty = ilvl < 250 ? 'LFR or Normal' : ilvl < 265 ? 'Normal or Heroic' : 'Heroic or Mythic';
    tips += `<div class="advice-tip"><div class="advice-tip-label">Raid Priority</div>${need} more boss${need>1?'es':''} for vault slot ${slotNum}. Queue ${difficulty} — Voidspire (6 bosses) is your best bet.</div>`;
  }

  // World tip
  if (world < 8) {
    const nextSlot = [2,4,8].find(t => world < t);
    const need = nextSlot - world;
    tips += `<div class="advice-tip"><div class="advice-tip-label">World Activities</div>${need} more for next vault slot. Run Bountiful Delves T8+ with Coffer Keys for Hero-level loot, or do zone events.</div>`;
  }

  // Weekly tasks not done
  if (!c.sparkDone && !c.sparkAccepted) {
    tips += `<div class="advice-tip"><div class="advice-tip-label">Don't Forget</div>Pick up your weekly Liadrin quest from Lady Liadrin in Silvermoon (49, 64). Free Apex Cache + Spark of Radiance!</div>`;
  }

  // Add BiS-related crest advice if we have gear data
  let crestAdvice = '';
  if (bisData && c) {
    let needsUpgrade = [];
    for (const [sid, bis] of Object.entries(bisData.slots)) {
      if (bis.bisIlvl === 0) continue;
      const curID = c[`gear_${sid}_itemID`] || 0;
      const curIlvl = c[`gear_${sid}_ilvl`] || 0;
      if (curID == bis.bisItemID && curIlvl < bis.bisIlvl) {
        needsUpgrade.push({ slot: bis.slotName, gap: bis.bisIlvl - curIlvl, source: bis.source });
      }
    }
    if (needsUpgrade.length > 0) {
      const topUpgrade = needsUpgrade.sort((a,b) => b.gap - a.gap)[0];
      crestAdvice = `<div class="advice-tip"><div class="advice-tip-label">Upgrade Priority</div>You have ${needsUpgrade.length} BiS items that need Dawncrests. Biggest gain: <strong>${topUpgrade.slot}</strong> (+${topUpgrade.gap} ilvl). Farm crests via M+ keys, raid bosses, and Tier 8+ Delves. Tier 11 Delves give the most crests per hour.</div>`;
    }
  }

  // Ilvl-based gearing phase tip — references BiS data
  let ilvlTip = '';
  // Find weakest slot for specific advice
  let weakestSlot = null, weakestGap = 0;
  if (bisData) {
    for (const [sid, bis] of Object.entries(bisData.slots)) {
      if (bis.bisIlvl === 0) continue;
      const curIlvl = c[`gear_${sid}_ilvl`] || 0;
      const gap = bis.bisIlvl - curIlvl;
      if (gap > weakestGap) { weakestGap = gap; weakestSlot = bis; }
    }
  }
  const weakestTip = weakestSlot ? ` Your biggest upgrade: <strong>${weakestSlot.slotName}</strong> from ${weakestSlot.source} (+${weakestGap} ilvl).` : '';

  if (ilvl < 246) {
    ilvlTip = `<div class="advice-tip"><div class="advice-tip-label">Gearing Phase: Early (${ilvl} ilvl)</div>Focus on M0 world tour for Champion 1/6 (246) gear, Heroic dungeons, and LFR for tier pieces. Craft your weapon first with 4 Sparks of Radiance — it's your single biggest DPS upgrade.${weakestTip}</div>`;
  } else if (ilvl < 259) {
    ilvlTip = `<div class="advice-tip"><div class="advice-tip-label">Gearing Phase: Mid (${ilvl} ilvl)</div>Push M+ keys (+6-9) for Champion/Hero vault rewards. Run Normal raids for tier set pieces (Voidbreaker's Accordance). Do Bountiful Delves T8+ with Coffer Keys from Prey Hunts.${weakestTip}</div>`;
  } else if (ilvl < 272) {
    ilvlTip = `<div class="advice-tip"><div class="advice-tip-label">Gearing Phase: Late (${ilvl} ilvl)</div>Push M+10 for Myth 1/6 vault rewards (272). Run Heroic raids for Hero-track gear (259-269). Spend Dawncrests to upgrade your BiS items. Target missing tier pieces for 4pc bonus.${weakestTip}</div>`;
  } else {
    ilvlTip = `<div class="advice-tip"><div class="advice-tip-label">Gearing Phase: Endgame (${ilvl} ilvl)</div>Mythic raids for Myth-track gear (272-282). Push high M+ keys for better vault options. Upgrade remaining BiS pieces with Myth Dawncrests to 6/6.${weakestTip}</div>`;
  }

  // AI-powered advice section
  let aiSection = '';
  let ruleBasedContent = `<div class="advice-nextup">${adv.nextUp || ''}</div>${tips}${ilvlTip}${crestAdvice}`;

  if (aiAdviceLoading) {
    aiSection = `<div style="padding:10px 0;text-align:center;color:#5a5545;font-size:12px;">
      <span style="color:#3fc7eb;">&#9881;</span> Claude is analyzing your character...</div>`;
  } else if (aiAdvice) {
    const formatted = sanitizeHTML(aiAdvice).replace(/\*\*(.*?)\*\*/g, '<strong style="color:#ffd700;">$1</strong>');
    aiSection = `
      <div style="border-top:1px solid #2a2235;padding-top:10px;margin-top:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#3fc7eb;">
            AI Advisor <span style="font-size:8px;color:#4a4038;font-weight:400;">powered by Claude</span>
          </div>
          <div style="display:flex;gap:6px;">
            <button onclick="fetchAIAdvice()" style="background:none;border:1px solid #2a2235;border-radius:4px;color:#3fc7eb;cursor:pointer;font-size:10px;padding:3px 8px;">&#8635; Refresh</button>
            <button onclick="aiAdvice=null;inlineChatHistory=[];renderAdvice();" style="background:none;border:1px solid #2a2235;border-radius:4px;color:#4a4038;cursor:pointer;font-size:10px;padding:3px 8px;">Rule-based</button>
          </div>
        </div>
        <div style="font-size:12px;color:#c8c0b0;line-height:1.7;white-space:pre-line;margin-bottom:12px;">${formatted}</div>

        ${isUserSubscribed ? `<div id="inlineChat">
          <div id="inlineChatMessages" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:8px;"></div>
          <div style="display:flex;gap:6px;">
            <input id="inlineChatInput" type="text" placeholder="Ask a follow-up... (e.g. I have 30 minutes, what should I do?)"
              style="flex:1;background:#1a1528;border:1px solid #2a2235;border-radius:6px;padding:8px 12px;color:#c8c0b0;font-size:11px;outline:none;font-family:inherit;"
              onkeydown="if(event.key==='Enter')sendInlineChat()">
            <button onclick="sendInlineChat()" style="background:linear-gradient(135deg,#3fc7eb,#1a9fd4);border:none;border-radius:6px;padding:8px 12px;color:#fff;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">Ask Claude</button>
          </div>
        </div>` : `<div style="position:relative;">
          <div style="filter:blur(4px);pointer-events:none;opacity:0.5;">
            <div style="background:#1a1528;border:1px solid #2a2235;border-radius:6px;padding:12px;">
              <div style="color:#4a4038;font-size:11px;">Chat messages would appear here...</div>
              <div style="display:flex;gap:6px;margin-top:8px;">
                <input disabled placeholder="Ask Claude..." style="flex:1;background:#12101e;border:1px solid #2a2235;border-radius:6px;padding:8px;color:#4a4038;font-size:11px;">
                <button disabled style="background:#333;border:none;border-radius:6px;padding:8px 12px;color:#555;font-size:11px;">Ask</button>
              </div>
            </div>
          </div>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <div style="font-size:13px;color:#ffd700;font-weight:600;margin-bottom:8px;">Unlock AI Chat</div>
            <div style="font-size:11px;color:#5a5545;margin-bottom:12px;text-align:center;">Get personalized coaching from Claude.<br>Ask follow-up questions about your gear and priorities.</div>
            <button onclick="subscribeToPro()" style="background:linear-gradient(135deg,#ffd700,#cc8800);border:none;border-radius:8px;padding:10px 24px;color:#1a0e00;font-size:13px;font-weight:700;cursor:pointer;">Subscribe</button>
          </div>
        </div>`}
      </div>`;
    // When AI advice is showing, hide rule-based tips
    ruleBasedContent = '';
  } else {
    aiSection = `<div style="border-top:1px solid #2a2235;padding-top:8px;margin-top:8px;text-align:center;">
      <button onclick="fetchAIAdvice()" style="background:linear-gradient(135deg,#3fc7eb,#1a9fd4);color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:12px;font-weight:600;cursor:pointer;transition:opacity 0.15s;">
        &#10024; Get AI Recommendations
      </button>
      <div style="font-size:9px;color:#3a3530;margin-top:4px;">Analyzes your gear, progress, and BiS data</div>
    </div>`;
  }

  el.innerHTML = `
    <div class="advice-card" data-panel="advice">
      <div class="advice-header" style="display:flex;justify-content:space-between;align-items:center;">
        <h3><span class="panel-drag-handle">&#8942;&#8942;</span> Smart Recommendations</h3>
        <button class="panel-min-btn">&#8722;</button>
      </div>
      ${ruleBasedContent}
      ${aiSection}
    </div>`;
}

// ── BiS Tracker ──
const QUALITY_CSS = ['quality-poor','quality-common','quality-uncommon','quality-rare','quality-epic','quality-legendary'];
const SLOT_ORDER_LEFT = [1, 2, 3, 5, 9, 11, 13];   // Head, Neck, Shoulder, Chest, Wrist, Ring1, Trinket1
const SLOT_ORDER_RIGHT = [15, 10, 6, 7, 8, 12, 14]; // Back, Hands, Waist, Legs, Feet, Ring2, Trinket2
const SLOT_ORDER_WEAPON = [16, 17];

let bisData = null;
let bisDetailSlot = null; // currently expanded slot

// Map class+spec to BiS data key
function getSpecKey(c) {
  if (!c || !c.spec || !c.class) return null;
  const cls = c.class.toLowerCase().replace(' ', '-');
  const spec = (c.spec || '').toLowerCase().replace(' ', '-');
  return `${spec}-${cls}`;  // e.g., "frost-mage", "arms-warrior", "holy-paladin"
}

async function fetchBiS() {
  const c = characters[selectedKey];
  if (!c || c.level < 90) { document.getElementById('bis').innerHTML = ''; return; }
  const specKey = getSpecKey(c);
  if (!specKey) { document.getElementById('bis').innerHTML = ''; return; }
  try {
    const res = await fetch(`/api/bis/${specKey}`);
    if (res.ok) {
      bisData = await res.json();
      renderBiS();
      renderCrests();
      renderExtra();
      fetchConsumables();
      renderAdvice();
    } else {
      const data = await res.json();
      if (data.generating) {
        // BiS data is being generated by Claude right now
        bisData = null;
        document.getElementById('bis').innerHTML = `
          <div class="card" style="border-top:2px solid rgba(163,53,238,0.3);padding:20px;text-align:center;">
            <h2 style="font-family:'Cinzel',serif;color:#a335ee;font-size:16px;margin-bottom:8px;">Best in Slot</h2>
            <div style="color:#3fc7eb;font-size:13px;margin-bottom:8px;">
              <span style="display:inline-block;animation:pulse 1.5s infinite;">&#9881;</span>
              Generating BiS data for <strong>${c.spec} ${c.class}</strong>...
            </div>
            <p style="color:#4a4038;font-size:11px;">Claude is researching the current meta. This takes ~10 seconds.</p>
          </div>`;
        // Auto-retry after 5 seconds
        setTimeout(() => fetchBiS(), 5000);
      } else {
        bisData = null;
        document.getElementById('bis').innerHTML = `
          <div class="card" style="border-top:2px solid rgba(163,53,238,0.3);padding:20px;text-align:center;">
            <h2 style="font-family:'Cinzel',serif;color:#a335ee;font-size:16px;margin-bottom:8px;">Best in Slot</h2>
            <p style="color:#5a5545;font-size:13px;">BiS data for <strong style="color:#c8c0b0;">${c.spec} ${c.class}</strong> could not be generated.</p>
            <button onclick="fetchBiS()" style="margin-top:8px;background:linear-gradient(135deg,#a335ee,#7a28b5);border:none;border-radius:6px;padding:8px 16px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Retry</button>
          </div>`;
      }
      renderCrests();
      renderExtra();
    }
  } catch (err) { console.error('Failed to fetch BiS:', err); }
}

function getSlotStatus(c, slotId, bis) {
  const currentItemID = c[`gear_${slotId}_itemID`] || 0;
  const currentIlvl = c[`gear_${slotId}_ilvl`] || 0;
  const isBisItem = currentItemID == bis.bisItemID;
  const isMaxIlvl = currentIlvl >= bis.bisIlvl;
  const isPerfect = isBisItem && isMaxIlvl;
  const isClose = currentIlvl >= bis.bisIlvl - 13;
  if (isPerfect) return 'perfect';    // right item, max ilvl
  if (isBisItem) return 'upgrading';  // right item, needs upgrades
  if (isClose) return 'close';        // wrong item but decent ilvl
  return 'upgrade';                   // major upgrade needed
}

function renderBiS() {
  const el = document.getElementById('bis');
  const c = characters[selectedKey];
  if (!c || c.level < 90 || !bisData) { el.innerHTML = ''; return; }

  // Tier counting
  const tierSlots = bisData.tierSet?.slots || [];
  let tierCount = 0;
  tierSlots.forEach(sid => {
    const b = bisData.slots[sid];
    if (b && c[`gear_${sid}_itemID`] == b.bisItemID) tierCount++;
  });

  // Overall progress score (ilvl-based)
  let totalIlvl = 0, totalBisIlvl = 0, bisCount = 0, slotCount = 0;
  for (const [sid, bis] of Object.entries(bisData.slots)) {
    if (bis.bisIlvl === 0) continue;
    slotCount++;
    const curIlvl = c[`gear_${sid}_ilvl`] || 0;
    totalIlvl += curIlvl;
    totalBisIlvl += bis.bisIlvl;
    if (c[`gear_${sid}_itemID`] == bis.bisItemID) bisCount++;
  }
  const gearPct = totalBisIlvl > 0 ? Math.round((totalIlvl / totalBisIlvl) * 100) : 0;
  const avgCur = slotCount > 0 ? Math.round(totalIlvl / slotCount) : 0;
  const avgBis = slotCount > 0 ? Math.round(totalBisIlvl / slotCount) : 0;

  function renderSlot(slotId) {
    const bis = bisData.slots[slotId];
    if (!bis) return '';
    const curName = c[`gear_${slotId}_name`] || 'Empty';
    const curIlvl = c[`gear_${slotId}_ilvl`] || 0;
    const curID = c[`gear_${slotId}_itemID`] || 0;
    const curQ = c[`gear_${slotId}_quality`] || 0;
    const qCSS = QUALITY_CSS[curQ] || 'quality-common';
    const status = getSlotStatus(c, slotId, bis);

    const statusMap = {
      perfect:  { cls: 'is-perfect', icon: '&#10003;', label: 'BiS MAX' },
      upgrading:{ cls: 'is-upgrading', icon: '&#8679;', label: 'NEEDS CRESTS' },
      close:    { cls: 'is-close',   icon: '&#8776;', label: '' },
      upgrade:  { cls: 'is-upgrade', icon: '',         label: '' },
    };
    const st = statusMap[status];
    const tierBadge = bis.isTier ? '<span class="tier-badge">TIER</span>' : '';
    const bisBadge = (status === 'perfect' || status === 'upgrading') ? '<span class="bis-badge">BiS</span>' : '';
    const statusBadge = st.label ? `<span class="status-badge ${st.cls}">${st.label}</span>` : '';

    const ilvlDiff = bis.bisIlvl - curIlvl;
    const ilvlHtml = curIlvl > 0
      ? `<span style="color:${status==='perfect'?'#2ecc71':'#8a7e6a'}">${curIlvl}</span> <span class="bis-arrow">&#8594;</span> <span class="bis-target">${bis.bisIlvl}</span>${ilvlDiff>0?` <span class="bis-diff">+${ilvlDiff}</span>`:''}`
      : `<span style="color:#3a3530">Empty</span> <span class="bis-arrow">&#8594;</span> <span class="bis-target">${bis.bisIlvl}</span>`;

    const sourceIcon = bis.sourceType === 'raid' ? '&#9876;' : bis.sourceType === 'mythicplus' ? '&#9881;' : bis.sourceType === 'crafted' ? '&#9874;' : '&#9733;';

    // Wrap item name with Wowhead link — use search URL if no direct URL/ID
    const bisSearchUrl = `https://www.wowhead.com/search?q=${encodeURIComponent(bis.bisName)}`;
    const wowheadHref = bis.wowheadUrl || bisSearchUrl;
    const wowheadAttr = bis.bisItemID > 0 ? `data-wowhead="item=${bis.bisItemID}"` : '';
    const wowheadLink = curName && curName !== 'Empty'
      ? `<a href="${wowheadHref}" ${wowheadAttr} class="bis-slot-item ${qCSS}" style="text-decoration:none;" target="_blank">${curName}</a>`
      : `<span class="bis-slot-item ${qCSS}">${curName || 'Empty'}</span>`;
    const unverifiedBadge = bis._verified === false
      ? '<span style="font-size:7px;color:#e74c3c;background:rgba(231,76,60,0.1);padding:1px 4px;border-radius:2px;margin-left:4px;">UNVERIFIED</span>'
      : '';

    return `
      <div class="bis-slot ${st.cls}" data-slot="${slotId}">
        <div class="bis-slot-left">
          <div class="bis-slot-label">${bis.slotName}</div>
          ${wowheadLink}
          <div class="bis-slot-ilvl">${ilvlHtml}</div>
        </div>
        <div class="bis-slot-right">
          <div style="display:flex;gap:3px;">
            ${bisBadge}${tierBadge}${unverifiedBadge}
          </div>
          ${statusBadge}
        </div>
      </div>`;
  }

  // Build columns
  const leftHtml = SLOT_ORDER_LEFT.map(renderSlot).join('');
  const rightHtml = SLOT_ORDER_RIGHT.map(renderSlot).join('');
  const weaponHtml = SLOT_ORDER_WEAPON.map(renderSlot).join('');

  el.innerHTML = `
    <div class="bis-card" data-panel="bis">
      <div class="bis-header">
        <div>
          <h2><span class="panel-drag-handle">&#8942;&#8942;</span> Best in Slot</h2>
          <div class="bis-spec">${bisData.specName} &middot; ${bisCount}/${slotCount} BiS items equipped</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="text-align:right;">
            <div class="bis-score">${gearPct}<span class="bis-score-pct">%</span></div>
            <div style="font-size:9px;color:#5a5545;margin-top:2px;">ilvl ${avgCur} of ${avgBis}</div>
          </div>
          <button class="panel-min-btn">&#8722;</button>
        </div>
      </div>

      <div class="bis-progress-row">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:9px;color:#5a5545;text-transform:uppercase;letter-spacing:0.8px;">Gear Progress to Full BiS</span>
          <span style="font-size:9px;color:#a335ee;">${gearPct}% — avg ${avgCur} / ${avgBis} ilvl</span>
        </div>
        <div class="bis-progress-bar"><div class="bis-progress-fill" style="width:${gearPct}%"></div></div>
        <div class="bis-progress-labels">
          <span>Stat Priority: ${bisData.statPriority}</span>
        </div>
      </div>

      <div class="bis-tier-row">
        <span class="tier-name">${bisData.tierSet.name}</span>
        <span class="tier-bonus ${tierCount>=2?'active':'inactive'}">2pc ${tierCount>=2?'&#10003;':'&#10007;'}</span>
        <span class="tier-bonus ${tierCount>=4?'active':'inactive'}">4pc ${tierCount>=4?'&#10003;':'&#10007;'}</span>
        <span class="tier-count">${tierCount}/4</span>
      </div>

      <div class="bis-columns">
        <div class="bis-col">${leftHtml}</div>
        <div class="bis-col">${rightHtml}</div>
      </div>
      <div class="bis-weapons">${weaponHtml}</div>

      <div id="bisDetail"></div>

      <div class="bis-footer">
        <div><strong>Upgrade Priority:</strong> ${bisData.upgradePriority}</div>
        <div><strong>Craft Priority:</strong> ${bisData.craftPriority}</div>
        <div><strong>Embellishments:</strong> ${bisData.embellishments}</div>
      </div>
    </div>`;

  // Refresh Wowhead tooltips for dynamically rendered links
  if (typeof $WowheadPower !== 'undefined') { try { $WowheadPower.refreshLinks(); } catch(e) {} }

  // Attach click handlers
  el.querySelectorAll('.bis-slot').forEach(slot => {
    slot.addEventListener('click', () => {
      const sid = slot.dataset.slot;
      if (bisDetailSlot === sid) { bisDetailSlot = null; renderBisDetail(); }
      else { bisDetailSlot = sid; renderBisDetail(); }
      // Toggle selected visual
      el.querySelectorAll('.bis-slot').forEach(s => s.classList.remove('expanded'));
      if (bisDetailSlot) slot.classList.add('expanded');
    });
  });
}

function renderBisDetail() {
  const el = document.getElementById('bisDetail');
  if (!bisDetailSlot || !bisData) { if(el) el.innerHTML = ''; return; }
  const c = characters[selectedKey];
  const bis = bisData.slots[bisDetailSlot];
  if (!bis) { el.innerHTML = ''; return; }

  const curName = c[`gear_${bisDetailSlot}_name`] || 'Empty';
  const curIlvl = c[`gear_${bisDetailSlot}_ilvl`] || 0;
  const curID = c[`gear_${bisDetailSlot}_itemID`] || 0;
  const status = getSlotStatus(c, bisDetailSlot, bis);
  const isBisItem = curID == bis.bisItemID;

  const sourceIcon = bis.sourceType==='raid'?'Raid Boss':bis.sourceType==='mythicplus'?'Mythic+ Dungeon':bis.sourceType==='crafted'?'Crafted':'Other';
  const ilvlGap = bis.bisIlvl - curIlvl;
  const statusText = status==='perfect'
    ? 'This slot is fully optimized! Nothing to do here.'
    : status==='upgrading'
    ? `You have the BiS item! Spend Dawncrests to upgrade it from ${curIlvl} to ${bis.bisIlvl} (${ilvlGap > 0 ? '+'+ilvlGap+' ilvl' : 'already close'}). Mythic raid drops at Myth track which upgrades to 6/6 = ilvl 282.`
    : status==='close'
    ? `Your current item (${curIlvl}) is decent, but switching to the BiS item would be a +${ilvlGap} ilvl upgrade with better stats.`
    : `Major upgrade available here! You're ${ilvlGap} ilvl below BiS. Prioritize getting this piece.`;

  const bisDetailSearchUrl = `https://www.wowhead.com/search?q=${encodeURIComponent(bis.bisName)}`;
  const wowheadLink = `<a href="${bis.wowheadUrl || bisDetailSearchUrl}" target="_blank" style="color:#a335ee;text-decoration:none;font-size:11px;">View on Wowhead &#8599;</a>`;

  el.innerHTML = `
    <div class="bis-detail-panel">
      <div class="bis-detail-header">
        <div>
          <div class="bis-detail-slot">${bis.slotName} — BiS Recommendation</div>
          <div class="bis-detail-status">${statusText}</div>
        </div>
        <div class="bis-detail-close" onclick="bisDetailSlot=null;renderBisDetail();document.querySelectorAll('.bis-slot').forEach(s=>s.classList.remove('expanded'));">&#10005;</div>
      </div>
      <div class="bis-detail-body">
        <div class="bis-detail-comparison">
          <div class="bis-detail-item ${isBisItem?'is-match':''}">
            <div class="bis-detail-label">YOUR ITEM</div>
            <div class="bis-detail-name quality-epic">${curName || 'Empty'}</div>
            <div class="bis-detail-ilvl">${curIlvl > 0 ? `ilvl ${curIlvl}` : 'No item equipped'}</div>
          </div>
          <div class="bis-detail-arrow">&#8594;</div>
          <div class="bis-detail-item target">
            <div class="bis-detail-label">BiS TARGET</div>
            <div class="bis-detail-name quality-epic"><a href="${bis.wowheadUrl || bisDetailSearchUrl}" ${bis.bisItemID > 0 ? `data-wowhead="item=${bis.bisItemID}"` : ''} style="color:#a335ee;text-decoration:none;" target="_blank">${bis.bisName}</a></div>
            <div class="bis-detail-ilvl">ilvl ${bis.bisIlvl} (max)</div>
          </div>
        </div>
        <div class="bis-detail-info">
          <div class="bis-detail-row"><span class="bis-detail-key">Source</span><span>${bis.source}</span></div>
          <div class="bis-detail-row"><span class="bis-detail-key">Type</span><span>${sourceIcon}</span></div>
          <div class="bis-detail-row"><span class="bis-detail-key">Why BiS</span><span>${bis.notes}</span></div>
          ${bis.usage?`<div class="bis-detail-row"><span class="bis-detail-key">Usage</span><span>${bis.usage}% of top raiders</span></div>`:''}
          ${bis.tierAlt?`<div class="bis-detail-row"><span class="bis-detail-key">Tier Alt</span><span>${bis.tierAlt}</span></div>`:''}
          ${wowheadLink?`<div class="bis-detail-row">${wowheadLink}</div>`:''}
        </div>
      </div>
    </div>`;
  // Refresh Wowhead tooltips for detail panel
  if (typeof $WowheadPower !== 'undefined') { try { $WowheadPower.refreshLinks(); } catch(e) {} }
}

// ── Crest Tracker ──
function renderCrests() {
  const el = document.getElementById('crests');
  const c = characters[selectedKey];
  if (!c || c.level < 90) { el.innerHTML = ''; return; }

  const ilvl = c.ilvl || 0;
  const tiers = [
    { name: 'Adventurer', css: 'crest-adventurer', color: '#1eff00', ilvl: '220-237', sources: 'LFR, Heroic dungeons, Delve T4, outdoor events' },
    { name: 'Veteran', css: 'crest-veteran', color: '#0070dd', ilvl: '233-250', sources: 'Heroic Season dungeons, Delve T5-6, Hard Prey hunts' },
    { name: 'Champion', css: 'crest-champion', color: '#a335ee', ilvl: '246-263', sources: 'M+ 2-3, Normal raid, Delve T7-10' },
    { name: 'Hero', css: 'crest-hero', color: '#ff8000', ilvl: '259-276', sources: 'M+ 4-8, Heroic raid, Bounty Delve T8+' },
    { name: 'Myth', css: 'crest-myth', color: '#e6cc80', ilvl: '272-289', sources: 'M+ 9+, Mythic raid' },
  ];

  // Determine which crest tier the player should focus on based on ilvl
  let focusTier = 'Champion';
  let farmAdvice = '';
  if (ilvl < 240) {
    focusTier = 'Veteran';
    farmAdvice = 'Farm Hard Prey hunts (15 crests/run, ~10 min each) and Delve T5-6 to upgrade Veteran-track gear.';
  } else if (ilvl < 255) {
    focusTier = 'Champion';
    farmAdvice = 'Farm Delve T7-10 (repeatable, ~12 min each) and M+ 2-3 keys for Champion crests to push gear to 263.';
  } else if (ilvl < 270) {
    focusTier = 'Hero';
    farmAdvice = 'Push M+ 4-8 keys and run Heroic raid for Hero crests. Bounty Delves T8+ with Coffer Keys are also efficient.';
  } else {
    focusTier = 'Myth';
    farmAdvice = 'Push M+9 and above for Myth crests. Mythic raid bosses also drop them. This is the final upgrade tier (up to ilvl 289).';
  }

  // Explain why this crest tier matters based on BiS
  let crestReason = '';
  if (bisData) {
    let upgradeableSlots = [];
    for (const [sid, bis] of Object.entries(bisData.slots)) {
      if (bis.bisIlvl === 0) continue;
      const curID = c[`gear_${sid}_itemID`] || 0;
      const curIlvl = c[`gear_${sid}_ilvl`] || 0;
      if (curID == bis.bisItemID && curIlvl < bis.bisIlvl) {
        // Determine which crest tier this upgrade needs
        let needed = 'Champion';
        if (curIlvl >= 259) needed = 'Hero';
        if (curIlvl >= 272) needed = 'Myth';
        if (needed === focusTier) {
          upgradeableSlots.push(bis.slotName);
        }
      }
    }
    if (upgradeableSlots.length > 0) {
      crestReason = `You need ${focusTier} crests to upgrade: ${upgradeableSlots.join(', ')}. `;
    }
  }

  const tiersHtml = tiers.map(t => {
    const isFocus = t.name === focusTier;
    return `
    <div class="crest-tier" style="${isFocus ? 'border-color:'+t.color+';background:#1a1528;' : ''}">
      <div class="crest-tier-name ${t.css}">${t.name}${isFocus ? ' ★' : ''}</div>
      <div class="crest-tier-cap" style="margin-top:4px;">100/week</div>
      <div style="font-size:9px;color:#5a5545;margin-top:4px;">${t.ilvl}</div>
      <div style="font-size:9px;color:#4a4038;margin-top:4px;">${t.sources}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="crest-card" data-panel="crests">
      <div class="crest-header">
        <h2><span class="panel-drag-handle">&#8942;&#8942;</span> Dawncrest Tracker</h2>
        <button class="panel-min-btn">&#8722;</button>
      </div>
      <div class="crest-grid">${tiersHtml}</div>
      <div style="padding:14px 18px;font-size:9px;color:#4a4038;border-top:1px solid #2a2235;word-wrap:break-word;">&#9733; = recommended tier for your current ilvl</div>
      <div style="padding:14px 18px;border-top:1px solid #2a2235;word-wrap:break-word;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#f39c12;margin-bottom:6px;">What to Farm Next</div>
        <div style="font-size:12px;color:#c8c0b0;line-height:1.5;">${crestReason}${farmAdvice}</div>
      </div>
      <div class="crest-sources">
        <strong>Cost:</strong> 20 crests/rank, 120 to fully upgrade one item<br>
        <strong>Convert:</strong> Higher→Lower 1:1 &middot; Lower→Higher 3:1 (gear milestone needed)
      </div>
    </div>`;
}

// ── Extra Panel (placeholder for future features) ──
function renderExtra() {
  const el = document.getElementById('extra');
  const c = characters[selectedKey];
  if (!c || c.level < 90) { el.innerHTML = ''; return; }

  // After weekly tasks are done, what should you farm?
  const ilvl = c.ilvl || 0;
  let bonusFarms = [];
  if (ilvl < 255) {
    bonusFarms = [
      { name: 'Delve T7-10 spam', detail: 'Champion crests + chance at Hero gear', time: '~12 min each' },
      { name: 'Normal raid re-clear', detail: 'Tier set pieces if missing any', time: '~2.5 hours' },
      { name: 'M+ key pushing', detail: 'Better vault options + crest income', time: '~45 min each' },
    ];
  } else {
    bonusFarms = [
      { name: 'M+ key pushing (+10+)', detail: 'Myth vault rewards (ilvl 272) + Myth crests', time: '~45 min each' },
      { name: 'Heroic raid', detail: 'Hero-track gear (259-269) + tier pieces', time: '~3 hours' },
      { name: 'Bounty Delve T8+', detail: 'Hero crests + guaranteed Hero gear with keys', time: '~15 min each' },
      { name: 'Crafting with Sparks', detail: 'Craft BiS pieces (weapon, wrist, cloak)', time: 'One-time per Spark' },
    ];
  }

  const farmsHtml = bonusFarms.map(f => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1e1e3a;">
      <div>
        <div style="font-size:12px;color:#c8c0b0;font-weight:500;">${f.name}</div>
        <div style="font-size:10px;color:#4a4038;">${f.detail}</div>
      </div>
      <div style="font-size:10px;color:#f39c12;white-space:nowrap;">${f.time}</div>
    </div>`).join('');

  el.innerHTML = `
    <div class="card" style="border-top:2px solid rgba(46,204,113,0.3);" data-panel="extra">
      <div style="padding:14px 18px;border-bottom:1px solid #2a2235;background:linear-gradient(180deg,rgba(46,204,113,0.05) 0%,transparent 100%);display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h2 style="font-size:15px;font-weight:700;color:#2ecc71;font-family:'Cinzel',serif;letter-spacing:1px;"><span class="panel-drag-handle">&#8942;&#8942;</span> Bonus Farming</h2>
          <div style="font-size:11px;color:#5a5545;margin-top:2px;">After weekly tasks — what to farm for more progress</div>
        </div>
        <button class="panel-min-btn">&#8722;</button>
      </div>
      <div style="padding:14px 18px;">${farmsHtml}</div>
    </div>`;
}

// ── Consumables ──
let consumablesData = null;

async function fetchConsumables() {
  const c = characters[selectedKey];
  if (!c || c.level < 90) { document.getElementById('consumables').innerHTML = ''; return; }
  const specKey = getSpecKey(c);
  if (!specKey) return;
  try {
    const res = await fetch(`/api/consumables/${specKey}`);
    if (res.ok) { consumablesData = await res.json(); renderConsumables(); }
    else {
      const data = await res.json();
      if (data.generating) {
        document.getElementById('consumables').innerHTML = `
          <div class="consumables-card" style="padding:20px;text-align:center;">
            <h2 style="font-family:'Cinzel',serif;color:#2ecc71;font-size:14px;">Consumables & Enchants</h2>
            <div style="color:#3fc7eb;font-size:12px;margin-top:8px;"><span style="animation:pulse 1.5s infinite;">&#9881;</span> Generating for ${c.spec} ${c.class}...</div>
          </div>`;
        setTimeout(fetchConsumables, 5000);
      }
    }
  } catch(e) { console.error(e); }
}

function renderConsumables() {
  const el = document.getElementById('consumables');
  if (!consumablesData) { el.innerHTML = ''; return; }
  const d = consumablesData;

  const enchantItems = Object.entries(d.enchants || {}).map(([slot, e]) => {
    const enchantName = e.wowheadUrl
      ? `<a href="${e.wowheadUrl}" ${e.itemID ? `data-wowhead="item=${e.itemID}"` : ''} style="color:#2ecc71;text-decoration:none;" target="_blank">${e.name}</a>`
      : e.name;
    return `<div class="consumable-item">
      <div class="consumable-label">${slot}</div>
      <div class="consumable-name">${enchantName}</div>
      <div class="consumable-stat">${e.stat}</div>
      <div style="font-size:8px;color:#2ecc71;margin-top:3px;">Stacks with all other buffs</div>
    </div>`;
  }).join('');

  const primaryGemName = d.gems?.primary?.wowheadUrl
    ? `<a href="${d.gems.primary.wowheadUrl}" ${d.gems.primary.itemID ? `data-wowhead="item=${d.gems.primary.itemID}"` : ''} style="color:#2ecc71;text-decoration:none;" target="_blank">${d.gems.primary.name}</a>`
    : (d.gems?.primary?.name || '?');
  const gemItems = [
    `<div class="consumable-item">
      <div class="consumable-label">Primary Gem</div>
      <div class="consumable-name">${primaryGemName}</div>
      <div class="consumable-stat">${d.gems?.primary?.stat || ''}</div>
      <div style="font-size:8px;color:#2ecc71;margin-top:3px;">Stacks with all other buffs</div>
    </div>`,
    ...(d.gems?.secondary || []).map(g => {
      const gemName = g.wowheadUrl
        ? `<a href="${g.wowheadUrl}" ${g.itemID ? `data-wowhead="item=${g.itemID}"` : ''} style="color:#2ecc71;text-decoration:none;" target="_blank">${g.name}</a>`
        : g.name;
      return `<div class="consumable-item">
        <div class="consumable-label">Secondary Gem</div>
        <div class="consumable-name">${gemName}</div>
        <div class="consumable-stat">${g.stat}</div>
        <div style="font-size:8px;color:#2ecc71;margin-top:3px;">Stacks with all other buffs</div>
      </div>`;
    })
  ].join('');

  // Stacking info per consumable type
  const stackingInfo = {
    flask: '<div style="font-size:8px;color:#e74c3c;margin-top:3px;">Does not stack with other flasks</div>',
    augmentRune: '<div style="font-size:8px;color:#f39c12;margin-top:3px;">Lost on death — re-apply after wipes</div>',
  };

  const consItems = Object.entries(d.consumables || {}).map(([key, c]) => {
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    const stacking = stackingInfo[key] || '<div style="font-size:8px;color:#2ecc71;margin-top:3px;">Stacks with all other buffs</div>';
    const consName = c.wowheadUrl
      ? `<a href="${c.wowheadUrl}" ${c.itemID ? `data-wowhead="item=${c.itemID}"` : ''} style="color:#2ecc71;text-decoration:none;" target="_blank">${c.name}</a>`
      : c.name;
    return `<div class="consumable-item">
      <div class="consumable-label">${label}</div>
      <div class="consumable-name">${consName}</div>
      <div class="consumable-stat">${c.stat || c.usage || c.note || ''}</div>
      ${stacking}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="consumables-card" data-panel="consumables">
      <div style="padding:14px 18px;border-bottom:1px solid #2a2235;display:flex;justify-content:space-between;align-items:center;background:linear-gradient(180deg,rgba(46,204,113,0.05) 0%,transparent 100%);">
        <h2 style="font-size:14px;font-weight:700;color:#2ecc71;font-family:'Cinzel',serif;letter-spacing:1px;">
          <span class="panel-drag-handle">&#8942;&#8942;</span> Consumables & Enchants
        </h2>
        <button class="panel-min-btn">&#8722;</button>
      </div>
      <div style="padding:10px 18px;border-bottom:1px solid #2a2235;">
        <div style="font-size:10px;font-weight:600;color:#ffd700;letter-spacing:0.5px;margin-bottom:6px;">Pre-Pull Checklist</div>
        <div style="font-size:11px;color:#c8c0b0;line-height:1.8;">
          1. Apply ${d.enchants?.weapon?.name || 'weapon enchant'} (permanent)<br>
          2. Use ${d.consumables?.flask?.name || 'flask'} (1hr)<br>
          3. Eat ${d.consumables?.food?.name || 'food'} (1hr)<br>
          4. Apply ${d.consumables?.weaponBuff?.name || 'weapon oil'} (2hr)<br>
          5. Use ${d.consumables?.augmentRune?.name || 'augment rune'} (1hr, re-apply after death)<br>
          6. Pre-pot ${d.consumables?.potion?.name || 'combat potion'} at 1 sec before pull<br>
          7. Second potion during burst window when CD resets
        </div>
      </div>
      <div style="padding:10px 18px 4px;font-size:10px;font-weight:600;color:#2ecc71;letter-spacing:1px;">Enchants</div>
      <div class="consumable-grid">${enchantItems}</div>
      <div style="padding:10px 18px 4px;font-size:10px;font-weight:600;color:#a335ee;letter-spacing:1px;">Gems</div>
      <div class="consumable-grid">${gemItems}</div>
      ${d.gems?.note ? `<div style="padding:0 18px 8px;font-size:10px;color:#4a4038;">${d.gems.note}</div>` : ''}
      <div style="padding:10px 18px 4px;font-size:10px;font-weight:600;color:#f39c12;letter-spacing:1px;">Consumables</div>
      <div class="consumable-grid">${consItems}</div>
    </div>`;
  // Refresh Wowhead tooltips for consumables
  if (typeof $WowheadPower !== 'undefined') { try { $WowheadPower.refreshLinks(); } catch(e) {} }
}

// ── AI Chatbot ──
let chatHistory = [];
let chatOpen = false;

function toggleChat() {
  if (!isUserSubscribed) {
    // Show subscribe prompt instead of opening chat
    chatOpen = true;
    const win = document.getElementById('chatWindow');
    win.classList.add('open');
    document.getElementById('chatMessages').innerHTML = `
      <div style="text-align:center;padding:30px 10px;">
        <div style="font-size:14px;color:#ffd700;font-weight:600;margin-bottom:8px;">Unlock AI Chat</div>
        <div style="font-size:12px;color:#5a5545;margin-bottom:16px;line-height:1.5;">Get personalized coaching from Claude.<br>Ask follow-up questions about your gear and priorities.</div>
        <button onclick="subscribeToPro();toggleChat();" style="background:linear-gradient(135deg,#ffd700,#cc8800);border:none;border-radius:8px;padding:10px 24px;color:#1a0e00;font-size:13px;font-weight:700;cursor:pointer;">Subscribe</button>
      </div>`;
    return;
  }
  chatOpen = !chatOpen;
  document.getElementById('chatWindow').classList.toggle('open', chatOpen);
  if (chatOpen && chatHistory.length === 0) {
    // Send opening message from AI
    const c = characters[selectedKey];
    if (c && c.level >= 90) {
      appendChat('ai', `Hey ${c.name}! I'm your AI gearing coach. How much time do you have to play today? And what are you in the mood for — M+, raids, chill solo content, or whatever gets you the best gear fastest?`);
    }
  }
}

function appendChat(role, text) {
  const el = document.getElementById('chatMessages');
  const safe = role === 'ai' ? sanitizeHTML(text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') : sanitizeHTML(text);
  const cls = role === 'user' ? 'user' : role === 'system' ? 'system' : 'ai';
  el.innerHTML += `<div class="chat-msg ${cls}">${safe}</div>`;
  el.scrollTop = el.scrollHeight;
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  appendChat('user', msg);
  chatHistory.push({ role: 'user', content: msg });

  const c = characters[selectedKey];
  if (!c) return;

  appendChat('system', 'Thinking...');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        character: c,
        bisData,
        chatHistory: chatHistory.slice(-10), // last 10 messages for context
        userKey: localStorage.getItem('wowdash_userKey') || 'local',
      }),
    });
    const data = await res.json();

    // Remove "Thinking..." message
    const msgs = document.getElementById('chatMessages');
    const lastSystem = msgs.querySelector('.chat-msg.system:last-child');
    if (lastSystem && lastSystem.textContent === 'Thinking...') lastSystem.remove();

    if (data.reply) {
      appendChat('ai', data.reply);
      chatHistory.push({ role: 'assistant', content: data.reply });
    } else if (data.rateLimited) {
      appendChat('system', data.error);
    } else {
      appendChat('system', 'Could not get a response. Try again.');
    }
  } catch (err) {
    const msgs = document.getElementById('chatMessages');
    const lastSystem = msgs.querySelector('.chat-msg.system:last-child');
    if (lastSystem && lastSystem.textContent === 'Thinking...') lastSystem.remove();
    appendChat('system', 'Connection error. Try again.');
  }
}

// ── Consent ──
function checkConsent() {
  const consent = localStorage.getItem('wowdash_consent');
  if (consent === null) {
    document.getElementById('consentBanner').style.display = 'block';
  }
}

function acceptConsent() {
  localStorage.setItem('wowdash_consent', 'true');
  document.getElementById('consentBanner').style.display = 'none';
}

function declineConsent() {
  localStorage.setItem('wowdash_consent', 'false');
  document.getElementById('consentBanner').style.display = 'none';
  // Disable AI features when consent declined
  document.querySelector('.chat-fab').style.display = 'none';
  document.getElementById('chatWindow').style.display = 'none';
}

// ── Subscription ──
let isUserSubscribed = false;

async function checkSubscription() {
  const key = localStorage.getItem('wowdash_userKey') || 'local';
  if (key === 'local' || !key) { isUserSubscribed = true; return; }
  try {
    const res = await fetch(`/api/subscription/${encodeURIComponent(key)}`);
    const data = await res.json();
    isUserSubscribed = data.subscribed;
  } catch (e) { isUserSubscribed = false; }
}

async function subscribeToPro() {
  const key = localStorage.getItem('wowdash_userKey') || 'local';
  try {
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userKey: key }),
    });
    const data = await res.json();
    if (data.subscribed) {
      isUserSubscribed = true;
      renderAdvice();
    }
  } catch (e) { console.error(e); }
}

// ── Init ──
checkConsent();
checkSubscription().then(() => {
  fetchCharacters();
});
setInterval(() => { fetchCharacters(); }, 30000);
setInterval(updateResetBanner, 60000);

// ── Draggable Panels ──
document.querySelectorAll('.panel-row').forEach(row => {
  new Sortable(row, {
    animation: 200,
    ghostClass: 'panel-ghost',
    chosenClass: 'panel-chosen',
    handle: '.panel-drag-handle',
    group: 'panels',
    swapThreshold: 0.65,
  });
});

// ── Panel Minimize ──
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('.panel-min-btn');
  if (toggle) {
    const card = toggle.closest('[data-panel]');
    if (card) {
      card.classList.toggle('card-minimized');
      toggle.textContent = card.classList.contains('card-minimized') ? '+' : '\u2212';
    }
  }
});
