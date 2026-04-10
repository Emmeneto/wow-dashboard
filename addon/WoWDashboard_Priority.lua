-- ============================================================================
-- WoWDashboard_Priority.lua - Priority Engine & Location Data
-- ============================================================================
-- Pure logic module: no UI, no events.
-- Defines task priorities, location/waypoint data, and provides sorted
-- task lists with completion status for the UI to render.
--
-- Priority Order (highest first):
--   1. Liadrin's Spark Quest  (weekly, 1 quest)
--   2. World Boss             (weekly, 1 kill per warband)
--   3. Prey Hunts             (weekly, 3 hunts)
--   4. M+ Dungeons            (vault, 8 runs for 3 slots)
--   5. Raid Bosses            (vault, 6 kills for 3 slots)
--   6. World Activities       (vault, 8 activities for 3 slots)
--   7. Housing Weekly         (weekly, 1 quest)
--
-- Includes TomTom/Blizzard waypoint integration and manual toggle support.
-- ============================================================================

-- ══════════════════════════════════════════
-- Location Data (mapID, x, y, description)
-- Uses Blizzard mapIDs. Coordinates are 0-1 normalized.
-- ══════════════════════════════════════════

-- Verified mapIDs:
--   Silvermoon City = 2393
--   Eversong Woods  = 2395
--   Zul'Aman        = 2437
--   Harandar         = 2413
--   Voidstorm        = 2405
--   Housing (Razorwind) = 2351

WoWDashboard_Locations = {
    spark = {
        label   = "Lady Liadrin",
        zone    = "Silvermoon City",
        mapID   = 2393,
        x       = 0.490,
        y       = 0.644,
        howTo   = "Pick up ONE weekly 'Midnight:' quest from Lady Liadrin near the Great Vault in Silvermoon. 13 options (Prey, Delves, Dungeons, Raid, World Boss, etc.). Each rewards an Apex Cache + Spark of Radiance.",
    },
    worldboss = {
        label   = "Weekly World Boss",
        zone    = "Rotates: Eversong / Zul'Aman / Harandar / Voidstorm",
        mapID   = nil,
        x       = nil,
        y       = nil,
        howTo   = "Open Adventure Guide (Shift+J) > Suggested Content to see this week's boss. Rotation: Lu'ashal (Eversong) > Cragpine (Zul'Aman) > Thorm'belan (Harandar) > Predaxas (Voidstorm). Join via Group Finder (I) > Premade Groups. One kill per warband per week.",
    },
    prey = {
        label      = "Astalor Bloodsworn (Hunt Table)",
        zone       = "Astalor's Sanctum, Silvermoon City",
        mapID      = 2393,
        x          = 0.562,
        y          = 0.598,
        howTo      = "Visit the Hunt Table at Astalor's Sanctum in Silvermoon (56, 60). Pick a Nightmare prey target from the map. Do 3 Nightmare hunts/week for Champion-track crests + Hero-track vault options. Quests are named 'Prey: [Target Name] (Nightmare)'.",
        unlockNote = "To unlock prey hunts: complete 'Prey: Astalor's Initiative' from Astalor Bloodsworn in Eversong Woods (43, 10), then 'To the Sanctum!' to access the Hunt Table in Silvermoon.",
        nightmareUnlock = "To unlock Nightmare difficulty:\n1. Reach Prey Journey Rank 4 (complete ~4 Hard hunts after reaching Rank 3)\n2. Return to Astalor Bloodsworn in Silvermoon (56, 65)\n3. Complete the 'Astalor's Temptations' quest chain (6 quests):\n   - Dark Mending > Precious Jewels > ... > The Sheep or the Wolf\n4. Nightmare unlocks after finishing 'The Sheep or the Wolf'\nNote: Nightmare hunts are solo-only with brutal mechanics (Torment stacks, Echo chasing you, Bloody Command affix). Gear up first!",
    },
    mplus = {
        label   = "Group Finder",
        zone    = "Press I > Dungeons > Mythic+",
        mapID   = nil,
        x       = nil,
        y       = nil,
        howTo   = "Open Group Finder (I) > Dungeon Finder > Mythic Keystone. Use your own key from bags or apply to groups. Push highest key you can time. +10 gives max vault rewards (Myth 1/6, ilvl 272).",
    },
    raid = {
        label   = "The Voidspire (main raid)",
        zone    = "Voidstorm / Harandar / Isle of Quel'Danas",
        mapID   = 2405,
        x       = 0.454,
        y       = 0.640,
        howTo   = "3 raids this season: The Voidspire (6 bosses, Voidstorm 45,64), Dreamrift (1 boss, Harandar 61,64), March on Quel'Danas (2 bosses, 53,85). Use Group Finder (I) > Raid Finder for LFR, or Premade Groups for Normal/Heroic. 9 bosses total.",
    },
    world = {
        label   = "Delves / Zone Events",
        zone    = "All Midnight zones",
        mapID   = 2393,
        x       = 0.406,
        y       = 0.537,
        howTo   = "Delves: Collegiate Calamity (Silvermoon 41,54), The Darkway (Silvermoon 39,32), Shadow Enclave (Eversong 46,86), Atal'Aman (Eversong 64,80), Twilight Crypts (Zul'Aman 25,84), Gulf of Memory (Harandar 37,50), Grudge Pit (Harandar 70,65), Shadowguard Point (Voidstorm 37,49), Sunkiller Sanctum (Voidstorm 55,47), Parhelion Plaza (Quel'Danas 47,41). Run T8+ Bountiful with Coffer Keys. Zone events (Soiree, Abundance, Stormarion Assault, Legends of Haranir) also count.",
    },
    housing = {
        label   = "Vaeli (Neighborhood Postmaster)",
        zone    = "Razorwind Shores / Founder's Point",
        mapID   = 2351,
        x       = 0.528,
        y       = 0.596,
        howTo   = "Housing weekly 'Community Engagement' from Vaeli at Razorwind Shores (53, 60). OR pick 'Midnight: Housing' from Lady Liadrin as your weekly spark quest. Rewards upgrade crests.",
    },
}

