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

// Occasionally give one term an inner power (e.g. b^2) or make it a reciprocal (e.g. 1/y),
// instead of always a plain "coeff*letter" term - only about 1 in 5 questions.
const SPECIAL_TERM_PROBABILITY = 0.2;
const SPECIAL_INNER_POWERS = [2, 3];
const RECIPROCAL_NUMERATOR_RANGE = [1, 2, 3];

const questionEl = document.getElementById("expansionQuestion");
const stepsEl = document.getElementById("expansionSteps");
const newQuestionBtn = document.getElementById("newQuestionBtn");
const revealBtn = document.getElementById("revealBtn");
const controlsBottomEl = document.getElementById("expansionControlsBottom");
const newQuestionBtnBottom = document.getElementById("newQuestionBtnBottom");
const revealBtnBottom = document.getElementById("revealBtnBottom");

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

/**
 * LaTeX for `coeff*letter^innerExp`, simplifying the coefficient away when it's 1 or -1
 * (e.g. "x", "-y", "3x"). `innerExp` defaults to 1 (plain letter); 2 or 3 renders as a power
 * (e.g. "b^{2}"); -1 renders as a reciprocal fraction (e.g. "\frac{1}{y}", or "-\frac{1}{y}").
 */
function coeffLetter(coeff, letter, innerExp = 1) {
  if (innerExp < 0) {
    const letterPart = Math.abs(innerExp) === 1 ? letter : `${letter}^{${Math.abs(innerExp)}}`;
    const sign = coeff < 0 ? "-" : "";
    const numerator = Math.abs(coeff) === 1 ? "1" : `${Math.abs(coeff)}`;
    return `${sign}\\frac{${numerator}}{${letterPart}}`;
  }
  const letterPart = innerExp === 1 ? letter : `${letter}^{${innerExp}}`;
  if (coeff === 1) return letterPart;
  if (coeff === -1) return `-${letterPart}`;
  return `${coeff}${letterPart}`;
}

/**
 * LaTeX for `(coeffBase*letter^innerExp)^outerExponent`, fully evaluated (e.g. outerExponent 0
 * -> "1"; innerExp 1 gives the original behaviour, e.g. "2x" or "8x^{3}"; innerExp 2/3 combines
 * into the total exponent, e.g. "b^{8}"; innerExp -1 (reciprocal) renders as a fraction, e.g.
 * "\frac{1}{y^{3}}").
 */
function evaluatedPower(coeffBase, letter, innerExp, outerExponent) {
  if (outerExponent === 0) return "1";
  const numeric = Math.pow(coeffBase, outerExponent);
  const totalLetterExp = innerExp * outerExponent;
  const absLetterExp = Math.abs(totalLetterExp);
  const letterPart = absLetterExp === 1 ? letter : `${letter}^{${absLetterExp}}`;
  if (totalLetterExp >= 0) {
    if (numeric === 1) return letterPart;
    if (numeric === -1) return `-${letterPart}`;
    return `${numeric}${letterPart}`;
  }
  const sign = numeric < 0 ? "-" : "";
  const numerator = Math.abs(numeric) === 1 ? "1" : `${Math.abs(numeric)}`;
  return `${sign}\\frac{${numerator}}{${letterPart}}`;
}

/**
 * LaTeX for one signed final-answer monomial, given the total (possibly negative) exponent of
 * each letter. Negative exponents (from a reciprocal term) move that letter to a denominator,
 * rendered as a fraction (e.g. "\frac{5x}{y^{4}}") instead of a plain monomial.
 */
