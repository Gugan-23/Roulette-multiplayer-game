/**
 * game.js — Socket.IO Client & Game State Management
 * Handles all real-time events, UI updates, betting state,
 * player management, and result display.
 */

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

const ROOM_ID      = window.location.pathname.split("/").pop();
const PLAYER_NAME  = sessionStorage.getItem("playerName") || "Guest";

let socket         = null;
let mySid          = null;
let myBalance      = 1000;
let myBets         = {};        // { "straight:7": 50, "color:red": 25, ... }
let selectedChip   = 10;
let currentPhase   = "waiting";
let timerInterval  = null;
let bettingEnabled = false;

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  socket = io();

  // Join the room immediately
  socket.emit("join_room", {
    room_id: ROOM_ID,
    player_name: PLAYER_NAME,
  });

  bindSocketEvents();
  setChip(10);

  // Enter key for chat
  document.getElementById("chatInput").addEventListener("keydown", e => {
    if (e.key === "Enter") sendChat();
  });
});

// ─────────────────────────────────────────────
// SOCKET EVENTS
// ─────────────────────────────────────────────

function bindSocketEvents() {

  /** Confirmation that WE joined */
  socket.on("joined", data => {
    mySid      = data.sid;
    myBalance  = data.balance;
    currentPhase = data.phase;

    updateBalance(myBalance);
    renderPlayers(data.players);
    renderHistory(data.history);
    setPhaseBanner(data.phase);

    addChat("System", `Welcome ${PLAYER_NAME}! Room: ${ROOM_ID}`);
  });

  /** Another player joined */
  socket.on("player_joined", data => {
    renderPlayers(data.players);
    addChat("System", `${data.player_name} joined the room.`);
  });

  /** Phase changed (betting / spinning / result) */
  socket.on("phase_change", data => {
    currentPhase = data.phase;
    setPhaseBanner(data.phase);

    if (data.phase === "betting") {
      bettingEnabled = true;
      clearTimerInterval();
      startTimer(data.duration);
      myBets = {};
      updateMyBetsUI();
      document.getElementById("wheelResult").style.display = "none";
      document.getElementById("resultOverlay").style.display = "none";
    }

    if (data.phase === "spinning") {
      bettingEnabled = false;
      clearTimerInterval();
      setPhaseBanner("spinning");
      // Spin the visual wheel
      spinWheelTo(data.winning_number, 4500);
      setTimeout(() => {
        document.getElementById("wheelResult").style.display = "flex";
        document.getElementById("wheelResult").textContent = data.winning_number;
        highlightWinningCell(data.winning_number);
      }, 4600);
    }
  });

  /** Timer countdown tick */
  socket.on("timer_tick", data => {
    const el = document.getElementById("timerDisplay");
    if (el) {
      el.textContent = data.remaining;
      el.style.color = data.remaining <= 5 ? "#e74c3c" : "";
    }
  });

  /** Round results */
  socket.on("round_result", data => {
    currentPhase = "result";
    renderPlayers(data.players);
    renderHistory(data.history);

    const myResult = data.results[mySid];
    if (myResult) {
      myBalance = myResult.new_balance;
      updateBalance(myBalance);
      showResultOverlay(data.winning_number, data.color, myResult);
      showToast(myResult.net);
    }

    setPhaseBanner("result");
    clearTimerInterval();
  });

  /** Live bet updates from all players */
  socket.on("bets_updated", data => {
    renderPlayers(data.players);
  });

  /** Bet confirmed (our own bet) */
  socket.on("bet_confirmed", data => {
    myBets = data.bets;
    updateMyBetsUI();
    updateBalance(myBalance); // balance display (bets haven't deducted yet, shown as reserved)
    document.getElementById("totalBetDisplay").textContent = `$${data.total_bet}`;
  });

  /** Chat message */
  socket.on("chat_message", data => {
    addChat(data.name, data.message);
  });

  /** Player left */
  socket.on("player_left", data => {
    renderPlayers(data.players);
    addChat("System", `${data.player_name} left the room.`);
  });

  /** Error from server */
  socket.on("error", data => {
    showNotification(data.message, "error");
  });
}