-- World boss location lookup (for TomTom waypoints when boss is known)
WoWDashboard_WorldBosses = {
    { name = "Lu'ashal",    mapID = 2395, x = 0.452, y = 0.600 },  -- Eversong Woods
    { name = "Cragpine",    mapID = 2437, x = 0.450, y = 0.470 },  -- Zul'Aman
    { name = "Thorm'belan", mapID = 2413, x = 0.390, y = 0.670 },  -- Harandar
    { name = "Predaxas",    mapID = 2405, x = 0.495, y = 0.865 },  -- Voidstorm
}

-- ══════════════════════════════════════════
-- Task Definitions
-- ══════════════════════════════════════════
-- Each task defines:
--   id            - unique string key
--   category      - groups tasks in the UI (weekly, vault_dungeons, vault_raid, vault_world)
--   label         - display name
--   priority      - sort order (lower = more important)
--   maxCount      - total completions possible per week
--   manualToggle  - if true, player can right-click to toggle done
--   slotThresholds - vault slot unlock thresholds (vault tasks only)
--   checkDone()   - returns true if task is complete
--   getCount()    - returns current progress count
--   getStatusText() - returns optional inline status text
--   getMessage()  - returns guidance text for tooltip/next-up banner

local TASKS = {
    -- Priority 1: Spark Quest
    {
        id = "spark",
        category = "weekly",
        label = "Liadrin's Spark Quest",
        priority = 1,
        maxCount = 1,
        manualToggle = true,
        checkDone = function(d)
            return (d.sparkDone or 0) >= 1
                or (d.manualSpark or 0) >= 1
                or (d.sparkAccepted or 0) >= 1
        end,
        getCount = function(d)
            local isDone = (d.sparkDone or 0) >= 1
                or (d.manualSpark or 0) >= 1
                or (d.sparkAccepted or 0) >= 1
            return isDone and 1 or 0
        end,
        getStatusText = function(d)
            if (d.sparkAccepted or 0) >= 1 and (d.sparkDone or 0) < 1 then
                if (d.sparkProgressMax or 0) > 0 then
                    return string.format("%d/%d", d.sparkProgress or 0, d.sparkProgressMax)
                end
                return "IN PROGRESS"
            end
            return nil
        end,
        getMessage = function(d)
            -- If quest is accepted but not done, show progress + turn-in location
            if (d.sparkAccepted or 0) >= 1 and (d.sparkDone or 0) < 1 then
                local progressStr = ""
                if (d.sparkProgressMax or 0) > 0 then
                    local objText = (d.sparkObjectiveText and d.sparkObjectiveText ~= "")
                        and d.sparkObjectiveText
                        or string.format("%d/%d completed", d.sparkProgress or 0, d.sparkProgressMax)
                    progressStr = objText .. ". "
                end
                return progressStr .. "Complete objectives and turn in to Lady Liadrin (49, 64 Silvermoon) for your Apex Cache + Spark of Radiance."
            end
            -- Not yet picked up: show how-to
            return WoWDashboard_Locations.spark.howTo
        end,
    },

    -- Priority 2: World Boss
    {
        id = "worldboss",
        category = "weekly",
        label = "World Boss",
        priority = 2,
        maxCount = 1,
        manualToggle = true,
        checkDone = function(d)
            return (d.worldBossDone or 0) >= 1 or (d.manualWorldBoss or 0) >= 1
        end,
        getCount = function(d)
            return ((d.worldBossDone or 0) >= 1 or (d.manualWorldBoss or 0) >= 1) and 1 or 0
        end,
        getMessage = function(d)
            return WoWDashboard_Locations.worldboss.howTo
        end,
    },

    -- Priority 3: Prey Hunts (Nightmare)
    {
        id = "prey",
        category = "weekly",
        label = "Prey Hunts - Nightmare",
        priority = 3,
        maxCount = 3,
        manualToggle = true,
        checkDone = function(d)
            return math.max(d.preyDone or 0, d.manualPrey or 0) >= 3
        end,
        getCount = function(d)
            return math.min(math.max(d.preyDone or 0, d.manualPrey or 0), 3)
        end,
        getMessage = function(d)
            local done = math.max(d.preyDone or 0, d.manualPrey or 0)
            local remaining = 3 - done
            if remaining <= 0 then return "Nightmare Prey hunts complete!" end
            local loc = WoWDashboard_Locations.prey
            if done == 0 then
                return loc.howTo .. "\n\n|cffffd700How to unlock Nightmare:|r\n" .. loc.nightmareUnlock
            end
            return string.format(
                "Do Nightmare Prey Hunt #%d (%d remaining). ", done + 1, remaining
            ) .. loc.howTo .. "\n\n|cffffd700How to unlock Nightmare:|r\n" .. loc.nightmareUnlock
        end,
    },

    -- Priority 4: M+ Dungeons (Great Vault)
    {
        id = "mplus",
        category = "vault_dungeons",
        label = "M+ Dungeons",
        priority = 4,
        maxCount = 8,
        slotThresholds = {1, 4, 8},
        checkDone = function(d) return (d.vaultDungeons or 0) >= 8 end,
        getCount = function(d) return math.min(d.vaultDungeons or 0, 8) end,
        getMessage = function(d)
            local done = d.vaultDungeons or 0
            local thresholds = {1, 4, 8}
            for i, t in ipairs(thresholds) do
                if done < t then
                    local remaining = t - done
                    return string.format(
                        "Run M+ #%d -- %d more for vault slot %d! ", done + 1, remaining, i
                    ) .. WoWDashboard_Locations.mplus.howTo
                end
            end
            return "M+ vault maxed! Run more for higher ilvl options."
        end,
    },

    -- Priority 5: Raid Bosses (Great Vault)
    {
        id = "raid",
        category = "vault_raid",
        label = "Raid Bosses",
        priority = 5,
        maxCount = 6,
        slotThresholds = {2, 4, 6},
        checkDone = function(d) return (d.vaultRaid or 0) >= 6 end,
        getCount = function(d) return math.min(d.vaultRaid or 0, 6) end,
        getMessage = function(d)
            local done = d.vaultRaid or 0
            local thresholds = {2, 4, 6}
            for i, t in ipairs(thresholds) do
                if done < t then
                    local remaining = t - done
                    return string.format(
                        "Kill raid boss #%d -- %d more for vault slot %d. ", done + 1, remaining, i
                    ) .. WoWDashboard_Locations.raid.howTo
                end
            end
            return "Raid vault maxed!"
        end,
    },

    -- Priority 6: World Activities (Great Vault)
    {
        id = "world",
        category = "vault_world",
        label = "World Activities",
        priority = 6,
        maxCount = 8,
        slotThresholds = {2, 4, 8},
        checkDone = function(d) return (d.vaultWorld or 0) >= 8 end,
        getCount = function(d) return math.min(d.vaultWorld or 0, 8) end,
        getMessage = function(d)
            local done = d.vaultWorld or 0
            local thresholds = {2, 4, 8}
            for i, t in ipairs(thresholds) do
                if done < t then
                    local remaining = t - done
                    return string.format(
                        "Do world activity #%d -- %d more for vault slot %d. ", done + 1, remaining, i
                    ) .. WoWDashboard_Locations.world.howTo
                end
            end
            return "World vault maxed!"
        end,
    },

    -- Priority 7: Housing Weekly
    {
        id = "housing",
        category = "weekly",
        label = "Housing Weekly",
        priority = 7,
        maxCount = 1,
        manualToggle = true,
        checkDone = function(d)
            return (d.housingDone or 0) >= 1 or (d.manualHousing or 0) >= 1
        end,
        getCount = function(d)
            return ((d.housingDone or 0) >= 1 or (d.manualHousing or 0) >= 1) and 1 or 0
        end,
        getMessage = function(d)
            return WoWDashboard_Locations.housing.howTo
        end,
    },
}

