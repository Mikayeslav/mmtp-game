# MMtp — Update Notes

## Session 22 (2026-02-20) — Nearest Score Rule & Rule Balance (v0.9.8)

### Nearest Score Rule
- **New game rule**: "Nearest Score" checkbox in lobby — when enabled, players earn partial points for expressions that are close but not exactly equal to the target
- **Scoring tiers**: Exact match = 1pt, off-by-1 = 0.5pt, off-by-2 = 0.25pt
- **Visual feedback**: Amber flash (`playfield-near-scored`) for near scores vs green for exact
- **Toast messages**: Distinguish exact vs near scores with difference amount shown
- **Server-authoritative**: `game-engine.js` validates and awards fractional `pointsAwarded` in `scored` broadcast
- **Bot AI updated**: `botCanScore()` helper and `evaluateAllPlays`/`evaluateDeepPlays` now consider near-score plays when rule is enabled
- **Fractional score display**: HUD and game-over modal format scores to 1 decimal place via `formatScore()`
- **Built-in presets**: Chaos & Beginner enable `nearestScore: true` by default

### Rule Balance Adjustments
- **Default timer**: 45s → **20s** (snappier turns, more urgency)
- **Default target max**: 99 → **10** (much more feasible to score with small hands)
- **Timer clamp**: [10–300] → **[5–60]** seconds (tighter range for all presets)
- **Target range clamp**: [-99, 99] → **[-50, 50]** (keeps targets reasonable)
- **All built-in presets** updated to reflect new default ranges
- **Chaos preset**: targetMax 99 → 50 (within new clamp)

### Incompatibility Fixes
- Fixed HTML `<input>` min/max attributes to match JS `RULES_CLAMP` values
- Fixed gameplay.html default timer display (00:45 → 00:20)
- Fixed online game-over handler to use `formatScore()` for fractional scores
- Fixed near-score toast message (was showing `target ± 0` instead of actual target)
- Updated `GAMEPLAY_FLOW.md` defaults to match new values

### Files Modified
- `index.html` — New "Nearest Score" checkbox, updated input min/max/value attributes
- `app.js` — `DEFAULTS`, `RULES_CLAMP`, `state.rules`, preset sync, event listeners updated
- `gameplay.js` — `tryScore()` rewritten for nearest scoring, `formatScore()`, `botCanScore()`, fractional display
- `gameplay.css` — `.playfield-near-scored` + `@keyframes nearScoreFlash`
- `server/game-engine.js` — `_handleScore()` updated for fractional scoring + `isNearScore` broadcast
- `server/rooms.js` — `nearestScore: false` added to room defaults
- `bot-ai-v2.js` — `evaluateAllPlays`/`evaluateDeepPlays` accept `nearestScore` option
- `gameplay.html` — Timer displays updated to 00:20
- `GAMEPLAY_FLOW.md` — Defaults updated (timer 20s, target 1..10)
- `ROADMAP.md` — Updated to v0.9.8 with new features

### Version
- Bumped to v0.9.8

---

## Session 21 (2026-02-20) — In-Game UI, Chat & Expression Deduplication (v0.9.7)

### In-Game Expression History Panel
- **Collapsible panel** in gameplay HUD (📜 button) showing all scored expressions
- Logs player name, expression string, result, and round number for each score
- Auto-scrolls to latest entry; toggleable via click or keyboard
- Populated from both local scoring and server `scored` events in multiplayer

### In-Game Chat System
- **Real-time chat widget** (💬 button) for multiplayer games
- Messages sent/received via WebSocket (`chatMessage` event)
- Chat input with Enter-to-send, auto-scroll to latest message
- Unread message badge counter when chat is collapsed
- Only visible in online multiplayer rooms (hidden in bot/local games)

### Round Counter
- **Round badge** in gameplay HUD showing current round number (e.g., "Round 3")
- Increments automatically when a player scores
- Provides at-a-glance context for how far into the match players are

### Expression Evaluator Deduplication
- **`server/expression.js` converted to UMD** (Universal Module Definition)
  - Works in Node.js via `require('./expression')` (unchanged for server)
  - Works in browser as `window.MMtpExpression` global (new for client)
- **`gameplay.js` refactored**: Removed duplicated `CardType`, `OperatorKind`, `SpecialKind`, `ParenKind` constants and `evaluateExpression()`, `evaluateLeftToRight()`, `evaluateStandard()`, `clientCanPlaceCard()`, `clientValidateParenBalance()`, `clientHasParens()`, `clientResolveParens()` functions — all replaced with `MMtpExpression.*` calls
- **`bot-ai-v2.js` refactored**: Removed duplicated `CardType`, `OperatorKind`, `ParenKind` and `evaluateExpressionFromCards()` — replaced with `MMtpExpression.evaluate()` call
- **Single source of truth**: All expression evaluation logic now lives in one file, preventing drift between client and server