// ─────────────────────────────────────────────
// BETTING ACTIONS
// ─────────────────────────────────────────────

function placeBet(betType, betValue) {
  if (!bettingEnabled) {
    showNotification("Betting is closed. Wait for the next round.", "error");
    return;
  }

  const totalBets = Object.values(myBets).reduce((a,b) => a+b, 0);
  if (totalBets + selectedChip > myBalance) {
    showNotification("Not enough balance!", "error");
    return;
  }

  socket.emit("place_bet", {
    room_id:   ROOM_ID,
    bet_type:  betType,
    bet_value: betValue,
    amount:    selectedChip,
  });

  // Optimistic local chip display on board cells
  if (betType === "straight") {
    const key = `straight:${betValue}`;
    const current = (myBets[key] || 0) + selectedChip;
    updateCellChip(betValue, current);
  }
}

function clearBets() {
  if (!bettingEnabled) return;
  socket.emit("clear_bets", { room_id: ROOM_ID });
  // Clear chip displays
  document.querySelectorAll(".cell-chip").forEach(c => c.remove());
}

function setChip(value) {
  selectedChip = value;
  document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
  document.querySelectorAll(`.chip-${value}`).forEach(c => c.classList.add("active"));
  document.getElementById("selectedChip").textContent = `$${value}`;
}

// ─────────────────────────────────────────────
// CHAT
// ─────────────────────────────────────────────

function sendChat() {
  const input = document.getElementById("chatInput");
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit("chat_message", { room_id: ROOM_ID, message: msg });
  input.value = "";
}

function addChat(name, message) {
  const box = document.getElementById("chatMessages");
  const el = document.createElement("div");
  el.className = "chat-msg";
  el.innerHTML = `<span class="chat-name">${escapeHtml(name)}: </span><span class="chat-text">${escapeHtml(message)}</span>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

// ─────────────────────────────────────────────
// UI RENDERERS
// ─────────────────────────────────────────────

function renderPlayers(players) {
  const list = document.getElementById("playersList");
  list.innerHTML = "";
  for (const [sid, p] of Object.entries(players)) {
    const isMe = sid === mySid;
    const div = document.createElement("div");
    div.className = "player-row" + (isMe ? " me" : "");
    div.innerHTML = `
      <div class="player-name">${escapeHtml(p.name)}${isMe ? " <em>(you)</em>" : ""}</div>
      <div class="player-balance">$${p.balance.toLocaleString()}</div>
      ${p.bet_total > 0 ? `<div class="player-bet">Bet: $${p.bet_total}</div>` : ""}
    `;
    list.appendChild(div);

    // Update our own stats
    if (isMe) {
      document.getElementById("statWins").textContent = p.stats.wins;
      document.getElementById("statLosses").textContent = p.stats.losses;
      document.getElementById("statWon").textContent = `$${p.stats.total_won.toLocaleString()}`;
      document.getElementById("statLost").textContent = `$${p.stats.total_lost.toLocaleString()}`;
    }
  }
}

function renderHistory(history) {
  const container = document.getElementById("historyBalls");
  container.innerHTML = "";
  [...history].reverse().slice(0, 20).forEach(num => {
    const ball = document.createElement("div");
    const c = colorOf(num);
    ball.className = `history-ball ${c}-ball`;
    ball.textContent = num;
    container.appendChild(ball);
  });
}

function colorOf(n) {
  const reds = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  if (n === 0) return "green";
  return reds.has(n) ? "red" : "black";
}

function updateBalance(bal) {
  document.getElementById("balanceDisplay").textContent = `$${bal.toLocaleString()}`;
}

function updateMyBetsUI() {
  const list = document.getElementById("myBetsList");
  list.innerHTML = "";
  const total = Object.values(myBets).reduce((a,b) => a+b, 0);

  if (Object.keys(myBets).length === 0) {
    list.innerHTML = `<p class="empty-label">No bets placed yet</p>`;
    document.getElementById("totalBetDisplay").textContent = "$0";
    return;
  }

  for (const [key, amount] of Object.entries(myBets)) {
    const [type, value] = key.split(":", 2);
    const div = document.createElement("div");
    div.className = "bet-item";
    div.innerHTML = `<span>${formatBetKey(type, value)}</span><strong>$${amount}</strong>`;
    list.appendChild(div);
  }
  document.getElementById("totalBetDisplay").textContent = `$${total}`;
}

function formatBetKey(type, value) {
  const labels = {
    straight: `#${value}`,
    color:    value.charAt(0).toUpperCase() + value.slice(1),
    parity:   value.charAt(0).toUpperCase() + value.slice(1),
    dozen:    `Dozen ${value}`,
    half:     `Half ${value}`,
    column:   `Column ${value.replace("col","")}`,
  };
  return labels[type] || `${type}:${value}`;
}

