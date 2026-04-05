const DAILY_COUNTS_KEY = "twitterDailyCounts";
const POPUP_SITE_KEY = "twitterTrackerPopupSite";
const BLOCK_MODE_KEY = "twitterTrackerBlockMode";
const BLOCKED_SITES_KEY = "twitterTrackerBlockedSites";
const BADGE_COUNT_VISIBLE_KEY = "twitterTrackerBadgeCountVisible";
const CHART_DAYS = 14;
const SVG_NS = "http://www.w3.org/2000/svg";

let currentSiteId = getFallbackSiteId([]);
let customSitesState = [];
let trackedSitesState = getTrackedSites(customSitesState);
let trackedSiteMapState = getTrackedSiteMap(customSitesState);
let cachedDailyCounts = {};
let isBlockModeEnabled = false;
let isBadgeCountVisible = true;
let blockedSitesState = normalizeBlockedSites({}, customSitesState);

function refreshTrackedSitesState() {
  trackedSitesState = getTrackedSites(customSitesState);
  trackedSiteMapState = getTrackedSiteMap(customSitesState);
  blockedSitesState = normalizeBlockedSites(blockedSitesState, customSitesState);

  if (!currentSiteId || !(currentSiteId in trackedSiteMapState)) {
    currentSiteId = getFallbackSiteId(customSitesState);
  }
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateKeyForOffset(offset) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLabel(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function emptyDayEntry() {
  return {
    total: 0,
    sites: {}
  };
}

function normalizeDayEntry(entry) {
  if (typeof entry === "number") {
    return {
      total: entry,
      sites: entry > 0 && trackedSiteMapState.twitter ? { twitter: entry } : {}
    };
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return emptyDayEntry();
  }

  const sites =
    entry.sites && typeof entry.sites === "object" && !Array.isArray(entry.sites)
      ? Object.fromEntries(
          Object.entries(entry.sites)
            .filter(([siteId, count]) => siteId in trackedSiteMapState && Number.isFinite(count) && count > 0)
            .map(([siteId, count]) => [siteId, count])
        )
      : {};
  const derivedTotal = Object.values(sites).reduce((sum, count) => sum + count, 0);
  const total = Number.isFinite(entry.total) && entry.total >= derivedTotal ? entry.total : derivedTotal;

  return {
    total,
    sites
  };
}

function normalizeDailyCounts(dailyCounts) {
  if (!dailyCounts || typeof dailyCounts !== "object" || Array.isArray(dailyCounts)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(dailyCounts).map(([dateKey, entry]) => [dateKey, normalizeDayEntry(entry)])
  );
}

function getSiteCountForDate(dailyCounts, dateKey, siteId) {
  return normalizeDayEntry(dailyCounts[dateKey]).sites[siteId] ?? 0;
}

function setSiteCountForDate(dailyCounts, dateKey, siteId, nextCount) {
  const dayEntry = normalizeDayEntry(dailyCounts[dateKey]);
  const previousCount = dayEntry.sites[siteId] ?? 0;
  const safeCount = Math.max(0, Math.round(nextCount));

  if (safeCount > 0) {
    dayEntry.sites[siteId] = safeCount;
  } else {
    delete dayEntry.sites[siteId];
  }

  dayEntry.total = Math.max(0, dayEntry.total - previousCount + safeCount);

  if (dayEntry.total === 0 && Object.keys(dayEntry.sites).length === 0) {
    delete dailyCounts[dateKey];
    return;
  }

  dailyCounts[dateKey] = dayEntry;
}

function removeSiteFromDailyCounts(dailyCounts, siteId) {
  const nextDailyCounts = normalizeDailyCounts(dailyCounts);

  Object.keys(nextDailyCounts).forEach((dateKey) => {
    const dayEntry = normalizeDayEntry(nextDailyCounts[dateKey]);
    const previousCount = dayEntry.sites[siteId] ?? 0;

    if (previousCount === 0) {
      return;
    }

    delete dayEntry.sites[siteId];
    dayEntry.total = Math.max(0, dayEntry.total - previousCount);

    if (dayEntry.total === 0 && Object.keys(dayEntry.sites).length === 0) {
      delete nextDailyCounts[dateKey];
      return;
    }

    nextDailyCounts[dateKey] = dayEntry;
  });

  return nextDailyCounts;
}

function getChartData(dailyCounts, siteId) {
  return Array.from({ length: CHART_DAYS }, (_, index) => {
    const offset = index - (CHART_DAYS - 1);
    const dateKey = getDateKeyForOffset(offset);
    return {
      dateKey,
      count: getSiteCountForDate(dailyCounts, dateKey, siteId)
    };
  });
}

function clearChart() {
  const chart = document.getElementById("historyChart");
  while (chart.firstChild) {
    chart.removeChild(chart.firstChild);
  }
  return chart;
}

function appendSvgElement(parent, tagName, attributes) {
  const element = document.createElementNS(SVG_NS, tagName);
  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, String(value));
  });
  parent.appendChild(element);
  return element;
}

