# MMtp — Implementation Roadmap & Status

**Current Status**: Full 2D web game (lobby + gameplay) with WebSocket multiplayer server + public tunnel support + QR code sharing + player profile sync + 5 special cards (Wild, Reroll, Double, Peek, Swap) with host toggle + parentheses support for expression grouping + custom rule presets (save/load/delete/export/import) + achievements system (10+ achievements) + advanced operators (Modulo %, Power ^) + in-game expression history + in-game chat (multiplayer) + round counter HUD + **Nearest Score rule** (partial points for close-but-not-exact expressions). Shared UMD expression evaluator (single source of truth for client + server). Default timer reduced to 20s, target range to 1–10 for faster, more feasible gameplay. Bot AI (3 difficulties) with deep lookahead (5-card combos), special card strategy, nearest-score awareness, stats/progression, sound effects, keyboard shortcuts, responsive UI, invite links, cross-network play all complete. Unity version abandoned.  
**Last Updated**: 2026-02-20  
**Version**: v0.9.8

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
- ⏳ Cloud deployment (permanent hosting on Render/Fly.io/Railway)

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

### ⏳ Phase 3: Advanced Features (PARTIALLY COMPLETE)

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

#### Code Quality
- ✅ Shared UMD expression evaluator (`server/expression.js` works in Node.js + browser)
- ✅ Deduplicated expression evaluation (client, bot AI, and server all use single module)
- ✅ `MMtpExpression` global in browser for `canPlaceCard`, `evaluate`, `validateParenBalance`, etc.

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
| Cloud deployment | ⏳ Not Started | Permanent hosting (Render/Fly.io) |
| 4-player support | ⏳ Not Started | UI and logic needed |

### UI/UX

| Feature | Status | Notes |
|---------|--------|-------|
| Dark theme | ✅ Complete | Consistent styling |
| Help system | ✅ Complete | ESC menu, lobby hints, `?` keyboard overlay |
| Keyboard shortcuts | ✅ Complete | Full keyboard support |
| Animations | ✅ Complete | Cards, XP, turn banners, target pulse, reshuffle |
| Sound effects | ✅ Complete | Web Audio API, 15 procedural sounds, toggle in settings |
| Accessibility | ✅ Complete | ARIA labels, keyboard nav |
| Mobile responsive | ✅ Complete | 768px/480px/360px breakpoints, touch-action, no-zoom |
| QR code sharing | ✅ Complete | Inline SVG in lobby share section |
| Expression history | ✅ Complete | Collapsible panel showing scored expressions per round |
| In-game chat | ✅ Complete | Real-time multiplayer chat via WebSocket |
| Round counter | ✅ Complete | Badge in HUD showing current round number |

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
| Cheat Panel | ✅ Complete | All testing features consolidated |
| Stat manipulation | ✅ Complete | XP, level, wins, rating controls |
| Game override | ✅ Complete | Timer, cards, deck controls |
| Skip bot | ✅ Complete | Fast testing |
| Simulate P2 | ✅ Complete | Lobby testing |

### Advanced Features

| Feature | Status | Notes |
|---------|--------|-------|
| Special cards | ✅ Complete | All 5 types (Wild, Reroll, Double, Peek, Swap) + host toggle |
| Parentheses | ✅ Complete | `(` and `)` cards, recursive evaluation, balanced validation |
| Advanced operators | ✅ Complete | Modulo (%), Power (^) with correct precedence |
| Custom presets | ✅ Complete | Save/load/delete + export/import JSON |
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
1. **Cloud Deployment**: No permanent cloud hosting — use `--public` flag for temporary public URLs
2. **4 Players**: UI and logic not implemented
3. **Localtunnel**: Free tier has rate limits; tunnel may close and auto-retry

### Technical Debt
1. **Code Organization**: Some functions could be better modularized
2. **Error Handling**: Could be more comprehensive in edge cases
3. **Testing**: No automated tests
4. ~~**Expression evaluator**: Duplicated between client and server~~ — ✅ Fixed (UMD shared module)

---

## Next Steps (Priority Order)

### Immediate (High Priority)
1. **Cloud Deployment**: Deploy to Render/Fly.io for permanent public URL (tunnel works for now)

### Short-term (Medium Priority)
1. **4-Player Support**: UI layout and turn management
2. **Special Card Cost System**: Balancing specials with a cost mechanic

### Long-term (Low Priority)
1. **Tournament Mode**: Bracket competitions
2. **Replay System**: Match replay viewer

---

## File Structure

```
webapp-lobby/
├── index.html          # Lobby (Main Menu)
├── app.js              # Lobby logic
├── styles.css          # Lobby styles
├── gameplay.html       # Gameplay scene
├── gameplay.js         # Gameplay logic
├── gameplay.css        # Gameplay styles
├── bot-ai-v2.js        # Bot AI engine (expression eval, hand planning)
├── net-client.js       # Socket.io client wrapper (MMtpNet)
├── qr.js               # Minimal QR code generator (SVG, zero deps)
├── sfx.js              # Sound effects engine (Web Audio API)
├── server/
│   ├── index.js        # Express + Socket.io server entry
│   ├── rooms.js        # Room management (create, join, leave)
│   ├── game-engine.js  # Server-authoritative game engine
│   ├── expression.js   # Shared expression evaluator
│   ├── profiles.js     # Player profile sync (JSON file DB)
│   └── package.json    # Server dependencies
├── start-server.bat    # Server startup script (LAN only)
├── start-public.bat    # Server + public tunnel (any network)
├── CONCEPT.md          # Game concept & vision
├── ROADMAP.md          # This file
├── GAMEPLAY_FLOW.md    # ASCII gameplay flowchart
├── MULTIPLAYER_PLAN.md # WebSocket server architecture plan
├── SETUP_MULTIDEVICE.md # Multi-device setup guide
└── README.md           # Quick start & overview
```

---

**Last Updated**: 2026-02-20  
**Version**: v0.9.8
