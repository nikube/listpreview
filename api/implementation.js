/**
 * ListPreview — Experiment API.
 *
 * Injecte une ligne d'aperçu du corps du message dans les cartes de la liste
 * de messages (vue Cartes d'about:3pane, TB/Betterbird 128+).
 *
 * Mécanique :
 *  - hooke chaque fenêtre messenger.xhtml, puis chaque onglet about:3pane ;
 *  - monkey-patche ThreadCard._fillRow pour remplir une div .lp-snippet ;
 *  - le texte est extrait par MsgHdrToMimeMessage + mimeMsgToContentSnippetAndMeta
 *    (le même chemin que les snippets de Thunderbird Conversations), puis mis en
 *    cache dans la propriété `preview` du header ;
 *  - la hauteur des cartes est augmentée d'une ligne en enveloppant
 *    threadPane.densityChange().
 */

"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);
var { MsgHdrToMimeMessage } = ChromeUtils.importESModule(
  "resource:///modules/gloda/MimeMessage.sys.mjs"
);
var { mimeMsgToContentSnippetAndMeta } = ChromeUtils.importESModule(
  "resource:///modules/gloda/GlodaContent.sys.mjs"
);

const WINDOW_LISTENER_ID = "listpreview@nikube.dev";
const TAB_MONITOR_NAME = "listPreviewTabMonitor";
const SNIPPET_LENGTH = 400;

// Options courantes (poussées par background.js depuis browser.storage).
const currentOptions = {
  lines: 1, // 1-3 lignes d'aperçu
  fontPct: 85, // taille de police en % de celle de la liste
};

function snippetCss({ lines, fontPct }) {
  // padding-inline-start: 3px = même retrait que .thread-card-subject-container.
  const clamp =
    lines > 1
      ? `display: -webkit-box;
         -webkit-box-orient: vertical;
         -webkit-line-clamp: ${lines};
         white-space: normal;
         overflow-wrap: anywhere;`
      : `white-space: nowrap;
         text-overflow: ellipsis;`;
  return `
    tr[is="thread-card"] .lp-snippet {
      font-size: ${fontPct / 100}em;
      opacity: 0.65;
      line-height: 1.5;
      overflow: hidden;
      padding-inline-start: 3px;
      min-height: 1em;
      ${clamp}
    }
    tr[is="thread-card"][data-properties~="dummy"] .lp-snippet {
      display: none;
    }
    /* Cohabitation Auto Profile Picture : son avatar est monté dans la 1re
       colonne (passée en flex-row par ses styles inline) avec un alignement
       pensé pour les hauteurs de carte standard ; nos cartes étant plus
       hautes (ligne d'aperçu), on le recentre verticalement. */
    tr[is="thread-card"] .thread-card-column:first-child:has(.recipient-avatar) {
      align-items: center;
      justify-content: flex-start;
    }
  `;
}

// Hauteur supplémentaire par carte pour `lines` lignes d'aperçu
// (même formule que densityChange : line-height 1.5 × font-size + gap).
function extraHeight(win) {
  const lineHeight =
    Math.round(1.5 * (currentOptions.fontPct / 100) * win.UIFontSize.size) + 3;
  return lineHeight * currentOptions.lines;
}

// Un état par fenêtre about:3pane hookée.
const hooked = new Map(); // win -> {cardClass, origFillRow, origDensityChange, ...}

function log(...args) {
  console.log("[ListPreview]", ...args);
}

// Verbeux le temps du debug du prototype.
const DEBUG = false;
function dbg(...args) {
  if (DEBUG) {
    console.log("[ListPreview:dbg]", ...args);
  }
}

/**
 * Remplit (ou crée) la ligne d'aperçu d'une carte.
 * `row` est un <tr is="thread-card">, `win` la fenêtre about:3pane.
 */