### Files Modified
- `server/expression.js` — UMD wrapper added, exports `MMtpExpression` in browser
- `gameplay.html` — Added `<script src="server/expression.js">` before bot-ai-v2.js
- `gameplay.js` — Removed ~150 lines of duplicated evaluator code, uses `MMtpExpression.*`
- `gameplay.css` — New styles for expression history panel, chat widget, round badge
- `bot-ai-v2.js` — Removed ~40 lines of duplicated evaluator, uses `MMtpExpression.*`
- `ROADMAP.md` — Updated to v0.9.7 with new features and resolved tech debt
- `UPDATE_NOTES.md` — This entry

### Version
- Bumped to v0.9.7

---

## Session 20 (2026-02-20) — Parentheses, Preset Sharing & Bot AI Upgrade (v0.9.6)

### Parentheses Support
- **New card type**: `Paren` cards with `(` and `)` variants appear in the deck (~5% of cards)
- **Expression grouping**: Players can build expressions like `( 3 + 2 ) × 4 = 20` to override operator precedence
- **Placement rules**: `(` can follow operators or start an expression; `)` can follow numbers or other `)`
- **Balance validation**: Parentheses must be balanced before scoring — enforced on both client and server
- **Recursive evaluation**: Innermost parentheses resolved first, works with both left-to-right and standard math precedence
- **Shared validation**: `canPlaceCard()` and `canScore()` exported from `expression.js` for consistent client/server logic
- **Visual design**: Green gradient cards with distinct `(` and `)` symbols, teal color on playfield
- **Sorting**: Paren cards sorted between operators and specials in hand

### Preset Sharing (Export/Import)
- **📤 Export button**: Download all custom presets as `mmtp-presets.json`
- **📥 Import button**: Upload a JSON file to import presets; duplicate names are skipped
- Enables sharing rule configurations between players across devices

### Bot AI Optimization
- **5-card deep lookahead**: Hard bot now evaluates N/O/N/O/N combinations when 3-card combos don't score
- **Reachability scoring**: Intermediate expressions get bonus points if a single op+num extension can reach target
- **Improved distance heuristic**: Uses tiered scoring (close/medium/far) instead of linear penalty
- **`applyOp()` helper**: Utility function for evaluating single operations, used in reachability analysis
- **Paren-aware playfield extension**: Bot correctly identifies when a `(` or `)` ends the playfield

### Files Modified
- `expression.js` — Added `ParenKind`, `canPlaceCard()`, `canScore()`, paren-aware evaluation
- `gameplay.js` — Paren card rendering, placement validation, expression evaluation with parens, sort update
- `gameplay.css` — Paren card styles (green gradient, teal text, playfield token style)
- `game-engine.js` — Server-side paren support: deck generation, placement, scoring, sort, exprToString
- `bot-ai-v2.js` — Deep lookahead, reachability scoring, paren handling, applyOp utility
- `app.js` — Preset export/import functions and event listeners
- `index.html` — Export/Import buttons in preset bar

### Version
- Bumped to v0.9.6

---

## Session 19 (2026-02-20) — Custom Presets, Achievements & Advanced Operators (v0.9.5)

### Custom Rule Presets
- **Save presets**: Save current rule configuration with a custom name
- **Load presets**: Dropdown selector to apply saved preset instantly
- **Delete presets**: Remove saved presets from the dropdown
- Presets stored in `localStorage` under `mmtp-rule-presets` key
- Presets include: handSize, timer, targetMin, targetMax, winPoints, rehandDraw, minDraw, maxDraw, specialCards

### Achievements System (10 Achievements)
- **🏆 First Win**: Win your first game
- **🔥 On Fire**: Win 3 games in a row (streak)
- **⭐ Card Shark**: Play 100+ total cards
- **🎯 Sharpshooter**: Score 50+ expressions across all games
- **📈 Level Up**: Reach level 5
- **🏅 Veteran**: Play 25+ total games
- **💪 Dominator**: Win 10+ total games
- **⚡ Speed Demon**: Win a game within 60 seconds (tracked via match duration)
- **🎰 High Roller**: Reach 1500+ rating
- **🌟 Legend**: Reach level 10
- Achievement modal accessible via "🏆 Achievements" button in lobby
- Toast notification when achievement unlocks
- Persistent tracking via `localStorage` (`mmtp-achievements` key)

### Advanced Operators
- **Modulo (%)**: Remainder after division — appears in ~20% of operator cards
- **Power (^)**: Exponentiation — appears in ~10% of operator cards
- **Correct precedence** in standard math mode: Power → Multiply/Divide/Modulo → Add/Subtract
- Left-to-right mode evaluates all operators sequentially as before
- **Division/Modulo by zero** protection: returns error instead of crashing
- **Overflow protection**: Power results checked for NaN/Infinity
- Bot AI (`bot-ai-v2.js`) evaluates Modulo and Power in expression scoring
- Server game engine (`game-engine.js`) generates and validates both operators
- Shared expression evaluator (`expression.js`) updated for both operators
- Unique card styling: Modulo = purple gradient, Power = orange/gold gradient

