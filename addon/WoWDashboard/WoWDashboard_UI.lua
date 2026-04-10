-- ============================================================================
-- WoWDashboard_UI.lua - In-Game Tracker Frame
-- ============================================================================
-- Creates a draggable, minimizable frame showing weekly task progress.
-- Features: NEXT UP banner, progress bar, section collapse, minimap button,
-- TomTom/waypoint integration, manual toggles, and debug slash commands.
--
-- UI Layout (top to bottom):
--   Title bar with minimize/close buttons
--   NEXT UP banner (clickable for waypoint)
--   Overall progress bar
--   Task sections: Weekly Must-Dos, Vault: M+, Vault: Raid, Vault: World
-- ============================================================================

local FRAME_WIDTH = 280

-- Section color scheme
local SECTION_COLORS = {
    weekly         = { r = 0.95, g = 0.77, b = 0.06 },  -- gold
    vault_dungeons = { r = 0.25, g = 0.78, b = 0.92 },  -- cyan
    vault_raid     = { r = 0.91, g = 0.30, b = 0.24 },  -- red
    vault_world    = { r = 0.18, g = 0.80, b = 0.44 },  -- green
}

-- Display order of sections in the tracker
local SECTION_ORDER = {
    { key = "weekly",         title = "WEEKLY MUST-DOS" },
    { key = "vault_dungeons", title = "GREAT VAULT: M+ DUNGEONS" },
    { key = "vault_raid",     title = "GREAT VAULT: RAID" },
    { key = "vault_world",    title = "GREAT VAULT: WORLD" },
}

local isMinimized = false
local sections = {}
local taskRows = {}

-- ══════════════════════════════════════════
-- Main Frame
-- ══════════════════════════════════════════

local TrackerFrame = CreateFrame("Frame", "WoWDashboardTracker", UIParent, "BackdropTemplate")
TrackerFrame:SetSize(FRAME_WIDTH, 400)
TrackerFrame:SetPoint("RIGHT", UIParent, "RIGHT", -20, 0)
TrackerFrame:SetBackdrop({
    bgFile = "Interface\\Buttons\\WHITE8x8",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
    edgeSize = 14,
    insets = { left = 3, right = 3, top = 3, bottom = 3 },
})
TrackerFrame:SetBackdropColor(0.06, 0.04, 0.08, 0.95)
TrackerFrame:SetBackdropBorderColor(0.25, 0.20, 0.15, 0.8)
TrackerFrame:SetMovable(true)
TrackerFrame:EnableMouse(true)
TrackerFrame:RegisterForDrag("LeftButton")
TrackerFrame:SetClampedToScreen(true)
TrackerFrame:SetFrameStrata("MEDIUM")
TrackerFrame:Hide()  -- hidden until PLAYER_LOGIN fires

-- Gold accent line at top of frame
local topAccent = TrackerFrame:CreateTexture(nil, "ARTWORK")
topAccent:SetHeight(2)
topAccent:SetPoint("TOPLEFT", TrackerFrame, "TOPLEFT", 4, -2)
topAccent:SetPoint("TOPRIGHT", TrackerFrame, "TOPRIGHT", -4, -2)
topAccent:SetColorTexture(1, 0.84, 0, 0.6)

-- Drag to reposition, save position to SavedVariables
TrackerFrame:SetScript("OnDragStart", TrackerFrame.StartMoving)
TrackerFrame:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    local point, _, relPoint, x, y = self:GetPoint()
    WoWDashboardDB._framePosition = { point, relPoint, x, y }
end)

-- ══════════════════════════════════════════
-- Title Bar
-- ══════════════════════════════════════════

local titleBar = CreateFrame("Frame", nil, TrackerFrame)
titleBar:SetHeight(24)
titleBar:SetPoint("TOPLEFT", TrackerFrame, "TOPLEFT", 6, -6)
titleBar:SetPoint("TOPRIGHT", TrackerFrame, "TOPRIGHT", -6, -6)

local titleText = titleBar:CreateFontString(nil, "OVERLAY", "GameFontNormal")
titleText:SetPoint("LEFT", 4, 0)
titleText:SetText("|cffffd700WoW Dashboard|r")

-- Minimize button (collapse to banner only)
local minimizeBtn = CreateFrame("Button", nil, titleBar)
minimizeBtn:SetSize(16, 16)
minimizeBtn:SetPoint("RIGHT", titleBar, "RIGHT", -24, 0)
minimizeBtn:SetNormalTexture("Interface\\Buttons\\UI-Panel-CollapseButton-Up")
minimizeBtn:SetHighlightTexture("Interface\\Buttons\\UI-Panel-MinimizeButton-Highlight")
minimizeBtn:SetScript("OnClick", function()
    isMinimized = not isMinimized
    WoWDashboard_RelayoutTracker()
end)

