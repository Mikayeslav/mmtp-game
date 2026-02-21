# MMtp — Implementation Roadmap & Status

**Current Status**: Full 2D web game (lobby + gameplay) with WebSocket multiplayer server + cloud deployment on Render + public tunnel support + QR code sharing + player profile sync (6-char codes, debounced autosave) + 5 special cards (Wild, Reroll, Double, Peek, Swap) with per-card host toggle + per-operator selection (chip UI) + parentheses support for expression grouping + custom rule presets (save/load/delete/export/import) + 6 built-in presets + achievements system (10+ achievements) + advanced operators (Modulo %, Power ^) + in-game expression history + in-game chat (multiplayer) + round counter HUD + **Nearest Score rule** (partial points for close-but-not-exact expressions). Perspective-aware multiplayer rendering (complete revamp). Collapsible lobby panels, opponent profile display, sign-out, enhanced match history, admin dashboard (/admin). Dev mode gate for cheat panel. Shared UMD expression evaluator (single source of truth for client + server). Default timer reduced to 20s, target range to 1–10 for faster, more feasible gameplay. Bot AI (3 difficulties) with deep lookahead (5-card combos), special card strategy, nearest-score awareness, stats/progression, sound effects, keyboard shortcuts, responsive UI, invite links, cross-network play all complete. Unity version abandoned.  
**Last Updated**: 2026-02-21  
**Version**: v1.0.0

---

## Implementation Status

### ✅ Phase 1: Core Gameplay (COMPLETE)

#### Lobby System
- ✅ Press Any Key to Start overlay
- ✅ PlayerPanel (name, level, XP, stats)
- ✅ LobbyPanel (host/join, room code, rules, ready/start)
- ✅ Room code system (4-digit)
- ✅ Rules configuration (host-only)
- ✅ Ready system
- ✅ Cross-tab synchronization (localStorage)
- ✅ Player stats persistence
- ✅ Connection status indicators
- ✅ Keyboard shortcuts

#### Gameplay Scene
- ✅ Gameplay HTML/CSS/JS structure
- ✅ Card deck system (finite with reshuffle)
- ✅ Hand management (2 players)
- ✅ Playfield (card placement area)
- ✅ Expression builder
- ✅ Expression evaluator (left-to-right, standard math modes)
- ✅ Scoring system
- ✅ Turn timer (client-side)
- ✅ Target generation
- ✅ Win condition
- ✅ Turn flow (draw, play, score, end turn)
- ✅ Card animations
- ✅ Visual feedback (target display, timer, scores)
- ✅ Help panel (ESC menu)
- ✅ Game over modal

#### Advanced Gameplay Features
- ✅ Mass card selection (Shift+Click)
- ✅ Drag and drop (cards, reordering, discard)
- ✅ Discard system (drag to zone, keyboard shortcuts)
- ✅ Hand sorting
- ✅ Rehand feature (hold deck to discard and redraw)
- ✅ Undo/Clear playfield
- ✅ Turn indicator (arrow, hand highlighting)
- ✅ Score piles visualization
- ✅ Hand count indicators
- ✅ Toast notifications (replaces browser alerts)

#### Multiplayer Sync
- ✅ Host/client detection
- ✅ Game state synchronization (localStorage-based)
- ✅ Real-time state updates (200ms polling)
- ✅ Move validation (only active player can act)
- ✅ Bot support (simple AI for Player 2)

#### Statistics & Progression
- ✅ Player stats (wins, losses, XP, level, rating)
- ✅ Match statistics tracking
  - Cards played/drawn/discarded
  - Expressions scored
  - Best expression
  - Time saved
  - Rehands used
- ✅ XP calculation (base, win bonus, time bonus)
- ✅ Level progression
- ✅ Post-match statistics display
- ✅ XP notifications (Call of Duty style)

#### Testing & Development Tools
- ✅ Cheat Panel
  - Testing features (simulate P2, skip bot, force states)
  - Stat manipulation (XP, level, wins, rating)
  - Game override (timer, cards, deck)
- ✅ Post-match stats (tabs: Summary, Stats, Expressions, XP Breakdown)
- ✅ Rematch button (post-match, in-place reset)
- ✅ Player names in gameplay HUD and game-over modal
- ✅ Draws stat tracking

---

### ✅ Phase 2: Production Multiplayer Server (COMPLETE)

