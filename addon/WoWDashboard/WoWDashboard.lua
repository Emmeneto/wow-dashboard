-- ============================================================================
-- WoWDashboard.lua - Core Data Collection Module
-- ============================================================================
-- Collects character data, weekly progress, vault status, and quest info.
-- Stores everything in WoWDashboardDB (SavedVariables) for the web dashboard
-- and the in-game tracker UI to consume.
--
-- Data flow: Game Events -> UpdateCharacterData() -> WoWDashboardDB -> UI callback
-- Debug data is collected every update and stored at WoWDashboardDB._debug
-- for the server's /api/debug endpoint to parse.
-- ============================================================================

WoWDashboardDB = WoWDashboardDB or {}
WoWDashboard_PlayerKey = nil       -- set on login, used by Priority + UI modules
WoWDashboard_OnDataUpdate = nil    -- callback set by UI module for real-time refresh

-- ── Event Frame ──

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_MONEY")
frame:RegisterEvent("PLAYER_EQUIPMENT_CHANGED")
frame:RegisterEvent("PLAYER_AVG_ITEM_LEVEL_UPDATE")
frame:RegisterEvent("TIME_PLAYED_MSG")
frame:RegisterEvent("ZONE_CHANGED_NEW_AREA")
frame:RegisterEvent("BAG_UPDATE")
frame:RegisterEvent("CHALLENGE_MODE_COMPLETED")
frame:RegisterEvent("WEEKLY_REWARDS_UPDATE")
frame:RegisterEvent("BOSS_KILL")
frame:RegisterEvent("QUEST_TURNED_IN")

local playedTotal = 0
local playedLevel = 0

-- ── Helper Functions ──

local function GetBagInfo()
    local totalSlots = 0
    local freeSlots = 0
    for bag = 0, 4 do
        totalSlots = totalSlots + C_Container.GetContainerNumSlots(bag)
        freeSlots = freeSlots + C_Container.GetContainerNumFreeSlots(bag)
    end
    return totalSlots, freeSlots
end

local function GetMountCount()
    local ok, mountIDs = pcall(C_MountJournal.GetMountIDs)
    if not ok or not mountIDs then return 0, 0 end
    local collected = 0
    for _, id in ipairs(mountIDs) do
        local _, _, _, _, _, _, _, _, _, _, isCollected = C_MountJournal.GetMountInfoByID(id)
        if isCollected then collected = collected + 1 end
    end
    return collected, #mountIDs
end

local function GetPetCount()
    local ok, numPets, numOwned = pcall(C_PetJournal.GetNumPets)
    if not ok then return 0 end
    return numOwned or 0
end

-- ── Weekly Progress: Great Vault ──

local function GetVaultProgress()
    local progress = {
        dungeonCount = 0,
        dungeonMax = 8,
        raidCount = 0,
        raidMax = 6,
        worldCount = 0,
        worldMax = 8,
    }

    -- Midnight changed the vault enum names from TWW!
    -- Old (TWW):      MythicPlus=1, Raid=2, World=3
    -- New (Midnight):  Activities=1, RankedPvP=2, Raid=3,
    --                  AlsoReceive=4, Concession=5, World=6
    -- We use the Midnight enum names with numeric fallbacks for safety.
    if C_WeeklyRewards and C_WeeklyRewards.GetActivities then
        local ENUM = Enum.WeeklyRewardChestThresholdType

        -- Dungeon row: "Activities" in Midnight (was "MythicPlus" in TWW)
        local dungeonEnum = ENUM.Activities or ENUM.MythicPlus or 1
        local ok1, dungeonActivities = pcall(C_WeeklyRewards.GetActivities, dungeonEnum)
        if ok1 and dungeonActivities then
            for _, activity in ipairs(dungeonActivities) do
                if activity.progress and activity.progress > progress.dungeonCount then
                    progress.dungeonCount = activity.progress
                end
            end
        end

        -- Raid row: enum 3 in Midnight (was 2 in TWW)
        local raidEnum = ENUM.Raid or 3
        local ok2, raidActivities = pcall(C_WeeklyRewards.GetActivities, raidEnum)
        if ok2 and raidActivities then
            for _, activity in ipairs(raidActivities) do
                if activity.progress and activity.progress > progress.raidCount then
                    progress.raidCount = activity.progress
                end
            end
        end

        -- World row: enum 6 in Midnight (was 3 in TWW)
        local worldEnum = ENUM.World or 6
        local ok3, worldActivities = pcall(C_WeeklyRewards.GetActivities, worldEnum)
        if ok3 and worldActivities then
            for _, activity in ipairs(worldActivities) do
                if activity.progress and activity.progress > progress.worldCount then
                    progress.worldCount = activity.progress
                end
            end
        end
    end

    return progress