-- Close button
local closeBtn = CreateFrame("Button", nil, titleBar, "UIPanelCloseButton")
closeBtn:SetSize(20, 20)
closeBtn:SetPoint("RIGHT", titleBar, "RIGHT", 2, 0)
closeBtn:SetScript("OnClick", function() TrackerFrame:Hide() end)

-- ══════════════════════════════════════════
-- "NEXT UP" Banner
-- ══════════════════════════════════════════

local currentNextId = nil  -- tracks current next task ID for click navigation

local nextUpFrame = CreateFrame("Button", nil, TrackerFrame, "BackdropTemplate")
nextUpFrame:SetHeight(48)
nextUpFrame:SetPoint("TOPLEFT", titleBar, "BOTTOMLEFT", 0, -4)
nextUpFrame:SetPoint("TOPRIGHT", titleBar, "BOTTOMRIGHT", 0, -4)
nextUpFrame:SetBackdrop({
    bgFile = "Interface\\Buttons\\WHITE8x8",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
    edgeSize = 10,
    insets = { left = 2, right = 2, top = 2, bottom = 2 },
})
nextUpFrame:SetBackdropColor(0.35, 0.25, 0.05, 0.4)
nextUpFrame:SetBackdropBorderColor(1, 0.84, 0, 0.5)

local nextUpLabel = nextUpFrame:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
nextUpLabel:SetPoint("TOPLEFT", 8, -5)
nextUpLabel:SetText("|cffffd700NEXT UP|r")

local nextUpText = nextUpFrame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
nextUpText:SetPoint("TOPLEFT", nextUpLabel, "BOTTOMLEFT", 0, -2)
nextUpText:SetPoint("RIGHT", nextUpFrame, "RIGHT", -8, 0)
nextUpText:SetWordWrap(true)
nextUpText:SetText("Loading...")

-- Click NEXT UP banner to set waypoint for the next task
nextUpFrame:EnableMouse(true)
nextUpFrame:RegisterForClicks("LeftButtonUp")
nextUpFrame:SetScript("OnClick", function()
    if currentNextId then
        WoWDashboard_Navigate(currentNextId)
    end
end)
nextUpFrame:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
    GameTooltip:SetText("|cffffd700Click to set waypoint for next task|r")
    GameTooltip:Show()
end)
nextUpFrame:SetScript("OnLeave", function() GameTooltip:Hide() end)

-- ══════════════════════════════════════════
-- Progress Bar
-- ══════════════════════════════════════════

local progressFrame = CreateFrame("Frame", nil, TrackerFrame)
progressFrame:SetHeight(16)
progressFrame:SetPoint("TOPLEFT", nextUpFrame, "BOTTOMLEFT", 0, -4)
progressFrame:SetPoint("TOPRIGHT", nextUpFrame, "BOTTOMRIGHT", 0, -4)

local progressBg = progressFrame:CreateTexture(nil, "BACKGROUND")
progressBg:SetAllPoints()
progressBg:SetColorTexture(0.10, 0.08, 0.12, 0.6)

local progressBar = progressFrame:CreateTexture(nil, "ARTWORK")
progressBar:SetPoint("TOPLEFT", progressBg, "TOPLEFT", 0, 0)
progressBar:SetPoint("BOTTOMLEFT", progressBg, "BOTTOMLEFT", 0, 0)
progressBar:SetColorTexture(1, 0.84, 0, 0.8)
progressBar:SetWidth(1)

local progressText = progressFrame:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
progressText:SetPoint("CENTER")
progressText:SetText("0%")

-- ══════════════════════════════════════════
-- Scrollable Content Area
-- ══════════════════════════════════════════

local contentAnchor = CreateFrame("Frame", nil, TrackerFrame)
contentAnchor:SetPoint("TOPLEFT", progressFrame, "BOTTOMLEFT", 0, -4)
contentAnchor:SetPoint("TOPRIGHT", progressFrame, "BOTTOMRIGHT", 0, -4)
contentAnchor:SetHeight(1)

-- ══════════════════════════════════════════
-- Section Header & Task Row Constructors
-- ══════════════════════════════════════════

