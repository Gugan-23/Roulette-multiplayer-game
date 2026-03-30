/**
 * wheel.js — Roulette Wheel Canvas Drawing & Spin Animation
 * Draws a European roulette wheel on a canvas element and
 * animates it spinning to a winning number.
 */

const WHEEL_NUMBERS = [
  0,32,15,19,4,21,2,25,17,34,6,27,13,36,
  11,30,8,23,10,5,24,16,33,1,20,14,31,9,
  22,18,29,7,28,12,35,3,26
];

const NUM_COUNT = WHEEL_NUMBERS.length; // 37
const SLICE_ANGLE = (2 * Math.PI) / NUM_COUNT;

const RED_SET = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

function sliceColor(num) {
  if (num === 0) return "#1a6b3c";
  return RED_SET.has(num) ? "#c0392b" : "#1a1a1a";
}

let wheelAngle = 0;
let isSpinning = false;
let spinTarget = 0;
let spinStart = 0;
let spinDuration = 0;
let spinRAF = null;

function drawWheel(angle) {
  const canvas = document.getElementById("wheelCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const R = cx - 4;
  const rInner = R * 0.55;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, R + 2, 0, 2 * Math.PI);
  ctx.fillStyle = "#c9a84c";
  ctx.fill();

  // Slices
  for (let i = 0; i < NUM_COUNT; i++) {
    const startA = angle + i * SLICE_ANGLE - SLICE_ANGLE / 2;
    const endA = startA + SLICE_ANGLE;
    const num = WHEEL_NUMBERS[i];

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, startA, endA);
    ctx.closePath();
    ctx.fillStyle = sliceColor(num);
    ctx.fill();
    ctx.strokeStyle = "rgba(201,168,76,0.3)";
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Number labels
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(startA + SLICE_ANGLE / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${R * 0.12}px DM Mono, monospace`;
    ctx.fillText(num, R - 4, 4);
    ctx.restore();
  }

  // Inner circle (hub)
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, 2 * Math.PI);
  ctx.fillStyle = "#0e1018";
  ctx.fill();
  ctx.strokeStyle = "#c9a84c";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Center logo text
  ctx.textAlign = "center";
  ctx.fillStyle = "#c9a84c";
  ctx.font = `italic bold ${rInner * 0.28}px Playfair Display, serif`;
  ctx.fillText("Royal", cx, cy - 8);
  ctx.fillText("Roulette", cx, cy + 14);

  // Ball marker (triangle at top)
  ctx.beginPath();
  ctx.moveTo(cx, 6);
  ctx.lineTo(cx - 7, 16);
  ctx.lineTo(cx + 7, 16);
  ctx.closePath();
  ctx.fillStyle = "#f0d080";
  ctx.fill();
}

/**
 * spinWheelTo(winningNumber, durationMs)
 * Smoothly rotates the wheel so the winning slice aligns with the top marker.
 */
function spinWheelTo(winningNumber, durationMs) {
  if (spinRAF) cancelAnimationFrame(spinRAF);

  const idx = WHEEL_NUMBERS.indexOf(winningNumber);
  if (idx === -1) return;

  // Angle for this slice to sit at top (negative because canvas Y is inverted)
  const targetSliceAngle = -(idx * SLICE_ANGLE) - Math.PI / 2;

  // Add several full rotations for a dramatic spin
  const extraSpin = 6 * 2 * Math.PI;
  spinTarget = wheelAngle + extraSpin + ((targetSliceAngle - wheelAngle) % (2 * Math.PI));

  spinStart = performance.now();
  spinDuration = durationMs;
  isSpinning = true;

  function animate(now) {
    const elapsed = now - spinStart;
    const t = Math.min(elapsed / spinDuration, 1);
    // Ease-out cubic
    const ease = 1 - Math.pow(1 - t, 3);
    wheelAngle = spinStart === 0 ? wheelAngle : lerp(wheelAngle, spinTarget, ease);
    // Better: compute absolute
    const startVal = wheelAngle - (spinTarget - wheelAngle);
    wheelAngle = lerp(startVal, spinTarget, ease);
    drawWheel(wheelAngle);

    if (t < 1) {
      spinRAF = requestAnimationFrame(animate);
    } else {
      wheelAngle = spinTarget;
      isSpinning = false;
    }
  }

  // Store starting angle at call time
  const startAngle = wheelAngle;
  function animate2(now) {
    const elapsed = now - spinStart;
    const t = Math.min(elapsed / spinDuration, 1);
    const ease = 1 - Math.pow(1 - t, 4); // ease-out quartic
    wheelAngle = startAngle + (spinTarget - startAngle) * ease;
    drawWheel(wheelAngle);
    if (t < 1) {
      spinRAF = requestAnimationFrame(animate2);
    } else {
      wheelAngle = spinTarget;
      isSpinning = false;
    }
  }

  spinTarget = startAngle + extraSpin + (targetSliceAngle - startAngle % (2 * Math.PI));
  requestAnimationFrame(animate2);
}

function lerp(a, b, t) { return a + (b - a) * t; }

// Initial draw when page loads
window.addEventListener("load", () => drawWheel(wheelAngle));

// Idle slow rotation when not spinning
function idleRotate() {
  if (!isSpinning) {
    wheelAngle += 0.002;
    drawWheel(wheelAngle);
  }
  requestAnimationFrame(idleRotate);
}
requestAnimationFrame(idleRotate);