end

-- ── Debug Data Collection ──
-- Dumps raw vault enums, vault slot data, and spark quest info
-- into SavedVariables so the server can read and parse it.
-- Runs every UpdateCharacterData call for always-current data.

local function CollectDebugData()
    local debug = {
        _debugVersion = 2,  -- bump when format changes so server knows what to expect
        timestamp = date("%Y-%m-%d %H:%M:%S"),
        vaultEnums = {},
        vaultRawData = {},
        sparkQuests = {},
    }

    -- Dump all vault enum name->value mappings
    if Enum and Enum.WeeklyRewardChestThresholdType then
        for k, v in pairs(Enum.WeeklyRewardChestThresholdType) do
            debug.vaultEnums[tostring(k)] = tostring(v)
        end
    end

    -- Dump raw vault data for enum values 0-10 (extended range to catch
    -- all Midnight enums: Activities=1, RankedPvP=2, Raid=3,
    -- AlsoReceive=4, Concession=5, World=6, and any future additions)
    for enumVal = 0, 10 do
        local ok, activities = pcall(C_WeeklyRewards.GetActivities, enumVal)
        if ok and activities and #activities > 0 then
            local slotData = {}
            for i, a in ipairs(activities) do
                local entry = {}
                for field, val in pairs(a) do
                    entry[tostring(field)] = tostring(val)
                end
                slotData["slot" .. i] = entry
            end
            debug.vaultRawData["enum" .. enumVal] = slotData
        end
    end

    -- Dump spark quest data from quest log (matches "midnight:" and "prey:" titles)
    if C_QuestLog then
        local numEntries = C_QuestLog.GetNumQuestLogEntries() or 0
        for i = 1, numEntries do
            local questInfo = C_QuestLog.GetInfo(i)
            if questInfo and not questInfo.isHeader then
                local lTitle = (questInfo.title or ""):lower()
                if lTitle:find("midnight:") or lTitle:find("prey:") then
                    local questEntry = {
                        title = questInfo.title or "",
                        questID = questInfo.questID or 0,
                        isComplete = questInfo.isComplete and "true" or "false",
                    }

                    -- Get objectives via C_QuestLog API
                    if questInfo.questID then
                        local ok2, objectives = pcall(C_QuestLog.GetQuestObjectives, questInfo.questID)
                        if ok2 and objectives then
                            questEntry.objectiveCount = #objectives
                            for j, obj in ipairs(objectives) do
                                questEntry["obj" .. j .. "_text"] = obj.text or ""
                                questEntry["obj" .. j .. "_fulfilled"] = tostring(obj.numFulfilled or 0)
                                questEntry["obj" .. j .. "_required"] = tostring(obj.numRequired or 0)
                                questEntry["obj" .. j .. "_finished"] = tostring(obj.finished or false)
                                questEntry["obj" .. j .. "_type"] = tostring(obj.type or "")
                            end
                        else
                            questEntry.objectivesError = "GetQuestObjectives failed"
                        end

                        -- Also try older LeaderBoard API for cross-reference
                        local logIndex = C_QuestLog.GetLogIndexForQuestID(questInfo.questID)
                        if logIndex then
                            questEntry.logIndex = logIndex
                            local numObj = GetNumQuestLeaderBoards(logIndex)
                            questEntry.leaderBoardCount = numObj or 0
                            if numObj and numObj > 0 then
                                for j = 1, numObj do
                                    local text, objType, finished = GetQuestLogLeaderBoard(j, logIndex)
                                    questEntry["lb" .. j .. "_text"] = text or ""
                                    questEntry["lb" .. j .. "_type"] = objType or ""
                                    questEntry["lb" .. j .. "_finished"] = tostring(finished or false)
                                end
                            end
                        end
                    end

                    table.insert(debug.sparkQuests, questEntry)
                end
            end
        end
    end

    return debug
end

-- ── Weekly Progress: M+ and Raid ──