function finalTermLatex(absValue, letter1, exp1, letter2, exp2) {
  const numFactors = [];
  const denomFactors = [];
  for (const [letter, exp] of [[letter1, exp1], [letter2, exp2]]) {
    if (exp === 0) continue;
    const absExp = Math.abs(exp);
    const part = absExp === 1 ? letter : `${letter}^{${absExp}}`;
    (exp > 0 ? numFactors : denomFactors).push(part);
  }
  const numeratorVarPart = numFactors.join("");
  const numeratorStr = absValue === 1 && numeratorVarPart ? numeratorVarPart : `${absValue}${numeratorVarPart}`;
  if (denomFactors.length === 0) return numeratorStr;
  return `\\frac{${numeratorStr}}{${denomFactors.join("")}}`;
}

function colorize(color, latex) {
  return `\\textcolor{${color}}{${latex}}`;
}

/**
 * Turns terms ({value, absLatex}) into an array of individually-rendered LaTeX strings, one
 * per term, each with its own correct leading sign baked in (e.g. ["5x^{2}", "-3y^{4}"]) -
 * rendered as separate flex items (see revealNextStep) rather than one long joined string, so
 * a step can wrap onto extra lines on a narrow screen instead of ever needing horizontal scroll.
 */
function signedTermStrings(terms) {
  return terms.map(({ value, absLatex }, i) => {
    const sign = value < 0 ? "-" : i === 0 ? "" : "+";
    // "\ " is LaTeX's explicit control-space - a plain space character is ignored in math mode.
    return i === 0 ? `${sign}${absLatex}` : `${sign}\\ ${absLatex}`;
  });
}

/** Same idea as signedTermStrings, for terms that are always added (never subtracted) - just needs a leading "+" on every term after the first. */
function plusJoinedTermStrings(terms) {
  return terms.map((t, i) => (i === 0 ? t : `+\\ ${t}`));
}

