/**
 * board.js — Roulette Board DOM Builder
 * Dynamically renders the numbered roulette grid.
 * European layout: 0 on left, then 3 columns × 12 rows = numbers 1–36.
 */

const RED_NUMBERS_SET = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

/**
 * Build the grid:
 *   Col 1: zero (spans 3 rows)
 *   Cols 2–13: numbers arranged in 3 rows (top=3,6,9,… mid=2,5,8,… bot=1,4,7,…)
 */
function buildBoard() {
  const board = document.getElementById("rouletteBoard");
  if (!board) return;

  // Grid: 3 rows, 13 columns (col 0 = zero, cols 1–12 = 1–36)
  board.style.gridTemplateColumns = `repeat(13, 1fr)`;
  board.style.gridTemplateRows    = `repeat(3, 40px)`;

  // ZERO cell spanning 3 rows in column 1
  const zeroCell = makeCell(0, "green");
  zeroCell.style.gridColumn = "1";
  zeroCell.style.gridRow    = "1 / span 3";
  board.appendChild(zeroCell);

  // Numbers 1–36: layout in 3 rows
  // Row 1 (top):    3,6,9,12,15,18,21,24,27,30,33,36
  // Row 2 (middle): 2,5,8,11,14,17,20,23,26,29,32,35
  // Row 3 (bottom): 1,4,7,10,13,16,19,22,25,28,31,34
  for (let col = 1; col <= 12; col++) {
    const top    = col * 3;       // 3,6,9,...
    const middle = col * 3 - 1;  // 2,5,8,...
    const bottom = col * 3 - 2;  // 1,4,7,...

    const topCell    = makeCell(top,    colorOf(top));
    const middleCell = makeCell(middle, colorOf(middle));
    const bottomCell = makeCell(bottom, colorOf(bottom));

    topCell.style.gridColumn    = `${col + 1}`;
    topCell.style.gridRow       = "1";
    middleCell.style.gridColumn = `${col + 1}`;
    middleCell.style.gridRow    = "2";
    bottomCell.style.gridColumn = `${col + 1}`;
    bottomCell.style.gridRow    = "3";

    board.appendChild(topCell);
    board.appendChild(middleCell);
    board.appendChild(bottomCell);
  }
}

function colorOf(n) {
  if (n === 0) return "green";
  return RED_NUMBERS_SET.has(n) ? "red" : "black";
}

function makeCell(number, color) {
  const cell = document.createElement("div");
  cell.className = `cell ${color}-cell`;
  cell.dataset.number = number;
  cell.textContent = number;
  cell.id = `cell-${number}`;
  cell.title = `Bet on ${number}`;
  cell.addEventListener("click", () => {
    placeBet("straight", number);
  });
  return cell;
}

/**
 * Highlight the winning cell on the board.
 */
function highlightWinningCell(number) {
  // Remove old highlight
  document.querySelectorAll(".cell.winning").forEach(c => c.classList.remove("winning"));
  const cell = document.getElementById(`cell-${number}`);
  if (cell) {
    cell.classList.add("winning");
    cell.style.boxShadow = "0 0 20px 6px rgba(240,208,128,0.9)";
    cell.style.zIndex = "10";
    setTimeout(() => {
      cell.style.boxShadow = "";
      cell.style.zIndex = "";
      cell.classList.remove("winning");
    }, 5000);
  }
}

/**
 * Show a chip badge on a board cell when player bets on it.
 */
function updateCellChip(number, totalAmount) {
  const cell = document.getElementById(`cell-${number}`);
  if (!cell) return;
  let chip = cell.querySelector(".cell-chip");
  if (totalAmount > 0) {
    if (!chip) {
      chip = document.createElement("div");
      chip.className = "cell-chip";
      cell.appendChild(chip);
    }
    chip.textContent = totalAmount >= 1000 ? `${(totalAmount/1000).toFixed(1)}k` : totalAmount;
  } else if (chip) {
    chip.remove();
  }
}

// Build board as soon as DOM is ready
document.addEventListener("DOMContentLoaded", buildBoard);