local function GetMythicPlusRuns()
    local count = 0
    if C_MythicPlus and C_MythicPlus.GetRunHistory then
        local ok, runs = pcall(C_MythicPlus.GetRunHistory, false, true)
        if ok and runs then
            count = #runs
        end
    end
    return count
end

local function GetRaidLockouts()
    local bossesKilled = 0
    local numInstances = GetNumSavedInstances() or 0
    for i = 1, numInstances do
        local _, _, _, _, locked, _, _, isRaid, _, _, numBosses, numDefeated = GetSavedInstanceInfo(i)
        if isRaid and locked then
            bossesKilled = bossesKilled + (numDefeated or 0)
        end
    end
    return bossesKilled
end

-- ── Weekly Progress: Quest Detection ──

-- All 13 confirmed Liadrin spark quest IDs (from Wowhead):
--   93766 = Midnight: World Quests
--   93767 = Midnight: Arcantina
--   93769 = Midnight: Housing
--   93889 = Midnight: Saltheril's Soiree
--   93890 = Midnight: Abundance
--   93891 = Midnight: Legends of the Haranir
--   93892 = Midnight: Stormarion Assault
--   93909 = Midnight: Delves
--   93910 = Midnight: Prey
--   93911 = Midnight: Dungeons
--   93912 = Midnight: Raid
--   93913 = Midnight: World Boss
--   94457 = Midnight: Battlegrounds
-- All match "midnight:" keyword. Quest ID range: 93766-94457.
-- "Midnight: World Tour" (95245) also matches "midnight:" but is NOT a
-- Liadrin weekly, so we filter by quest ID for spark progress tracking.

local SPARK_KEYWORDS    = { "midnight:", "spark of radiance", "apex cache" }
local PREY_KEYWORDS     = { "prey:" }      -- "Prey: [Target Name]" -- colon distinguishes from "Midnight: Prey"
local HOUSING_KEYWORDS  = { "community engagement", "vaeli" }
local WORLDBOSS_KEYWORDS = { "lu'ashal", "cragpine", "thorm'belan", "predaxas" }

-- All known Liadrin weekly quest IDs for IsQuestFlaggedCompleted checks
-- (detects turned-in quests that are no longer in the quest log)
local LIADRIN_QUEST_IDS = {
    93766, 93767, 93769, 93889, 93890, 93891,
    93892, 93909, 93910, 93911, 93912, 93913, 94457,
}

local function MatchesAny(text, keywords)
    for _, kw in ipairs(keywords) do
        if text:find(kw) then return true end
    end
    return false
end

local function GetWeeklyQuestStatus()
    local status = {
        sparkQuest = false,
        sparkAccepted = false,      -- in quest log, not yet complete
        sparkObjectiveText = "",
        sparkProgress = 0,
        sparkProgressMax = 0,
        worldBoss = false,
        housingWeekly = false,
        housingAccepted = false,
        preyCount = 0,
        preyAccepted = 0,
    }

    if not C_QuestLog then return status end

    local numEntries = C_QuestLog.GetNumQuestLogEntries() or 0
    for i = 1, numEntries do
        local questInfo = C_QuestLog.GetInfo(i)
        if questInfo and not questInfo.isHeader then
            local title = questInfo.title or ""
            local lTitle = title:lower()

            -- Spark quest: Liadrin's weekly (e.g. "Midnight: Prey")
            -- Check spark FIRST: if it matches spark, do NOT also count as prey hunt
            local isSpark = MatchesAny(lTitle, SPARK_KEYWORDS)

            if isSpark then
                status.sparkAccepted = true
                if questInfo.isComplete then
                    status.sparkQuest = true
                end

                -- Grab objective progress ONLY from actual Liadrin weeklies
                -- (quest IDs 93766-94457), NOT from "Midnight: World Tour" (95245)
                local qid = questInfo.questID or 0
                local isLiadrinWeekly = (qid >= 93766 and qid <= 94457)

                if isLiadrinWeekly and status.sparkProgressMax == 0 then
                    local ok, objectives = pcall(C_QuestLog.GetQuestObjectives, qid)
                    if ok and objectives and #objectives > 0 then
                        status.sparkObjectiveText = objectives[1].text or ""
                        status.sparkProgress = objectives[1].numFulfilled or 0
                        status.sparkProgressMax = objectives[1].numRequired or 0
                    end
                end
            end

            -- Prey hunt: only if NOT already matched as spark quest
            if not isSpark and MatchesAny(lTitle, PREY_KEYWORDS) then
                status.preyAccepted = status.preyAccepted + 1
                if questInfo.isComplete then
                    status.preyCount = status.preyCount + 1
                end
            end

            -- Housing weekly
            if MatchesAny(lTitle, HOUSING_KEYWORDS) then
                status.housingAccepted = true
                if questInfo.isComplete then
                    status.housingWeekly = true
                end
            end

            -- World boss quest
            if MatchesAny(lTitle, WORLDBOSS_KEYWORDS) then
                status.worldBoss = true
            end
        end
    end

    -- Check for TURNED-IN spark quests (no longer in quest log)
    -- IsQuestFlaggedCompleted returns true if the quest was completed this reset period
    if not status.sparkQuest and C_QuestLog.IsQuestFlaggedCompleted then
        for _, qid in ipairs(LIADRIN_QUEST_IDS) do
            local ok, completed = pcall(C_QuestLog.IsQuestFlaggedCompleted, qid)
            if ok and completed then
                status.sparkQuest = true
                status.sparkAccepted = true
                -- Quest is done, set progress to max
                status.sparkProgress = 1
                status.sparkProgressMax = 1
                status.sparkObjectiveText = "Completed"
                break
            end
        end
    end

    return status
