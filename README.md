# Cory's Plex Hub

A dark, glassmorphism **Plex request & discovery app** — browse trending movies and TV, request titles for the Plex server, and track new episodes. Installable as a PWA, mobile-friendly, with Google sign-in.

![Cory's Plex Hub](assets/hero.png)

🔗 **Live:** [plex-updates.vercel.app](https://plex-updates.vercel.app)

## Features

- 🎬 Browse trending movies & TV powered by the **TMDB API**
- ✅ Request titles and track request status
- 🔐 **Google sign-in** to save your requests and watchlist
- 📺 Episode tracking for new releases
- 🌗 Dark glassmorphism UI with a light-theme toggle
- 📱 Installable **PWA** with offline support (service worker)

## Tech

HTML5 · JavaScript · TMDB API · Firebase/Google Auth · Service Workers (PWA)


## Run your own copy (wired to PlexClaw)

One command on Windows, from a clone of this repo:

```powershell
.\setup-plexupdates.ps1 -PlexClawDir "C:\path	o\PlexClaw"
```

It installs the Firebase and Vercel CLIs if needed, creates the Firebase project, web app and Firestore database, writes your admin email, the family member's simplified view and your TMDB key into the site, deploys the rules and the site, and points PlexClaw at the project. Add `-DryRun` to preview every step.

Three things stay in the Firebase console because they have no CLI: enable Google sign-in, authorize the Vercel domain, and generate the service-account key that PlexClaw uses for write-back (save it as `data\plexhub_service_account.json` inside PlexClaw). PlexClaw then polls the request list every 15 minutes, downloads what is missing, marks requests as On Plex, publishes the library so the site can badge titles you already have, and drives the admin dashboard's Sync, Rescan and Grab buttons.
