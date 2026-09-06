// Binomial expansion practice: generates a random question like "(2x - 3y)^4" and
// reveals the step-by-step solution one step at a time, colour-coded so students can
// trace each term through the working:
//   - binomial coefficient  -> cyan
//   - the "ax" term         -> red
//   - the "by" term         -> green
//   - the final answer      -> plain white (the destination, not "working")
import { hexCorners, SQRT3 } from "./hexgeom.js";

const COLOR_COEFF = "#ff2fd6"; // hot magenta - distinct from the card's cyan border
const COLOR_TERM1 = "#ffa726"; // amber/orange - red was hard to read on the dark background
const COLOR_TERM2 = "#4ade80";
const HEX_FILL_COLOR = "rgba(18, 20, 32, 0.96)"; // same background as the working step cards

const LETTER_POOL = ["x", "y", "a", "b", "m", "n", "p", "q"];
const COEFF_RANGE = [1, 2, 3, 4];
const POWER_MIN = 3;
const POWER_MAX = 6;

const questionEl = document.getElementById("expansionQuestion");
const stepsEl = document.getElementById("expansionSteps");
const newQuestionBtn = document.getElementById("newQuestionBtn");
const revealBtn = document.getElementById("revealBtn");

let steps = []; // array of { latex, colored } for the current question
let revealedCount = 0;

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pickLetters() {
  const pool = [...LETTER_POOL];
  const i = randomInt(0, pool.length - 1);
  const letter1 = pool.splice(i, 1)[0];
  const letter2 = pool[randomInt(0, pool.length - 1)];
  return [letter1, letter2];
}

function nCr(n, k) {
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return Math.round(result);
}

/** LaTeX for `coeff*letter`, simplifying the coefficient away when it's 1 or -1 (e.g. "x", "-y", "3x"). */
function coeffLetter(coeff, letter) {
  if (coeff === 1) return letter;
  if (coeff === -1) return `-${letter}`;
  return `${coeff}${letter}`;
}

/** LaTeX for `(coeffBase*letter)^exponent`, fully evaluated (e.g. exponent 0 -> "1", exponent 1 -> "2x", else "8x^{3}"). */
function evaluatedPower(coeffBase, letter, exponent) {
  if (exponent === 0) return "1";
  const numeric = Math.pow(coeffBase, exponent);
  const varPart = exponent === 1 ? letter : `${letter}^{${exponent}}`;
  if (numeric === 1) return varPart;
  if (numeric === -1) return `-${varPart}`;
  return `${numeric}${varPart}`;
}

function colorize(color, latex) {
  return `\\textcolor{${color}}{${latex}}`;
}

/** Joins signed terms ({value, absLatex}) into "term1 - term2 + term3 ..." with correct leading sign. */
function joinSignedTerms(terms) {
  let out = "";
  terms.forEach(({ value, absLatex }, i) => {
    const sign = value < 0 ? "-" : i === 0 ? "" : "+";
    out += i === 0 ? `${sign}${absLatex}` : ` ${sign} ${absLatex}`;
  });
  return out;
}

/** Builds a fresh random question and its full set of reveal steps. */
function generateQuestion() {
  const [letter1, letter2] = pickLetters();
  const a = COEFF_RANGE[randomInt(0, COEFF_RANGE.length - 1)];
  const b = COEFF_RANGE[randomInt(0, COEFF_RANGE.length - 1)];
  const sign = Math.random() < 0.5 ? "+" : "-";
  const signedB = sign === "-" ? -b : b;
  const n = randomInt(POWER_MIN, POWER_MAX);

  const term1Bracket = coeffLetter(a, letter1);
  const term2BracketAbs = coeffLetter(b, letter2);
  const questionLatex = `(${term1Bracket} ${sign} ${term2BracketAbs})^{${n}}`;

  // Step 1: symbolic binomial expansion, coefficients as \binom{n}{k}.
  const step1Terms = [];
  // Step 2: coefficients evaluated to numbers.
  const step2Terms = [];
  // Step 3: each bracketed power fully evaluated.
  const step3Terms = [];
  // Step 4: final answer - one signed monomial per term (no repeated powers, so nothing to combine further).
  const finalTerms = [];

  for (let k = 0; k <= n; k++) {
    const powA = n - k;
    const term1Signed = coeffLetter(a, letter1);
    const term2Signed = coeffLetter(signedB, letter2);

    step1Terms.push(
      colorize(COLOR_COEFF, `\\binom{${n}}{${k}}`) +
        colorize(COLOR_TERM1, `(${term1Signed})^{${powA}}`) +
        colorize(COLOR_TERM2, `(${term2Signed})^{${k}}`)
    );

    const coeffValue = nCr(n, k);
    step2Terms.push(
      colorize(COLOR_COEFF, `${coeffValue}`) +
        colorize(COLOR_TERM1, `(${term1Signed})^{${powA}}`) +
        colorize(COLOR_TERM2, `(${term2Signed})^{${k}}`)
    );

    const part1 = evaluatedPower(a, letter1, powA);
    const part2 = evaluatedPower(signedB, letter2, k);
    step3Terms.push(
      colorize(COLOR_COEFF, `${coeffValue}`) + colorize(COLOR_TERM1, `(${part1})`) + colorize(COLOR_TERM2, `(${part2})`)
    );

    const combinedValue = coeffValue * Math.pow(a, powA) * Math.pow(signedB, k);
    const varPart = (powA >= 1 ? (powA >= 2 ? `${letter1}^{${powA}}` : letter1) : "") + (k >= 1 ? (k >= 2 ? `${letter2}^{${k}}` : letter2) : "");
    const absValue = Math.abs(combinedValue);
    const absLatex = absValue === 1 && varPart ? varPart : `${absValue}${varPart}`;
    finalTerms.push({ value: combinedValue, absLatex });
  }

  const coloredQuestionLatex = `(${colorize(COLOR_TERM1, term1Bracket)} ${colorize(COLOR_TERM2, `${sign} ${term2BracketAbs}`)})^{${n}}`;

  steps = [
    { type: "katex", latex: coloredQuestionLatex, colored: true, noEquals: true },
    { type: "pascalRow", n },
    { type: "katex", latex: step1Terms.join(" + "), colored: true },
    { type: "katex", latex: step2Terms.join(" + "), colored: true },
    { type: "katex", latex: step3Terms.join(" + "), colored: true },
    { type: "katex", latex: joinSignedTerms(finalTerms), colored: false },
  ];

  questionEl.textContent = ""; // cleared then re-rendered via KaTeX below
  window.katex?.render(`\\text{Expand } ${questionLatex}`, questionEl, { throwOnError: false, displayMode: true });
  fitKatexBox(questionEl);

  revealedCount = 0;
  stepsEl.innerHTML = "";
  updateRevealButton();
}

