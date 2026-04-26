# Personal Gym Workout Tracker

A lightweight, single-file gym tracking app. No backend, no database — all data lives in your browser's `localStorage`.

## Features

- Log workout sessions with multiple exercises per day
- Per-exercise set logging (weight + reps per set)
- Bar weight support — enter plates only, app adds the bar and shows total
- Save individual exercises mid-session (crash protection)
- Commit the full day's session with one button
- Progress chart and personal bests per exercise
- Export / restore data as JSON backup
- Works offline after first load
- Light and dark mode support

## Deploying to GitHub Pages (free hosting)

### Step 1 — Create a GitHub account
Go to [github.com](https://github.com) and sign up if you don't have an account.

### Step 2 — Create a new repository
1. Click the **+** icon (top right) → **New repository**
2. Name it `gym-tracker`
3. Set it to **Public**
4. Click **Create repository**

### Step 3 — Upload the file
1. On the repository page, click **Add file** → **Upload files**
2. Drag and drop `index.html` into the upload area
3. Scroll down and click **Commit changes**

### Step 4 — Enable GitHub Pages
1. Go to **Settings** (top tab of your repo)
2. Scroll down to **Pages** in the left sidebar
3. Under **Source**, select **Deploy from a branch**
4. Set branch to `main`, folder to `/ (root)`
5. Click **Save**

### Step 5 — Access your app
After a minute or two, your app will be live at:
```
https://YOUR_USERNAME.github.io/gym-tracker
```

Bookmark this URL on your phone and laptop. Done!

---

## Data & privacy

All data is stored in `localStorage` in your own browser — nothing is sent to any server.

**Important:** localStorage is per-browser, per-device. To move data between devices:
1. Go to the **Data** tab in the app
2. Click **Download gym-data.json** on your old device
3. Open the app on your new device
4. Click **Choose backup file** and upload the JSON

## Updating the app

If you want to update the app in the future, just upload a new `index.html` to your GitHub repo — GitHub Pages will redeploy automatically within a minute.