### Files Modified
- `index.html` — Preset dropdown, save/delete buttons, achievements button + modal
- `styles.css` — Preset and achievement modal styles
- `app.js` — Preset logic (save/load/delete), achievement tracking + rendering
- `gameplay.js` — Modulo/Power in deck, rendering, evaluation, sorting
- `gameplay.css` — Card styles for Modulo and Power operators
- `game-engine.js` — Server-side deck generation, expression display, sorting
- `expression.js` — Shared evaluator with Modulo and Power support
- `bot-ai-v2.js` — Bot AI expression evaluation with advanced operators

### Version
- Bumped to v0.9.5

---

## Session 18 (2026-02-20) — Special Cards System (v0.9.0)

### 5 Special Card Types Implemented
- **★ Wild**: Choose any number 0-9 via picker overlay; replaces the card in-hand
- **🎯 Reroll**: Instantly rerolls the current target to a new random number
- **×2 Double**: Next successful score counts double (×2 buff indicator shown)
- **👁️ Peek**: Reveals opponent's hand for 5 seconds with countdown timer bar
- **🔄 Swap**: Randomly swaps one of your non-special cards with one of opponent's

### Special Card Infrastructure
- `SpecialKind` enum extended in both client (`gameplay.js`) and server (`expression.js`)
- `createDeck()` / `_createDeck()` generates ~7% specials when enabled, evenly distributed
- Each card type has unique gradient background, icon, and label
- Wild card uses a number picker overlay (0-9 grid)
- Peek uses a full-screen overlay showing opponent's cards with a countdown timer
- Swap selects random non-special cards from both hands and exchanges them