/** Builds a fresh random question and its full set of reveal steps. */
function generateQuestion() {
  const [letter1, letter2] = pickLetters();
  let a = COEFF_RANGE[randomInt(0, COEFF_RANGE.length - 1)];
  let b = COEFF_RANGE[randomInt(0, COEFF_RANGE.length - 1)];
  const sign = Math.random() < 0.5 ? "+" : "-";
  const n = randomInt(POWER_MIN, POWER_MAX);

  // Pick which term (if any) gets an inner power/reciprocal this time, e.g. b^2, 3x^2, 1/y.
  let innerExp1 = 1;
  let innerExp2 = 1;
  if (Math.random() < SPECIAL_TERM_PROBABILITY) {
    const isReciprocal = Math.random() < 0.5;
    const innerExp = isReciprocal ? -1 : SPECIAL_INNER_POWERS[randomInt(0, SPECIAL_INNER_POWERS.length - 1)];
    if (Math.random() < 0.5) {
      innerExp1 = innerExp;
      if (isReciprocal) a = RECIPROCAL_NUMERATOR_RANGE[randomInt(0, RECIPROCAL_NUMERATOR_RANGE.length - 1)];
    } else {
      innerExp2 = innerExp;
      if (isReciprocal) b = RECIPROCAL_NUMERATOR_RANGE[randomInt(0, RECIPROCAL_NUMERATOR_RANGE.length - 1)];
    }
  }
  const signedB = sign === "-" ? -b : b;

  const term1Bracket = coeffLetter(a, letter1, innerExp1);
  const term2BracketAbs = coeffLetter(b, letter2, innerExp2);
  const questionLatex = `\\left(${term1Bracket} ${sign} ${term2BracketAbs}\\right)^{${n}}`;

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
    const term1Signed = coeffLetter(a, letter1, innerExp1);
    const term2Signed = coeffLetter(signedB, letter2, innerExp2);

    step1Terms.push(
      colorize(COLOR_COEFF, `\\binom{${n}}{${k}}`) +
        colorize(COLOR_TERM1, `\\left(${term1Signed}\\right)^{${powA}}`) +
        colorize(COLOR_TERM2, `\\left(${term2Signed}\\right)^{${k}}`)
    );

    const coeffValue = nCr(n, k);
    step2Terms.push(
      colorize(COLOR_COEFF, `${coeffValue}`) +
        colorize(COLOR_TERM1, `\\left(${term1Signed}\\right)^{${powA}}`) +
        colorize(COLOR_TERM2, `\\left(${term2Signed}\\right)^{${k}}`)
    );

    const part1 = evaluatedPower(a, letter1, innerExp1, powA);
    const part2 = evaluatedPower(signedB, letter2, innerExp2, k);
    step3Terms.push(
      colorize(COLOR_COEFF, `${coeffValue}`) +
        colorize(COLOR_TERM1, `\\left(${part1}\\right)`) +
        colorize(COLOR_TERM2, `\\left(${part2}\\right)`)
    );

    const combinedValue = coeffValue * Math.pow(a, powA) * Math.pow(signedB, k);
    const absValue = Math.abs(combinedValue);
    const absLatex = finalTermLatex(absValue, letter1, innerExp1 * powA, letter2, innerExp2 * k);
    finalTerms.push({ value: combinedValue, absLatex });
  }

  const coloredQuestionLatex = `\\left(${colorize(COLOR_TERM1, term1Bracket)} ${colorize(COLOR_TERM2, `${sign} ${term2BracketAbs}`)}\\right)^{${n}}`;

  steps = [
    { type: "katex", latex: coloredQuestionLatex, colored: true, noEquals: true },
    { type: "pascalRow", n },
    { type: "katexTerms", terms: plusJoinedTermStrings(step1Terms), colored: true },
    { type: "katexTerms", terms: plusJoinedTermStrings(step2Terms), colored: true },
    { type: "katexTerms", terms: plusJoinedTermStrings(step3Terms), colored: true },
    { type: "katexTerms", terms: signedTermStrings(finalTerms), colored: false },
  ];

  // "Expand" and the bracket are rendered as two separate KaTeX spans (not one string) so the
  // title can wrap between them on a narrow screen instead of ever needing horizontal scroll.
  questionEl.innerHTML = "";
  const expandSpan = document.createElement("span");
  window.katex?.render("\\text{Expand}", expandSpan, { throwOnError: false, displayMode: true });
  const bracketSpan = document.createElement("span");
  bracketSpan.className = "expansion-question-bracket";
  window.katex?.render(questionLatex, bracketSpan, { throwOnError: false, displayMode: true });
  questionEl.appendChild(expandSpan);
  questionEl.appendChild(bracketSpan);
  fitBracketToQuestion(bracketSpan);

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
  const narrow = window.matchMedia(NARROW_SCREEN_QUERY).matches;
  const label = narrow ? "Reveal next" : "Reveal next step";
  for (const btn of [revealBtn, revealBtnBottom]) {
    btn.textContent = label;
    // Hidden (not just disabled) once done - a disabled button on iOS Safari still lets a
    // double-tap gesture fall through to native zoom, since disabled elements aren't
    // hit-tested for touch-action purposes; hiding it entirely sidesteps that.
    btn.classList.toggle("hidden", done);
  }
  // The bottom controls duplicate the top ones (added so a long revealed-steps list doesn't force
  // scrolling all the way back up just to reveal the next step) - only worth showing once there's
  // actually a gap to save scrolling from, i.e. after at least one step has been revealed.
  controlsBottomEl.classList.toggle("hidden", revealedCount === 0);
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

/**
 * Rare fallback for when the bracket alone doesn't fit on its own flex line inside
 * .expansion-question: shrinks its font-size until it does. Deliberately not CSS
 * overflow-x:auto (see the CSS comment on .expansion-question-bracket) - measures against
 * the question container's own width, since the bracket itself is a shrink-to-fit flex item
 * with no fixed width of its own to overflow within.
 */
