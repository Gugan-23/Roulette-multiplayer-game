
import eventlet
eventlet.monkey_patch()


import random
import time
from datetime import datetime
from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, join_room, leave_room, emit
from pymongo import MongoClient
from bson import ObjectId
import os
app = Flask(__name__)
app.secret_key = "roulette_secret_key_2024"

# MongoDB Configuration

MONGO_URI = os.getenv("MONGO_URI")
DB_NAME = "roulette_game"
COLLECTIONS = {
    "users": "users",
    "rooms": "rooms", 
    "bets": "bets",
    "player_stats": "player_stats"
}

# Initialize MongoDB
mongo_client = MongoClient(MONGO_URI)
db = mongo_client[DB_NAME]

socketio = SocketIO(app, cors_allowed_origins="*")

# ─────────────────────────────────────────────
# ROULETTE CONSTANTS
# ─────────────────────────────────────────────

RED_NUMBERS = {1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36}
BLACK_NUMBERS = {2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35}

MAX_PLAYERS_PER_ROOM = 3
STARTING_BALANCE = 1000
BETTING_DURATION = 20
SPIN_DURATION = 5

# ─────────────────────────────────────────────
# MONGODB ROOM-CENTRIC HELPER FUNCTIONS
# ─────────────────────────────────────────────

def save_user_login(sid, player_name, room_id):
    """Save user login information to MongoDB."""
    user_doc = {
        "session_id": sid,
        "player_name": player_name,
        "room_id": room_id,
        "login_time": datetime.utcnow(),
        "last_active": datetime.utcnow(),
        "balance": STARTING_BALANCE,
        "status": "active"
    }
    user_id = db[COLLECTIONS["users"]].insert_one(user_doc).inserted_id
    return str(user_id)

def update_user_activity(sid):
    """Update user's last active time."""
    db[COLLECTIONS["users"]].update_one(
        {"session_id": sid},
        {"$set": {"last_active": datetime.utcnow()}}
    )

def get_user_by_sid(sid):
    """Get user info by session ID."""
    return db[COLLECTIONS["users"]].find_one({"session_id": sid})

def create_or_get_mongo_room(room_id):
    """Create room in MongoDB if doesn't exist, return room_id."""
    room_doc = db[COLLECTIONS["rooms"]].find_one({"room_id": room_id})
    if not room_doc:
        room_doc = {
            "room_id": room_id,
            "created_at": datetime.utcnow(),
            "spins": [],  # ARRAY to store ALL spins
            "total_spins": 0,
            "player_count": 0,
            "last_activity": datetime.utcnow()
        }
        result = db[COLLECTIONS["rooms"]].insert_one(room_doc)
        return str(result.inserted_id)
    return str(room_doc["_id"])

def add_spin_to_room_array(room_id, winning_number, color, players_bets, results):
    """Add spin to the spins ARRAY in room document."""
    spin_doc = {
        "spin_number": db[COLLECTIONS["rooms"]].find_one({"room_id": room_id})["total_spins"] + 1,
        "winning_number": winning_number,
        "color": color,
        "timestamp": datetime.utcnow(),
        "players_bets": players_bets,
        "results": results,
        "total_players": len(players_bets)
    }
    
    # Atomic update: push to spins array AND increment counter
    result = db[COLLECTIONS["rooms"]].update_one(
        {"room_id": room_id},
        {
            "$push": {"spins": spin_doc},
            "$inc": {"total_spins": 1},
            "$set": {"last_activity": datetime.utcnow()}
        }
    )
    return result.modified_count > 0

def get_room_spins_array(room_id, limit=20):
    """Get recent spins from room's spins array."""
    room_doc = db[COLLECTIONS["rooms"]].find_one({"room_id": room_id})
    if room_doc and "spins" in room_doc:
        spins = room_doc["spins"][-limit:]  # Last N spins from array
        return [spin["winning_number"] for spin in spins]
    return []

