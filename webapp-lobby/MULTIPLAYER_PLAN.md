# MMtp — Multiplayer Architecture Plan

How the game moves from localStorage sync to real networked multiplayer.

---

## Current State (localStorage)

```
[Tab 1: Host]                    [Tab 2: Client]
     |                                |
     |-- localStorage.setItem() ---->|
     |<---- storage event -----------|
     |                                |
     +---- 200ms polling loop --------+
```

- Works: same browser, same origin
- Works: LAN via `python -m http.server` (each device uses own localStorage — no real sync)
- Breaks: different browsers, different machines, latency, cheating

---

## Target: WebSocket Server

### Why WebSocket (not HTTP polling / WebRTC)

| Option | Latency | Complexity | NAT/Firewall | Server needed |
|--------|---------|------------|---------------|---------------|
| HTTP polling | ~500ms+ | Low | OK | Yes |
| WebSocket | ~10-50ms | Medium | OK | Yes |
| WebRTC (P2P) | ~10ms | High | Hard (STUN/TURN) | Minimal |
| Socket.io | ~10-50ms | Low-Medium | OK | Yes |

**Choice: Socket.io** (WebSocket with HTTP fallback)
- Auto-reconnect built in
- Room/namespace support built in
- Fallback to long-polling if WebSocket blocked
- Most examples and docs available

---

## Architecture: Server-Authoritative

```
┌─────────────────────────────────────────────┐
│                 SERVER (Node.js)             │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Room     │  │  Room     │  │  Room     │  │
│  │  Manager  │  │  1234     │  │  5678     │  │
│  └──────────┘  └──────────┘  └──────────┘   │
│                                              │
│  ┌─────────────────────────────────────┐     │
│  │  Game Engine (per room)             │     │
│  │  - Deck (shuffled, server-only)     │     │
│  │  - Hands (per player, server-only)  │     │
│  │  - Playfield state                  │     │
│  │  - Timer                            │     │
│  │  - Score                            │     │
│  │  - Turn logic                       │     │
│  │  - Expression evaluator             │     │
│  └─────────────────────────────────────┘     │
│                                              │
│  ┌──────────┐  ┌──────────┐                  │
│  │  Player   │  │  Player   │                 │
│  │  Auth     │  │  Stats    │                 │
│  │  (token)  │  │  (DB/file)│                 │
│  └──────────┘  └──────────┘                  │
└──────────────┬──────────────┬────────────────┘
               │ Socket.io    │
        ┌──────┘              └──────┐
        │                            │
   ┌────┴─────┐              ┌───────┴────┐
   │ Client 1 │              │ Client 2   │
   │ (browser)│              │ (browser)  │
   │          │              │            │
   │ - UI     │              │ - UI       │
   │ - Input  │              │ - Input    │
   │ - Render │              │ - Render   │
   └──────────┘              └────────────┘
```

### What the server owns (clients CANNOT see/modify)
- **Deck order** — shuffled server-side, clients never see undrawn cards
- **Opponent's hand** — client only sees own hand + card count for opponent
- **Timer authority** — server counts down, client displays
- **Score authority** — server validates expressions and awards points
- **Turn order** — server decides whose turn it is

### What the client sends (actions)
- `draw` — request to draw card(s)
- `place` — request to place card on playfield (card ID + position)
- `undo` — request to undo last playfield card
- `clear` — request to clear playfield
- `score` — request to evaluate + score expression
- `endTurn` — request to end turn
- `discard` — request to discard card(s)
- `rehand` — request to rehand
- `ready` — toggle ready in lobby
- `setRules` — host sets rules (lobby only)

### What the server sends (state updates)
- `yourHand` — full hand (only to card owner)
- `opponentHandCount` — number of cards in opponent's hand
- `playfield` — cards on playfield (visible to all)
- `target` — current target number
- `scores` — both players' scores
- `timer` — time remaining
- `turn` — whose turn (player ID)
- `deckCount` — cards remaining in deck
- `discardPile` — visible discard cards
- `gameOver` — winner, final stats
- `error` — rejected action + reason

---

## Migration Plan (3 Phases)

### Phase A: Shared Server (run alongside localStorage) ✅ COMPLETE

**Goal**: Get a server running without breaking the current game.

**Status**: Implemented in v0.5.0. All steps complete:
1. ✅ Created `server/` folder with Express + Socket.io
2. ✅ Expression evaluator shared as `server/expression.js`
3. ✅ Server manages rooms, hands, decks, scoring (game-engine.js)
4. ✅ Socket.io CDN + `net-client.js` added to HTML
5. ✅ Connection layer in `app.js` (lobby) and `gameplay.js` (game)
6. ✅ Feature flag: `onlineMode` auto-detects server; falls back to localStorage for bot play

### Phase B: Full Server Authority (PARTIALLY DONE)

**Goal**: All game logic on server. Client is display-only.

**Status**: Server-authoritative engine exists. Client still has local game logic for bot play.

1. ✅ Server owns deck, hands, scoring, turns, timer
2. ✅ Client sends action → server validates → server broadcasts result
3. ✅ Anti-cheat: server rejects invalid moves
4. ✅ Reconnection with session token (30s grace period)
5. ⏳ Spectator mode (read-only socket)
6. ⏳ Remove redundant client-side game logic for online mode

### Phase C: Production Deployment

**Goal**: Playable on the internet.

