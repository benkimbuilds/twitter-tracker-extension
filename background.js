const DAILY_COUNTS_KEY = "twitterDailyCounts";
const LEGACY_COUNT_KEY = "twitterOpenCount";

function isTwitterUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname === "x.com" || parsedUrl.hostname === "twitter.com";
  } catch {
    return false;
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

  return dailyCounts;
}

async function setDailyCounts(dailyCounts) {
  await chrome.storage.local.set({ [DAILY_COUNTS_KEY]: dailyCounts });
}

async function migrateLegacyCount() {
  const stored = await chrome.storage.local.get([DAILY_COUNTS_KEY, LEGACY_COUNT_KEY]);
  const legacyCount = stored[LEGACY_COUNT_KEY];
  const existingDailyCounts = stored[DAILY_COUNTS_KEY];

  if (typeof legacyCount !== "number") {
    if (!existingDailyCounts) {
      await setDailyCounts({});
    }
    return;
  }

  const dailyCounts =
    existingDailyCounts && typeof existingDailyCounts === "object" && !Array.isArray(existingDailyCounts)
      ? existingDailyCounts
      : {};

  const todayKey = getTodayKey();
  dailyCounts[todayKey] = (dailyCounts[todayKey] ?? 0) + legacyCount;

  await chrome.storage.local.set({
    [DAILY_COUNTS_KEY]: dailyCounts
  });
  await chrome.storage.local.remove(LEGACY_COUNT_KEY);
}

async function incrementOpenCount() {
  const dailyCounts = await getDailyCounts();
  const todayKey = getTodayKey();
  dailyCounts[todayKey] = (dailyCounts[todayKey] ?? 0) + 1;
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

  if (!isTwitterUrl(details.url)) {
    return;
  }

  await incrementOpenCount();
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

    await chrome.tabs.create({
      url: chrome.runtime.getURL("popup.html")
    });
    sendResponse({ ok: true, mode: "tab" });
  })();

  return true;
});
