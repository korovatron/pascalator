import { computeExactValue, describeSelection, digitCount, INFOCARD_EXACT_LIMIT, log10Binomial, scientificFromLog10 } from "./triangle.js";

export class InfoCard {
  constructor() {
    this.el = document.getElementById("infoCard");
    this.nEl = document.getElementById("infoN");
    this.kEl = document.getElementById("infoK");
    this.digitsEl = document.getElementById("infoDigits");
    this.valueEl = document.getElementById("infoValue");
    this.sequenceEl = document.getElementById("infoSequence");
    this.sequenceLabelEl = document.getElementById("infoSequenceLabel");
    this.sequenceDetailEl = document.getElementById("infoSequenceDetail");
    this.noteEl = document.getElementById("infoNote");
  }

  /** Show info for cell (n, k), naming the sequence if it's part of a highlighted row/diagonal. */
  show(n, k, selection = null) {
    // Reset any previous auto-fit overrides (see _fitSequenceBox) before re-measuring.
    this.el.style.width = "";
    this.el.style.fontSize = "";

    this.nEl.textContent = n.toLocaleString();
    this.kEl.textContent = k.toLocaleString();

    const description = describeSelection(selection);
    this.sequenceLabelEl.textContent = description?.label || "";
    this.sequenceLabelEl.classList.toggle("hidden", !description?.label);
    if (description?.detail && description.detailIsMath && window.katex) {
      this.sequenceDetailEl.innerHTML = "";
      window.katex.render(description.detail, this.sequenceDetailEl, { throwOnError: false, displayMode: true });
    } else {
      this.sequenceDetailEl.textContent = description?.detail || "";
    }
    // Named-sequence descriptions (e.g. "Triangular numbers") are plain text, not KaTeX - pick
    // them out visually in yellow so they stand out as a named result, distinct from the plain
    // white maths formulas (row/hockey-stick/cell identities) shown for other selection types.
    this.sequenceDetailEl.classList.toggle("named", Boolean(description?.detail) && !description.detailIsMath);
    this.sequenceEl.classList.toggle("hidden", !description);

    if (n <= INFOCARD_EXACT_LIMIT) {
      const value = computeExactValue(n, k);
      this.valueEl.textContent = value.toString();
      this.digitsEl.textContent = digitCount(n, k).toLocaleString();
      this.noteEl.textContent = "";
    } else {
      const log10 = log10Binomial(n, k);
      this.valueEl.textContent = `~${scientificFromLog10(log10, 6)}`;
      this.digitsEl.textContent = `~${(Math.floor(log10) + 1).toLocaleString()}`;
      this.noteEl.textContent = "Row too large to compute an exact value here.";
    }

    this.el.classList.remove("hidden");
    this._fitSequenceBox();
  }

  /**
   * If the KaTeX/pattern box is too narrow for its content, first try widening the whole card
   * (up to a sensible cap, leaving a margin either side of the viewport), and only if that
   * still isn't enough room (e.g. a narrow phone screen), shrink the card's font size until
   * the content fits - avoids ever needing a horizontal scrollbar or clipped content.
   */
  _fitSequenceBox() {
    if (this.sequenceEl.classList.contains("hidden")) return;
    const detail = this.sequenceDetailEl;
    const maxWidth = Math.min(window.innerWidth - 32, 640);
    const minFontSize = 12;

    let guard = 0;
    while (detail.scrollWidth > detail.clientWidth && guard++ < 30) {
      const currentWidth = this.el.getBoundingClientRect().width;
      if (currentWidth < maxWidth - 1) {
        this.el.style.width = `${Math.min(maxWidth, currentWidth + 24)}px`;
      } else {
        break;
      }
    }

    guard = 0;
    while (detail.scrollWidth > detail.clientWidth && guard++ < 30) {
      const currentSize = parseFloat(getComputedStyle(this.el).fontSize);
      if (currentSize <= minFontSize) break;
      this.el.style.fontSize = `${currentSize - 1}px`;
    }
  }

  hide() {
    this.el.classList.add("hidden");
  }
}