def save_player_bets(sid, room_id, bets, total_amount):
    """Save individual player bets."""
    bet_doc = {
        "session_id": sid,
        "room_id": room_id,
        "bets": bets,
        "total_amount": total_amount,
        "timestamp": datetime.utcnow(),
        "round_id": f"{room_id}_{int(time.time())}"
    }
    return db[COLLECTIONS["bets"]].insert_one(bet_doc).inserted_id

def update_player_stats(sid, stats_update):
    """Update player statistics."""
    db[COLLECTIONS["player_stats"]].update_one(
        {"session_id": sid},
        {"$inc": stats_update},
        upsert=True
    )

# ─────────────────────────────────────────────
# SERVER-SIDE GAME STATE
# ─────────────────────────────────────────────

rooms = {}

def get_room(room_id):
    return rooms.get(room_id)

def create_room(room_id):
    # Create MongoDB room document
    mongo_room_id = create_or_get_mongo_room(room_id)
    
    rooms[room_id] = {
        "players": {},
        "phase": "waiting",
        "history": get_room_spins_array(room_id),  # Load from room's spins array
        "current_result": None,
        "mongo_room_id": mongo_room_id
    }
    return rooms[room_id]

def public_player_info(room):
    return {
        sid: {
            "name": p["name"],
            "balance": p["balance"],
            "stats": p.get("stats", {"wins":0,"losses":0,"total_won":0,"total_lost":0}),
            "bet_total": sum(p["bets"].values()) if p.get("bets") else 0,
        }
        for sid, p in room["players"].items()
    }

def color_of(number):
    if number == 0:
        return "green"
    return "red" if number in RED_NUMBERS else "black"

# ─────────────────────────────────────────────
# PAYOUT CALCULATOR
# ─────────────────────────────────────────────

def calculate_payout(bet_type, bet_value, amount, winning_number):
    won = False
    multiplier = 1

    if bet_type == "straight":
        if int(bet_value) == winning_number:
            won = True
            multiplier = 35
    elif bet_type == "color":
        if bet_value == color_of(winning_number):
            won = True
            multiplier = 1
    elif bet_type == "parity":
        if winning_number != 0:
            if bet_value == "even" and winning_number % 2 == 0:
                won = True
            elif bet_value == "odd" and winning_number % 2 != 0:
                won = True
        multiplier = 1
    elif bet_type == "dozen":
        ranges = {"1-12": (1,12), "13-24": (13,24), "25-36": (25,36)}
        lo, hi = ranges.get(bet_value, (0,0))
        if lo <= winning_number <= hi:
            won = True
        multiplier = 2
    elif bet_type == "half":
        if bet_value == "1-18" and 1 <= winning_number <= 18:
            won = True
        elif bet_value == "19-36" and 19 <= winning_number <= 36:
            won = True
        multiplier = 1
    elif bet_type == "column":
        col_map = {
            "col1": [1,4,7,10,13,16,19,22,25,28,31,34],
            "col2": [2,5,8,11,14,17,20,23,26,29,32,35],
            "col3": [3,6,9,12,15,18,21,24,27,30,33,36],
        }
        if winning_number in col_map.get(bet_value, []):
            won = True
        multiplier = 2

    return amount * multiplier if won else 0

# ─────────────────────────────────────────────
# GAME LOOP WITH ROOM ARRAY STORAGE
# ─────────────────────────────────────────────