- ✅ WebSocket server setup (Node.js + Socket.io)
- ✅ Room management system (`server/rooms.js`)
- ✅ Player connection handling (connect/disconnect/reconnect)
- ✅ Server-side game state management (`server/game-engine.js`)
- ✅ Server validation (server-authoritative architecture)
- ✅ Reconnection handling (30s grace period)
- ✅ Session token system
- ✅ Client network layer (`net-client.js`)
- ✅ Bot mode fallback (localStorage when playing vs bot)
- ✅ Public tunnel support (`--public` flag, localtunnel, auto-retry on close)
- ✅ Server IP auto-detection + display in lobby
- ✅ Invite link generation (copy-to-clipboard, `?join=XXXX` auto-join)
- ✅ QR code generation for invite links (client-side SVG, zero deps)
- ✅ Tunnel password auto-detection for visitors
- ✅ Cloud deployment on Render (render.yaml blueprint, Dockerfile, fly.toml also available)

---

### ✅ Phase 2.5: Polish & UX (COMPLETE)

- ✅ Keyboard shortcut help overlay (`?` key in gameplay)
- ✅ Deck reshuffle notification + animation
- ✅ Match streak tracking (win streak counter, best streak, XP bonus at 3+)
- ✅ Cleaned up `bot-test.html` (dead test page removed)
- ✅ Favicon and meta tags for sharing (og:title, og:description, theme-color)
- ✅ Sound effects (Web Audio API, 15 procedural sounds for gameplay + lobby)
- ✅ Mobile UI polish (768px / 480px / 360px breakpoints, touch-action, no-zoom)
- ✅ Player profile sync (6-char codes, server-persisted, cross-device)
- ✅ Auto-save profile after each game
- ✅ QR code invite link sharing
- ✅ Tunnel auto-reconnect on close (up to 10 retries)

---

### ✅ Phase 3: Advanced Features & v1.0.0 Polish (COMPLETE)

#### Bot AI
- ✅ Basic bot (draws, builds expressions, attempts to score)
- ✅ 3 difficulty levels: Easy / Medium / Hard
- ✅ Hard bot uses BotAIv2 planning engine
- ✅ Deep lookahead (5-card N/O/N/O/N combos for hard bot)
- ✅ Reachability scoring (intermediate expressions scored by how close they are to target completion)

#### Special Cards System
- ✅ Wildcard (★ Wild): choose any number 0-9, picker overlay
- ✅ Reroll Target (🎯 Reroll): change the current target to a new random one
- ✅ Double (×2 Double): next score counts double (×2 buff indicator)
- ✅ Peek (👁 Peek): reveals opponent's hand for 5 seconds with timer bar
- ✅ Swap (🔄 Swap): randomly swap a card with opponent
- ✅ Special card rendering (gradient backgrounds, icons, labels per type)
- ✅ Bot AI uses Reroll, Double, Swap & Peek cards strategically
- ✅ Server-authoritative special card validation for all 5 types
- ✅ Host toggle to enable/disable special cards in lobby rules
- ✅ Client + server respect specialCards=false (no specials in deck)

#### 4-Player Support
- ⏳ UI layout for 4 players
- ⏳ Turn order management
- ⏳ Score display for 4 players

#### Parentheses Support
- ✅ Paren card type (`(` and `)`) in deck (~5% of cards)
- ✅ Expression grouping: `( 3 + 2 ) × 4 = 20` overrides precedence
- ✅ Balanced paren validation at score time
- ✅ Recursive innermost-first evaluation
- ✅ Shared `canPlaceCard()` / `canScore()` in `expression.js`
- ✅ Green gradient card styling, teal playfield tokens
- ✅ Server-authoritative validation

#### Custom Rule Presets
- ✅ Preset save/load system (localStorage-based)
- ✅ Custom preset management (save, load, delete from dropdown)
- ✅ Preset sharing: export all as JSON / import from JSON file

#### Achievements System
- ✅ 10 unlockable achievements (First Win, Card Shark, Speed Demon, etc.)
- ✅ Achievement tracking based on player stats
- ✅ Achievement modal with locked/unlocked display
- ✅ Toast notification on achievement unlock
- ✅ Persistent via localStorage

#### Advanced Operators
- ✅ Modulo (%) operator — remainder division
- ✅ Power (^) operator — exponentiation
- ✅ Correct operator precedence: Power > Mul/Div/Mod > Add/Sub
- ✅ Bot AI handles Modulo and Power in expression evaluation
- ✅ Server-side expression evaluator updated for both operators
- ✅ Styled card rendering (unique gradient per operator type)