function fillSnippet(row, win) {
  let snippet = row.querySelector(".lp-snippet");
  if (!snippet) {
    snippet = row.ownerDocument.createElement("div");
    snippet.classList.add("lp-snippet");
    // La 2e colonne de la carte contient les lignes sender/subject.
    row.querySelector(".thread-card-row")?.parentElement?.appendChild(snippet);
    if (!snippet.parentElement) {
      return;
    }
  }
  snippet.textContent = "";

  const props = (row.dataset.properties || "").split(" ");
  if (props.includes("dummy")) {
    return;
  }

  let hdr;
  try {
    hdr = row.view.getMsgHdrAt(row._index);
  } catch (e) {
    dbg("getMsgHdrAt threw at index", row._index, e);
    return;
  }
  if (!hdr) {
    return;
  }

  let preview = "";
  try {
    preview = hdr.getStringProperty("preview");
  } catch (e) {
    // Propriété absente : on va la calculer.
  }
  if (preview) {
    snippet.textContent = preview;
    return;
  }
  requestSnippet(win, hdr);
}

/**
 * Extrait le snippet d'un message (async), le met en cache dans la propriété
 * `preview` du header, puis re-remplit les cartes affichées.
 */
function requestSnippet(win, hdr) {
  const state = hooked.get(win);
  if (!state) {
    return;
  }
  const folder = hdr.folder;
  if (!folder) {
    return;
  }
  const attemptKey = folder.URI + ":" + hdr.messageKey;
  if (state.attempted.has(attemptKey)) {
    return;
  }
  state.attempted.add(attemptKey);

  try {
    MsgHdrToMimeMessage(
      hdr,
      null,
      (aHdr, mimeMsg) => {
        if (!mimeMsg) {
          dbg("no mimeMsg for", attemptKey);
          return;
        }
        let text = "";
        try {
          ({ snippet: text } = mimeMsgToContentSnippetAndMeta(
            mimeMsg,
            aHdr.folder,
            SNIPPET_LENGTH
          ));
        } catch (e) {
          dbg("snippet extraction failed for", attemptKey, e);
        }
        if (!text) {
          // Plan B : aplatir le corps nous-mêmes.
          try {
            text = mimeMsg.coerceBodyToPlaintext(aHdr.folder) || "";
            text = text.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LENGTH);
          } catch (e) {
            dbg("coerceBodyToPlaintext failed for", attemptKey, e);
          }
        }
        if (!text) {
          try {
            dbg(
              "empty snippet for", attemptKey,
              "contentType:", mimeMsg.contentType,
              "parts:", (mimeMsg.parts || []).map(p => p.contentType).join(","),
              "prettyString:", mimeMsg.prettyString?.(true)?.slice(0, 400)
            );
          } catch (e) {
            dbg("empty snippet for", attemptKey, "(dump failed)", e);
          }
          return;
        }
        try {
          aHdr.setStringProperty("preview", text);
        } catch (e) {
          dbg("setStringProperty(preview) failed", e);
        }
        scheduleRefresh(win);
      },
      true, // allowDownload : va chercher le corps au serveur si pas de copie locale
      { saneBodySize: true }
    );
  } catch (e) {
    dbg("MsgHdrToMimeMessage threw for", attemptKey, e);
  }
}

function scheduleRefresh(win) {
  const state = hooked.get(win);
  if (!state) {
    return;
  }
  win.clearTimeout(state.refreshTimer);
  state.refreshTimer = win.setTimeout(() => refreshSnippets(win), 100);
}

/**
 * Re-remplit directement les cartes actuellement rendues.
 */
function refreshSnippets(win) {
  const rows = win.document.querySelectorAll('tr[is="thread-card"]');
  for (const row of rows) {
    try {
      fillSnippet(row, win);
    } catch (e) {
      log("refresh fillSnippet error", e);
    }
  }
}

/**
 * Hooke une fenêtre about:3pane : CSS, _fillRow, densityChange.
 */
function hook3Pane(win) {
  if (hooked.has(win) || win.closed) {
    return;
  }
  const doc = win.document;
  const cardClass = win.customElements.get("thread-card");
  if (!cardClass || !win.threadPane) {
    log("about:3pane sans thread-card/threadPane, skip", doc?.URL);
    return;
  }

  const style = doc.createElement("style");
  style.id = "lp-style";
  style.textContent = snippetCss(currentOptions);
  doc.head.appendChild(style);

  const origFillRow = cardClass.prototype._fillRow;
  cardClass.prototype._fillRow = function () {
    origFillRow.call(this);
    try {
      fillSnippet(this, win);
    } catch (e) {
      log("fillSnippet error", e);
    }
  };

  // Une ligne de plus dans le calcul de hauteur des cartes
  // (même formule que densityChange : line-height 1.5 × font-size + gap).
  const threadPane = win.threadPane;
  const origDensityChange = threadPane.densityChange;
  threadPane.densityChange = async function (...args) {
    await origDensityChange.apply(this, args);
    cardClass.ROW_HEIGHT = cardClass.ROW_HEIGHT + extraHeight(win);
  };

  hooked.set(win, {
    cardClass,
    origFillRow,
    origDensityChange,
    style,
    attempted: new Set(),
    refreshTimer: null,
  });

  win.addEventListener("unload", () => hooked.delete(win), { once: true });

  win.threadPane.updateThreadItemSize();
  log("hooked", doc.URL);
}