def run_round(room_id):
    room = get_room(room_id)
    if not room:
        return

    # Betting phase
    room["phase"] = "betting"
    for p in room["players"].values():
        p["bets"] = {}

    socketio.emit("phase_change", {
        "phase": "betting",
        "duration": BETTING_DURATION
    }, room=room_id)

    for remaining in range(BETTING_DURATION, 0, -1):
        if not get_room(room_id):
            return
        socketio.emit("timer_tick", {"remaining": remaining}, room=room_id)
        time.sleep(1)

    # Spin phase
    room["phase"] = "spinning"
    winning_number = random.randint(0, 36)
    room["current_result"] = winning_number

    socketio.emit("phase_change", {
        "phase": "spinning",
        "duration": SPIN_DURATION,
        "winning_number": winning_number
    }, room=room_id)

    time.sleep(SPIN_DURATION)

    # Result phase - STORE SPIN IN ROOM'S ARRAY
    room["phase"] = "result"
    
    all_bets = {}
    results = {}
    
    for sid, player in room["players"].items():
        total_bet_amount = sum(player["bets"].values())
        if total_bet_amount > 0:
            save_player_bets(sid, room_id, player["bets"], total_bet_amount)
        
        all_bets[sid] = player["bets"].copy()
        
        net = 0
        breakdown = []
        for bet_key, amount in player["bets"].items():
            bet_type, bet_value = bet_key.split(":", 1)
            won_amount = calculate_payout(bet_type, bet_value, amount, winning_number)
            if won_amount > 0:
                net += won_amount + amount
                breakdown.append({"bet": bet_key, "amount": amount, "result": "win", "payout": won_amount})
                update_player_stats(sid, {"wins": 1, "total_won": net})
            else:
                net -= amount
                breakdown.append({"bet": bet_key, "amount": amount, "result": "loss", "payout": 0})
                update_player_stats(sid, {"losses": 1, "total_lost": abs(net)})

        player["balance"] += net
        if player["balance"] < 0:
            player["balance"] = 0

        db[COLLECTIONS["users"]].update_one(
            {"session_id": sid},
            {"$set": {"balance": player["balance"]}}
        )

        results[sid] = {
            "name": player["name"],
            "net": net,
            "new_balance": player["balance"],
            "breakdown": breakdown,
        }

    # 🔥 CRITICAL: Store spin in ROOM'S spins ARRAY
    success = add_spin_to_room_array(room_id, winning_number, color_of(winning_number), all_bets, results)
    
    # Update in-memory history
    room["history"].append(winning_number)
    if len(room["history"]) > 20:
        room["history"] = room["history"][-20:]

    socketio.emit("round_result", {
        "winning_number": winning_number,
        "color": color_of(winning_number),
        "spin_stored": success,
        "results": results,
        "history": room["history"],
        "players": public_player_info(room),
    }, room=room_id)

    time.sleep(6)

    if get_room(room_id) and len(room["players"]) > 0:
        run_round(room_id)

# ─────────────────────────────────────────────
# FLASK ROUTES
# ─────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("lobby.html")

@app.route("/room/<room_id>")
def room_page(room_id):
    return render_template("room.html", room_id=room_id)

@app.route("/api/room/<room_id>")
def get_room_info(room_id):
    """Get complete room info including all spins array."""
    room_doc = db[COLLECTIONS["rooms"]].find_one({"room_id": room_id})
    if room_doc:
        # Return recent 10 spins only for API
        recent_spins = room_doc["spins"][-10:] if len(room_doc["spins"]) > 10 else room_doc["spins"]
        return {
            "room_id": room_id,
            "total_spins": room_doc["total_spins"],
            "spins_count": len(room_doc["spins"]),
            "recent_spins": [spin["winning_number"] for spin in recent_spins],
            "last_activity": room_doc["last_activity"]
        }
    return {"error": "Room not found"}, 404

# ─────────────────────────────────────────────
# SOCKET.IO EVENTS
# ─────────────────────────────────────────────

