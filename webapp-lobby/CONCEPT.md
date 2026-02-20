# MMtp — Game Concept & Vision

**Purpose**: Educational math card game combining expression building with competitive multiplayer gameplay.

---

## Core Vision

**MMtp** is a turn-based card game where players build mathematical expressions to match target numbers. The game emphasizes:
- **Educational Value**: Learn math through play (operators, expressions, problem-solving)
- **Strategic Depth**: Card management, timing, and expression optimization
- **Social Play**: Real-time multiplayer with friends
- **Flexibility**: Extensive host rules for varied gameplay experiences

---

## Core Gameplay

### The Goal
Build mathematical expressions using cards to match target numbers. First player to reach the win condition (default: 5 successful matches) wins.

### Basic Flow
1. **Lobby**: Host creates room or join existing room (4-digit code)
2. **Match Start**: Players receive starting hand, first target is always `1`
3. **Turn Loop**:
   - Draw card(s) at turn start
   - Place cards on playfield to build expression
   - Click playfield to score when expression matches target
   - End turn (timer expires or manual end)
4. **Win**: First to reach win points (default: 5) wins

### Expression Rules
- **Pattern**: Must start with a number, then `(Operator Number)*`
- **Evaluation**: Left-to-right (default) or standard math precedence (host rule)
- **Operators**: `+`, `−`, `×`, `÷` (all always available, no level locks)
- **Example**: `1 + 2 × 3` = `9` (left-to-right) or `7` (standard math)

---

## Key Features & Ideas

### 1. Card System
- **Deck**: Finite deck with reshuffle (when empty, discard pile becomes new deck)
- **Distribution**: ~70% numbers (0-9), ~30% operators
- **Hand Management**: Configurable hand size (default: 7), hand limit with discard rules

### 2. Multiplayer
- **Players**: 2-4 players supported
- **Networking**: WebSocket server (server-authoritative for fairness)
- **Room System**: 4-digit room codes, host/join mechanics
- **Bots**: Optional bot players for testing/solo play

### 3. Host Rules & Customization
Extensive rule customization for varied gameplay:
- **Basic**: Hand size, turn timer, target range, win points
- **Advanced**: Operator precedence, negative results, draw modes, discard methods
- **Special Cards**: Enable/disable, select cards, cost methods (future)
- **Presets**: Official (educational) and Custom (full control)

### 4. Special Cards System (Future)
- **Peek**: Look at opponent's hand
- **Swap**: Exchange a card with opponent
- **Wildcard**: Use as any operator
- **Double**: Next number card counts as double
- **Reroll Target**: Change target number
- **Cost System**: Activate using expression result or single card value

### 5. XP & Progression
- **XP Sources**: Base match completion, win bonus, time bonus (unused time)
- **Leveling**: Increasing XP requirements per level
- **Visual Feedback**: Call of Duty-style floating XP notifications
- **Stats**: Wins, losses, games played, win rate, rating, best expressions

### 6. UI/UX Features
- **Dark Theme**: Modern, clean interface
- **Help System**: ESC menu in-game, collapsible hints in lobby
- **Keyboard Shortcuts**: Full keyboard support for power users
- **Animations**: Card movements, XP notifications, visual feedback
- **Accessibility**: ARIA labels, keyboard navigation, screen reader support

### 7. Testing & Development Tools
- **Cheat Panel**: Consolidated testing features (Ctrl+Shift+C)
  - Simulate players, skip bot turns, force game states
  - Stat manipulation (XP, level, wins, rating)
  - Game override (timer, cards, deck)
- **Post-Match Stats**: Detailed breakdown of match performance
- **Match Statistics**: Track cards played, expressions scored, time saved, etc.

---

## Technical Architecture

### Current (Webapp)
- **Frontend**: Vanilla HTML/CSS/JavaScript (no build step)
- **Multiplayer**: localStorage-based sync (cross-tab simulation)
- **Storage**: localStorage for player stats, room state

### Production (Implemented)
- **Server**: Node.js + Express + Socket.io WebSocket server
- **Architecture**: Server-authoritative (prevents cheating)
- **Deployment**: LAN server (cloud deployment planned)

---

## Educational Goals

### Learning Outcomes
- **Math Skills**: Expression building, operator understanding, mental math
- **Strategy**: Card management, timing, risk/reward decisions
- **Problem Solving**: Finding paths to target numbers
- **Social Skills**: Turn-taking, competitive play, sportsmanship

### Official Presets
Educational presets guide learning:
1. **Basics**: Focus on `+` and `−`, generous timer, clear hints
2. **Multiplication & Division**: Focus on `×` and `÷`, normal timer
3. **Challenge**: All operators, strict timer, wider range
4. **Standard**: All operators, special cards, standard math precedence
5. **Chaos**: All operators, all special cards, parentheses, 4 players

---

## Design Principles

1. **Flexibility First**: Most rules are host-configurable
2. **Fair Play**: Server-authoritative prevents cheating
3. **Educational Focus**: Official presets guide learning, not restrict
4. **Accessibility**: Keyboard support, screen readers, clear UI
5. **Future-Proof**: Architecture allows easy extension
6. **Web-First**: Pure HTML/CSS/JS — runs in any modern browser

---

## Future Ideas (Not Yet Implemented)

- **Advanced Operators**: Modulo (`%`), Power (`^`)
- **Parentheses Support**: Complex expression building
- **Achievements**: Unlock system based on performance
- **Replay System**: Record and replay matches
- **Spectator Mode**: Watch ongoing matches
- **Tournament Mode**: Bracket-style competitions
- **Custom Card Designs**: Player customization
- **Mobile App**: Native mobile version
- **Analytics Dashboard**: Visual stats and trends

---

**Last Updated**: 2025-01-29  
**Version**: 1.0
