# Social Open Tracker

`Social Open Tracker` is a lightweight Chrome extension that tracks how many times you open LinkedIn, YouTube, X/Twitter, Facebook, and Instagram, then keeps a local daily history on your machine.

It adds a draggable floating counter across normal web pages and a popup with:

- today's open count
- a 14-day history chart
- an optional block mode with per-site blocking controls
- local-only storage with no backend or account sync

## Features

- Tracks top-level visits to LinkedIn, YouTube, X/Twitter, Facebook, and Instagram
- Shows a floating badge across regular websites
- Can block individual supported sites behind a blocker screen
- Saves badge position locally after you move it
- Resets the visible count naturally by storing data per calendar day
- Displays daily history in the extension popup
- Stores all data in `chrome.storage.local`

## Install Locally

1. Clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select this project folder.

## How It Works

- The background service worker listens for top-level navigations to LinkedIn, YouTube, X/Twitter, Facebook, and Instagram.
- Opens are counted into daily buckets using a local date key like `YYYY-MM-DD`.
- Each day's data stores an aggregate total plus per-site counts.
- The content script injects the floating badge across regular websites.
- On tracked sites it shows that site's count for the day; elsewhere it shows the total across all tracked sites for today.
- When block mode is enabled, the same content script swaps only the selected tracked sites for a local blocker overlay instead.
- The popup reads the same local store and renders the recent chart.

## Privacy

This extension is intentionally local-first.

- No analytics
- No remote server
- No account login
- No data sale or transfer
- No sync outside the current browser profile unless Chrome itself moves your profile data

Tracked data is limited to:

- daily open counts
- saved floating badge position

## Permissions

- `storage`: saves your daily counts and badge position locally
- `tabs`: used when opening the popup fallback flow from the floating badge
- `webNavigation`: counts top-level opens of the tracked sites
- `host_permissions` for LinkedIn, YouTube, X/Twitter, Facebook, and Instagram: required to detect and count visits on those tracked sites

## Development

Main files:

- `manifest.json`
- `background.js`
- `content.js`
- `content.css`
- `popup.html`
- `popup.css`
- `popup.js`

## Publishing Notes

Before Chrome Web Store submission, make sure your store listing clearly states:

- the single purpose of the extension
- that data is stored locally
- that it only operates on LinkedIn, YouTube, X/Twitter, Facebook, and Instagram pages

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by LinkedIn, Google/YouTube, Meta, X Corp., or Twitter.