**Steps**:
1. ⏳ Deploy server to Render / Fly.io / Railway (free tier)
2. ✅ Session token system (in localStorage)
3. ⏳ Add rate limiting (prevent spam actions)
4. ✅ Graceful disconnect (30s grace period before forfeit)
5. ⏳ Persistent stats in a database (SQLite or JSON file)

---

## Socket.io Event Reference

### Lobby Events

| Direction | Event | Payload | Description |
|-----------|-------|---------|-------------|
| C→S | `createRoom` | `{ name, rules }` | Host creates room |
| S→C | `roomCreated` | `{ roomCode }` | Room code assigned |
| C→S | `joinRoom` | `{ roomCode, name }` | Player joins |
| S→C | `playerJoined` | `{ players }` | Updated player list |
| C→S | `toggleReady` | — | Toggle ready status |
| S→C | `readyUpdate` | `{ players }` | Updated ready states |
| C→S | `setRules` | `{ rules }` | Host changes rules |
| S→C | `rulesUpdate` | `{ rules }` | Rules changed |
| C→S | `startGame` | — | Host starts game |
| S→C | `gameStarted` | `{ rules, yourId }` | Navigate to gameplay |
| C→S | `leaveRoom` | — | Leave room |
| S→C | `playerLeft` | `{ players }` | Updated player list |

### Gameplay Events

| Direction | Event | Payload | Description |
|-----------|-------|---------|-------------|
| S→C | `initialState` | `{ hand, target, turn, scores, deckCount }` | Game start state |
| C→S | `draw` | — | Request draw |
| S→C | `cardDrawn` | `{ card }` (to drawer) / `{ opponentHandCount }` (to other) | Draw result |
| C→S | `placeCard` | `{ cardId }` | Place card on playfield |
| S→C | `cardPlaced` | `{ card, playfield }` | Playfield updated |
| C→S | `undoCard` | — | Undo last placement |
| S→C | `cardUndone` | `{ playfield, hand }` | Card returned |
| C→S | `clearPlayfield` | — | Clear all |
| S→C | `playfieldCleared` | `{ playfield, hand }` | Cards returned |
| C→S | `tryScore` | — | Attempt to score |
| S→C | `scored` | `{ scores, newTarget, playfield }` | Score success |
| S→C | `scoreFailed` | `{ reason }` | Invalid expression |
| C→S | `endTurn` | — | End turn |
| S→C | `turnChanged` | `{ turn, timer, hand, deckCount }` | New turn |
| C→S | `discard` | `{ cardId }` | Discard card |
| S→C | `cardDiscarded` | `{ hand, discardPile }` | Discard result |
| C→S | `rehand` | — | Rehand request |
| S→C | `rehandDone` | `{ hand, deckCount }` | New hand dealt |
| S→C | `timerUpdate` | `{ timeLeft }` | Every second |
| S→C | `gameOver` | `{ winner, scores, stats, xp }` | Game ended |

### Connection Events

| Direction | Event | Description |
|-----------|-------|-------------|
| S→C | `connect` | Connected to server |
| S→C | `disconnect` | Connection lost |
| S→C | `reconnected` | Successfully reconnected |
| S→C | `opponentDisconnected` | Other player lost connection |
| S→C | `opponentReconnected` | Other player reconnected |
| S→C | `forfeit` | Opponent didn't reconnect in time |

---

## Key Design Decisions

### Card IDs
Each card gets a unique ID when deck is created (e.g., `n3_0`, `n3_1`, `op_add_0`).
Client references cards by ID, server validates ownership.

### Session Tokens
On first connect, server issues a random token stored in localStorage.
On reconnect, client sends token → server restores player to room.

### Anti-Cheat
- Client never sees deck order or opponent's hand
- Server validates every action:
  - Can only place cards you own
  - Can only act on your turn
  - Expression must be valid pattern
  - Score must match target
- Rate limit: max 10 actions per second per client

### Graceful Disconnect
- Player disconnects → 30s grace period
- If reconnects within 30s: resume normally
- If not: auto-forfeit, opponent wins
- Timer pauses during disconnect (optional, host rule)

### Bot on Server
- Bot logic runs server-side (not client-side)
- Same bot-ai-v2 code, but executed by server
- No special handling needed — bot is just another "player" making actions

---

## File Structure (After Phase A)

```
webapp-lobby/
├── server/
│   ├── index.js              # Express + Socket.io entry
│   ├── package.json          # { socket.io, express }
│   ├── rooms.js              # Room create/join/leave/list
│   ├── game-engine.js        # Deck, hands, turns, scoring
│   ├── expression.js         # Shared evaluator (also used by client)
│   └── bot.js                # Server-side bot AI
├── index.html                # Lobby
├── app.js                    # Lobby + socket client
├── styles.css
├── gameplay.html             # Game
├── gameplay.js               # Game + socket client
├── gameplay.css
├── bot-ai-v2.js              # Client-side bot (fallback/offline)
└── start-server.bat          # Updated to run Node server
```

---

## Estimated Effort

| Phase | Work | Time |
|-------|------|------|
| A: Shared server | Server setup, room management, basic sync | 2-3 days |
| B: Full authority | Move all game logic to server, anti-cheat | 3-5 days |
| C: Production | Deploy, auth, reconnection, polish | 2-3 days |
| **Total** | | **~1-2 weeks** |

---

**Priority**: Phase A first — get basic room join working over WebSocket while keeping localStorage as fallback. This lets you test on multiple devices immediately.