/** Renders a small glowing strip of hexes for row n onto the given canvas, coefficients coloured to match the coefficient colour used in the steps. */
function renderMiniRow(canvas, n) {
  const dpr = window.devicePixelRatio || 1;
  const radius = 30;
  const hexWidth = SQRT3 * radius;
  const margin = radius * 0.6; // symmetric on all sides - big enough to fit the glow without clipping
  const width = (n + 1) * hexWidth + margin * 2;
  const height = radius * 2 + margin * 2;

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const centerY = height / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let k = 0; k <= n; k++) {
    const cx = margin + hexWidth * (k + 0.5);
    const corners = hexCorners(cx, centerY, radius * 0.94);

    ctx.beginPath();
    ctx.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i][0], corners[i][1]);
    ctx.closePath();

    ctx.fillStyle = HEX_FILL_COLOR;
    ctx.fill();

    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLOR_COEFF;
    ctx.shadowColor = COLOR_COEFF;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();

    ctx.font = `bold ${radius * 0.75}px "Cascadia Code", Consolas, monospace`;
    ctx.fillStyle = "#f0f0f5";
    ctx.fillText(String(nCr(n, k)), cx, centerY);
  }
}

const NARROW_SCREEN_QUERY = "(max-width: 600px)"; // matches the breakpoint used elsewhere for mobile-portrait tweaks

function updateRevealButton() {
  const done = revealedCount >= steps.length;
  revealBtn.disabled = done;
  const narrow = window.matchMedia(NARROW_SCREEN_QUERY).matches;
  revealBtn.textContent = done ? "All steps revealed" : narrow ? "Reveal next" : "Reveal next step";
}

const MIN_STEP_FONT_SIZE = 12;

/**
 * If a KaTeX box's content is wider than the space made for it (even after the CSS
 * already widens the container to use most of a wide screen), shrink its own font-size
 * until it fits, or bottom out at MIN_STEP_FONT_SIZE - avoids a horizontal scrollbar
 * wherever reasonably possible, only falling back to one for genuinely long expansions.
 */
function fitKatexBox(el) {
  el.style.fontSize = "";
  let guard = 0;
  while (el.scrollWidth > el.clientWidth && guard++ < 30) {
    const current = parseFloat(getComputedStyle(el).fontSize);
    if (current <= MIN_STEP_FONT_SIZE) break;
    el.style.fontSize = `${current - 1}px`;
  }
}

function refitAll() {
  fitKatexBox(questionEl);
  for (const inner of stepsEl.querySelectorAll(".expansion-step-inner")) fitKatexBox(inner);
  updateRevealButton();
}

window.addEventListener("resize", refitAll);

function revealNextStep() {
  if (revealedCount >= steps.length) return;
  const step = steps[revealedCount];
  revealedCount++;

  const box = document.createElement("div");
  box.className = "expansion-step-box";
  stepsEl.appendChild(box);

  if (step.type === "pascalRow") {
    const row = document.createElement("div");
    row.className = "expansion-step-row";
    const p = document.createElement("p");
    p.textContent = `Look at row ${step.n} of Pascal's triangle\u2026`;
    const canvas = document.createElement("canvas");
    row.appendChild(p);
    row.appendChild(canvas);
    box.appendChild(row);
    renderMiniRow(canvas, step.n);
  } else {
    const inner = document.createElement("div");
    inner.className = "expansion-step-inner";
    box.appendChild(inner);

    const prefix = step.noEquals ? "" : "= ";
    window.katex?.render(`${prefix}${step.latex}`, inner, { throwOnError: false, displayMode: true });
    if (!step.colored) box.classList.add("expansion-step-final");
    fitKatexBox(inner);
  }

  updateRevealButton();
}

newQuestionBtn.addEventListener("click", generateQuestion);
revealBtn.addEventListener("click", revealNextStep);

generateQuestion();