function fitBracketToQuestion(bracketSpan) {
  bracketSpan.style.fontSize = "";
  let guard = 0;
  while (bracketSpan.scrollWidth > questionEl.clientWidth && guard++ < 30) {
    const current = parseFloat(getComputedStyle(bracketSpan).fontSize);
    if (current <= MIN_STEP_FONT_SIZE) break;
    bracketSpan.style.fontSize = `${current - 1}px`;
  }
}

function refitAll() {
  // Only the single-expression "scroll" fallback step (no wrap points available) ever needs
  // shrinking - the wrap-based question title and multi-term steps handle narrow screens by
  // wrapping onto extra lines instead, so they never need this.
  for (const inner of stepsEl.querySelectorAll(".expansion-step-inner--scroll")) fitKatexBox(inner);
  const bracketSpan = questionEl.querySelector(".expansion-question-bracket");
  if (bracketSpan) fitBracketToQuestion(bracketSpan);
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
  } else if (step.type === "katexTerms") {
    // Several terms joined by +/- - each rendered as its own KaTeX span in a flex-wrap row, so
    // the row wraps onto extra lines on a narrow screen instead of ever needing horizontal scroll.
    const inner = document.createElement("div");
    inner.className = "expansion-step-inner expansion-step-inner--wrap";
    box.appendChild(inner);

    const eqSpan = document.createElement("span");
    window.katex?.render("=", eqSpan, { throwOnError: false, displayMode: true });
    inner.appendChild(eqSpan);

    for (const termLatex of step.terms) {
      const termSpan = document.createElement("span");
      window.katex?.render(termLatex, termSpan, { throwOnError: false, displayMode: true });
      inner.appendChild(termSpan);
    }

    if (!step.colored) box.classList.add("expansion-step-final");
  } else {
    // Single, indivisible expression (no internal wrap points) - old horizontal-scroll/shrink-to-fit fallback.
    const inner = document.createElement("div");
    inner.className = "expansion-step-inner expansion-step-inner--scroll";
    box.appendChild(inner);

    const prefix = step.noEquals ? "" : "= ";
    window.katex?.render(`${prefix}${step.latex}`, inner, { throwOnError: false, displayMode: true });
    if (!step.colored) box.classList.add("expansion-step-final");
    fitKatexBox(inner);
  }

  updateRevealButton();
  // Scroll all the way down (not just the new step into view) so the bottom button bar is
  // visible too - otherwise users can't tell it needs a further scroll to reach it.
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
}

newQuestionBtn.addEventListener("click", generateQuestion);
revealBtn.addEventListener("click", revealNextStep);
newQuestionBtnBottom.addEventListener("click", generateQuestion);
revealBtnBottom.addEventListener("click", revealNextStep);

// iOS Safari tab mode ONLY (not installed-PWA/standalone, which has no such gestures at all)
// ignores `touch-action`/viewport `user-scalable=no` for both pinch-zoom and (on some iOS
// versions) double-tap-zoom - `touch-action: manipulation` on the KaTeX boxes wasn't enough
// on its own. Suppressed at the JS level instead: `gesturestart`/`gesturechange` are Safari's
// proprietary pinch/rotate gesture events (no-op on other browsers, safe to always attach);
// a rapid second `touchend` inside a display-only (non-interactive) math box is treated as a
// double-tap-zoom attempt and prevented - buttons are deliberately excluded from this so a
// genuine fast double-click on "New question" etc. still registers both taps.
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("gesturechange", (e) => e.preventDefault());

const ZOOM_GUARD_SELECTOR = ".expansion-question, .expansion-step-inner, .expansion-step-row, .expansion-step-box";
const DOUBLE_TAP_WINDOW_MS = 350;
let lastMathTapTime = 0;
document.addEventListener(
  "touchend",
  (e) => {
    if (!e.target.closest(ZOOM_GUARD_SELECTOR)) return;
    const now = Date.now();
    if (now - lastMathTapTime <= DOUBLE_TAP_WINDOW_MS) e.preventDefault();
    lastMathTapTime = now;
  },
  { passive: false }
);

generateQuestion();
