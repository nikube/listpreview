const DEFAULTS = { lines: 1, fontPct: 85 };

async function getOptions() {
  const stored = await browser.storage.local.get(DEFAULTS);
  return { lines: stored.lines, fontPct: stored.fontPct };
}

async function main() {
  await browser.ListPreview.activate(await getOptions());
  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area === "local" && (changes.lines || changes.fontPct)) {
      await browser.ListPreview.setOptions(await getOptions());
    }
  });
}

main();