function renderChart(dailyCounts, siteId) {
  const chart = clearChart();
  const data = getChartData(dailyCounts, siteId);
  const values = data.map((entry) => entry.count);
  const maxValue = Math.max(...values, 1);
  const width = 320;
  const height = 180;
  const padding = { top: 18, right: 34, bottom: 20, left: 12 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const yAxisTicks = Array.from({ length: 4 }, (_, index) => {
    const ratio = 1 - index / 3;
    return {
      value: Math.round(maxValue * ratio),
      y: padding.top + (innerHeight / 3) * index
    };
  });

  appendSvgElement(chart, "path", {
    d: `M ${padding.left} ${padding.top} H ${width - padding.right} V ${height - padding.bottom} H ${padding.left} Z`,
    fill: "rgba(255,255,255,0.02)",
    stroke: "rgba(255,255,255,0.06)"
  });

  yAxisTicks.forEach(({ value, y }) => {
    appendSvgElement(chart, "line", {
      x1: padding.left,
      y1: y,
      x2: width - padding.right,
      y2: y,
      stroke: "rgba(255,255,255,0.08)",
      "stroke-dasharray": "4 6"
    });

    appendSvgElement(chart, "text", {
      x: width - padding.right + 8,
      y: y + 4,
      fill: "rgba(139,152,165,0.92)",
      "font-size": "10",
      "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      "text-anchor": "start"
    }).textContent = String(value);
  });

  const points = data.map((entry, index) => {
    const x = padding.left + (innerWidth / (data.length - 1)) * index;
    const y = padding.top + innerHeight - (entry.count / maxValue) * innerHeight;
    return { x, y, count: entry.count };
  });

  appendSvgElement(chart, "polyline", {
    points: points.map(({ x, y }) => `${x},${y}`).join(" "),
    fill: "none",
    stroke: "#1d9bf0",
    "stroke-width": "3",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  });

  points.forEach(({ x, y, count }) => {
    appendSvgElement(chart, "circle", {
      cx: x,
      cy: y,
      r: 4,
      fill: "#0f1419",
      stroke: "#86cbff",
      "stroke-width": "2"
    }).appendChild(document.createElementNS(SVG_NS, "title")).textContent = `${count} opens`;
  });

  document.getElementById("startLabel").textContent = formatLabel(data[0].dateKey);
  document.getElementById("endLabel").textContent = formatLabel(data[data.length - 1].dateKey);
}

async function getDefaultSiteId(storedPopupSiteId) {
  const requestedSiteId = new URLSearchParams(window.location.search).get("site");
  if (requestedSiteId && requestedSiteId in trackedSiteMapState) {
    return requestedSiteId;
  }

  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });
    const activeSiteId = findTrackedSiteIdByUrl(activeTab?.url, customSitesState);
    if (activeSiteId) {
      return activeSiteId;
    }
  } catch {
    // Ignore and fall back to stored preference.
  }

  if (storedPopupSiteId && storedPopupSiteId in trackedSiteMapState) {
    return storedPopupSiteId;
  }

  return getFallbackSiteId(customSitesState);
}

function setSiteInputMessage(message, tone = "info") {
  const element = document.getElementById("siteInputMessage");
  if (!message) {
    element.hidden = true;
    element.textContent = "";
    element.classList.remove("is-error");
    return;
  }

  element.hidden = false;
  element.textContent = message;
  element.classList.toggle("is-error", tone === "error");
}

function findConflictingTrackedSite(domain) {
  return trackedSitesState.find((site) =>
    site.domains.some((existingDomain) => matchesDomain(domain, existingDomain) || matchesDomain(existingDomain, domain))
  );
}

function renderSiteOptions() {
  const select = document.getElementById("siteSelect");
  select.textContent = "";

  trackedSitesState.forEach((site) => {
    const option = document.createElement("option");
    option.value = site.id;
    option.textContent = site.label;
    select.appendChild(option);
  });

  if (currentSiteId && currentSiteId in trackedSiteMapState) {
    select.value = currentSiteId;
  }
}

async function handleBlockedSiteToggle(siteId, nextValue) {
  const nextBlockedSites = normalizeBlockedSites(
    {
      ...blockedSitesState,
      [siteId]: nextValue
    },
    customSitesState
  );

  await chrome.storage.local.set({ [BLOCKED_SITES_KEY]: nextBlockedSites });
}