end

-- ── Per-Slot Gear Scanning ──

local GEAR_SLOTS = {
    {id = 1,  name = "Head"},
    {id = 2,  name = "Neck"},
    {id = 3,  name = "Shoulder"},
    {id = 5,  name = "Chest"},
    {id = 6,  name = "Waist"},
    {id = 7,  name = "Legs"},
    {id = 8,  name = "Feet"},
    {id = 9,  name = "Wrist"},
    {id = 10, name = "Hands"},
    {id = 11, name = "Ring1"},
    {id = 12, name = "Ring2"},
    {id = 13, name = "Trinket1"},
    {id = 14, name = "Trinket2"},
    {id = 15, name = "Back"},
    {id = 16, name = "MainHand"},
    {id = 17, name = "OffHand"},
}

local function ScanEquippedGear()
    local gear = {}
    for _, slot in ipairs(GEAR_SLOTS) do
        local itemLink = GetInventoryItemLink("player", slot.id)
        if itemLink then
            local itemName, _, itemQuality = C_Item.GetItemInfo(itemLink)
            local itemID = GetInventoryItemID("player", slot.id)
            local ilvl = 0
            local ok, detailedIlvl = pcall(C_Item.GetDetailedItemLevelInfo, itemLink)
            if ok and detailedIlvl then ilvl = detailedIlvl end

            -- Extract enchant ID from item link (format: item:ID:enchantID:...)
            local enchantID = 0
            local linkParts = {strsplit(":", itemLink)}
            if linkParts[3] then
                enchantID = tonumber(linkParts[3]) or 0
            end

            -- Store as flat keys for the Lua parser
            gear["gear_" .. slot.id .. "_name"] = itemName or ""
            gear["gear_" .. slot.id .. "_ilvl"] = ilvl
            gear["gear_" .. slot.id .. "_itemID"] = itemID or 0
            gear["gear_" .. slot.id .. "_quality"] = itemQuality or 0
            gear["gear_" .. slot.id .. "_enchant"] = enchantID
        else
            gear["gear_" .. slot.id .. "_name"] = ""
            gear["gear_" .. slot.id .. "_ilvl"] = 0
            gear["gear_" .. slot.id .. "_itemID"] = 0
            gear["gear_" .. slot.id .. "_quality"] = 0
            gear["gear_" .. slot.id .. "_enchant"] = 0
        end
    end
    return gear
end

-- ── Main Data Update ──
-- Called on every tracked event. Collects all character data,
-- stores it in WoWDashboardDB, and notifies the UI to refresh.

