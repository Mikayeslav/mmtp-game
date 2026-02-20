# MMtp — Full Gameplay Flowchart

Full, detailed flowchart for the 2D webapp game. Plain ASCII — select all and copy.

---

## 1. MASTER FLOW

```
================================================================================
MMtp — GAMEPLAY FLOWCHART (2D webapp, full detail)
================================================================================

[OPEN index.html]
   |
   v
+--PRESS ANY KEY-------------------------------------------------+
|  Fullscreen overlay: "Press Any Key to Start"                   |
|  Any keydown or click  -->  hide overlay, show lobby            |
+----------------------------------------------------------------+
   |
   v
+--LOBBY (index.html)--------------------------------------------+
|  Two stacked panels fill viewport:                              |
|                                                                 |
|  TOP: PlayerPanel                                               |
|    - Name (editable input, saved to localStorage)               |
|    - Level, XP bar, Wins, Losses, Games, Winrate, Rating        |
|    - Status (Idle / In Lobby / In Game)                         |
|    - Last Match timestamp                                       |
|    - Match stats (cards played/drawn/discarded, expressions)    |
|    - Player 2 stats (when in room)                              |
|                                                                 |
|  BOTTOM: LobbyPanel                                             |
|    - Players list: P1, P2 (name + [READY] / [NOT READY])       |
|    - Ready summary: (0/2 ready), (1/2 ready), (2/2 ready)      |
|    - Host Room Block: room code + Copy button                   |
|    - Rules grid (host-only editable):                           |
|        Hand size, Timer, Target min/max, Win points             |
|        Rehand draw, Min draw/click, Max draw/turn               |
|    - Simulate P2 (Bot) checkbox + Toggle Bot Ready              |
|    - Join section: IP input + Room code input + Join button     |
|    - Action buttons: Host | Ready | Start | Leave | Help        |
|    - Hints (collapsible): H=Host, R=Ready, S=Start, ESC=Leave  |
+----------------------------------------------------------------+
   |
   +-- HOST ----> Create room. Get 4-digit code. Edit rules.
   |              Room stored in localStorage.
   |
   +-- JOIN ----> Enter IP + 4-digit code. Join room.
   |              Rules synced from host (read-only).
   |
   |  Both players toggle Ready.
   |  Host clicks "Start Game" when 2 players + all ready.
   |
   v
[NAVIGATE TO gameplay.html]
   |  Rules passed via URL params (?rules=...&role=host&room=XXXX)
   |  Host = Player 1, Client = Player 2
   v
+--GAMEPLAY (gameplay.html)---------------------------------------+
|  Full viewport, dark theme                                      |
|                                                                 |
|  TOP HUD:  Target | Timer | Turn indicator | Scores (P1, P2)   |
|                                                                 |
|  PLAYER 2 HAND  (top of screen, face down or visible)           |
|                                                                 |
|  PLAYFIELD  (center)                                            |
|    - Target number (large)                                      |
|    - Expression display (cards placed here)                     |
|    - "Click playfield to place / score" hint                    |
|    - Clear / Undo buttons below                                 |
|                                                                 |
|  PLAYER 1 HAND  (bottom of screen)                              |
|    - Cards (clickable, draggable, Shift+Click mass select)      |
|    - Deck (click to draw)                                       |
|    - Discard zone (drag cards here)                             |
|    - Sort button | End Turn button                              |
|    - Score piles visualization                                  |
|    - Hand count badge (e.g. 7/12)                               |
+----------------------------------------------------------------+
   |
   v
+--MATCH START----------------------------------------------------+
|  - Deal HandSize cards (default 7) to P1 and P2                 |
|  - Target = 1 (first turn always targets 1)                     |
|  - Turn = Player 1                                              |
|  - Timer = TurnTimer seconds (default 45)                       |
+----------------------------------------------------------------+
   |
   v
+--TURN LOOP (repeat until win)-----------------------------------+
|                                                                  |
|  START OF TURN                                                   |
|    - Draw card(s) from deck (minDraw per click, default 1)       |
|    - Reset timer                                                 |
|    - If deck empty: reshuffle discard pile into deck             |
|                                                                  |
|  PLAYER ACTIONS (active player only)                             |
|                                                                  |
|    [Click card in hand]  --> Select card (highlight)             |
|    [Shift+Click]         --> Mass select multiple cards          |
|    [Click Playfield]     --> Place selected card(s) on field     |
|      - Builds expression: Number (Operator Number)*              |
|      - Must start with Number, cannot end with Operator          |
|                                                                  |
|    [Click empty Playfield]  --> TryScore                         |
|      - Evaluate expression (left-to-right or standard math)      |
|      - If result == Target:                                      |
|          +1 point for active player                              |
|          New Target = random(TargetMin..TargetMax)               |
|          Clear playfield                                         |
|          Cards go to score pile                                  |
|      - If result != Target:                                      |
|          No change, keep playing                                 |
|                                                                  |
|    [Click Deck]          --> Draw more cards                     |
|    [Drag card to discard]--> Discard card from hand              |
|    [Hold Deck]           --> Rehand (discard hand, redraw N)     |
|    [Sort button]         --> Sort hand by type                   |
|    [Undo button]         --> Return last card from field to hand |
|    [Clear button]        --> Return all cards from field to hand |
|    [End Turn button]     --> EndTurn manually                    |
|    [Timer reaches 0]     --> EndTurn automatically               |
|                                                                  |
|  END TURN                                                        |
|    - Clear playfield (return cards to hand)                      |
|    - Swap active player (P1 <-> P2)                              |
|    - If bot's turn: bot AI plays automatically                   |
|    - Go to START OF TURN                                         |
|                                                                  |
|  WIN CHECK (after each TryScore)                                 |
|    - If Score[P1] >= WinPoints  -->  P1 wins                    |
|    - If Score[P2] >= WinPoints  -->  P2 wins                    |
|    - Else  -->  continue turn loop                               |
+----------------------------------------------------------------+
   |
   v
+--GAME OVER------------------------------------------------------+
|  - Game Over modal: Winner announced                             |
|  - Post-match stats (tabs):                                      |
|      Summary: result, scores, turns, duration                    |
|      Stats: cards played/drawn/discarded, rehands                |
|      Expressions: all scored expressions                         |
|      XP Breakdown: base + win bonus + time bonus                 |
|  - XP awarded, level up check                                    |
|  - XP notification (floating, CoD-style)                         |
|  - Stats saved to localStorage                                   |
|  - Return to lobby (index.html)                                  |
+----------------------------------------------------------------+
```