async function removeCustomSite(siteId) {
  const site = trackedSiteMapState[siteId];
  if (!site?.isCustom) {
    return;
  }

  const nextCustomSites = customSitesState.filter((customSite) => customSite.id !== siteId);
  const nextBlockedSitesBase = { ...blockedSitesState };
  delete nextBlockedSitesBase[siteId];
  const nextBlockedSites = normalizeBlockedSites(nextBlockedSitesBase, nextCustomSites);
  const nextDailyCounts = removeSiteFromDailyCounts(cachedDailyCounts, siteId);
  const nextPopupSiteId =
    currentSiteId === siteId ? getFallbackSiteId(nextCustomSites) : currentSiteId;

  await chrome.storage.local.set({
    [CUSTOM_SITES_KEY]: nextCustomSites,
    [BLOCKED_SITES_KEY]: nextBlockedSites,
    [DAILY_COUNTS_KEY]: nextDailyCounts,
    [POPUP_SITE_KEY]: nextPopupSiteId
  });

  setSiteInputMessage(`Removed ${site.label}.`);
}

function renderBlockedSites() {
  const list = document.getElementById("blockedSitesList");
  list.textContent = "";

  trackedSitesState.forEach((site) => {
    const row = document.createElement("div");
    row.className = "blocked-site-row";

    const copy = document.createElement("div");
    copy.className = "blocked-site-copy";

    const title = document.createElement("p");
    title.className = "blocked-site-name";
    title.textContent = site.label;

    const hint = document.createElement("p");
    hint.className = "blocked-site-hint";
    hint.textContent = site.isCustom
      ? `${site.domains[0]}${blockedSitesState[site.id] ? " • blocked when master mode is on" : " • allowed through"}`
      : `${site.domains.join(", ")}${blockedSitesState[site.id] ? " • blocked when master mode is on" : " • allowed through"}`;

    copy.append(title, hint);

    const actions = document.createElement("div");
    actions.className = "blocked-site-actions";

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "toggle";

    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.checked = blockedSitesState[site.id];

    const toggleTrack = document.createElement("span");
    toggleTrack.className = "toggle-track";
    toggleTrack.setAttribute("aria-hidden", "true");

    const toggleCopy = document.createElement("span");
    toggleCopy.className = "toggle-copy";
    toggleCopy.textContent = blockedSitesState[site.id] ? "Blocked" : "Allowed";

    toggleInput.addEventListener("change", async (event) => {
      await handleBlockedSiteToggle(site.id, event.target.checked);
    });

    toggleLabel.append(toggleInput, toggleTrack, toggleCopy);
    actions.appendChild(toggleLabel);

    if (site.isCustom) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "secondary-button remove-site-button";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", async () => {
        await removeCustomSite(site.id);
      });
      actions.appendChild(removeButton);
    }

    row.append(copy, actions);
    list.appendChild(row);
  });
}

function renderPopup() {
  refreshTrackedSitesState();
  renderSiteOptions();
  renderBlockedSites();
  document.getElementById("blockModeToggle").checked = isBlockModeEnabled;
  document.getElementById("badgeCountToggle").checked = isBadgeCountVisible;
  document.getElementById("badgeCountToggleCopy").textContent = isBadgeCountVisible ? "On" : "Off";

  const site = trackedSiteMapState[currentSiteId];
  if (!site) {
    return;
  }

  document.getElementById("todayLabel").textContent = `${site.label} today`;
  document.getElementById("todayCount").textContent = String(
    getSiteCountForDate(cachedDailyCounts, getTodayKey(), currentSiteId)
  );
  document.getElementById("todayDescription").textContent =
    `Opens on ${site.label}. Resets automatically when the local day changes.`;
  document.getElementById("historyTitle").textContent = `Last 14 days on ${site.label}`;
  document.getElementById("historyChart").setAttribute("aria-label", `Line chart of daily ${site.label} opens`);
  renderChart(cachedDailyCounts, currentSiteId);
}

async function resetToday() {
  const nextDailyCounts = normalizeDailyCounts(cachedDailyCounts);
  setSiteCountForDate(nextDailyCounts, getTodayKey(), currentSiteId, 0);
  await chrome.storage.local.set({ [DAILY_COUNTS_KEY]: nextDailyCounts });
}

