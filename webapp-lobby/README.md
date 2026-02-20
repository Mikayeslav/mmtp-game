# MMtp — Math Card Game

Educational multiplayer card game where players build mathematical expressions to match target numbers.

---

## Quick Start

### Run Locally
1. **Simple**: Open `index.html` in a browser
2. **Multi-device**: Run `start-server.bat` or:
   ```bash
   python -m http.server 8000 --bind 0.0.0.0
   ```
   Then access from other devices: `http://YOUR_IP:8000`

### How to Play
1. Press any key to start
2. Enter your name
3. Host a room or join with a 4-digit code
4. Build expressions to match target numbers
5. First to 5 points wins!

---

## Documentation

- **`CONCEPT.md`** - Game vision, ideas, and design principles
- **`ROADMAP.md`** - Implementation status and detailed feature list
- **`SETUP_MULTIDEVICE.md`** - Guide for playing across multiple devices

---

## Features

- ✅ Full gameplay (expressions, scoring, turns)
- ✅ Multiplayer (localStorage sync for testing)
- ✅ Player stats & progression (XP, levels)
- ✅ Match statistics & post-game breakdown
- ✅ XP notifications (Call of Duty style)
- ✅ Cheat panel for testing (Ctrl+Shift+C)
- ✅ Keyboard shortcuts
- ✅ Help system

---

## Tech Stack

- Vanilla HTML/CSS/JavaScript (no build step)
- localStorage for state persistence
- Dark theme, responsive design

---

**Version**: 0.2 enhanced  
**Status**: Core gameplay complete, production server pending