-- ══════════════════════════════════════════
-- Navigation: Set TomTom / Blizzard Waypoint
-- ══════════════════════════════════════════

function WoWDashboard_Navigate(taskId)
    local loc = WoWDashboard_Locations[taskId]
    if not loc then
        print("|cff00ccff[WoW Dashboard]|r No location data for: " .. taskId)
        return
    end

    -- Tasks without fixed coordinates (M+, world boss rotation, etc.)
    if not loc.mapID or not loc.x or not loc.y then
        print("|cffffd700[Navigate]|r " .. loc.label .. " -- " .. loc.zone)
        print("|cff7ec8e3[How To]|r " .. loc.howTo)
        return
    end

    -- Try TomTom first (popular waypoint addon)
    if TomTom and TomTom.AddWaypoint then
        local opts = {
            title = loc.label,
            persistent = false,
            minimap = true,
            world = true,
            from = "WoWDashboard",
        }
        pcall(function()
            TomTom:AddWaypoint(loc.mapID, loc.x, loc.y, opts)
        end)
        print("|cff00ccff[WoW Dashboard]|r TomTom waypoint set: |cffffd700" .. loc.label .. "|r in " .. loc.zone)
    else
        -- Fallback: Blizzard built-in waypoint + map pin
        local ok = pcall(function()
            C_Map.SetUserWaypoint(UiMapPoint.CreateFromCoordinates(loc.mapID, loc.x, loc.y))
            C_SuperTrack.SetSuperTrackedUserWaypoint(true)
        end)
        if ok then
            print("|cff00ccff[WoW Dashboard]|r Waypoint set: |cffffd700" .. loc.label .. "|r in " .. loc.zone)
        end
    end

    print("|cff7ec8e3[How To]|r " .. loc.howTo)
