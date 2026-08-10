const DEFAULTS = { lines: 1, fontPct: 85 };

const linesEl = document.getElementById("lines");
const fontEl = document.getElementById("fontPct");

async function load() {
  const stored = await browser.storage.local.get(DEFAULTS);
  linesEl.value = String(stored.lines);
  // Retombe sur "Normale" si la valeur stockée ne matche aucune option.
  fontEl.value = [...fontEl.options].some(o => o.value === String(stored.fontPct))
    ? String(stored.fontPct)
    : "85";
}

function save() {
  browser.storage.local.set({
    lines: parseInt(linesEl.value, 10),
    fontPct: parseInt(fontEl.value, 10),
  });
}

linesEl.addEventListener("change", save);
fontEl.addEventListener("change", save);
load();
