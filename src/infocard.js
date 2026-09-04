import { computeExactValue, describeSelection, digitCount, INFOCARD_EXACT_LIMIT, log10Binomial, scientificFromLog10 } from "./triangle.js";

export class InfoCard {
  constructor() {
    this.el = document.getElementById("infoCard");
    this.nEl = document.getElementById("infoN");
    this.kEl = document.getElementById("infoK");
    this.digitsEl = document.getElementById("infoDigits");
    this.valueEl = document.getElementById("infoValue");
    this.sequenceEl = document.getElementById("infoSequence");
    this.noteEl = document.getElementById("infoNote");
  }

  /** Show info for cell (n, k), naming the sequence if it's part of a highlighted row/diagonal. */
  show(n, k, selection = null) {
    this.nEl.textContent = n.toLocaleString();
    this.kEl.textContent = k.toLocaleString();

    const description = describeSelection(selection);
    this.sequenceEl.textContent = description || "";
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
  }

  hide() {
    this.el.classList.add("hidden");
  }
}