local function CreateSectionHeader(parent, title, color, anchor, yOffset)
    local header = CreateFrame("Button", nil, parent)
    header:SetHeight(20)
    header:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, yOffset)
    header:SetPoint("TOPRIGHT", anchor, "BOTTOMRIGHT", 0, yOffset)
    header:EnableMouse(true)
    header:RegisterForClicks("LeftButtonUp")

    -- Subtle divider line above header
    local divider = header:CreateTexture(nil, "ARTWORK")
    divider:SetHeight(1)
    divider:SetPoint("TOPLEFT", header, "TOPLEFT", 4, 0)
    divider:SetPoint("TOPRIGHT", header, "TOPRIGHT", -4, 0)
    divider:SetColorTexture(0.30, 0.25, 0.18, 0.4)

    local bg = header:CreateTexture(nil, "BACKGROUND")
    bg:SetAllPoints()
    bg:SetColorTexture(color.r, color.g, color.b, 0.08)

    local text = header:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    text:SetPoint("LEFT", 6, 0)
    text:SetText(title)
    text:SetTextColor(1, 0.84, 0)

    -- Progress label on the right side (e.g. "2/3 slots")
    local progressLabel = header:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    progressLabel:SetPoint("RIGHT", -6, 0)
    progressLabel:SetText("")
    progressLabel:SetTextColor(0.6, 0.55, 0.4)

    -- Hover highlight
    header:SetScript("OnEnter", function()
        bg:SetColorTexture(color.r, color.g, color.b, 0.15)
    end)
    header:SetScript("OnLeave", function()
        bg:SetColorTexture(color.r, color.g, color.b, 0.08)
    end)

    return header, progressLabel
end

local function CreateTaskRow(parent, anchor, yOffset)
    local row = CreateFrame("Frame", nil, parent)
    row:SetHeight(22)
    row:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, yOffset)
    row:SetPoint("TOPRIGHT", anchor, "BOTTOMRIGHT", 0, yOffset)
    row:EnableMouse(true)

    -- Status indicator (colored pipe character)
    local status = row:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    status:SetPoint("LEFT", 10, 0)
    status:SetWidth(14)

    -- Task label
    local label = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    label:SetPoint("LEFT", status, "RIGHT", 4, 0)
    label:SetPoint("RIGHT", row, "RIGHT", -40, 0)
    label:SetJustifyH("LEFT")
    label:SetWordWrap(false)

    -- Count text (e.g. "3/8" for vault tasks)
    local countText = row:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    countText:SetPoint("RIGHT", -6, 0)

    row.status = status
    row.label = label
    row.countText = countText
    row.entry = nil

    -- Hover tooltip with full guidance
    row:SetScript("OnEnter", function(self)
        if not self.entry then return end
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:SetText(self.entry.label, 1, 0.84, 0)

        -- Location info
        if self.entry.locationZone and self.entry.locationZone ~= "" then
            GameTooltip:AddLine(self.entry.locationLabel .. " - " .. self.entry.locationZone, 0.5, 0.8, 1)
        end

        -- How-to guidance
        GameTooltip:AddLine(" ")
        GameTooltip:AddLine("How to do this:", 1, 0.84, 0)
        GameTooltip:AddLine(self.entry.howTo or self.entry.message, 1, 1, 1, true)

        -- Nightmare unlock info for prey hunts
        if self.entry.id == "prey" then
            local loc = WoWDashboard_Locations and WoWDashboard_Locations.prey
            if loc and loc.nightmareUnlock then
                GameTooltip:AddLine(" ")
                GameTooltip:AddLine("How to unlock Nightmare:", 1, 0.5, 0.5)
                GameTooltip:AddLine("1. Reach Prey Journey Rank 4 (~4 Hard hunts after Rank 3)", 0.9, 0.8, 0.7, true)
                GameTooltip:AddLine("2. Return to Astalor Bloodsworn in Silvermoon (56, 65)", 0.9, 0.8, 0.7, true)
                GameTooltip:AddLine("3. Complete 'Astalor's Temptations' chain (6 quests)", 0.9, 0.8, 0.7, true)
                GameTooltip:AddLine("4. Final quest: 'The Sheep or the Wolf' unlocks Nightmare", 0.9, 0.8, 0.7, true)
                GameTooltip:AddLine("Note: Nightmare is solo-only with brutal mechanics!", 0.8, 0.4, 0.4, true)
            end
        end

        -- Server-generated tip (from advice file)
        if self.entry.serverTip then
            GameTooltip:AddLine(" ")
            GameTooltip:AddLine("Tip: " .. self.entry.serverTip, 0.5, 0.8, 1, true)
        end

        -- Vault slot thresholds
        if self.entry.slotThresholds then
            GameTooltip:AddLine(" ")
            GameTooltip:AddLine("Vault Slots:", 0.8, 0.8, 0.8)
            for i, threshold in ipairs(self.entry.slotThresholds) do
                if self.entry.count >= threshold then
                    GameTooltip:AddLine(
                        string.format("  Slot %d (%d) -- UNLOCKED", i, threshold),
                        0.18, 0.8, 0.44
                    )
                else
                    GameTooltip:AddLine(
                        string.format("  Slot %d (%d) -- %d more", i, threshold, threshold - self.entry.count),
                        0.6, 0.6, 0.6
                    )
                end
            end
        end

        GameTooltip:AddLine(" ")
        GameTooltip:AddLine("Left-click: Set waypoint | Right-click: Toggle done", 0.4, 0.4, 0.4)
        GameTooltip:Show()
    end)
    row:SetScript("OnLeave", function() GameTooltip:Hide() end)

    -- Left-click: navigate (set waypoint) | Right-click: manual toggle
    row:SetScript("OnMouseDown", function(self, button)
        if not self.entry then return end
        if button == "LeftButton" then
            WoWDashboard_Navigate(self.entry.id)
        elseif button == "RightButton" and self.entry.manualToggle then
            WoWDashboard_ManualToggle(self.entry.id)
        end
    end)

    return row