#### In-Game UI Enhancements
- ✅ Expression history panel (collapsible log of all scored expressions per round)
- ✅ In-game chat system (real-time messaging in multiplayer rooms via WebSocket)
- ✅ Round counter badge in gameplay HUD (shows current round number)

#### Nearest Score Rule
- ✅ "Nearest Score" checkbox in lobby rules — toggle for more forgiving gameplay
- ✅ Partial points: exact match = 1pt, off-by-1 = 0.5pt, off-by-2 = 0.25pt
- ✅ Distinct visual feedback (amber flash vs green for exact scores)
- ✅ Toast messages distinguish exact vs near scores with difference shown
- ✅ Server-authoritative: `game-engine.js` validates and awards fractional points
- ✅ Bot AI updated: considers near-score plays when `nearestScore` rule is enabled
- ✅ Fractional score display (1 decimal place) in HUD and game-over modal
- ✅ Built-in presets updated (Chaos & Beginner enable nearestScore by default)

#### Rule Balance Adjustments (v0.9.8)
- ✅ Default timer: 45s → 20s (snappier turns)
- ✅ Default target max: 99 → 10 (more feasible scoring with small hands)
- ✅ Timer clamp: [10–300] → [5–60] seconds
- ✅ Target range clamp: [-99, 99] → [-50, 50]
- ✅ All built-in presets updated to reflect new defaults
- ✅ Documentation (GAMEPLAY_FLOW.md) updated

#### QoL Rule Customization (v1.0.0)
- ✅ Per-operator selection: chip UI toggles for Add, Sub, Mul, Div, Mod, Pow
- ✅ Per-special-card selection: chip UI toggles for Wild, Reroll, Double, Peek, Swap
- ✅ Minimum 1 operator enforced (falls back to Add)
- ✅ `allowedOperators[]` and `allowedSpecials[]` propagated to server + client deck creation
- ✅ 6 built-in presets: Standard, Speed, Marathon, Pure Math, Chaos, Beginner
- ✅ Presets include operator/special selections (each preset has a distinct flavor)

#### Multiplayer Revamp (v1.0.0)
- ✅ Perspective-aware rendering: local player always rendered at slot 0 (bottom, face-up)
- ✅ Opponent always rendered at slot 1 (top, face-down) regardless of server-side player ID
- ✅ `serverPlayerId` tracks actual server ID; `GP.myPlayerId` always 1 for rendering
- ✅ Event buffering in `net-client.js` to prevent missed `gameState` events during reconnection
- ✅ `requestState` server action for explicit state recovery after reconnection
- ✅ Face-down card rendering via `faceDown` flag (removed '?' Unity leftover)
- ✅ Turn arrow hidden until first server state received (prevents flash)
- ✅ Rematch flow: resets `_endGameCalled` flag, clears score zones
- ✅ Server-authoritative timer display in online mode (client reads `gameState.turnTimer`)
- ✅ `_endGameCalled` guard prevents double `endGame()` calls
- ✅ Score pile rendering handles both string (server) and card array (local) formats
- ✅ `_handleScore()` auto-advances turn and tracks `bestExpression`

#### Lobby UX Overhaul (v1.0.0)
- ✅ Collapsible panels: Rules section, Profile Sync section (fold to save screen space)
- ✅ Action buttons (Host/Ready/Start/Leave) repositioned above Rules panel
- ✅ Reset to Defaults: inline button, visible only for host, polished styling
- ✅ Toggle Bot Ready button removed (bot auto-readies when enabled)
- ✅ Opponent profile display: avatar, title, rating shown in lobby player lines
- ✅ Achievement button moved to player panel
- ✅ Sign out feature: clears all `mmtp-*` localStorage + sessionStorage + reloads
- ✅ Enhanced match history: opponent name, mode (🌐/🤖/🏠), duration, expressions, best expr
- ✅ Share URL auto-detects deployed environment (uses `window.location.origin` on Render)

#### Dev Tools & Admin (v1.0.0)
- ✅ Dev mode gate: cheat panel hidden by default, activated via `?dev=1` URL param or `Ctrl+Shift+C`
- ✅ `mmtp-dev-mode` localStorage flag persists dev mode across sessions
- ✅ Sign-out clears dev mode flag
- ✅ Admin dashboard (`/admin?key=...`): server status, active rooms, active games, profiles
- ✅ Admin profile management: view, edit stats, delete profiles
- ✅ Admin room management: view details, force-end games, close rooms
- ✅ Admin key authentication (`ADMIN_KEY` env var, default `mmtp-dev-2026`)
- ✅ Auto-refresh (5s) with activity log

