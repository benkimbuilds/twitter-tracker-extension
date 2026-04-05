const DAILY_COUNTS_KEY = "twitterDailyCounts";
const POPUP_SITE_KEY = "twitterTrackerPopupSite";
const BLOCK_MODE_KEY = "twitterTrackerBlockMode";
const CHART_DAYS = 14;
const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_SITE_ID = "twitter";
const TRACKED_SITES = {
  linkedin: {
    label: "LinkedIn",
    domains: ["linkedin.com"]
  },
  youtube: {
    label: "YouTube",
    domains: ["youtube.com"]
  },
  twitter: {
    label: "Twitter",
    domains: ["x.com", "twitter.com"]
  },
  facebook: {
    label: "Facebook",
    domains: ["facebook.com"]
  },
  instagram: {
    label: "Instagram",
    domains: ["instagram.com"]
  }
};

let currentSiteId = DEFAULT_SITE_ID;
let cachedDailyCounts = {};
let isBlockModeEnabled = false;

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

function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function getTrackedSiteIdFromUrl(url) {
  if (!url) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    return (
      Object.entries(TRACKED_SITES).find(([, site]) =>
        site.domains.some((domain) => matchesDomain(parsedUrl.hostname, domain))
      )?.[0] ?? null
    );
  } catch {
    return null;
  }
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
      sites: entry > 0 ? { twitter: entry } : {}
    };
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return emptyDayEntry();
  }

  const sites =
    entry.sites && typeof entry.sites === "object" && !Array.isArray(entry.sites)
      ? Object.fromEntries(
          Object.entries(entry.sites)
            .filter(([siteId, count]) => siteId in TRACKED_SITES && Number.isFinite(count) && count > 0)
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

  const polylinePoints = points.map(({ x, y }) => `${x},${y}`).join(" ");
  appendSvgElement(chart, "polyline", {
    points: polylinePoints,
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

async function getDailyCounts() {
  const stored = await chrome.storage.local.get(DAILY_COUNTS_KEY);
  return normalizeDailyCounts(stored[DAILY_COUNTS_KEY]);
}

async function getBlockMode() {
  const stored = await chrome.storage.local.get(BLOCK_MODE_KEY);
  return stored[BLOCK_MODE_KEY] === true;
}

async function getDefaultSiteId() {
  const requestedSiteId = new URLSearchParams(window.location.search).get("site");
  if (requestedSiteId && requestedSiteId in TRACKED_SITES) {
    return requestedSiteId;
  }

  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });
    const activeSiteId = getTrackedSiteIdFromUrl(activeTab?.url);
    if (activeSiteId) {
      return activeSiteId;
    }
  } catch {
    // Ignore and fall back to stored preference.
  }

  const stored = await chrome.storage.local.get(POPUP_SITE_KEY);
  if (stored[POPUP_SITE_KEY] && stored[POPUP_SITE_KEY] in TRACKED_SITES) {
    return stored[POPUP_SITE_KEY];
  }

  return DEFAULT_SITE_ID;
}

function renderPopup() {
  const site = TRACKED_SITES[currentSiteId];
  document.getElementById("blockModeToggle").checked = isBlockModeEnabled;
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

async function initializePopup() {
  const [dailyCounts, defaultSiteId, blockModeEnabled] = await Promise.all([
    getDailyCounts(),
    getDefaultSiteId(),
    getBlockMode()
  ]);
  cachedDailyCounts = dailyCounts;
  currentSiteId = defaultSiteId;
  isBlockModeEnabled = blockModeEnabled;
  const siteSelect = document.getElementById("siteSelect");
  siteSelect.value = currentSiteId;
  renderPopup();
}

document.getElementById("siteSelect").addEventListener("change", async (event) => {
  currentSiteId = event.target.value;
  await chrome.storage.local.set({ [POPUP_SITE_KEY]: currentSiteId });
  renderPopup();
});

document.getElementById("resetTodayButton").addEventListener("click", resetToday);
document.getElementById("clearHistoryButton").addEventListener("click", clearHistory);
document.getElementById("blockModeToggle").addEventListener("change", async (event) => {
  await chrome.storage.local.set({ [BLOCK_MODE_KEY]: event.target.checked });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[DAILY_COUNTS_KEY]) {
    cachedDailyCounts = normalizeDailyCounts(changes[DAILY_COUNTS_KEY].newValue);
  }

  if (changes[POPUP_SITE_KEY] && changes[POPUP_SITE_KEY].newValue in TRACKED_SITES) {
    currentSiteId = changes[POPUP_SITE_KEY].newValue;
    document.getElementById("siteSelect").value = currentSiteId;
  }

  if (changes[BLOCK_MODE_KEY]) {
    isBlockModeEnabled = changes[BLOCK_MODE_KEY].newValue === true;
  }

  renderPopup();
});

initializePopup();
