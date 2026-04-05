importScripts("sites.js");

const DAILY_COUNTS_KEY = "twitterDailyCounts";
const LEGACY_COUNT_KEY = "twitterOpenCount";
const BLOCK_MODE_KEY = "twitterTrackerBlockMode";
const BLOCKED_SITES_KEY = "twitterTrackerBlockedSites";

async function getTrackerConfig() {
  const stored = await chrome.storage.local.get([
    CUSTOM_SITES_KEY,
    BLOCK_MODE_KEY,
    BLOCKED_SITES_KEY,
    BLOCKED_OPEN_MINUTES_KEY
  ]);
  const customSites = normalizeCustomSites(stored[CUSTOM_SITES_KEY]);

  return {
    customSites,
    trackedSiteMap: getTrackedSiteMap(customSites),
    blockedSites: normalizeBlockedSites(stored[BLOCKED_SITES_KEY], customSites),
    isBlockModeEnabled: stored[BLOCK_MODE_KEY] === true,
    blockedOpenMinutes: normalizeBlockedOpenMinutes(stored[BLOCKED_OPEN_MINUTES_KEY])
  };
}

async function getDailyCounts(trackedSiteMap) {
  const stored = await chrome.storage.local.get(DAILY_COUNTS_KEY);
  const dailyCounts = stored[DAILY_COUNTS_KEY];
  return normalizeDailyCounts(dailyCounts, trackedSiteMap);
}

async function setDailyCounts(dailyCounts) {
  await chrome.storage.local.set({ [DAILY_COUNTS_KEY]: dailyCounts });
}

async function migrateLegacyCount() {
  const trackerConfig = await getTrackerConfig();
  const stored = await chrome.storage.local.get([DAILY_COUNTS_KEY, LEGACY_COUNT_KEY]);
  const legacyCount = stored[LEGACY_COUNT_KEY];
  const existingDailyCounts = stored[DAILY_COUNTS_KEY];
  const normalizedDailyCounts = normalizeDailyCounts(existingDailyCounts, trackerConfig.trackedSiteMap);

  if (typeof legacyCount !== "number") {
    if (!existingDailyCounts) {
      await setDailyCounts({});
      return;
    }

    if (JSON.stringify(existingDailyCounts) !== JSON.stringify(normalizedDailyCounts)) {
      await setDailyCounts(normalizedDailyCounts);
    }
    return;
  }

  const todayKey = getTodayKey();
  const todayEntry = normalizedDailyCounts[todayKey] ?? createEmptyDayEntry();
  if (trackerConfig.trackedSiteMap.twitter) {
    todayEntry.total += legacyCount;
    todayEntry.sites.twitter = (todayEntry.sites.twitter ?? 0) + legacyCount;
    normalizedDailyCounts[todayKey] = todayEntry;
  }

  await chrome.storage.local.set({
    [DAILY_COUNTS_KEY]: normalizedDailyCounts
  });
  await chrome.storage.local.remove(LEGACY_COUNT_KEY);
}

async function incrementVisit(siteId, trackedSiteMap, { blocked = false, savedMinutes = 0 } = {}) {
  const dailyCounts = await getDailyCounts(trackedSiteMap);
  const todayKey = getTodayKey();
  const todayEntry = dailyCounts[todayKey] ?? createEmptyDayEntry();

  if (blocked) {
    todayEntry.blockedTotal += 1;
    todayEntry.blockedSites[siteId] = (todayEntry.blockedSites[siteId] ?? 0) + 1;

    if (savedMinutes > 0) {
      todayEntry.savedMinutes += savedMinutes;
      todayEntry.savedSites[siteId] = (todayEntry.savedSites[siteId] ?? 0) + savedMinutes;
    }
  } else {
    todayEntry.total += 1;
    todayEntry.sites[siteId] = (todayEntry.sites[siteId] ?? 0) + 1;
  }

  dailyCounts[todayKey] = todayEntry;
  await setDailyCounts(dailyCounts);
}

chrome.runtime.onInstalled.addListener(async () => {
  await migrateLegacyCount();
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateLegacyCount();
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) {
    return;
  }

  const trackerConfig = await getTrackerConfig();
  const siteId = findTrackedSiteIdByUrl(details.url, trackerConfig.customSites);

  if (!siteId) {
    return;
  }

  const isBlockedVisit = trackerConfig.isBlockModeEnabled && trackerConfig.blockedSites[siteId] === true;

  if (isBlockedVisit) {
    await incrementVisit(siteId, trackerConfig.trackedSiteMap, {
      blocked: true,
      savedMinutes: trackerConfig.blockedOpenMinutes
    });
    return;
  }

  await incrementVisit(siteId, trackerConfig.trackedSiteMap);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "OPEN_TRACKER_POPUP") {
    return;
  }

  (async () => {
    try {
      if (chrome.action?.openPopup) {
        await chrome.action.openPopup();
        sendResponse({ ok: true, mode: "popup" });
        return;
      }
    } catch {
      // Fall through to the tab fallback when popup opening is unavailable.
    }

    const popupUrl = new URL(chrome.runtime.getURL("popup.html"));
    if (typeof message.siteId === "string" && message.siteId) {
      popupUrl.searchParams.set("site", message.siteId);
    }

    await chrome.tabs.create({
      url: popupUrl.toString()
    });
    sendResponse({ ok: true, mode: "tab" });
  })();

  return true;
});