#### Profile & Stats Improvements (v1.0.0)
- ✅ Debounced cloud autosave (3s debounce on name/bio changes, 5s after page load)
- ✅ Auto-save profile to server after each game (`gameplay.js`)
- ✅ `scheduleProfileAutoSave()` exposed for external callers
- ✅ Profile data (avatar, title, rating) sent during room create/join via WebSocket
- ✅ Server stores and broadcasts player profile in room state

#### Code Quality
- ✅ Shared UMD expression evaluator (`server/expression.js` works in Node.js + browser)
- ✅ Deduplicated expression evaluation (client, bot AI, and server all use single module)
- ✅ `MMtpExpression` global in browser for `canPlaceCard`, `evaluate`, `validateParenBalance`, etc.
- ✅ CSS variable consistency (`--danger`, `--text` properly defined)
- ✅ Dead code cleanup (removed legacy `ruleSpecialCards` references)

---

### ❌ Phase 4: Unity Integration (ABANDONED)

- ❌ Unity version fully abandoned — MMtp is 100% a web-based game
- ❌ Unity C# code in `MMtp/Assets/Scripts/` is no longer maintained

---

## Detailed Feature Status

### Core Mechanics

| Feature | Status | Notes |
|---------|--------|-------|
| Deck system | ✅ Complete | Finite deck with reshuffle |
| Hand management | ✅ Complete | Configurable size, discard rules |
| Expression building | ✅ Complete | Left-to-right and standard math modes |
| Expression evaluation | ✅ Complete | Supports both precedence modes |
| Scoring system | ✅ Complete | Target matching, win condition |
| Turn timer | ✅ Complete | Client-side, clickable to end early |
| Target generation | ✅ Complete | Fixed start (1) or random |
| Win condition | ✅ Complete | Configurable win points |

### Multiplayer

| Feature | Status | Notes |
|---------|--------|-------|
| Host/Join system | ✅ Complete | 4-digit room codes, online + localStorage |
| Ready system | ✅ Complete | All players must be ready |
| State synchronization | ✅ Complete | WebSocket (online) + localStorage (bot) |
| Move validation | ✅ Complete | Server-authoritative for online play |
| Bot support | ✅ Complete | 3 difficulty levels (Easy/Medium/Hard) |
| WebSocket server | ✅ Complete | Node.js + Socket.io, server-authoritative |
| Reconnection | ✅ Complete | 30s grace period, session tokens |
| Network client | ✅ Complete | `net-client.js` wrapper with auto-reconnect |
| Public tunnel | ✅ Complete | `--public` flag, auto-retry on close (10 attempts) |
| Invite links | ✅ Complete | Copy-to-clipboard, `?join=XXXX` auto-join |
| QR code sharing | ✅ Complete | Client-side SVG QR code, zero dependencies |
| Profile sync | ✅ Complete | 6-char codes, server-persisted, cross-device |
| Cloud deployment | ✅ Complete | Deployed on Render (render.yaml + Dockerfile + fly.toml) |
| Perspective remapping | ✅ Complete | Local player always slot 0, opponent slot 1 |
| Event buffering | ✅ Complete | `net-client.js` buffers + replays missed events |
| Reconnection recovery | ✅ Complete | `requestState` action + session tokens |
| 4-player support | ⏳ Not Started | UI and logic needed |

### UI/UX

| Feature | Status | Notes |
|---------|--------|-------|
| Dark theme | ✅ Complete | Consistent styling |
| Help system | ✅ Complete | ESC menu, lobby hints, `?` keyboard overlay, % ^ specials |
| Keyboard shortcuts | ✅ Complete | Full keyboard support |
| Animations | ✅ Complete | Cards, XP, turn banners, target pulse, reshuffle |
| Sound effects | ✅ Complete | Web Audio API, 15 procedural sounds, toggle in settings |
| Accessibility | ✅ Complete | ARIA labels, keyboard nav |
| Mobile responsive | ✅ Complete | 768px/480px/360px breakpoints, touch-action, no-zoom |
| QR code sharing | ✅ Complete | Inline SVG in lobby share section |
| Expression history | ✅ Complete | Collapsible panel showing scored expressions per round |
| In-game chat | ✅ Complete | Real-time multiplayer chat via WebSocket |
| Round counter | ✅ Complete | Badge in HUD showing current round number |
| Collapsible panels | ✅ Complete | Rules, profile sync sections fold to save space |
| Opponent profiles | ✅ Complete | Avatar, title, rating visible in lobby player lines |
| Sign out | ✅ Complete | Clears all mmtp-* data + session + reloads |
| Match history detail | ✅ Complete | Opponent, mode, duration, best expression, card/expr counts |
| Per-operator selection | ✅ Complete | Chip UI for add/sub/mul/div/mod/pow |
| Per-special selection | ✅ Complete | Chip UI for wild/reroll/double/peek/swap |