async function clearHistory() {
  const nextDailyCounts = normalizeDailyCounts(cachedDailyCounts);
  Object.keys(nextDailyCounts).forEach((dateKey) => {
    setSiteCountForDate(nextDailyCounts, dateKey, currentSiteId, 0);
  });
  await chrome.storage.local.set({ [DAILY_COUNTS_KEY]: nextDailyCounts });
}

async function addCustomSiteFromForm(event) {
  event.preventDefault();

  const input = document.getElementById("siteDomainInput");
  const site = createCustomSite(input.value);

  if (!site) {
    setSiteInputMessage("Enter a valid domain like reddit.com.", "error");
    return;
  }

  const conflictingSite = findConflictingTrackedSite(site.domains[0]);
  if (conflictingSite) {
    setSiteInputMessage(`${site.label} overlaps with ${conflictingSite.label}. Add a non-overlapping domain instead.`, "error");
    return;
  }

  const existingSite = trackedSitesState.find((trackedSite) => trackedSite.id === site.id);
  if (existingSite) {
    currentSiteId = existingSite.id;
    await chrome.storage.local.set({ [POPUP_SITE_KEY]: existingSite.id });
    input.value = "";
    setSiteInputMessage(`${existingSite.label} is already in your tracked list.`);
    return;
  }

  const nextCustomSites = [...customSitesState, site];
  const nextBlockedSites = normalizeBlockedSites(
    {
      ...blockedSitesState,
      [site.id]: true
    },
    nextCustomSites
  );

  await chrome.storage.local.set({
    [CUSTOM_SITES_KEY]: nextCustomSites,
    [BLOCKED_SITES_KEY]: nextBlockedSites,
    [POPUP_SITE_KEY]: site.id
  });

  input.value = "";
  setSiteInputMessage(`Added ${site.label}.`);
}

async function initializePopup() {
  const stored = await chrome.storage.local.get([
    DAILY_COUNTS_KEY,
    POPUP_SITE_KEY,
    BLOCK_MODE_KEY,
    BLOCKED_SITES_KEY,
    BADGE_COUNT_VISIBLE_KEY,
    CUSTOM_SITES_KEY
  ]);

  customSitesState = normalizeCustomSites(stored[CUSTOM_SITES_KEY]);
  blockedSitesState = normalizeBlockedSites(stored[BLOCKED_SITES_KEY], customSitesState);
  refreshTrackedSitesState();
  cachedDailyCounts = normalizeDailyCounts(stored[DAILY_COUNTS_KEY]);
  isBlockModeEnabled = stored[BLOCK_MODE_KEY] === true;
  isBadgeCountVisible = stored[BADGE_COUNT_VISIBLE_KEY] !== false;
  currentSiteId = await getDefaultSiteId(stored[POPUP_SITE_KEY]);
  renderPopup();
}

document.getElementById("siteSelect").addEventListener("change", async (event) => {
  currentSiteId = event.target.value;
  await chrome.storage.local.set({ [POPUP_SITE_KEY]: currentSiteId });
  renderPopup();
});

document.getElementById("addSiteForm").addEventListener("submit", addCustomSiteFromForm);
document.getElementById("resetTodayButton").addEventListener("click", resetToday);
document.getElementById("clearHistoryButton").addEventListener("click", clearHistory);
document.getElementById("blockModeToggle").addEventListener("change", async (event) => {
  await chrome.storage.local.set({ [BLOCK_MODE_KEY]: event.target.checked });
});
document.getElementById("badgeCountToggle").addEventListener("change", async (event) => {
  await chrome.storage.local.set({ [BADGE_COUNT_VISIBLE_KEY]: event.target.checked });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[CUSTOM_SITES_KEY]) {
    customSitesState = normalizeCustomSites(changes[CUSTOM_SITES_KEY].newValue);
  }

  if (changes[BLOCKED_SITES_KEY]) {
    blockedSitesState = normalizeBlockedSites(changes[BLOCKED_SITES_KEY].newValue, customSitesState);
  }

  if (changes[DAILY_COUNTS_KEY]) {
    cachedDailyCounts = normalizeDailyCounts(changes[DAILY_COUNTS_KEY].newValue);
  }

  if (changes[POPUP_SITE_KEY] && changes[POPUP_SITE_KEY].newValue in getTrackedSiteMap(customSitesState)) {
    currentSiteId = changes[POPUP_SITE_KEY].newValue;
  }

  if (changes[BLOCK_MODE_KEY]) {
    isBlockModeEnabled = changes[BLOCK_MODE_KEY].newValue === true;
  }

  if (changes[BADGE_COUNT_VISIBLE_KEY]) {
    isBadgeCountVisible = changes[BADGE_COUNT_VISIBLE_KEY].newValue !== false;
  }

  renderPopup();
});

initializePopup();
