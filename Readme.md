# Personal Gym Workout Tracker

A lightweight, single-file personal workout tracker. No backend or database: workouts remain in your browser's localStorage. The backend is deferred to version 2.

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

## Run locally

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open http://127.0.0.1:8765/ in your browser. Use a consistent URL and port to retain access to the same browser data.

## Saving and editing

Sets save automatically when added, updated, or repeated. The **Finish workout** button commits all logged sets to history in the same storage write that clears the draft. Add or clear any partially entered set before finishing. Empty exercise blocks are not included in history.

Each exercise accepts up to three new sets. After the third set, its card collapses and the next unfinished exercise opens. Tap any card header to reopen it for review or editing. The set-entry controls stay above the logged sets, and **Finish workout** stays accessible at the bottom while scrolling.

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

## Data and offline behavior

Data is specific to the browser, device, and website origin. Clearing browser storage can remove workouts and recovery copies. JSON exports remain important.

Workout data is not sent to a backend. Chart.js is loaded from jsDelivr; the browser makes a network request for that library. If it is unavailable, workout logging and numeric progress statistics still work.

The app has no service worker yet. Keeping the already-loaded app open can work without connectivity, but reopening it offline is not guaranteed. Installable offline support, reusable routines, and expanded progress metrics remain follow-up improvements.

## Verification

Run the dependency-free regression suite with Node.js:

```sh
TZ=Asia/Colombo node --test tests/app.test.cjs
```

Tests cover atomic saves, failed writes, legacy migration, draft recovery, special exercise names, input validation, backup validation/restore/undo, history editing, cross-tab conflict detection, and local calendar dates. They use a small DOM stub, so browser and iPhone checks remain separate.