### Statistics & Progression

| Feature | Status | Notes |
|---------|--------|-------|
| Player stats | ✅ Complete | Wins, losses, draws, XP, level, rating |
| Match statistics | ✅ Complete | Cards, expressions, time saved |
| XP system | ✅ Complete | Base, win bonus, time bonus |
| Level progression | ✅ Complete | Increasing XP requirements |
| XP notifications | ✅ Complete | Call of Duty style |
| Post-match stats | ✅ Complete | Tabs: Summary, Stats, Expressions, XP |
| Rematch | ✅ Complete | In-place reset, Back to Lobby for new settings |
| Win Streak | ✅ Complete | Streak counter, best streak, XP bonus at 3+ |
| Profile sync | ✅ Complete | 6-char code, save/load across devices, auto-save after game |
| Achievements | ✅ Complete | 10 unlockable achievements, modal display, localStorage |

### Testing & Development

| Feature | Status | Notes |
|---------|--------|-------|
| Cheat Panel | ✅ Complete | Hidden by default, dev mode gate |
| Dev mode | ✅ Complete | `?dev=1` URL param or `Ctrl+Shift+C` to activate |
| Stat manipulation | ✅ Complete | XP, level, wins, rating controls |
| Game override | ✅ Complete | Timer, cards, deck controls |
| Skip bot | ✅ Complete | Fast testing |
| Simulate P2 | ✅ Complete | Lobby testing (auto-ready) |
| Admin dashboard | ✅ Complete | `/admin?key=...` — rooms, games, profiles, logs |
| Profile autosave | ✅ Complete | Debounced 3s cloud save + save after each game |

### Advanced Features

| Feature | Status | Notes |
|---------|--------|-------|
| Special cards | ✅ Complete | All 5 types (Wild, Reroll, Double, Peek, Swap) + host toggle |
| Parentheses | ✅ Complete | `(` and `)` cards, recursive evaluation, balanced validation |
| Advanced operators | ✅ Complete | Modulo (%), Power (^) with correct precedence |
| Custom presets | ✅ Complete | Save/load/delete + export/import JSON + 6 built-in presets |
| Shared expression module | ✅ Complete | UMD module, single source for client + server + bot |
| Expression history | ✅ Complete | Collapsible panel, scored expressions log |
| In-game chat | ✅ Complete | Real-time multiplayer chat via WebSocket |
| Round counter | ✅ Complete | Badge in HUD showing current round |
| Nearest Score rule | ✅ Complete | Partial points for off-by-1/2 expressions |
| Rule balance (v0.9.8) | ✅ Complete | Timer 20s, target max 10, tighter clamps |
| Tournament mode | ⏳ Not Started | Future feature |
| Replay system | ⏳ Not Started | Future feature |

---

## Known Issues & Limitations

### Current Limitations
1. **4 Players**: UI and logic not implemented (2-player only)
2. **Localtunnel**: Free tier has rate limits; tunnel may close and auto-retry
3. **No automated tests**: Manual testing only

### Technical Debt
1. **Code Organization**: Some functions could be better modularized
2. **Error Handling**: Could be more comprehensive in edge cases
3. ~~**Expression evaluator**: Duplicated between client and server~~ — ✅ Fixed (UMD shared module)
4. ~~**Cloud Deployment**: No permanent hosting~~ — ✅ Fixed (Render)

---

## Next Steps (Priority Order)

### Short-term (Medium Priority)
1. **4-Player Support**: UI layout and turn management
2. **Special Card Cost System**: Balancing specials with a cost mechanic
3. **Automated Testing**: Unit tests for expression evaluator, game engine

### Long-term (Low Priority)
1. **Tournament Mode**: Bracket competitions
2. **Replay System**: Match replay viewer

---

## Brainstorm: New Operators & Special Cards (v1.1 candidates)

