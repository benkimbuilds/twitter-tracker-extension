const DAILY_COUNTS_KEY = "twitterDailyCounts";
const POPUP_SITE_KEY = "twitterTrackerPopupSite";
const BLOCK_MODE_KEY = "twitterTrackerBlockMode";
const BLOCKED_SITES_KEY = "twitterTrackerBlockedSites";
const BADGE_COUNT_VISIBLE_KEY = "twitterTrackerBadgeCountVisible";
const CHART_DAYS = 14;
const SVG_NS = "http://www.w3.org/2000/svg";
const DAY_METRIC_CONFIG = {
  sites: "total",
  blockedSites: "blockedTotal",
  savedSites: "savedMinutes"
};

let currentSiteId = getFallbackSiteId([]);
let customSitesState = [];
let trackedSitesState = getTrackedSites(customSitesState);
let trackedSiteMapState = getTrackedSiteMap(customSitesState);
let cachedDailyCounts = {};
let isBlockModeEnabled = false;
let isStayHardEnabled = false;
let isBadgeCountVisible = true;
let blockedOpenMinutesState = DEFAULT_BLOCKED_OPEN_MINUTES;
let blockedSitesState = normalizeBlockedSites({}, customSitesState);

function refreshTrackedSitesState() {
  trackedSitesState = getTrackedSites(customSitesState);
  trackedSiteMapState = getTrackedSiteMap(customSitesState);
  blockedSitesState = normalizeBlockedSites(blockedSitesState, customSitesState);

  if (!currentSiteId || !(currentSiteId in trackedSiteMapState)) {
    currentSiteId = getFallbackSiteId(customSitesState);
  }
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

function formatMinutesSaved(minutes) {
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (remainder === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainder}m`;
}

function getNormalizedDayEntry(entry) {
  return normalizeDayEntry(entry, trackedSiteMapState);
}

function getNormalizedDailyCounts(dailyCounts) {
  return normalizeDailyCounts(dailyCounts, trackedSiteMapState);
}

function isDayEntryEmpty(dayEntry) {
  return (
    dayEntry.total === 0 &&
    dayEntry.blockedTotal === 0 &&
    dayEntry.savedMinutes === 0 &&
    Object.keys(dayEntry.sites).length === 0 &&
    Object.keys(dayEntry.blockedSites).length === 0 &&
    Object.keys(dayEntry.savedSites).length === 0
  );
}

function getSiteMetricForDate(dailyCounts, dateKey, siteId, metricKey) {
  return getNormalizedDayEntry(dailyCounts[dateKey])[metricKey][siteId] ?? 0;
}

function getSiteCountForDate(dailyCounts, dateKey, siteId) {
  return getSiteMetricForDate(dailyCounts, dateKey, siteId, "sites");
}

function getBlockedCountForDate(dailyCounts, dateKey, siteId) {
  return getSiteMetricForDate(dailyCounts, dateKey, siteId, "blockedSites");
}

function getSavedMinutesForDate(dailyCounts, dateKey, siteId) {
  return getSiteMetricForDate(dailyCounts, dateKey, siteId, "savedSites");
}

function setSiteMetricForDate(dailyCounts, dateKey, siteId, metricKey, nextValue) {
  const dayEntry = getNormalizedDayEntry(dailyCounts[dateKey]);
  const totalKey = DAY_METRIC_CONFIG[metricKey];
  const previousValue = dayEntry[metricKey][siteId] ?? 0;
  const safeValue = Math.max(0, Math.round(nextValue));

  if (safeValue > 0) {
    dayEntry[metricKey][siteId] = safeValue;
  } else {
    delete dayEntry[metricKey][siteId];
  }

  dayEntry[totalKey] = Math.max(0, dayEntry[totalKey] - previousValue + safeValue);

  if (isDayEntryEmpty(dayEntry)) {
    delete dailyCounts[dateKey];
    return;
  }

  dailyCounts[dateKey] = dayEntry;
}

function removeSiteFromDailyCounts(dailyCounts, siteId) {
  const nextDailyCounts = getNormalizedDailyCounts(dailyCounts);

  Object.keys(nextDailyCounts).forEach((dateKey) => {
    const dayEntry = getNormalizedDayEntry(nextDailyCounts[dateKey]);

    Object.entries(DAY_METRIC_CONFIG).forEach(([metricKey, totalKey]) => {
      const previousValue = dayEntry[metricKey][siteId] ?? 0;

      if (previousValue === 0) {
        return;
      }

      delete dayEntry[metricKey][siteId];
      dayEntry[totalKey] = Math.max(0, dayEntry[totalKey] - previousValue);
    });

    if (isDayEntryEmpty(dayEntry)) {
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
      count: getSiteCountForDate(dailyCounts, dateKey, siteId),
      blockedCount: getBlockedCountForDate(dailyCounts, dateKey, siteId)
    };
  });
}

function getAccumulatedSiteMetric(dailyCounts, siteId, metricKey) {
  return Object.keys(dailyCounts).reduce(
    (sum, dateKey) => sum + getSiteMetricForDate(dailyCounts, dateKey, siteId, metricKey),
    0
  );
}

function getAccumulatedTotal(dailyCounts, totalKey) {
  return Object.keys(dailyCounts).reduce(
    (sum, dateKey) => sum + getNormalizedDayEntry(dailyCounts[dateKey])[totalKey],
    0
  );
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
  const values = data.flatMap((entry) => [entry.count, entry.blockedCount]);
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

  const openPoints = data.map((entry, index) => {
    const x = padding.left + (innerWidth / (data.length - 1)) * index;
    const y = padding.top + innerHeight - (entry.count / maxValue) * innerHeight;
    return { x, y, count: entry.count };
  });
  const blockedPoints = data.map((entry, index) => {
    const x = padding.left + (innerWidth / (data.length - 1)) * index;
    const y = padding.top + innerHeight - (entry.blockedCount / maxValue) * innerHeight;
    return { x, y, count: entry.blockedCount };
  });

  appendSvgElement(chart, "polyline", {
    points: openPoints.map(({ x, y }) => `${x},${y}`).join(" "),
    fill: "none",
    stroke: "#1d9bf0",
    "stroke-width": "3",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  });

  appendSvgElement(chart, "polyline", {
    points: blockedPoints.map(({ x, y }) => `${x},${y}`).join(" "),
    fill: "none",
    stroke: "#ff8b3d",
    "stroke-width": "3",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  });

  openPoints.forEach(({ x, y, count }) => {
    appendSvgElement(chart, "circle", {
      cx: x,
      cy: y,
      r: 4,
      fill: "#0f1419",
      stroke: "#86cbff",
      "stroke-width": "2"
    }).appendChild(document.createElementNS(SVG_NS, "title")).textContent = `${count} opens`;
  });

  blockedPoints.forEach(({ x, y, count }) => {
    appendSvgElement(chart, "circle", {
      cx: x,
      cy: y,
      r: 4,
      fill: "#0f1419",
      stroke: "#ffc28d",
      "stroke-width": "2"
    }).appendChild(document.createElementNS(SVG_NS, "title")).textContent = `${count} blocked`;
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
  document.getElementById("stayHardToggle").checked = isStayHardEnabled;
  document.getElementById("stayHardToggleCopy").textContent = isStayHardEnabled ? "On" : "Off";
  document.getElementById("blockedOpenMinutesInput").value = String(blockedOpenMinutesState);
  document.getElementById("badgeCountToggle").checked = isBadgeCountVisible;
  document.getElementById("badgeCountToggleCopy").textContent = isBadgeCountVisible ? "On" : "Off";

  const site = trackedSiteMapState[currentSiteId];
  if (!site) {
    return;
  }

  const todayKey = getTodayKey();
  const siteOpensToday = getSiteCountForDate(cachedDailyCounts, todayKey, currentSiteId);
  const blockedTodayCount = getBlockedCountForDate(cachedDailyCounts, todayKey, currentSiteId);
  const timeSavedToday = getSavedMinutesForDate(cachedDailyCounts, todayKey, currentSiteId);
  const siteTimeSavedTotal = getAccumulatedSiteMetric(cachedDailyCounts, currentSiteId, "savedSites");
  const allTimeSavedTotal = getAccumulatedTotal(cachedDailyCounts, "savedMinutes");

  document.getElementById("todayLabel").textContent = `${site.label} today`;
  document.getElementById("todayCount").textContent = String(siteOpensToday);
  document.getElementById("todayDescription").textContent =
    `${site.label} opened ${siteOpensToday} times, blocked ${blockedTodayCount} times, and saved about ${formatMinutesSaved(timeSavedToday)} today.`;
  document.getElementById("blockedTodayCount").textContent = String(blockedTodayCount);
  document.getElementById("timeSavedToday").textContent = formatMinutesSaved(timeSavedToday);
  document.getElementById("siteTimeSavedTotal").textContent = formatMinutesSaved(siteTimeSavedTotal);
  document.getElementById("allTimeSavedTotal").textContent = formatMinutesSaved(allTimeSavedTotal);
  document.getElementById("historyTitle").textContent = `Last 14 days on ${site.label}`;
  document
    .getElementById("historyChart")
    .setAttribute("aria-label", `Line chart of daily ${site.label} opens and blocked visits`);
  renderChart(cachedDailyCounts, currentSiteId);
}

async function resetToday() {
  const nextDailyCounts = getNormalizedDailyCounts(cachedDailyCounts);
  setSiteMetricForDate(nextDailyCounts, getTodayKey(), currentSiteId, "sites", 0);
  setSiteMetricForDate(nextDailyCounts, getTodayKey(), currentSiteId, "blockedSites", 0);
  setSiteMetricForDate(nextDailyCounts, getTodayKey(), currentSiteId, "savedSites", 0);
  await chrome.storage.local.set({ [DAILY_COUNTS_KEY]: nextDailyCounts });
}

async function clearHistory() {
  const nextDailyCounts = getNormalizedDailyCounts(cachedDailyCounts);
  Object.keys(nextDailyCounts).forEach((dateKey) => {
    setSiteMetricForDate(nextDailyCounts, dateKey, currentSiteId, "sites", 0);
    setSiteMetricForDate(nextDailyCounts, dateKey, currentSiteId, "blockedSites", 0);
    setSiteMetricForDate(nextDailyCounts, dateKey, currentSiteId, "savedSites", 0);
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
    CUSTOM_SITES_KEY,
    STAY_HARD_ENABLED_KEY,
    BLOCKED_OPEN_MINUTES_KEY
  ]);

  customSitesState = normalizeCustomSites(stored[CUSTOM_SITES_KEY]);
  blockedSitesState = normalizeBlockedSites(stored[BLOCKED_SITES_KEY], customSitesState);
  refreshTrackedSitesState();
  cachedDailyCounts = getNormalizedDailyCounts(stored[DAILY_COUNTS_KEY]);
  isBlockModeEnabled = stored[BLOCK_MODE_KEY] === true;
  isStayHardEnabled = stored[STAY_HARD_ENABLED_KEY] === true;
  isBadgeCountVisible = stored[BADGE_COUNT_VISIBLE_KEY] !== false;
  blockedOpenMinutesState = normalizeBlockedOpenMinutes(stored[BLOCKED_OPEN_MINUTES_KEY]);
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
document.getElementById("stayHardToggle").addEventListener("change", async (event) => {
  await chrome.storage.local.set({ [STAY_HARD_ENABLED_KEY]: event.target.checked });
});
document.getElementById("blockedOpenMinutesInput").addEventListener("change", async (event) => {
  const nextValue = normalizeBlockedOpenMinutes(Number(event.target.value));
  event.target.value = String(nextValue);
  await chrome.storage.local.set({ [BLOCKED_OPEN_MINUTES_KEY]: nextValue });
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
    cachedDailyCounts = getNormalizedDailyCounts(changes[DAILY_COUNTS_KEY].newValue);
  }

  if (changes[POPUP_SITE_KEY] && changes[POPUP_SITE_KEY].newValue in getTrackedSiteMap(customSitesState)) {
    currentSiteId = changes[POPUP_SITE_KEY].newValue;
  }

  if (changes[BLOCK_MODE_KEY]) {
    isBlockModeEnabled = changes[BLOCK_MODE_KEY].newValue === true;
  }

  if (changes[STAY_HARD_ENABLED_KEY]) {
    isStayHardEnabled = changes[STAY_HARD_ENABLED_KEY].newValue === true;
  }

  if (changes[BLOCKED_OPEN_MINUTES_KEY]) {
    blockedOpenMinutesState = normalizeBlockedOpenMinutes(changes[BLOCKED_OPEN_MINUTES_KEY].newValue);
  }

  if (changes[BADGE_COUNT_VISIBLE_KEY]) {
    isBadgeCountVisible = changes[BADGE_COUNT_VISIBLE_KEY].newValue !== false;
  }

  renderPopup();
});

initializePopup();