local function UpdateCharacterData()
    local name = UnitName("player")
    local realm = GetRealmName()
    local key = name .. "-" .. realm
    WoWDashboard_PlayerKey = key

    -- Character identity
    local _, classLocalized, classID = UnitClass("player")
    local level = UnitLevel("player")
    local specIndex = GetSpecialization()
    local specName = "None"
    if specIndex then
        local _, sName = GetSpecializationInfo(specIndex)
        specName = sName or "None"
    end

    -- Gear and gold
    local _, avgIlvlEquipped = GetAverageItemLevel()
    local gold = GetMoney()

    -- Guild info
    local guildName, guildRank = GetGuildInfo("player")

    -- Location
    local zone = GetRealZoneText() or GetZoneText() or "Unknown"
    local subZone = GetSubZoneText() or ""

    -- Bag space
    local totalSlots, freeSlots = GetBagInfo()

    -- Rested XP (percentage of level)
    local restedXP = GetXPExhaustion() or 0
    local maxXP = UnitXPMax("player") or 1
    local restedPct = 0
    if maxXP > 0 and restedXP > 0 then
        restedPct = math.floor(restedXP / maxXP * 100)
    end

    -- Collections
    local mountsCollected, mountsTotal = GetMountCount()
    local petsOwned = GetPetCount()

    -- Professions
    local p1, p2 = GetProfessions()
    local prof1Name, prof1Rank, prof1Max = "", 0, 0
    local prof2Name, prof2Rank, prof2Max = "", 0, 0
    if p1 then
        local pName, _, pRank, pMax = GetProfessionInfo(p1)
        prof1Name = pName or ""
        prof1Rank = pRank or 0
        prof1Max = pMax or 0
    end
    if p2 then
        local pName, _, pRank, pMax = GetProfessionInfo(p2)
        prof2Name = pName or ""
        prof2Rank = pRank or 0
        prof2Max = pMax or 0
    end

    -- Weekly progress (only tracked for max-level characters)
    local vaultDungeons = 0
    local vaultRaid = 0
    local vaultWorld = 0
    local mplusRuns = 0
    local raidBossesKilled = 0
    local sparkDone = 0
    local worldBossDone = 0
    local preyDone = 0
    local housingDone = 0
    local sparkAccepted = 0
    local sparkObjectiveText = ""
    local sparkProgress = 0
    local sparkProgressMax = 0
    local housingAccepted = 0
    local preyAccepted = 0

    -- Capture existing data BEFORE overwrite so we can preserve manual toggles
    local existing = WoWDashboardDB[key]

    if level >= 90 then
        -- Great Vault progress (sole source of truth for vault counts)
        local vault = GetVaultProgress()
        vaultDungeons = vault.dungeonCount
        vaultRaid = vault.raidCount
        vaultWorld = vault.worldCount

        -- Collect debug data and store at top level of DB
        local ok, debugData = pcall(CollectDebugData)
        if ok and debugData then
            WoWDashboardDB._debug = debugData
        end

        -- M+ run count and raid lockouts (stored separately, never override vault)
        mplusRuns = GetMythicPlusRuns()
        raidBossesKilled = GetRaidLockouts()

        -- Quest-based weeklies
        local quests = GetWeeklyQuestStatus()
        sparkDone = quests.sparkQuest and 1 or 0
        sparkAccepted = quests.sparkAccepted and 1 or 0
        sparkObjectiveText = quests.sparkObjectiveText or ""
        sparkProgress = quests.sparkProgress or 0
        sparkProgressMax = quests.sparkProgressMax or 0
        housingDone = quests.housingWeekly and 1 or 0
        housingAccepted = quests.housingAccepted and 1 or 0
        preyDone = quests.preyCount           -- only COMPLETED prey hunts
        preyAccepted = quests.preyAccepted    -- in-progress ones (not counted as done)

        -- World boss from quest log detection
        if quests.worldBoss then
            worldBossDone = 1
        end

        -- Preserve manual toggles and previous BOSS_KILL tracking from existing data
        if existing then
            if existing.worldBossDone and existing.worldBossDone > 0 then
                worldBossDone = existing.worldBossDone
            end
            if existing.manualWorldBoss and existing.manualWorldBoss > 0 then
                worldBossDone = 1
            end
            if existing.manualSpark then sparkDone = math.max(sparkDone, existing.manualSpark) end
            if existing.manualPrey then preyDone = math.max(preyDone, existing.manualPrey) end
            if existing.manualHousing then housingDone = math.max(housingDone, existing.manualHousing) end
        end
    end

    -- Write full character record to SavedVariables
    WoWDashboardDB[key] = {
        -- Identity
        name = name,
        realm = realm,
        level = level,
        class = classLocalized,
        classID = classID,
        spec = specName,
        ilvl = math.floor(avgIlvlEquipped * 10) / 10,
        -- Currency
        gold = math.floor(gold / 10000),
        silver = math.floor((gold % 10000) / 100),
        copper = gold % 100,
        -- Guild
        guildName = guildName or "",
        guildRank = guildRank or "",
        -- Location
        zone = zone,
        subZone = subZone,
        -- Playtime
        playedTotal = playedTotal,
        playedLevel = playedLevel,
        -- Bags
        totalBagSlots = totalSlots,
        freeBagSlots = freeSlots,
        -- Rest
        restedPct = restedPct,
        -- Collections
        mountsCollected = mountsCollected,
        mountsTotal = mountsTotal,
        petsOwned = petsOwned,
        -- Professions
        prof1Name = prof1Name,
        prof1Rank = prof1Rank,
        prof1Max = prof1Max,
        prof2Name = prof2Name,
        prof2Rank = prof2Rank,
        prof2Max = prof2Max,
        -- Weekly: Great Vault
        vaultDungeons = vaultDungeons,
        vaultRaid = vaultRaid,
        vaultWorld = vaultWorld,
        mplusRuns = mplusRuns,
        raidBossesKilled = raidBossesKilled,
        -- Weekly: Quests
        sparkDone = sparkDone,
        sparkAccepted = sparkAccepted,
        sparkObjectiveText = sparkObjectiveText,
        sparkProgress = sparkProgress,
        sparkProgressMax = sparkProgressMax,
        worldBossDone = worldBossDone,
        preyDone = preyDone,
        preyAccepted = preyAccepted,
        housingDone = housingDone,
        housingAccepted = housingAccepted,
        -- Manual toggles (preserved across updates)
        manualSpark = (existing and existing.manualSpark) or nil,
        manualWorldBoss = (existing and existing.manualWorldBoss) or nil,
        manualPrey = (existing and existing.manualPrey) or nil,
        manualHousing = (existing and existing.manualHousing) or nil,
        -- Metadata
        lastUpdated = date("%Y-%m-%d %H:%M:%S"),
    }

    -- Merge gear data into character entry
    local gearData = ScanEquippedGear()
    for k, v in pairs(gearData) do
        WoWDashboardDB[key][k] = v
    end

    -- Notify UI module to refresh in real-time
    if WoWDashboard_OnDataUpdate then
        WoWDashboard_OnDataUpdate(key)
    end
