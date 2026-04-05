# Social Open Tracker

`Social Open Tracker` is a lightweight Chrome extension that tracks how many times you open the websites you care about, then keeps a local daily history on your machine.

It adds a floating counter across normal web pages and a popup with:

- today's open count
- a 14-day history chart
- an optional block mode with per-site blocking controls
- custom website tracking you can add yourself
- local-only storage with no backend or account sync

## Features

- Tracks top-level visits to the built-in social sites plus any custom websites you add
- Shows a floating badge across regular websites
- Lets you hide or show the floating badge count from the popup
- Can block individual tracked websites behind a blocker screen
- Pins the floating badge to the bottom-right corner on every page
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

- The background service worker listens for top-level navigations to built-in sites and any custom domains you add.
- Opens are counted into daily buckets using a local date key like `YYYY-MM-DD`.
- Each day's data stores an aggregate total plus per-site counts.
- The content script injects the floating badge across regular websites and keeps it pinned to the bottom-right corner.
- The floating badge always shows the eyes icon. On tracked sites it can also show that site's live count; on non-tracked sites it stays eyes-only.
- The popup can hide the numeric badge count on tracked sites while leaving the eyes badge and tracking behavior in place.
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
- your custom tracked-site list
- your per-site block settings
- your badge count visibility preference

## Permissions

- `storage`: saves your daily counts and tracked-site settings locally
- `tabs`: used when opening the popup fallback flow from the floating badge
- `webNavigation`: counts top-level opens of tracked websites
- `host_permissions` for regular websites: required so custom domains can be detected, counted, and blocked

## Development

Main files:

- `manifest.json`
- `sites.js`
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
- that it can operate on built-in sites plus any domains the user adds manually

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by LinkedIn, Google/YouTube, Meta, X Corp., Twitter, or any other tracked website.
