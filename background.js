importScripts("sites.js");

const DAILY_COUNTS_KEY = "twitterDailyCounts";
const LEGACY_COUNT_KEY = "twitterOpenCount";
const BLOCK_MODE_KEY = "twitterTrackerBlockMode";
const BLOCKED_SITES_KEY = "twitterTrackerBlockedSites";

function normalizeDayEntry(entry, trackedSiteMap) {
  if (typeof entry === "number") {
    return {
      total: entry,
      sites: entry > 0 && trackedSiteMap.twitter ? { twitter: entry } : {}
    };
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return {
      total: 0,
      sites: {}
    };
  }

  const sites =
    entry.sites && typeof entry.sites === "object" && !Array.isArray(entry.sites)
      ? Object.fromEntries(
          Object.entries(entry.sites)
            .filter(([siteId, count]) => siteId in trackedSiteMap && Number.isFinite(count) && count > 0)
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

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getTrackerConfig() {
  const stored = await chrome.storage.local.get([CUSTOM_SITES_KEY, BLOCK_MODE_KEY, BLOCKED_SITES_KEY]);
  const customSites = normalizeCustomSites(stored[CUSTOM_SITES_KEY]);

  return {
    customSites,
    trackedSiteMap: getTrackedSiteMap(customSites),
    blockedSites: normalizeBlockedSites(stored[BLOCKED_SITES_KEY], customSites),
    isBlockModeEnabled: stored[BLOCK_MODE_KEY] === true
  };
}

async function getDailyCounts(trackedSiteMap) {
  const stored = await chrome.storage.local.get(DAILY_COUNTS_KEY);
  const dailyCounts = stored[DAILY_COUNTS_KEY];

  if (!dailyCounts || typeof dailyCounts !== "object" || Array.isArray(dailyCounts)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(dailyCounts).map(([dateKey, entry]) => [dateKey, normalizeDayEntry(entry, trackedSiteMap)])
  );
}

async function setDailyCounts(dailyCounts) {
  await chrome.storage.local.set({ [DAILY_COUNTS_KEY]: dailyCounts });
}

async function migrateLegacyCount() {
  const trackerConfig = await getTrackerConfig();
  const stored = await chrome.storage.local.get([DAILY_COUNTS_KEY, LEGACY_COUNT_KEY]);
  const legacyCount = stored[LEGACY_COUNT_KEY];
  const existingDailyCounts = stored[DAILY_COUNTS_KEY];
  const normalizedDailyCounts =
    existingDailyCounts && typeof existingDailyCounts === "object" && !Array.isArray(existingDailyCounts)
      ? Object.fromEntries(
          Object.entries(existingDailyCounts).map(([dateKey, entry]) => [
            dateKey,
            normalizeDayEntry(entry, trackerConfig.trackedSiteMap)
          ])
        )
      : {};

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
  const todayEntry = normalizedDailyCounts[todayKey] ?? normalizeDayEntry(undefined, trackerConfig.trackedSiteMap);
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

async function incrementOpenCount(siteId, trackedSiteMap) {
  const dailyCounts = await getDailyCounts(trackedSiteMap);
  const todayKey = getTodayKey();
  const todayEntry = dailyCounts[todayKey] ?? normalizeDayEntry(undefined, trackedSiteMap);
  todayEntry.total += 1;
  todayEntry.sites[siteId] = (todayEntry.sites[siteId] ?? 0) + 1;
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

  if (trackerConfig.isBlockModeEnabled && trackerConfig.blockedSites[siteId] === true) {
    return;
  }

  await incrementOpenCount(siteId, trackerConfig.trackedSiteMap);
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