### New Operator Ideas
| Operator | Symbol | Description | Balance Notes |
|----------|--------|-------------|---------------|
| Factorial | `!` | Postfix: `5! = 120`. Extremely powerful, only applies to single digit. | Restrict to values ≤ 7 to prevent overflow. Could be "!" card placed after a number. |
| Square Root | `√` | Prefix: `√9 = 3`. Useful for reducing large numbers. | Returns floor value for non-perfect squares. Unary operator, needs special placement rules. |
| Absolute Value | `\|x\|` | Wraps sub-expression: ensures result is positive. | Pairs like parentheses. Interesting with `allowNegative` rule. |
| Concatenate | `∥` | Joins two digits: `3 ∥ 5 = 35`. Creates larger numbers from small cards. | Very powerful for large targets (Ridiculous Numbers preset). Could be operator card. |

### New Special Card Ideas
| Card | Description | Balance Notes |
|------|-------------|---------------|
| **Mirror** | Copy the last card played by your opponent to your hand. | Reactive strategy. Needs tracking of opponent's last play. |
| **Freeze** | Skip opponent's next draw phase — they can't draw cards for 1 turn. | Disruption. Not too harsh since they keep their hand. |
| **Bomb** | Discard 3 random cards from opponent's hand into discard pile. | Very aggressive. Consider limiting to 1 per deck. |
| **Shield** | Prevent the next special card used against you (blocks Swap, Bomb, Freeze). | Defensive counter-play. Creates mind games. |
| **Copy** | Create a duplicate of any card in your hand. | Flexible but not overpowered. Player chooses which card. |
| **Multiply Target** | Multiply the current target by 2 (or halve it). | Changes the game state for both players. Risky play. |
| **Steal** | Take a specific visible card from opponent's score pile. | Punishing but strategic. Only works if opponent has scored. |
| **Time Warp** | Add 10 seconds to your timer / Remove 5 seconds from opponent's. | Only relevant in timed games. Adds urgency. |

### Implementation Priority (if adding)
1. **Concatenate** (high impact, simple rules)
2. **Copy** (straightforward, fun)  
3. **Freeze** (multiplayer strategy)
4. **Mirror** (reactive play)
5. **Factorial / Square Root** (math depth)
6. Others as community requests

---

## File Structure

```
webapp-lobby/
├── index.html            # Lobby (Main Menu)
├── app.js                # Lobby logic & state management
├── app-online.js         # Client-side online lobby (WebSocket connect, auto-join)
├── app-cheat.js          # Lobby cheat panel & profile sync (dev mode gate)
├── styles.css            # Lobby styles
├── gameplay.html         # Gameplay scene
├── gameplay.js           # Gameplay logic (cards, turns, scoring, rendering)
├── gameplay-online.js    # Online gameplay (perspective remapping, server state sync)
├── gameplay-bot.js       # Bot turn logic (AI integration)
├── gameplay-cheat.js     # Gameplay cheat panel (dev mode gate)
├── gameplay.css          # Gameplay styles
├── bot-ai-v2.js          # Bot AI engine (expression eval, hand planning)
├── net-client.js         # Socket.io client wrapper (MMtpNet, event buffering)
├── qr.js                 # Minimal QR code generator (SVG, zero deps)
├── sfx.js                # Sound effects engine (Web Audio API)
├── server/
│   ├── index.js          # Express + Socket.io server entry + admin API
│   ├── rooms.js          # Room management (create, join, leave, profile data)
│   ├── game-engine.js    # Server-authoritative game engine
│   ├── expression.js     # Shared UMD expression evaluator
│   ├── profiles.js       # Player profile sync (JSON file DB, admin access)
│   ├── admin.html        # Admin dashboard (rooms, games, profiles, logs)
│   └── package.json      # Server dependencies
├── start-server.bat      # Server startup script (LAN only)
├── start-public.bat      # Server + public tunnel (any network)
├── render.yaml           # Render deployment blueprint
├── Dockerfile            # Docker deployment config
├── fly.toml              # Fly.io deployment config
├── CONCEPT.md            # Game concept & vision
├── ROADMAP.md            # This file
├── GAMEPLAY_FLOW.md      # ASCII gameplay flowchart
├── MULTIPLAYER_PLAN.md   # WebSocket server architecture plan
├── SETUP_MULTIDEVICE.md  # Multi-device setup guide
└── README.md             # Quick start & overview
```

---

**Last Updated**: 2026-02-21  
**Version**: v1.0.0
