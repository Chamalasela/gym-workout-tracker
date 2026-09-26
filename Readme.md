# Personal Gym Workout Tracker

A lightweight personal workout tracker, available as a website or an installable offline web app (PWA). No backend, account, or database: workouts remain in your browser's localStorage. Hosted on the existing GitHub Pages site with no paid services. The backend is deferred to version 2.

## Features

- Automatically save sets, session date, and unfinished weight/reps input on this device
- Finish a workout with one button; every exercise containing sets is included
- Edit and repeat sets, and edit completed workouts without replacing the original until saved
- See the previous workout's sets while logging an exercise
- Compact exercise cards: one open at a time, with automatic advancement after the third set
- Alphabetical ordering only in the Log workout exercise picker; logged exercises retain entry order
- Bar weight support: enter the combined plates on both sides; the app adds the bar
- History, maximum-weight progress charts, and workout days in the last seven days
- Dated JSON backups containing history, exercise preferences, and the active draft
- Validated backup restore with an on-device recovery copy and undo
- Local calendar dates and light/dark mode
- Home Screen installation and offline reopening, including progress charts
- Offline readiness indicator, guided Safari data transfer, and explicit app updates

## Run locally

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open http://127.0.0.1:8765/ in your browser. Use a consistent URL and port to retain access to the same browser data.

The service worker requires HTTPS or localhost. Once installed, it serves the cached release. When developing, use your browser's developer tools to unregister the local service worker or change the release in `sw.js` and `pwa.js`; an ordinary reload intentionally keeps the working cached version.

## Saving and editing

Sets save automatically when added, updated, or repeated. The **Finish workout** button commits all logged sets to history in the same storage write that clears the draft. Add or clear any partially entered set before finishing. Empty exercise blocks are not included in history.

Each exercise accepts up to three new sets. After each saved set, the large set-entry controls tuck away and the logged sets stay visible. Tap **Add next set** to bring the controls back, or **Repeat last set** to log the same weight and reps. Editing or partially typed input stays visible. After the third set, its card collapses and the next unfinished exercise opens. Tap any card header to reopen it for review or editing. **Finish workout** stays accessible at the bottom while scrolling.

Existing backups, history, and drafts with more than three sets are retained in full. You can edit or remove their existing sets, but cannot add another set while the exercise has three or more. These interface changes do not change the storage format or migrate existing data.

Use **Edit workout** in History to load a completed workout for corrections. Finish your current draft first. The original stays in history until **Save workout changes** succeeds; **Cancel workout edits** discards the edits.

The app detects a newer save from another tab and asks you to reload rather than overwrite it. Prefer keeping one editing tab open.

## Backups and migration

- **Data → Download dated backup** exports version 4 JSON, including the draft, its date, pending set input, and any in-progress history edits.
- **Choose backup file** previews validated version 4 backups and older backups with the original sessions/exercises structure, including files without a version or exercise metadata. Restore replaces history, preferences, and the draft together.
- **Undo last restore** returns to the snapshot made before the latest successful restore attempt. It replaces any later edits too. Keep separate JSON files for durable backups; the recovery copy is on the same device.
- On first use, the app reads the previous `gym_sessions`, `gym_exercises`, `gym_ex_meta`, and `gym_draft` keys. The next successful save uses one `gym_state_v4` record. Legacy keys remain untouched for recovery, but are not kept up to date.
- The previous app did not store draft dates. Recovered legacy drafts therefore show a reminder to check the date.
- Invalid saved data is not silently overwritten. A recovery download is offered, and changes are blocked until a valid backup is restored. Raw recovery downloads are for manual recovery, not direct import.
- Historical numeric values accepted by the old app, including zero/negative reps or weights, remain readable. Recorded totals are preserved, including when editing other sets. New or explicitly edited sets still require nonnegative weights and positive integer reps; changing bar settings recalculates that exercise's totals.
- Invalid data structures, dates, unknown backup versions, duplicate workout IDs, and nonnumeric set values are rejected before restore. Restore errors stay visible beside the file picker.
- **Review data from the previous version** previews the untouched legacy storage. Nothing changes until you confirm. An unreadable old draft is identified and excluded from that recovery preview, while readable history stays accessible; its raw original remains available for recovery.

Regression fixtures cover older accepted data and malformed drafts. A particular personal backup still needs to pass the restore preview before it can be restored.

## Install on iPhone without losing Safari data

1. Open the existing [GitHub Pages app](https://chamalasela.github.io/gym-workout-tracker/) in Safari. Under **Data**, download a dated backup to Files and note its workout, set, exercise, and draft counts.
2. Use Safari's Share menu (sometimes inside More) → **Add to Home Screen**. Enable **Open as Web App** if offered, then tap Add.
3. Open the new icon while online and wait for **Offline ready**.
4. Safari and the Home Screen app can have separate storage. If the installed app is empty, choose the JSON file under **Data → Choose backup file**, compare the preview counts, and confirm **Restore backup**. Restore replaces that app's history, settings, and draft.
5. Check History, the latest workout date, and the backup counts in the installed app. Keep the JSON file and original Safari data until verified. Future logging in Safari and the installed app does not automatically sync.

The same installation/transfer guide is available inside the app. Browsers with a built-in installation prompt also receive an Install button when available. Continuing to use Safari is fine; installation is optional.

## Data and offline behavior

Data is specific to the browser, device, and website origin. Clearing browser storage can remove workouts and recovery copies. JSON exports remain important.

Workout data is not sent to a backend. Chart.js 4.4.1 is bundled locally under `vendor/`, with its MIT license, so charts do not depend on an external CDN.

After the first successful online load, the service worker caches the app and all required assets. **Offline ready** is shown only after the controlling worker confirms that the complete app is cached. You can then reopen the app, log workouts, view history/charts, and import/export backups without reaching the server. Browsers may evict website storage; offline files are not a backup of your workouts.

The offline layer never reads, writes, migrates, or deletes localStorage. Version 4 workout data and older backup compatibility remain unchanged. The worker only manages caches belonging to this app's URL path. A failed download leaves the previous offline release available.

An available update displays **Update app**. It waits while a workout, history edit, restore, or new exercise name is in progress. Only the tab that requests the update can reload automatically, and its state is checked again before reloading. If every app window closes, the browser may activate a waiting update naturally; saved drafts remain in localStorage. **Data → Use as an app on your iPhone → Check for updates** retries offline setup and checks for new releases.

## Deploy to GitHub Pages

Publish the repository root, keeping the existing origin and `/gym-workout-tracker/` path. Deploy `index.html`, `pwa.js`, `sw.js`, `manifest.webmanifest`, `icons/`, and `vendor/` together. There is no build step and no secret or service account to configure.

For each release that changes cached files, bump the matching release literals in **both** `sw.js` and `pwa.js`. The worker fetches the complete new shell before offering the update. Verify that all assets return HTTP 200 on Pages and that **Offline ready** appears. Test an offline reopen and a backup restore before relying on the installation on another device.

Reusable routines, a rest timer, expanded progress metrics, and optional sync remain follow-up improvements.

## Verification

Run the dependency-free regression suite with Node.js:

```sh
TZ=Asia/Colombo node --test tests/*.test.cjs
```

Tests cover atomic saves, failed writes, legacy migration, draft recovery, special exercise names, input validation, backup validation/restore/undo, history editing, cross-tab conflict detection, local calendar dates, offline caches, and update handling. They use small browser API stubs, so real browser and iPhone checks remain separate.