end

-- ── Event Handler ──

frame:SetScript("OnEvent", function(self, event, ...)
    if event == "PLAYER_LOGIN" then
        RequestTimePlayed()
        C_Timer.After(3, UpdateCharacterData)
        -- Request vault data refresh after initial load
        if C_WeeklyRewards and C_WeeklyRewards.CanClaimRewards then
            C_Timer.After(5, function()
                UpdateCharacterData()
            end)
        end
        print("|cff00ccff[WoW Dashboard]|r Character data tracked!")

    elseif event == "TIME_PLAYED_MSG" then
        playedTotal, playedLevel = ...
        UpdateCharacterData()

    elseif event == "ZONE_CHANGED_NEW_AREA" then
        C_Timer.After(1, UpdateCharacterData)

    elseif event == "CHALLENGE_MODE_COMPLETED" then
        C_Timer.After(2, UpdateCharacterData)
        print("|cff00ccff[WoW Dashboard]|r M+ complete! Tracker updated.")

    elseif event == "BOSS_KILL" then
        local _, bossName = ...
        -- Detect world boss kills (outdoor, no instance)
        local _, instanceType = GetInstanceInfo()
        if instanceType == "none" then
            local name = UnitName("player")
            local realm = GetRealmName()
            local key = name .. "-" .. realm
            if WoWDashboardDB[key] then
                WoWDashboardDB[key].worldBossDone = 1
            end
        end
        C_Timer.After(2, UpdateCharacterData)
        print("|cff00ccff[WoW Dashboard]|r Boss kill tracked!")

    elseif event == "WEEKLY_REWARDS_UPDATE" then
        C_Timer.After(1, UpdateCharacterData)

    elseif event == "QUEST_TURNED_IN" then
        C_Timer.After(1, UpdateCharacterData)

    else
        -- PLAYER_MONEY, PLAYER_EQUIPMENT_CHANGED, PLAYER_AVG_ITEM_LEVEL_UPDATE, BAG_UPDATE
        UpdateCharacterData()
    end
end)