end

-- ══════════════════════════════════════════
-- Manual Toggle (for tasks auto-detection missed)
-- ══════════════════════════════════════════

function WoWDashboard_ManualToggle(taskId)
    local key = WoWDashboard_PlayerKey
    if not key or not WoWDashboardDB[key] then return end
    local data = WoWDashboardDB[key]

    if taskId == "worldboss" then
        data.manualWorldBoss = (data.manualWorldBoss == 1) and 0 or 1
        local state = data.manualWorldBoss == 1 and "DONE" or "not done"
        print("|cff00ccff[WoW Dashboard]|r World Boss marked as |cffffd700" .. state .. "|r")

    elseif taskId == "spark" then
        data.manualSpark = (data.manualSpark == 1) and 0 or 1
        local state = data.manualSpark == 1 and "DONE" or "not done"
        print("|cff00ccff[WoW Dashboard]|r Spark Quest marked as |cffffd700" .. state .. "|r")

    elseif taskId == "prey" then
        local current = data.manualPrey or 0
        current = current + 1
        if current > 3 then current = 0 end
        data.manualPrey = current
        print("|cff00ccff[WoW Dashboard]|r Prey Hunts set to |cffffd700" .. current .. "/3|r")

    elseif taskId == "housing" then
        data.manualHousing = (data.manualHousing == 1) and 0 or 1
        local state = data.manualHousing == 1 and "DONE" or "not done"
        print("|cff00ccff[WoW Dashboard]|r Housing Weekly marked as |cffffd700" .. state .. "|r")
    end

    -- Refresh UI immediately
    if WoWDashboard_OnDataUpdate then
        WoWDashboard_OnDataUpdate(key)
    end