@socketio.on("join_room")
def handle_join(data):
    room_id = data.get("room_id", "").strip()
    player_name = data.get("player_name", "Anonymous").strip()
    sid = request.sid

    if not room_id:
        emit("error", {"message": "Room ID required."})
        return

    if room_id not in rooms:
        create_room(room_id)

    room = get_room(room_id)

    if len(room["players"]) >= MAX_PLAYERS_PER_ROOM:
        emit("error", {"message": f"Room '{room_id}' is full (max {MAX_PLAYERS_PER_ROOM} players)."})
        return

    user_id = save_user_login(sid, player_name, room_id)
    
    room["players"][sid] = {
        "name": player_name,
        "balance": STARTING_BALANCE,
        "bets": {},
        "stats": {"wins": 0, "losses": 0, "total_won": 0, "total_lost": 0},
        "user_id": str(user_id)
    }

    join_room(room_id)
    session["room_id"] = room_id
    session["player_name"] = player_name
    update_user_activity(sid)

    emit("joined", {
        "room_id": room_id,
        "sid": sid,
        "player_name": player_name,
        "balance": STARTING_BALANCE,
        "phase": room["phase"],
        "history": room["history"],
        "players": public_player_info(room),
    })

    socketio.emit("player_joined", {
        "player_name": player_name,
        "players": public_player_info(room),
    }, room=room_id)

    # Update room player count in MongoDB
    db[COLLECTIONS["rooms"]].update_one(
        {"room_id": room_id},
        {"$set": {"player_count": len(room["players"])}}
    )

    if len(room["players"]) == 1 and room["phase"] == "waiting":
        socketio.start_background_task(run_round, room_id)

@socketio.on("place_bet")
def handle_bet(data):
    sid = request.sid
    room_id = data.get("room_id")
    bet_type = data.get("bet_type")
    bet_value = str(data.get("bet_value"))
    amount = int(data.get("amount", 0))

    room = get_room(room_id)
    if not room:
        emit("error", {"message": "Room not found."})
        return

    if room["phase"] != "betting":
        emit("error", {"message": "Betting is not open right now."})
        return

    player = room["players"].get(sid)
    if not player:
        emit("error", {"message": "Player not in room."})
        return

    if amount <= 0:
        emit("error", {"message": "Bet amount must be positive."})
        return

    total_bets = sum(player["bets"].values())
    if total_bets + amount > player["balance"]:
        emit("error", {"message": "Insufficient balance."})
        return

    bet_key = f"{bet_type}:{bet_value}"
    player["bets"][bet_key] = player["bets"].get(bet_key, 0) + amount
    update_user_activity(sid)

    emit("bet_confirmed", {
        "bets": player["bets"],
        "total_bet": sum(player["bets"].values()),
        "balance": player["balance"],
    })

    socketio.emit("bets_updated", {
        "players": public_player_info(room),
    }, room=room_id)

@socketio.on("clear_bets")
def handle_clear_bets(data):
    sid = request.sid
    room_id = data.get("room_id")
    room = get_room(room_id)
    if not room:
        return
    player = room["players"].get(sid)
    if player and room["phase"] == "betting":
        player["bets"] = {}
        emit("bet_confirmed", {"bets": {}, "total_bet": 0, "balance": player["balance"]})
        socketio.emit("bets_updated", {"players": public_player_info(room)}, room=room_id)
        update_user_activity(sid)

@socketio.on("chat_message")
def handle_chat(data):
    room_id = data.get("room_id")
    sid = request.sid
    room = get_room(room_id)
    if not room:
        return
    player = room["players"].get(sid)
    name = player["name"] if player else "Unknown"
    update_user_activity(sid)
    socketio.emit("chat_message", {
        "name": name,
        "message": data.get("message", "")[:200],
    }, room=room_id)

@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    for room_id, room in list(rooms.items()):
        if sid in room["players"]:
            name = room["players"][sid]["name"]
            del room["players"][sid]
            leave_room(room_id)
            socketio.emit("player_left", {
                "player_name": name,
                "players": public_player_info(room),
            }, room=room_id)
            
            db[COLLECTIONS["users"]].update_one(
                {"session_id": sid},
                {"$set": {"status": "inactive"}}
            )
            
            # Update room player count
            db[COLLECTIONS["rooms"]].update_one(
                {"room_id": room_id},
                {"$set": {"player_count": len(room["players"])}}
            )
            
            if not room["players"]:
                del rooms[room_id]
            break



if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)
