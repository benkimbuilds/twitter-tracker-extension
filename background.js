const DAILY_COUNTS_KEY = "twitterDailyCounts";
const LEGACY_COUNT_KEY = "twitterOpenCount";
const BLOCK_MODE_KEY = "twitterTrackerBlockMode";
const BLOCKED_SITES_KEY = "twitterTrackerBlockedSites";
const TRACKED_SITES = {
  facebook: {
    domains: ["facebook.com"]
  },
  instagram: {
    domains: ["instagram.com"]
  },
  linkedin: {
    domains: ["linkedin.com"]
  },
  twitter: {
    domains: ["x.com", "twitter.com"]
  },
  youtube: {
    domains: ["youtube.com"]
  }
};
const TRACKED_SITE_IDS = Object.keys(TRACKED_SITES);

function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function getTrackedSiteId(url) {
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

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getDailyCounts() {
  const stored = await chrome.storage.local.get(DAILY_COUNTS_KEY);
  const dailyCounts = stored[DAILY_COUNTS_KEY];

  if (!dailyCounts || typeof dailyCounts !== "object" || Array.isArray(dailyCounts)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(dailyCounts).map(([dateKey, entry]) => [dateKey, normalizeDayEntry(entry)])
  );
}

async function setDailyCounts(dailyCounts) {
  await chrome.storage.local.set({ [DAILY_COUNTS_KEY]: dailyCounts });
}

function normalizeDayEntry(entry) {
  if (typeof entry === "number") {
    return {
      total: entry,
      sites: entry > 0 ? { twitter: entry } : {}
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

function normalizeBlockedSites(blockedSites) {
  if (!blockedSites || typeof blockedSites !== "object" || Array.isArray(blockedSites)) {
    return Object.fromEntries(TRACKED_SITE_IDS.map((siteId) => [siteId, true]));
  }

  return Object.fromEntries(
    TRACKED_SITE_IDS.map((siteId) => [siteId, blockedSites[siteId] !== false])
  );
}

async function migrateLegacyCount() {
  const stored = await chrome.storage.local.get([DAILY_COUNTS_KEY, LEGACY_COUNT_KEY]);
  const legacyCount = stored[LEGACY_COUNT_KEY];
  const existingDailyCounts = stored[DAILY_COUNTS_KEY];
  const normalizedDailyCounts =
    existingDailyCounts && typeof existingDailyCounts === "object" && !Array.isArray(existingDailyCounts)
      ? Object.fromEntries(
          Object.entries(existingDailyCounts).map(([dateKey, entry]) => [dateKey, normalizeDayEntry(entry)])
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
  const todayEntry = normalizedDailyCounts[todayKey] ?? normalizeDayEntry();
  todayEntry.total += legacyCount;
  todayEntry.sites.twitter = (todayEntry.sites.twitter ?? 0) + legacyCount;
  normalizedDailyCounts[todayKey] = todayEntry;

  await chrome.storage.local.set({
    [DAILY_COUNTS_KEY]: normalizedDailyCounts
  });
  await chrome.storage.local.remove(LEGACY_COUNT_KEY);
}

async function incrementOpenCount(siteId) {
  const dailyCounts = await getDailyCounts();
  const todayKey = getTodayKey();
  const todayEntry = dailyCounts[todayKey] ?? normalizeDayEntry();
  todayEntry.total += 1;
  todayEntry.sites[siteId] = (todayEntry.sites[siteId] ?? 0) + 1;
  dailyCounts[todayKey] = todayEntry;
  await setDailyCounts(dailyCounts);
}

async function isSiteBlockingEnabled(siteId) {
  const stored = await chrome.storage.local.get([BLOCK_MODE_KEY, BLOCKED_SITES_KEY]);
  if (stored[BLOCK_MODE_KEY] !== true) {
    return false;
  }

  const blockedSites = normalizeBlockedSites(stored[BLOCKED_SITES_KEY]);
  return blockedSites[siteId] === true;
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

  const siteId = getTrackedSiteId(details.url);

  if (!siteId) {
    return;
  }

  if (await isSiteBlockingEnabled(siteId)) {
    return;
  }

  await incrementOpenCount(siteId);
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
    if (message.siteId && message.siteId in TRACKED_SITES) {
      popupUrl.searchParams.set("site", message.siteId);
    }

    await chrome.tabs.create({
      url: popupUrl.toString()
    });
    sendResponse({ ok: true, mode: "tab" });
  })();

  return true;
});