end

-- ══════════════════════════════════════════
-- Build Sections & Task Rows
-- ══════════════════════════════════════════

local lastAnchor = contentAnchor
local allRows = {}

for _, sectionDef in ipairs(SECTION_ORDER) do
    local color = SECTION_COLORS[sectionDef.key]
    local header, progressLabel = CreateSectionHeader(TrackerFrame, sectionDef.title, color, lastAnchor, -4)

    local section = {
        key = sectionDef.key,
        header = header,
        progressLabel = progressLabel,
        collapsed = false,
        rows = {},
    }

    -- Map sections to their task IDs
    local rowDefs = {}
    if sectionDef.key == "weekly" then
        rowDefs = {"spark", "worldboss", "prey", "housing"}
    elseif sectionDef.key == "vault_dungeons" then
        rowDefs = {"mplus"}
    elseif sectionDef.key == "vault_raid" then
        rowDefs = {"raid"}
    elseif sectionDef.key == "vault_world" then
        rowDefs = {"world"}
    end

    local rowAnchor = header
    for _, taskId in ipairs(rowDefs) do
        local row = CreateTaskRow(TrackerFrame, rowAnchor, -1)
        row.taskId = taskId
        table.insert(section.rows, row)
        taskRows[taskId] = row
        allRows[#allRows + 1] = row
        rowAnchor = row
    end

    -- Click header to toggle section collapse
    header:SetScript("OnClick", function()
        section.collapsed = not section.collapsed
        for _, row in ipairs(section.rows) do
            row:SetShown(not section.collapsed)
        end
        WoWDashboard_RelayoutTracker()
    end)

    sections[sectionDef.key] = section
    lastAnchor = section.rows[#section.rows] or header
end

-- ══════════════════════════════════════════
-- Layout / Resize
-- ══════════════════════════════════════════

function WoWDashboard_RelayoutTracker()
    if isMinimized then
        for _, section in pairs(sections) do
            section.header:Hide()
            for _, row in ipairs(section.rows) do
                row:Hide()
            end
        end
        TrackerFrame:SetHeight(6 + 24 + 4 + 48 + 4 + 16 + 8)
        return
    end

    -- Dynamically re-anchor all sections and rows so collapsed sections
    -- don't leave gaps. Each element anchors to the previous visible one.
    local lastAnchor = contentAnchor
    local totalHeight = 6 + 24 + 4 + 48 + 4 + 16 + 4  -- title + nextup + progress

    for _, sectionDef in ipairs(SECTION_ORDER) do
        local section = sections[sectionDef.key]

        -- Re-anchor header to whatever was last visible
        section.header:ClearAllPoints()
        section.header:SetPoint("TOPLEFT", lastAnchor, "BOTTOMLEFT", 0, -4)
        section.header:SetPoint("TOPRIGHT", lastAnchor, "BOTTOMRIGHT", 0, -4)
        section.header:Show()
        totalHeight = totalHeight + 4 + 20

        local rowAnchor = section.header
        for _, row in ipairs(section.rows) do
            if not section.collapsed then
                row:ClearAllPoints()
                row:SetPoint("TOPLEFT", rowAnchor, "BOTTOMLEFT", 0, -1)
                row:SetPoint("TOPRIGHT", rowAnchor, "BOTTOMRIGHT", 0, -1)
                row:Show()
                totalHeight = totalHeight + 1 + 22
                rowAnchor = row
            else
                row:Hide()
            end
        end

        -- Next section anchors to the last visible element in this section
        if not section.collapsed and #section.rows > 0 then
            lastAnchor = section.rows[#section.rows]
        else
            lastAnchor = section.header
        end
    end

    totalHeight = totalHeight + 10
    TrackerFrame:SetHeight(totalHeight)
end

-- ══════════════════════════════════════════
-- Update Display
-- ══════════════════════════════════════════

local function UpdateTrackerUI(charKey)
    if not charKey then
        charKey = WoWDashboard_PlayerKey
    end
    if not charKey then return end

    local data = WoWDashboardDB and WoWDashboardDB[charKey]
    if not data or (data.level or 0) < 90 then
        TrackerFrame:Hide()
        return
    end

    local results, nextAction = WoWDashboard_GetPriorities(charKey)
    if not results then
        TrackerFrame:Hide()
        return
    end

    -- ── Update NEXT UP banner ──
    currentNextId = nextAction and nextAction.id or nil
    if nextAction then
        local shortMsg = nextAction.label .. ": " .. (nextAction.serverAdvice or nextAction.message)
        if #shortMsg > 120 then shortMsg = shortMsg:sub(1, 117) .. "..." end
        nextUpText:SetText(shortMsg)
        nextUpFrame:SetBackdropColor(0.35, 0.25, 0.05, 0.4)
        nextUpFrame:SetBackdropBorderColor(1, 0.84, 0, 0.5)
    else
        nextUpText:SetText("|cff2ecc71All weekly gearing tasks complete! Great work.|r")
        nextUpFrame:SetBackdropColor(0.08, 0.25, 0.08, 0.35)
        nextUpFrame:SetBackdropBorderColor(0.18, 0.8, 0.44, 0.4)
    end

    -- ── Update progress bar ──
    local doneCount, totalCount = WoWDashboard_GetTotalProgress(charKey)
    local pct = totalCount > 0 and (doneCount / totalCount) or 0
    progressBar:SetWidth(math.max(1, progressFrame:GetWidth() * pct))
    progressText:SetText(string.format("%d%% (%d/%d)", math.floor(pct * 100), doneCount, totalCount))

    -- ── Update task rows ──
    for _, entry in ipairs(results) do
        local row = taskRows[entry.id]
        if row then
            row.entry = entry

            -- Spark quest: show inline progress text (e.g. "[3/5]" or "[IN PROGRESS]")
            local sparkInline = ""
            if entry.id == "spark" and entry.statusText then
                if entry.statusText ~= "IN PROGRESS" then
                    sparkInline = " |cfff39c12[" .. entry.statusText .. "]|r"
                else
                    sparkInline = " |cfff39c12[IN PROGRESS]|r"
                end
            end

            -- Status indicator colors:
            --   Orange pipe = accepted/in-progress
            --   Green pipe  = complete
            --   Gold pipe   = next action (highlighted)
            --   Grey pipe   = pending
            if entry.done and entry.statusText then
                -- Accepted but not turned in: show as in-progress (orange)
                row.status:SetText("|cffff9900|||r")
                row.status:SetTextColor(1, 0.65, 0)
                row.label:SetText(entry.label .. sparkInline)
                row.label:SetTextColor(1, 0.65, 0)
            elseif entry.done then
                -- Complete (green, dimmed label)
                row.status:SetText("|cff2ecc71|||r")
                row.status:SetTextColor(0.18, 0.8, 0.44)
                row.label:SetText(entry.label)
                row.label:SetTextColor(0.45, 0.45, 0.45)
            elseif nextAction and nextAction.id == entry.id then
                -- Next action (gold, highlighted)
                row.status:SetText("|cffffd700|||r")
                row.status:SetTextColor(1, 0.84, 0)
                row.label:SetText("|cffffd700" .. entry.label .. "|r" .. sparkInline)
                row.label:SetTextColor(1, 0.84, 0)
            else
                -- Pending (grey)
                row.status:SetText("|cff666666|||r")
                row.status:SetTextColor(0.4, 0.4, 0.4)
                row.label:SetText(entry.label .. sparkInline)
                row.label:SetTextColor(0.65, 0.65, 0.65)
            end

            -- Count display for multi-completion tasks (e.g. "3/8")
            if entry.maxCount > 1 then
                row.countText:SetText(string.format("%d/%d", entry.count, entry.maxCount))
                if entry.done then
                    row.countText:SetTextColor(0.18, 0.8, 0.44)
                else
                    row.countText:SetTextColor(0.6, 0.6, 0.6)
                end
            else
                row.countText:SetText(entry.done and "" or "")
            end

            -- Update vault section header progress labels (e.g. "2/3 slots")
            if entry.slotThresholds and entry.category then
                local section = sections[entry.category]
                if section and section.progressLabel then
                    local slotsUnlocked = 0
                    local totalSlots = #entry.slotThresholds
                    for _, threshold in ipairs(entry.slotThresholds) do
                        if entry.count >= threshold then
                            slotsUnlocked = slotsUnlocked + 1
                        end
                    end
                    if slotsUnlocked == totalSlots then
                        section.progressLabel:SetText("|cff2ecc71" .. slotsUnlocked .. "/" .. totalSlots .. " slots|r")
                    elseif slotsUnlocked > 0 then
                        section.progressLabel:SetText("|cffffd700" .. slotsUnlocked .. "/" .. totalSlots .. " slots|r")
                    else
                        section.progressLabel:SetText("|cff666666" .. slotsUnlocked .. "/" .. totalSlots .. " slots|r")
                    end
                end
            end
        end
    end

    -- ── Update weekly section header with completion count ──
    if sections["weekly"] and sections["weekly"].progressLabel then
        local weeklyDone = 0
        local weeklyTotal = 0
        for _, entry in ipairs(results) do
            if entry.category == "weekly" then
                weeklyTotal = weeklyTotal + 1
                if entry.done then weeklyDone = weeklyDone + 1 end
            end
        end
        if weeklyDone == weeklyTotal then
            sections["weekly"].progressLabel:SetText("|cff2ecc71" .. weeklyDone .. "/" .. weeklyTotal .. " done|r")
        elseif weeklyDone > 0 then
            sections["weekly"].progressLabel:SetText("|cffffd700" .. weeklyDone .. "/" .. weeklyTotal .. " done|r")
        else
            sections["weekly"].progressLabel:SetText("|cff666666" .. weeklyDone .. "/" .. weeklyTotal .. " done|r")
        end
    end

    -- Adjust NEXT UP frame height to fit text content
    local textHeight = nextUpText:GetStringHeight() or 12
    nextUpFrame:SetHeight(math.max(40, 18 + textHeight + 6))

    WoWDashboard_RelayoutTracker()

    if not TrackerFrame:IsShown() then
        TrackerFrame:Show()
    end
end

-- Register as the data-layer callback for real-time updates
WoWDashboard_OnDataUpdate = UpdateTrackerUI

-- ══════════════════════════════════════════
-- Minimap Button
-- ══════════════════════════════════════════

local minimapButton = CreateFrame("Button", "WoWDashboardMinimapBtn", Minimap)
minimapButton:SetSize(32, 32)
minimapButton:SetFrameStrata("MEDIUM")
minimapButton:SetFrameLevel(8)

local mmIcon = minimapButton:CreateTexture(nil, "ARTWORK")
mmIcon:SetSize(20, 20)
mmIcon:SetPoint("CENTER")
mmIcon:SetTexture("Interface\\Icons\\INV_Misc_Spyglass_03")

local mmBorder = minimapButton:CreateTexture(nil, "OVERLAY")
mmBorder:SetSize(52, 52)
mmBorder:SetPoint("CENTER")
mmBorder:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")

local function UpdateMinimapPosition(angle)
    local x = math.cos(angle) * 80
    local y = math.sin(angle) * 80
    minimapButton:SetPoint("CENTER", Minimap, "CENTER", x, y)
end

-- Drag minimap button around the minimap edge
minimapButton:RegisterForDrag("LeftButton")
minimapButton:SetScript("OnDragStart", function() minimapButton.dragging = true end)
minimapButton:SetScript("OnDragStop", function() minimapButton.dragging = false end)
minimapButton:SetScript("OnUpdate", function(self)
    if self.dragging then
        local mx, my = Minimap:GetCenter()
        local cx, cy = GetCursorPosition()
        local scale = UIParent:GetEffectiveScale()
        cx, cy = cx / scale, cy / scale
        local angle = math.atan2(cy - my, cx - mx)
        WoWDashboardDB._minimapAngle = angle
        minimapButton:ClearAllPoints()
        UpdateMinimapPosition(angle)
    end
end)

-- Click minimap button to toggle tracker visibility
minimapButton:SetScript("OnClick", function()
    if TrackerFrame:IsShown() then
        TrackerFrame:Hide()
    else
        TrackerFrame:Show()
        UpdateTrackerUI()
    end
end)

minimapButton:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:SetText("|cffffd700WoW Dashboard|r")
    GameTooltip:AddLine("Click to toggle the weekly tracker", 0.8, 0.8, 0.8)
    local charKey = WoWDashboard_PlayerKey
    if charKey then
        local doneCount, totalCount = WoWDashboard_GetTotalProgress(charKey)
        local pct = totalCount > 0 and math.floor((doneCount / totalCount) * 100) or 0
        GameTooltip:AddLine(string.format("Progress: %d%% (%d/%d)", pct, doneCount, totalCount), 0.18, 0.8, 0.44)
    end
    GameTooltip:Show()
end)
minimapButton:SetScript("OnLeave", function() GameTooltip:Hide() end)

-- ══════════════════════════════════════════
-- Slash Commands
-- ══════════════════════════════════════════

SLASH_WOWDASHBOARD1 = "/dashboard"
SLASH_WOWDASHBOARD2 = "/db"

SlashCmdList["WOWDASHBOARD"] = function(msg)
    local cmd = msg:lower():trim()

    -- /db (no args) -- toggle tracker visibility
    if cmd == "" then
        if TrackerFrame:IsShown() then
            TrackerFrame:Hide()
        else
            TrackerFrame:Show()
            UpdateTrackerUI()
        end
        return
    end

    -- /db reset -- restore default frame position
    if cmd == "reset" then
        TrackerFrame:ClearAllPoints()
        TrackerFrame:SetPoint("RIGHT", UIParent, "RIGHT", -20, 0)
        WoWDashboardDB._framePosition = nil
        print("|cff00ccff[WoW Dashboard]|r Frame position reset.")
        return
    end

    -- /db next -- print and navigate to next task
    if cmd == "next" then
        local charKey = WoWDashboard_PlayerKey
        if charKey then
            local _, nextAction = WoWDashboard_GetPriorities(charKey)
            if nextAction then
                print("|cffffd700[NEXT UP]|r " .. nextAction.label)
                WoWDashboard_Navigate(nextAction.id)
            else
                print("|cff2ecc71[WoW Dashboard]|r All weekly tasks complete!")
            end
        end
        return
    end

    -- /db go -- set waypoint for next task (no print)
    if cmd == "go" then
        if currentNextId then
            WoWDashboard_Navigate(currentNextId)
        else
            print("|cff00ccff[WoW Dashboard]|r Nothing to navigate to -- all tasks done!")
        end
        return
    end

    -- /db mark <task> -- manual toggle
    if cmd:find("^mark ") then
        local taskId = cmd:match("^mark (%S+)")
        if taskId then
            WoWDashboard_ManualToggle(taskId)
        else
            print("|cff00ccff[WoW Dashboard]|r Usage: /db mark <task>")
            print("  Tasks: spark, worldboss, prey, housing")
        end
        return
    end

    -- /db quests -- debug: print all quests in log
    if cmd == "quests" then
        print("|cffffd700[WoW Dashboard] Your Quest Log:|r")
        if C_QuestLog then
            local numEntries = C_QuestLog.GetNumQuestLogEntries() or 0
            local count = 0
            for i = 1, numEntries do
                local questInfo = C_QuestLog.GetInfo(i)
                if questInfo and not questInfo.isHeader then
                    count = count + 1
                    local status = ""
                    if questInfo.isComplete then
                        status = " |cff2ecc71[COMPLETE]|r"
                    end
                    print(string.format("  %d. |cffffd700%s|r (ID: %d)%s",
                        count, questInfo.title or "???", questInfo.questID or 0, status))
                end
            end
            if count == 0 then
                print("  No quests found in log.")
            end
            print("|cff888888Copy the quest title for any prey/spark/housing quest and tell Claude!|r")
        end
        return
    end

    -- /db vault -- debug: print raw Great Vault API data
    if cmd == "vault" then
        print("|cffffd700[WoW Dashboard] === GREAT VAULT DEBUG ===|r")

        -- Print enum name->value mappings
        print("|cff888888Enum values:|r")
        if Enum and Enum.WeeklyRewardChestThresholdType then
            for k, v in pairs(Enum.WeeklyRewardChestThresholdType) do
                print(string.format("  %s = %s", tostring(k), tostring(v)))
            end
        else
            print("  |cffe74c3cEnum.WeeklyRewardChestThresholdType not found!|r")
        end

        -- Query vault data via named enums
        if C_WeeklyRewards and C_WeeklyRewards.GetActivities then
            local types = {
                { name = "MythicPlus", enum = Enum.WeeklyRewardChestThresholdType.MythicPlus },
                { name = "Raid",      enum = Enum.WeeklyRewardChestThresholdType.Raid },
                { name = "World",     enum = Enum.WeeklyRewardChestThresholdType.World },
            }
            for _, t in ipairs(types) do
                local ok, activities = pcall(C_WeeklyRewards.GetActivities, t.enum)
                if ok and activities then
                    print(string.format("|cffffd700%s (enum=%s)|r (%d entries):", t.name, tostring(t.enum), #activities))
                    for i, a in ipairs(activities) do
                        local fields = ""
                        for k, v in pairs(a) do
                            fields = fields .. string.format("%s=%s ", tostring(k), tostring(v))
                        end
                        print(string.format("    Slot %d: %s", i, fields))
                    end
                else
                    print(string.format("  |cffe74c3c%s (enum=%s)|r: FAILED", t.name, tostring(t.enum)))
                end
            end

            -- Also try raw numeric values 0-10 (extended range for Midnight enums)
            print("|cff888888Trying raw numeric enum values 0-10:|r")
            for enumVal = 0, 10 do
                local ok, activities = pcall(C_WeeklyRewards.GetActivities, enumVal)
                if ok and activities and #activities > 0 then
                    local prog = 0
                    for _, a in ipairs(activities) do
                        if (a.progress or 0) > prog then prog = a.progress end
                    end
                    print(string.format("  Enum %d: %d entries, max progress=%d, threshold1=%d",
                        enumVal, #activities, prog, activities[1].threshold or 0))
                end
            end
        end

        -- Print stored SavedVariables values for comparison
        local charKey = WoWDashboard_PlayerKey
        if charKey and WoWDashboardDB[charKey] then
            local d = WoWDashboardDB[charKey]
            print("|cffffd700Stored in SavedVariables:|r")
            print(string.format("  vaultDungeons=%s, vaultRaid=%s, vaultWorld=%s",
                tostring(d.vaultDungeons), tostring(d.vaultRaid), tostring(d.vaultWorld)))
            print(string.format("  mplusRuns=%s, raidBossesKilled=%s",
                tostring(d.mplusRuns), tostring(d.raidBossesKilled)))
            print(string.format("  sparkDone=%s, sparkAccepted=%s, sparkProgress=%s/%s",
                tostring(d.sparkDone), tostring(d.sparkAccepted),
                tostring(d.sparkProgress), tostring(d.sparkProgressMax)))
            print(string.format("  sparkObjectiveText=%s", tostring(d.sparkObjectiveText)))
        end
        return
    end

    -- /db spark -- debug: print spark quest objective details
    if cmd == "spark" then
        print("|cffffd700[WoW Dashboard] === SPARK QUEST DEBUG ===|r")
        if C_QuestLog then
            local numEntries = C_QuestLog.GetNumQuestLogEntries() or 0
            for i = 1, numEntries do
                local questInfo = C_QuestLog.GetInfo(i)
                if questInfo and not questInfo.isHeader then
                    local lTitle = (questInfo.title or ""):lower()
                    if lTitle:find("midnight:") then
                        print(string.format("|cffffd700Found: %s|r (ID: %d, complete: %s)",
                            questInfo.title, questInfo.questID or 0, tostring(questInfo.isComplete)))

                        if questInfo.questID then
                            -- C_QuestLog objectives API
                            local ok, objectives = pcall(C_QuestLog.GetQuestObjectives, questInfo.questID)
                            if ok and objectives then
                                print(string.format("  Objectives (%d total):", #objectives))
                                for j, obj in ipairs(objectives) do
                                    print(string.format("    %d. text='%s' fulfilled=%s required=%s finished=%s type=%s",
                                        j, obj.text or "?", tostring(obj.numFulfilled),
                                        tostring(obj.numRequired), tostring(obj.finished), tostring(obj.type)))
                                end
                            else
                                print("  |cffe74c3cGetQuestObjectives failed or returned nil|r")
                            end

                            -- Older LeaderBoard API for cross-reference
                            local logIndex = C_QuestLog.GetLogIndexForQuestID(questInfo.questID)
                            if logIndex then
                                print(string.format("  Quest log index: %d", logIndex))
                                local numObj = GetNumQuestLeaderBoards(logIndex)
                                if numObj and numObj > 0 then
                                    print(string.format("  LeaderBoards (%d):", numObj))
                                    for j = 1, numObj do
                                        local text, objType, finished = GetQuestLogLeaderBoard(j, logIndex)
                                        print(string.format("    %d. '%s' type=%s finished=%s",
                                            j, text or "?", objType or "?", tostring(finished)))
                                    end
                                end
                            end
                        end
                    end
                end
            end
        end
        return
    end

    -- /db help -- print all available commands
    if cmd == "help" then
        print("|cffffd700WoW Dashboard Commands:|r")
        print("  /db -- Toggle tracker frame")
        print("  /db next -- Show & navigate to next task")
        print("  /db go -- Set waypoint for next task")
        print("  /db mark worldboss -- Toggle world boss done")
        print("  /db mark spark -- Toggle spark quest done")
        print("  /db mark prey -- Cycle prey hunt count (0>1>2>3>0)")
        print("  /db mark housing -- Toggle housing weekly done")
        print("  /db quests -- Print all quests in log")
        print("  /db vault -- Print raw Great Vault API data")
        print("  /db spark -- Print spark quest objective details")
        print("  /db reset -- Reset frame position")
        print("|cff888888In-frame: Left-click task = waypoint, Right-click = toggle done|r")
        return
    end

    -- Unknown command: show help hint
    print("|cff00ccff[WoW Dashboard]|r Unknown command: " .. cmd .. ". Type /db help for commands.")
end

-- ══════════════════════════════════════════
-- Initialization
-- ══════════════════════════════════════════

local initFrame = CreateFrame("Frame")
initFrame:RegisterEvent("PLAYER_LOGIN")
initFrame:SetScript("OnEvent", function()
    -- Delay to let SavedVariables load and data layer populate
    C_Timer.After(4, function()
        -- Restore saved frame position
        local pos = WoWDashboardDB and WoWDashboardDB._framePosition
        if pos then
            TrackerFrame:ClearAllPoints()
            TrackerFrame:SetPoint(pos[1], UIParent, pos[2], pos[3], pos[4])
        end

        -- Restore minimap button angle (default: ~126 degrees)
        local angle = WoWDashboardDB and WoWDashboardDB._minimapAngle or 2.2
        minimapButton:ClearAllPoints()
        UpdateMinimapPosition(angle)

        -- Initial UI update
        UpdateTrackerUI()
    end)
end)