end

-- ══════════════════════════════════════════
-- Priority Computation
-- ══════════════════════════════════════════
-- Returns two values:
--   results   - ordered list of all task entries with status
--   nextAction - the first incomplete task (highest priority)

function WoWDashboard_GetPriorities(charKey)
    local data = WoWDashboardDB and WoWDashboardDB[charKey]
    if not data or (data.level or 0) < 90 then
        return nil, nil
    end

    local results = {}
    local nextAction = nil

    for _, task in ipairs(TASKS) do
        local done = task.checkDone(data)
        local count = task.getCount(data)
        local message = task.getMessage(data)
        local loc = WoWDashboard_Locations[task.id]
        local statusText = task.getStatusText and task.getStatusText(data) or nil

        local entry = {
            id             = task.id,
            category       = task.category,
            label          = task.label,
            priority       = task.priority,
            done           = done,
            count          = count,
            maxCount       = task.maxCount,
            message        = message,
            statusText     = statusText,
            slotThresholds = task.slotThresholds,
            manualToggle   = task.manualToggle or false,
            hasWaypoint    = loc and loc.mapID and true or false,
            locationLabel  = loc and loc.label or "",
            locationZone   = loc and loc.zone or "",
            howTo          = loc and loc.howTo or "",
        }

        table.insert(results, entry)

        -- First incomplete task becomes the "next action"
        if not done and not nextAction then
            nextAction = entry
        end
    end

    -- Merge server-generated advice (from WoWDashboard_Advice.lua) if available
    if WoWDashboard_AdviceData and WoWDashboard_AdviceData[charKey] then
        local advice = WoWDashboard_AdviceData[charKey]
        if advice.nextUp and nextAction then
            nextAction.serverAdvice = advice.nextUp
        end
        if advice.tips then
            for _, entry in ipairs(results) do
                if advice.tips[entry.id] then
                    entry.serverTip = advice.tips[entry.id]
                end
            end
        end
    end

    return results, nextAction
end

-- Returns aggregate progress across all tasks (for progress bar)
function WoWDashboard_GetTotalProgress(charKey)
    local results, _ = WoWDashboard_GetPriorities(charKey)
    if not results then return 0, 0 end
    local total = 0
    local done = 0
    for _, entry in ipairs(results) do
        total = total + entry.maxCount
        done = done + entry.count
    end
    return done, total
end