### Server-Authoritative Validation
- `game-engine.js` `_handleUseSpecial()` handles all 5 types server-side
- Peek: sends `peekRevealed` event only to the peeking player (opponent's hand not leaked)
- Swap: validates both players have swappable cards, broadcasts `cardSwapped` event
- Double: sets `_doubleBuff[pid]` flag, applied and cleared on next score
- Reroll: generates new target, broadcasts `targetRerolled`
- Wild: validates chosen value 0-9, replaces card in hand

### Bot AI for Special Cards
- Hard bot uses Reroll when current hand can't reach target (50% chance)
- Hard bot uses Double before scoring when confident (40% chance)
- Hard bot uses Peek to see opponent's hand (50% chance)
- Hard bot uses Swap to disrupt opponent (30% chance)
- Medium/Easy bots don't use special cards (except Wild at random)

### Host Toggle for Special Cards
- Added "Special Cards" checkbox in lobby rules section
- `specialCards` rule defaults to `true`, persisted in game rules
- When disabled, no special cards appear in deck (more numbers/operators instead)
- Server respects `specialCards=false` in `_createDeck()`

### Network Events Added
- `targetRerolled`, `doubleActivated`, `doubleDeactivated`
- `peekRevealed`, `peekUsed`, `cardSwapped`
- All forwarded through `net-client.js`

### CSS Additions
- Gradient backgrounds for each special type (Wild=gold, Reroll=teal, Double=crimson, Peek=purple, Swap=orange)
- Peek overlay with card grid and countdown timer
- Wild picker overlay with 0-9 number grid

---

## Session 17 (2026-02-20) — Player Profile Sync (v0.8.0)

### Profile Sync System
- **`server/profiles.js`**: Server-side profile storage using JSON file (`profiles.json`)
- 6-character alphanumeric profile codes for cross-device access
- Save/load player stats (name, level, XP, wins, losses, draws, rating, streaks)
- Profiles auto-expire after 90 days of inactivity

### Client Integration
- Profile sync section added to lobby UI (generate code, enter existing code)
- Auto-save profile after each game ends
- Profile code displayed prominently for easy sharing
- Load profile restores all stats and player name

### API Endpoints
- `POST /api/profile/save` — save profile with code
- `POST /api/profile/load` — load profile by code

---

## Session 16 (2026-02-20) — Sound Effects (v0.7.5)

### Web Audio API Sound Engine (`sfx.js`)
- 15 procedural sounds generated entirely with Web Audio API (no audio files)
- Sounds: cardSelect, cardPlace, cardDraw, cardDiscard, score, scoreMiss, turnChange, timerTick, timerWarning, gameWin, gameLose, gameDraw, buttonClick, deckShuffle, levelUp, peek
- Volume and mute controls, respects "Sound Effects" setting in lobby
- `window.SFX` global for easy integration

### Integration Points
- Card selection, placement, drawing, discarding
- Scoring (hit/miss), turn changes, timer ticks
- Game over (win/lose/draw), deck reshuffle
- Lobby button clicks, level-up notifications

---

## Session 15 (2026-02-20) — Mobile UI Polish (v0.7.0)

### Lobby Mobile Fixes
- Server info bar wraps properly on small screens
- Invite link section uses column layout on mobile
- QR code scales to fit viewport
- Player panel text sizes reduced for readability
- Rules grid uses single-column layout below 480px

### Gameplay Mobile Fixes
- Cards scale to fit 5-7 per row without overflow
- Playfield uses full width, reduced padding
- HUD elements stack vertically on narrow screens
- Score zones don't overflow on small displays
- Turn indicator arrow scales down
- Timer and deck elements repositioned for mobile
- Game-over modal fits within viewport

### Touch Improvements
- `touch-action: manipulation` on all interactive elements
- `user-scalable=no` in viewport meta to prevent accidental zoom
- Larger touch targets for cards and buttons on mobile

---

## Session 14 (2026-02-20) — Public Tunnel & Cross-Network Play (v0.6.5)

### Localtunnel Integration
- `--public` flag on server enables localtunnel for internet-accessible URL
- Auto-fetches tunnel password (host's public IP) for visitor verification
- Auto-retry on tunnel close (up to 10 attempts)
- `start-public.bat` script for easy public server launch

### Invite Links & QR Codes
- Server auto-detects LAN IP addresses and displays in lobby
- "Copy Invite Link" button generates shareable URL with `?join=XXXX`
- `qr.js`: Minimal QR code generator (SVG, zero dependencies)
- QR code displayed inline in lobby for easy mobile scanning
- Public tunnel URL displayed when available

### Cloud Deployment Config
- `render.yaml` created for Render.com deployment
- Environment variables configured for production

---

## Session 13 (2026-02-20) — Multiplayer Bug Fixes & Polish (v0.6.0)

### Critical Multiplayer Fixes
- **Room constructor init order**: `sessionTokens` map initialized before `addPlayer()` call (was crashing)
- **Browser autofill**: Bot checkbox autofill caused online rooms to use localStorage mode — added `autocomplete="off"` and explicit state sync on load
- **`file://` protocol**: Detect and redirect to `http://localhost:3000` when opened from filesystem
- **Connection resilience**: `connect_error` handler no longer marks server unavailable during transport fallback
- **Cache busting**: Added `Cache-Control: no-store` headers for all static files during development

### Temporal Dead Zone Fix
- `p1Stats`/`p2Stats` in `endGame()` were `const` declared after their first usage — moved declarations before usage

### Spacebar Key Fix
- Changed `e.key === 'Space'` to `e.code === 'Space'` for correct spacebar detection

### Server Improvements
- Server IP auto-detection for lobby display
- Room cleanup on disconnect/leave
- Detailed server-side logging for debugging

---

## Session 12 (2026-02-20) — Server Testing & Bug Fixes (v0.5.0)

### Node.js Server Testing
- Installed Node.js, ran `npm install`, started server on port 3000
- Tested full lobby flow: hosting, joining, bot mode, game start
- Verified WebSocket connection (Socket.io) connects successfully
- Confirmed bot/offline mode uses localStorage fallback (not WebSocket)
- Verified full bot game cycle: lobby → host → ready → start → gameplay (cards, timer, scoring)

### Critical Bug Fix: Bot Mode vs Online Mode
- **Bug**: When `onlineMode` was true (server reachable), `onHost()` would try to create online rooms even for bot games
- **Fix**: Added `wantBot` check — if bot/simulateP2 is active, skip online hosting
- Added `state.isOnlineRoom` flag to track whether current room is actually on the server
- Updated `onLeave`, `onReady`, `onStart`, `onRulesChange`, and all server event handlers to use `state.isOnlineRoom` instead of global `onlineMode`

### Critical Bug Fix: Online UI Rendering (6 broken function calls)
- **Bug**: `applyServerState()` and online event handlers called non-existent functions:
  - `renderScores()` → should be `updateScores()`
  - `renderTimer()` → should be `updateTimer()`
  - `renderTurnIndicator()` → should be `updateTurn()`
  - `showTurnTransition()` → didn't exist, created wrapper using `showTurnBanner()`
  - `showScoreFlash()` → didn't exist, created to add `playfield-scored` CSS class
  - `showGameOverModal()` → didn't exist, created to call `endGame()` for stat tracking + modal display
- **Impact**: In online mode, the UI would not update scores, timer, or turn indicator after receiving server state
- **Fix**: Corrected all 5 render function names and created 3 missing wrapper functions

### Bug Fix: Online gameOver Match Stats
- **Bug**: `gameState.matchStats.players` was empty when `gameOver` event fired in online mode
- **Fix**: Added server→client mapping in the `gameOver` event handler to populate local `matchStats` from server data before calling `showGameOverModal()`

### UI Polish: Connection Status Indicator
- **Bug**: Two conflicting functions (`updateConnectionStatus` and `updateConnectionIndicator`) managed the same `#connection-status` element using different methods (CSS classes vs. inline styles)
- **Fix**: Consolidated into single `updateConnectionStatus(status, roomCode)` function using CSS classes (`connected`, `disconnected`, `local-only`)
- Added new `.connection-status.local-only` CSS class with softer orange styling (was showing alarming red "disconnected" for bot/local games)

### UI Polish: Gameplay Help Text
- **Bug**: Help text said "Drag card to discard zone" even though visible discard zone was removed
- **Fix**: Updated to "Select card(s) and press Delete/D"

### Verified Bot Game Flow (End-to-End)
- Full cycle works cleanly: Lobby → Host → Bot checkbox → Ready → Start → Gameplay
- No console errors during gameplay
- Cards, timer, scoring, deck, turn indicator all functional
- Bot plays turns correctly across all 3 difficulty levels

### Documentation Updates
- **ROADMAP.md**: Updated to v0.5.0 — Phase 2 (WebSocket) marked complete, Phase 4 (Unity) marked abandoned, multiplayer table updated, file structure includes server files
- **CONCEPT.md**: Removed Unity integration references, updated architecture to reflect implemented server
- **MULTIPLAYER_PLAN.md**: Updated Phase B/C status to reflect completed features (reconnection, session tokens, graceful disconnect)

---

## Session 11 (2026-02-20) — Real Multiplayer WebSocket Server (v0.5.0)

### Unity Version Abandoned
- All Unity C# code (`MMtp/Assets/Scripts/`) is fully abandoned
- Unity networking scaffolding (NGO, UnityTransport) no longer relevant
- MMtp is 100% a web-based game now

### WebSocket Server Created (`server/`)
- **`server/package.json`** — Node.js project with Express + Socket.io deps
- **`server/index.js`** — Main entry: Express static file server + Socket.io WebSocket
  - Serves `webapp-lobby/` on port 3000
  - Health endpoint: `GET /api/status`
  - Room create/join/leave/ready/start via WebSocket events
  - Game actions validated server-side (draw, place, score, endTurn, etc.)
  - Disconnect handling with 30s reconnection grace period
  - Host promotion if host leaves
  - Room cleanup for expired/empty rooms
- **`server/rooms.js`** — Room management (create, join, leave, reconnect, session tokens)
- **`server/game-engine.js`** — Server-authoritative game engine
  - Deck, hands, turns, scoring, timer all on server
  - Expression evaluation via shared module
  - Per-player state views (you see your hand, opponent count only)
  - Turn timer with auto-end-turn on timeout
  - Rematch support
- **`server/expression.js`** — Shared expression evaluator (left-to-right + standard math)

### Client-Side Network Layer
- **`net-client.js`** — Socket.io client wrapper (`window.MMtpNet`)
  - Connect/disconnect, create/join/leave room
  - Game actions, ready toggle, rules update
  - Event pub/sub, session token persistence, auto-reconnect
- **`index.html`** — Added Socket.io CDN + `net-client.js` script
- **`gameplay.html`** — Added Socket.io CDN + `net-client.js` script

### Lobby Integration (`app.js`)
- `onlineMode` flag: WebSocket when server available, localStorage fallback for bot play
- `onHost()` → tries `MMtpNet.createRoom()` first, falls back to localStorage
- `onJoin()` → tries `MMtpNet.joinRoom()` first, falls back to localStorage
- `onReady()` → sends `setReady` via WebSocket when online
- `onStart()` → sends `startGame` via WebSocket, server `gameStarting` event navigates
- `onLeave()` → sends `leaveRoom` via WebSocket
- Connection status indicator: "Online" (green) or "Local Only" (orange)
- Listens for `lobbyUpdate`, `gameStarting`, `playerLeft`, `playerDisconnected`

### Gameplay Integration (`gameplay.js`)
- `onlineGame` flag: set when `?online=1` URL param present
- All game actions (draw, place, undo, clear, score, endTurn, discard, rehand, sort) send to server when online
- `applyServerState()` — applies authoritative server state to local gameState + re-renders
- Server events: `gameState`, `timerUpdate`, `turnChanged`, `scored`, `scoreMiss`, `gameOver`, `deckReshuffled`, `rematch`, `playerDisconnected`, `playerLeft`
- Rematch button wired to `MMtpNet.requestRematch()` in online mode
- Back to Lobby button calls `MMtpNet.leaveRoom()` in online mode

### Updated Files
- **`start-server.bat`** — Now runs `node server/index.js` instead of Python HTTP server
  - Auto-installs npm dependencies if missing

### How to Run
1. Install Node.js (v18+)
2. Run `start-server.bat` or `cd server && npm install && node index.js`
3. Open `http://localhost:3000` in two browser tabs/devices
4. Host a room → share 4-digit code → join → ready → start

---

## Major Clarification: Webapp is the Real Game

The game **MMtp** is a **2D web-based** card game. All previous references to Unity 3D,
3D tabletop scenes, cameras, crosshairs, and Unity C# milestones are from an **old,
abandoned design**. The active codebase is entirely in `webapp-lobby/`.

---

## Documents Updated

### `DESIGN_DOCUMENT.md` (rewritten)
- Removed all Unity 3D references
- Describes the game as a 2D webapp (vanilla HTML/CSS/JS)
- Documents both scenes: Lobby (index.html) and Gameplay (gameplay.html)
- Lists visual style, architecture, gameplay rules, controls, current build status
- Marks old Unity code as abandoned

### `DEVELOPMENT_GUIDE.md` (rewritten)
- Removed all Unity milestones (CmdConsole, LookAroundCamera, HoverHighlight, etc.)
- New milestones reflect actual webapp development:
  - Milestones 1-8: All COMPLETE (foundation → lobby → gameplay → stats → bot AI)
  - Milestone 9: Production WebSocket server (NOT STARTED)
  - Milestone 10: Advanced features — 4-player, special cards, presets (NOT STARTED)
  - Milestone 11: Unity WebView integration for school requirement (NOT STARTED)
- Documents file structure, architecture, state management, multiplayer sync

### `GAMEPLAY_FLOW.md` (rewritten)
- Removed 3D scene references (camera, crosshair, 3D table objects)
- Full ASCII flowchart for the 2D webapp:
  - Press Any Key → Lobby → Navigate to gameplay.html → Match → Game Over → Return
  - Turn loop: Draw → Select/Place → TryScore → EndTurn → Swap
  - Expression rules, default rules, controls & shortcuts, multiplayer info

---

## What Actually Exists (webapp-lobby/)

| File | Purpose | Status |
|------|---------|--------|
| `index.html` | Lobby (Main Menu) | Complete |
| `app.js` | Lobby logic (~2150 lines) | Complete |
| `styles.css` | Lobby styles | Complete |
| `gameplay.html` | Gameplay scene | Complete |
| `gameplay.js` | Gameplay logic (~5175 lines) | Complete |
| `gameplay.css` | Gameplay styles (~1600 lines) | Complete |
| `bot-ai-v2.js` | Bot AI (expression eval, hand planning) | Complete |
| `net-client.js` | Socket.io client wrapper (MMtpNet) | Complete |
| `server/index.js` | Express + Socket.io server entry | Complete |
| `server/rooms.js` | Room management | Complete |
| `server/game-engine.js` | Server-authoritative game engine | Complete |
| `server/expression.js` | Shared expression evaluator | Complete |
| `server/package.json` | Server dependencies | Complete |
| `start-server.bat` | Node.js server launcher | Updated |
| `CONCEPT.md` | Game vision & ideas | Complete |
| `ROADMAP.md` | Implementation status & features | Complete |
| `GAMEPLAY_FLOW.md` | ASCII gameplay flowchart | Updated |
| `SETUP_MULTIDEVICE.md` | Multi-device play guide | Complete |
| `README.md` | Quick start & overview | Complete |

---

## Session 2 (2025-01-28) — Implementation Fixes

### Lobby Cheat Panel (index.html)
- **Was**: Placeholder text (`<p>Cheat panel content...</p>`)
- **Now**: Full interactive panel with collapsible sections:
  - **Simulate Players**: Simulate P2 checkbox, Auto-Ready Bot
  - **XP & Level**: Add XP (amount input), Reset XP, Set Level, Level +/−
  - **Wins / Losses**: Add wins/losses (amount inputs)
  - **Rating**: Set Rating, +50, −50
  - **Danger Zone**: Reset ALL Stats (with confirmation)
- All elements now match `app.js` handlers that were already wired but had no HTML

### Lobby Settings Panel (index.html)
- **Was**: Only UI Size radio buttons
- **Now**: Full settings panel with:
  - **UI Size**: Small / Normal / Large (radio buttons)
  - **Gameplay**: Card animations, Target highlight, Auto-sort hand, Expression hint, Sound effects
  - **Discard Pile**: Visible cards count, Fade older cards toggle
- All elements match `app.js` settings handlers

### Standard Math Precedence (gameplay.js)
- **Was**: `evaluateStandard()` was a placeholder that just called `evaluateLeftToRight()`
- **Now**: Real two-pass implementation:
  - Pass 1: Resolve `×` and `÷` (higher precedence)
  - Pass 2: Resolve `+` and `−` (lower precedence)
  - Example: `1 + 2 × 3` now correctly evaluates to `7` in standard mode
- Includes division-by-zero check and negative result check

### CSS (styles.css)
- Added styles for cheat panel: sections, collapsible titles, input rows, danger button
- Added styles for settings panel: groups, radios, toggles, input rows

---

## Session 3 (2025-01-28) — Bug Fixes & Dead Code Cleanup

### Bugs Fixed
- **`showGame()` / `onBack()` dead path**: The lobby had a `#game-placeholder` div and `showGame()`/`onBack()` functions from when the game loaded inline. Since the game now navigates to `gameplay.html`, these were dead code. The `syncFromStorage` host path was still calling `showGame()` instead of navigating — fixed to use `window.location.href` like the client path.
- **Hints toggle lost label**: The hints button toggled between `▶` and `▼` but dropped the word "Hints". Fixed to `▶ Hints` / `▼ Hints`.

### Dead Code Removed (app.js)
- `gamePlaceholder` / `btnBack` element refs
- `showGame()` function
- `onBack()` function  
- `btnBack` event listener
- `state.lastReadyStatus` (set but never read)
- `hintsInline` variable (assigned but never used)
- `drawLimit` from `RULES_CLAMP` (future feature, not used in clamping)
- `.personality` display code (field never exists in player data)
- Excessive `console.log` debug spam in `updatePlayerPanel`

### Dead Code Removed (index.html)
- `#game-placeholder` div (game navigates to gameplay.html)

### Dead Code Removed (styles.css)
- `.game-placeholder` styles
- `.personality` styles

### Files Deleted
- `QUICK_REFERENCE.md` — entirely about the old Unity CMD 3D game (CmdConsole, LookAroundCamera, HoverHighlight, PlayField objects, etc.)

---

## Session 4 (2025-01-28) — Bot Stuck Fix

### Bot Watchdog Timer
- Added `botWatchdogTimer` (8 seconds) — if the bot is in a recursive `runBotTurn` loop and hasn't placed a card, scored, or ended its turn within 8s, the watchdog forces `endTurn()`
- Watchdog is cleared in `endTurn()`, `tryScore()`, and `endGame()`

### Bot Infinite Loop Fixes
- **Phase 3A retry bug**: The "can extend but no good card found, retrying" path called `runBotTurn` without incrementing `botReevalAttempts`, so the safety check at the top never triggered. Now increments before retrying and respects `maxReevalAttempts`.
- **Phase 3B placement-failed retry**: If number placement failed, it retried without incrementing attempts. Now increments.

### Result
Bot will now always end its turn within ~8 seconds even if its decision logic gets stuck in a loop.

---

## Session 5 (2025-01-28) — Draws Stat, Rematch, Multiplayer Plan

### Draws Stat
- Added "Draws" to player profile panel (between Losses and Games)
- `state.stats.draws` tracked in `app.js` (load, save, display, reset)
- `gameplay.js` `endGame()` increments `stats.draws` on draw result (`winnerId === 0`)
- Games total now computed as `wins + losses + draws`

### Rematch / Post-Match Buttons
- **Rematch** (green): Resets all game state in-place — new deck, hands, scores, timer, match stats — without page reload
- **New Game** (gray): Full page reload with same rules/role/room
- **Back to Lobby** (blue): Navigate to index.html (unchanged)
- `resetGameState()` properly clears: timers, bot watchdog, sync interval, score zones, playfield, expression, selected cards, match stats

### Match Summary Enriched
- Result banner: large "VICTORY" (green) / "DEFEAT" (red) / "DRAW" (gold) with glow
- Contextual message: "Player 1 defeats Player 2" / "Both players tied!"
- New stats: Turns Played, Total Cards Played, Total Expressions Scored

### Multiplayer Architecture Plan
- Created `MULTIPLAYER_PLAN.md` — full server-authoritative WebSocket design
- Socket.io event reference for lobby + gameplay
- 3-phase migration: shared server → full authority → production deploy
- Anti-cheat, reconnection, bot-on-server design

---

## Session 6 (2025-01-28) — Integrity Audit & Polish

### Integrity Fixes
- **Dead code**: Removed orphaned `cheatSimulateP2`/`cheatAutoReadyP2` from `app.js` (elements removed from HTML in prior session)
- **Missing ID**: Added `id="hud-top"` to `gameplay.html` — UI size toggle button was never appended to gameplay HUD
- **Sync lost after rematch**: `resetGameState()` now restarts `syncInterval` for non-host clients
- **Non-functional cheats**: Wired `cheat-pause-timer` and `cheat-infinite-timer` checkboxes with `timerPaused`/`timerInfinite` state variables
- **Non-functional auto-skip**: Wired `cheat-auto-skip-bot` checkbox — bot turns are instantly ended when enabled
- **Default stats**: Added `draws: 0` to `endGame()` fallback stats object
- **Tab stacking**: Moved game-over tab switching to one-time event delegation (no more duplicate listeners on rematch)
- **Tab reset**: Summary tab is now always active when game-over modal opens
- **Bot restart**: Bot is re-kicked after rematch if `allowBots` is enabled
- **Cheat reset**: Timer cheat checkboxes are unchecked in UI on rematch

### Player Names Polish
- P1 name loaded from localStorage and displayed in hand label + HUD score
- P2 name set to "Bot" when `allowBots` is true
- HUD score labels show actual names instead of hardcoded "P1:"/"P2:"
- Game-over Stats tab headers show actual player names
- Game-over message uses actual names ("Alice defeats Bot")

### Version
- Bumped to v0.3.3

---

## Session 7 — Settings Wiring & Gameplay Polish (v0.3.4)

### Settings Wired into Gameplay
- **Auto-sort hand**: Setting now sorts hand automatically after drawing, dealing, and rehand
- **Card animations**: Fly animations are skipped when the setting is disabled
- **Target highlight**: Target number pulses when it changes (after scoring)

### Turn Transition Feedback
- A center-screen banner briefly appears when the turn changes
- Shows "Your Turn" (green) or "[Name]'s Turn" (gray)
- Auto-fades after ~1 second

### Mobile Responsive (Gameplay)
- Added `@media` breakpoints for 768px and 480px in `gameplay.css`
- Cards, playfield, HUD, modals, and controls scale down for smaller screens
- Game-over modal tabs wrap on narrow screens

### Sound Effects Label
- Changed "not yet implemented" to "coming soon" with disabled checkbox

### Version
- Bumped to v0.3.4

---

## Session 8 — Bot Difficulty Levels (v0.4.0)

### Bot AI: 3 Difficulty Levels
- **Easy**: Slower thinking (250ms base), 25% chance to miss single-card plays, shorter max expression length (-2), draws fewer cards per turn (30% aggression), no discards allowed
- **Medium**: Balanced behavior (120ms base), 2 re-evaluation attempts, standard expression lengths, 60% draw aggression, 1 discard per turn (unchanged from before)
- **Hard**: Fast thinking (60ms base), 3 re-evaluation attempts, longer max expression length (+2), 90% draw aggression, 2 discards per turn, uses BotAIv2 planning engine for optimal N/O/N combos

### Bot Difficulty Selector (Lobby)
- Difficulty dropdown appears below the "Simulate P2 (Bot)" checkbox when bot is enabled
- Options: Easy / Medium / Hard (default: Medium)
- Persisted in rules and passed to gameplay via URL

### BotAIv2 Integration
- `bot-ai-v2.js` is now loaded in `gameplay.html` (was previously dead code)
- Hard difficulty uses `BotAIv2.evaluateAllPlays()` and `findBestPlay()` to find optimal scoring combos
- Places all cards sequentially when a perfect combo is found

### Cheat Panel
- Bot difficulty dropdown in cheat panel now includes "Hard" option

### Cleanup
- Removed "New Game" button from game-over modal (redundant with Rematch; Back to Lobby covers different-rules case)

### Version
- Bumped to v0.4.0

---

## Session 9 — Polish & Quality of Life (v0.4.1)

### Gameplay Polish
- **`?` key opens help panel** (alternative to ESC), cheat panel shortcut documented in help
- **Deck reshuffle notification**: toast + yellow flash on deck button when discard pile is reshuffled back
- **Win streak tracking**: `winStreak` and `bestWinStreak` persisted in player stats, displayed in lobby profile
- **Streak XP bonus**: 3+ win streak awards bonus XP with an orange notification

### Code Cleanup
- **bot-test.html**: Rewrote to use shared `bot-ai-v2.js` instead of duplicated inline code
- **"New Game" button removed**: Redundant with Rematch; "Back to Lobby" covers the different-rules case

### Meta & Branding
- Added SVG favicon (card emoji) to both lobby and gameplay pages
- Added `og:title`, `og:description`, `theme-color` meta tags for sharing/embedding
- Added `meta description` for search engines

### Version
- Bumped to v0.4.1

---

## Session 10 — QoL Polish & Cleanup (v0.4.2)

### Bug Fixes
- **CSS orphan bug**: Fixed orphaned CSS properties in `gameplay.css` (lines 908-915) — floating styles without a selector from old discard zone cleanup were causing parse issues

### Keyboard Shortcut Help Button
- Added a `?` button (bottom-left corner of gameplay screen) that opens the help overlay
- Matches the existing `?` keyboard shortcut — both toggle the same help panel
- Styled as a subtle circular button that highlights on hover

### Deck Reshuffle Notification Enhancement
- Enhanced reshuffle toast message with 🔄 emoji and clearer wording
- Added animated `+N` count badge that pops up on the deck button when discard pile is reshuffled
- Badge auto-removes after 2 seconds with the flash animation

### Win Streak Counter in Gameplay HUD
- Added streak badge in the top HUD bar (next to turn indicator)
- Shows `🔥 N streak` when player has 2+ consecutive wins
- Badge tooltip shows current streak and best streak
- Updates live when match ends (win resets on loss/draw)
- Pulsing animation draws attention to active streaks

### Cleanup
- **Deleted `bot-test.html`**: Outdated standalone test page — bot testing is fully integrated into the gameplay cheat panel
- **Meta tags**: Added `og:title`, `og:description`, `og:type`, and `meta description` to `gameplay.html` (lobby already had them)
- **Apple touch icon**: Added `apple-touch-icon` to both lobby and gameplay pages

### Version
- Bumped to v0.4.2

---

## What's Next

1. **Cloud Deployment**: Deploy server to Render/Fly.io/Railway for permanent public URL (tunnel works for now)
2. **4-Player Support**: UI layout + turn order for 3-4 players
3. **Special Card Cost System**: Balancing specials with a cost mechanic
4. **Tournament Mode**: Bracket competitions
5. **Replay System**: Match replay viewer
