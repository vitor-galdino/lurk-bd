<div align="center">

# Lurk

**See who typed to you and gave up, catch ghost pings and deleted messages, and keep an eye on your VIPs.**

A [BetterDiscord](https://betterdiscord.app) plugin by [Vitor](https://github.com/vitor-galdino)

[![Download](https://img.shields.io/badge/download-Lurk.plugin.js-43b581)](https://github.com/vitor-galdino/lurk-bd/releases/latest/download/Lurk.plugin.js)

</div>

---

## Features

### ⌨️ Typed & quit
- Logs everyone who starts typing in your DMs or group DMs and stops **without sending**: when they started, how long they typed, when they stopped, and how many attempts they made.
- Works for anyone with a DM to you, including people who aren't your friends and DMs you've closed.
- Their avatar shows up in the server sidebar, under the Discord button, with a typing indicator on top. Click it to open the DM.
- Marks "sent later" when the person eventually sends a message.
- Optional status log (online, idle, invisible, device) at the moment they typed.

### ⭐ VIP list
Add people from their right-click menu or by user ID, and Lurk keeps a closer watch on them:
- **Status timeline**: online, idle, DND, offline and device, plus time online today. Lurk can tell when a friend is **invisible** (they show as offline but are typing or sending messages).
- **Last online** under their name in your DM list ("offline for 2h"). Optionally also how long they've been online, at the top of the open conversation and in server member lists.
- **Profile changes**: name, username and avatar changes for every VIP, with the old and new avatar side by side.
- **Watch profile** for one VIP at a time: connected accounts added or removed, bio, pronouns and banner, checked every 15 minutes.
- **Messages** in shared servers and DMs, including **edited and deleted** messages and their attachments.
- **Typed & quit in servers**, across all your shared servers. Experimental and off by default; Lurk explains the risks before you turn it on.
- **Voice calls**: channel, who was there, how long, and mute, deafen, camera and screen-share changes.
- **Routine**: a map of the days and hours they're usually online over the last 4 weeks, their most active hours and day, daily average, when they usually come online and leave, this week compared with last week, the best time to talk to them, when they talk the most, and whether they're on desktop or mobile.
- Per-VIP choice of which events notify you, including when they send a message in a server.

### 🕘 VIP history
A single feed (clock button in the top bar) with an unread badge:
- **Messages**: every message your VIPs sent, with filters for deleted, edited and server messages you asked to be notified about, in DMs and servers.
- **Search** through all VIP messages by text, person, channel or server, optionally including old messages.
- **Old messages**: when VIP messages reach the limit, the oldest ones are archived instead of deleted. Browse, search or delete each archive right inside Lurk.
- **Status**: every status change.
- **Profile**: name, username, avatar, connections, bio, pronouns and banner changes.
- **People**: each VIP with their full history.

### @ Mentions
- **Ghost pings**: someone mentions you, then deletes the message or edits the mention out.
- **Deleted replies** to your messages.
- **Removed reactions** on your messages.
- **Keywords**: whole-word, case- and accent-insensitive, with an option to ignore muted servers.

### 👤 New contacts
- **First-time typers**: someone who never talked to you typed and stopped without sending. People who do send aren't listed, which keeps spam bots out.
- **Canceled friend requests**: someone sent you a request and took it back.

### 🔔 Friends
Off by default; turn it on in **Settings → Friends**. A top bar button with an unread counter (no notifications):
- **New requests**: every pending friend request with when it was sent, account age, mutual friends and mutual servers (hover to see who) and Nitro. Accept, decline or view the profile right from the card.
- **Tags**: *New account*, *Possible bot* (a very new account with no mutual friends, no connected accounts and no Nitro) and *You declined* for people you already declined who asked again.
- **Quick filters**: All · Mutual · New account · Bots.
- **Spam filter**: pick servers to ignore and requests from their members go to **Spam** (right at the top of the list), even if they leave the server afterwards. Optionally send possible bots, or people you already declined, to Spam too.
- **Bulk actions**: decline all possible bots, or everything in Spam, up to 25 at a time with a few seconds between each.
- **Removed you**: people who unfriended you, including while your Discord was closed.

### 📞 Call time
Total time in calls with each person, kept forever, plus the details of your recent calls (when, where and who was there).

### And also
- **Discreet mode**: hides Lurk's buttons and counters, the typing avatar and "offline for…", and silences notifications, while Lurk keeps logging. Toggle it with **Ctrl+Shift+L** (you can change the shortcut), and optionally turn it on automatically while you share your screen.
- **New items are highlighted**, with red counters showing what you haven't seen yet.
- **Notifications** per event: in-app toast, desktop notification and/or sound, with a master switch for in-app toasts.
- **Sounds**: a beep, any Discord sound, or your own audio file, with a volume setting.
- **Focus mode**: silences notifications while you're on Do Not Disturb or playing a game. Everything is still logged.
- **Storage limits** for every log in one place, so Lurk stays light.
- **Automatic backups** that you can restore, plus export and import to a file.
- **Ignore list** for people and groups.
- **English and Portuguese (Brazil)**. Follows your Discord language, or pick one.
- **Choose the icon**: ghost, ninja mask or eye.
- **Updates itself**, and shows what's new after each update.

## Installation

1. Install [BetterDiscord](https://betterdiscord.app).
2. Download **[Lurk.plugin.js](https://github.com/vitor-galdino/lurk-bd/releases/latest/download/Lurk.plugin.js)** from the [latest release](https://github.com/vitor-galdino/lurk-bd/releases/latest).
3. Open Discord → **User Settings → Plugins → Open Plugins Folder** and drop the file there.
4. Turn **Lurk** on.

## Usage

| Where | What it does |
| --- | --- |
| Lurk button (top bar) | Opens Lurk: typed & quit, VIPs, mentions, new contacts, calls and settings |
| Clock button (top bar) | VIP history: deleted/edited messages, search, old messages, status changes, people |
| Direct messages list | How long each VIP has been offline, under their name |
| Friends button (top bar) | Pending friend requests, spam filter and who removed you |
| Server sidebar | Avatar of whoever is typing to you right now; click to open the DM |
| Right-click a user | See their attempts, add or remove them as VIP, see call time, ignore them |
| Right-click a group or channel | See typing attempts and deleted/edited messages there |
| Settings → Plugins → Lurk ⚙️ | All settings, with search |

Discord only sends the typing signal about every 10 seconds, so typing durations are shown as approximate ranges.

## Updates

Lurk keeps itself up to date. After each update, a window shows what's new in that version.

## Privacy

- Everything Lurk records stays **on your computer**, in BetterDiscord's plugins folder (`Lurk.config.json`, `LurkVIPMessages.config.json`, `LurkBackup.config.json`… and the `LurkArchives` folder). Discord PTB and Canary keep their own separate copies (`Lurk_ptb.config.json`, `Lurk_canary.config.json`…). Nothing is uploaded anywhere.
- Lurk only talks to Discord itself (for example to load a friend request's profile or accept a request) and to this repository to download its own updates. Nothing goes to any other server.
- Lurk only sees what your Discord client already receives. It can't read other people's DMs or servers you're not in.
- Don't share your config files or the `LurkArchives` folder: they contain your logs.

## Disclaimer

Client modifications are against Discord's Terms of Service. Use BetterDiscord and this plugin at your own risk. Please respect other people's privacy.

## License

[MIT](LICENSE)