function setPhaseBanner(phase) {
  const banner = document.getElementById("phaseBanner");
  const text   = document.getElementById("phaseText");
  banner.className = `phase-banner ${phase}`;

  const labels = {
    waiting:  "Waiting for players…",
    betting:  "🟢 Place Your Bets!",
    spinning: "🎰 Spinning…",
    result:   "🏆 Round Complete",
  };
  text.textContent = labels[phase] || phase;

  if (phase !== "betting") {
    document.getElementById("timerDisplay").textContent = "";
  }
}

function startTimer(duration) {
  clearTimerInterval();
  const el = document.getElementById("timerDisplay");
  let remaining = duration;
  el.textContent = remaining;
  timerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearTimerInterval();
      el.textContent = "";
    } else {
      el.textContent = remaining;
      el.style.color = remaining <= 5 ? "#e74c3c" : "";
    }
  }, 1000);
}

function clearTimerInterval() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function showResultOverlay(number, color, myResult) {
  const overlay  = document.getElementById("resultOverlay");
  const numEl    = document.getElementById("resultNumber");
  const colorEl  = document.getElementById("resultColorLabel");
  const bdEl     = document.getElementById("resultBreakdown");
  const netEl    = document.getElementById("resultNet");

  numEl.textContent = number;
  colorEl.textContent = color.toUpperCase();
  colorEl.className = `result-color-label ${color}-label`;

  // Breakdown rows
  bdEl.innerHTML = "";
  if (myResult.breakdown && myResult.breakdown.length > 0) {
    myResult.breakdown.forEach(b => {
      const row = document.createElement("div");
      row.className = `rb-row ${b.result}`;
      row.innerHTML = `<span>${formatBetKey(...b.bet.split(":"))}</span><span>${b.result === "win" ? `+$${b.payout}` : `-$${b.amount}`}</span>`;
      bdEl.appendChild(row);
    });
  } else {
    bdEl.innerHTML = `<p style="text-align:center;color:var(--muted)">No bets this round</p>`;
  }

  // Net result
  const net = myResult.net;
  netEl.textContent = net > 0 ? `+$${net}` : net < 0 ? `-$${Math.abs(net)}` : "No Change";
  netEl.className = `result-net ${net > 0 ? "positive" : net < 0 ? "negative" : "zero"}`;

  overlay.style.display = "flex";

  // Auto-hide after 5 seconds
  setTimeout(() => { overlay.style.display = "none"; }, 5500);
}

function showToast(net) {
  const area = document.getElementById("toastArea");
  const toast = document.createElement("div");
  toast.className = `toast ${net > 0 ? "win" : net < 0 ? "loss" : ""}`;
  toast.textContent = net > 0 ? `🎉 Won $${net}!` : net < 0 ? `💸 Lost $${Math.abs(net)}` : "No bet this round";
  area.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function showNotification(msg, type = "info") {
  const area = document.getElementById("toastArea");
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "loss" : ""}`;
  el.textContent = msg;
  area.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