function unhook3Pane(win) {
  const state = hooked.get(win);
  if (!state) {
    return;
  }
  hooked.delete(win);
  if (win.closed) {
    return;
  }
  win.clearTimeout(state.refreshTimer);
  state.cardClass.prototype._fillRow = state.origFillRow;
  win.threadPane.densityChange = state.origDensityChange;
  state.style.remove();
  for (const el of win.document.querySelectorAll(".lp-snippet")) {
    el.remove();
  }
  win.threadPane.updateThreadItemSize();
}

/**
 * Hooke un onglet de tabmail s'il héberge un about:3pane.
 */
function maybeHookTab(tab) {
  const browser = tab.chromeBrowser;
  if (!browser) {
    return;
  }
  const tryHook = () => {
    const cw = browser.contentWindow;
    if (cw?.document?.URL === "about:3pane") {
      if (cw.document.readyState === "complete") {
        hook3Pane(cw);
      } else {
        cw.addEventListener("load", () => hook3Pane(cw), { once: true });
      }
    }
  };
  tryHook();
  // Le browser peut encore être sur about:blank : on écoute les loads suivants.
  browser.addEventListener("load", () => tryHook(), { capture: true });
}

function hookMessengerWindow(win) {
  const tabmail = win.document.getElementById("tabmail");
  if (!tabmail) {
    return;
  }
  for (const tab of tabmail.tabInfo) {
    maybeHookTab(tab);
  }
  tabmail.registerTabMonitor({
    monitorName: TAB_MONITOR_NAME,
    onTabOpened(tab) {
      maybeHookTab(tab);
    },
    onTabTitleChanged() {},
    onTabClosing() {},
    onTabPersist() {},
    onTabRestored() {},
    onTabSwitched() {},
  });
}

function unhookMessengerWindow(win) {
  const tabmail = win.document.getElementById("tabmail");
  try {
    const monitor = tabmail?.tabMonitors?.find(
      m => m.monitorName === TAB_MONITOR_NAME
    );
    if (monitor) {
      tabmail.unregisterTabMonitor(monitor);
    }
  } catch (e) {
    log("unregisterTabMonitor failed", e);
  }
}

function applyOptions(options) {
  if (Number.isInteger(options?.lines) && options.lines >= 1) {
    currentOptions.lines = Math.min(options.lines, 3);
  }
  if (Number.isFinite(options?.fontPct)) {
    currentOptions.fontPct = Math.min(Math.max(options.fontPct, 60), 120);
  }
  for (const [win, state] of hooked) {
    if (win.closed) {
      continue;
    }
    state.style.textContent = snippetCss(currentOptions);
    win.threadPane.updateThreadItemSize();
  }
}

var ListPreview = class extends ExtensionCommon.ExtensionAPI {
  getAPI() {
    return {
      ListPreview: {
        async activate(options) {
          applyOptions(options);
          ExtensionSupport.registerWindowListener(WINDOW_LISTENER_ID, {
            chromeURLs: ["chrome://messenger/content/messenger.xhtml"],
            onLoadWindow(win) {
              hookMessengerWindow(win);
            },
          });
          log("activated", JSON.stringify(currentOptions));
        },
        async setOptions(options) {
          applyOptions(options);
          log("options applied", JSON.stringify(currentOptions));
        },
      },
    };
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    ExtensionSupport.unregisterWindowListener(WINDOW_LISTENER_ID);
    for (const win of [...hooked.keys()]) {
      unhook3Pane(win);
    }
    for (const win of Services.wm.getEnumerator("mail:3pane")) {
      unhookMessengerWindow(win);
    }
    log("shut down");
  }
};