---

## 2. STEP-BY-STEP SCENE FLOW

```
Step 1  LOBBY (index.html)
          Press any key -> PlayerPanel + LobbyPanel
          Set name, host or join room, configure rules, all Ready, Start

Step 2  NAVIGATE
          Browser navigates to gameplay.html?rules=...&role=host&room=XXXX

Step 3  MATCH START
          Deal 7 cards each. Target=1. Turn=P1. Timer=20s.

Step 4  TURN LOOP
          Draw -> select/place cards -> TryScore -> EndTurn -> swap
          Repeat until someone reaches WinPoints

Step 5  GAME OVER
          Show results, post-match stats, award XP, update stats

Step 6  RETURN TO LOBBY
          Navigate back to index.html
```

---

## 3. EXPRESSION RULES

```
Cards:       Numbers 0-9, Operators + - x /
Pattern:     Number (Operator Number)*
Evaluation:  LEFT-TO-RIGHT (default) or STANDARD MATH (host rule)
  Left-to-right:  1 + 2 x 3  =  (1+2) x 3  =  9
  Standard math:  1 + 2 x 3  =  1 + (2x3)  =  7
Invalid:     Starts with operator, or ends with operator
Deck:        ~70% numbers, ~30% operators. Finite with reshuffle.
```

---

## 4. DEFAULT RULES

```
Hand size:        7
Hand limit:       12
Turn timer:       20 seconds
Target range:     1 .. 10
Win points:       5
Rehand draw:      5 (cards drawn when rehand)
Min draw/click:   1
Max draw/turn:    0 (unlimited)
Precedence:       left-to-right
Allow negative:   false
```

---

## 5. CONTROLS & SHORTCUTS

```
LOBBY:
  H           Host room
  R           Toggle ready
  S           Start game (host only)
  Enter       Join (when in room code input)
  ESC         Leave room / close modals
  ?           Toggle help
  Ctrl+Sh+C   Cheat panel

GAMEPLAY:
  Click       Select card / place on field / score
  Shift+Click Mass select
  Drag        Move card to playfield or discard
  U           Undo last card from playfield
  C           Clear playfield
  D           Draw card
  E           End turn
  ESC         Help menu
```

---

## 6. MULTIPLAYER

```
Current:   localStorage cross-tab sync (200ms polling)
           Host in one tab, join in another tab (same browser)
           Or use start-server.bat for LAN (python HTTP server)
Future:    WebSocket server (Node.js + Socket.io)
Room code: 4-digit (1000-9999)
Roles:     Host = P1, Client = P2
Bot:       Optional P2 bot (medium AI, configurable)
```

================================================================================
END OF FLOWCHART
================================================================================
