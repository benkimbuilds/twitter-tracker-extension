# Twitter Open Tracker

`Twitter Open Tracker` is a lightweight Chrome extension that tracks how many times you open `x.com` and keeps a local daily history on your machine.

It adds a draggable floating counter on `x.com` and a popup with:

- today's open count
- a 14-day history chart
- local-only storage with no backend or account sync

## Features

- Tracks top-level visits to `x.com` and `twitter.com`
- Shows a floating badge only on `x.com`
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

- The background service worker listens for top-level navigations to `x.com` and `twitter.com`.
- Opens are counted into daily buckets using a local date key like `YYYY-MM-DD`.
- The content script injects the floating badge only on `x.com`.
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
- `webNavigation`: counts top-level opens of X/Twitter
- `host_permissions` for `https://x.com/*` and `https://twitter.com/*`: required to detect those pages and inject the on-page badge on `x.com`

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
- that it only operates on X/Twitter pages

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by X Corp. or Twitter.
