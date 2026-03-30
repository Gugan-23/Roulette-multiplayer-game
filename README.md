# 🎰 Royal Roulette — Multiplayer Flask App

A real-time multiplayer roulette game built with Flask + Socket.IO.  
Up to **3 players** per room. All game state is server-side. Fully event-driven.

---

## 📁 Project Structure

```
roulette_app/
├── app.py                    # Flask backend + all Socket.IO events + game logic
├── requirements.txt
├── templates/
│   ├── lobby.html            # Landing page — enter name & room
│   └── room.html             # Game room UI
└── static/
    ├── css/
    │   └── style.css         # Full dark casino theme
    └── js/
        ├── wheel.js          # Canvas wheel draw + spin animation
        ├── board.js          # Roulette grid DOM builder
        └── game.js           # Socket.IO client logic & UI updates
```

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run the server
python app.py

# 3. Open in browser
http://localhost:5000
```

---

## 🎮 How to Play

1. Open `http://localhost:5000` in two or three browser tabs/windows.
2. Each player enters their **name** and the **same Room ID**.
3. The game auto-starts when the first player joins.
4. During the **Betting Phase** (20 seconds):
   - Select a chip value ($5 / $10 / $25 / $50 / $100)
   - Click numbers on the board or outside-bet buttons
5. The wheel spins and a winning number is revealed.
6. Payouts are applied and balances updated automatically.
7. A new round starts immediately.

---

## 🎲 Bet Types & Payouts

| Bet           | Description             | Payout |
|---------------|-------------------------|--------|
| Straight      | Single number (0–36)    | 35:1   |
| Color         | Red / Black             | 1:1    |
| Parity        | Odd / Even              | 1:1    |
| Half          | 1–18 / 19–36            | 1:1    |
| Dozen         | 1–12 / 13–24 / 25–36   | 2:1    |
| Column        | Column 1 / 2 / 3        | 2:1    |

---

## ⚙️ Configuration (app.py top constants)

```python
MAX_PLAYERS_PER_ROOM = 3      # Max players per room
STARTING_BALANCE     = 1000   # Starting chips
BETTING_DURATION     = 20     # Seconds for betting phase
SPIN_DURATION        = 5      # Seconds for spin animation
```

---

## 🔌 Socket.IO Event Reference

### Client → Server
| Event         | Payload                                      | Description            |
|---------------|----------------------------------------------|------------------------|
| `join_room`   | `{room_id, player_name}`                     | Join / create a room   |
| `place_bet`   | `{room_id, bet_type, bet_value, amount}`     | Place a bet            |
| `clear_bets`  | `{room_id}`                                  | Clear all current bets |
| `chat_message`| `{room_id, message}`                         | Send a chat message    |

### Server → Client
| Event          | Payload                                      | Description            |
|----------------|----------------------------------------------|------------------------|
| `joined`       | Full room state                              | Confirmed join         |
| `player_joined`| `{player_name, players}`                    | Someone joined         |
| `player_left`  | `{player_name, players}`                    | Someone disconnected   |
| `phase_change` | `{phase, duration, winning_number?}`         | Round phase update     |
| `timer_tick`   | `{remaining}`                               | Countdown tick         |
| `round_result` | `{winning_number, color, results, history}`  | End of round           |
| `bet_confirmed`| `{bets, total_bet, balance}`                | Your bet was registered|
| `bets_updated` | `{players}`                                 | Room-wide bet update   |
| `chat_message` | `{name, message}`                           | Chat relay             |
| `error`        | `{message}`                                 | Server error           |
