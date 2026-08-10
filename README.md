# ListPreview

Aperçu du corps du message directement dans la liste des mails (vue **Cartes**),
façon Outlook/Gmail — pour Thunderbird / Betterbird 128+.

Ni Thunderbird ni Betterbird n'affichent le texte du message dans la liste
(la 3ᵉ ligne des cartes ne montre que fil/étiquettes). Ce module ajoute une
ligne d'aperçu grisée sous le sujet de chaque carte.

## Fonctionnement

- **Experiment API** (pas d'API MailExtension pour le thread pane) :
  `api/implementation.js` patche `ThreadCard._fillRow` dans chaque `about:3pane`.
- Le texte est extrait par `MsgHdrToMimeMessage` +
  `mimeMsgToContentSnippetAndMeta` (le chemin des snippets de Thunderbird
  Conversations : parsing MIME complet, HTML→texte, téléchargement serveur si
  pas de copie locale), puis mis en cache dans la propriété `preview` du header
  — chaque message n'est parsé qu'une fois.
- Ne PAS utiliser l'option `partsOnDemand` ni `fetchMsgPreviewText` : sur
  certains profils (constaté sur Betterbird 140), la lecture directe du store
  offline (`getLocalMsgStream`) rend un stream vide, et ces chemins produisent
  alors des aperçus vides sans erreur.
- La hauteur des cartes est augmentée d'une ligne en enveloppant
  `threadPane.densityChange()`.

## Installation

Télécharger le `.xpi` de la [dernière release](../../releases/latest), puis
Thunderbird/Betterbird → Modules complémentaires → ⚙️ → **Installer un module
depuis un fichier**. (Release construite par tag : `git tag vX.Y.Z && git push
--tags`, la version du tag doit matcher `manifest.json`.)

## Développement (module temporaire)

1. Betterbird → ☰ → Outils → Outils de développement → Déboguer des modules
   (`about:debugging`) → **Charger un module complémentaire temporaire**.
2. Sélectionner `manifest.json` du repo
   (depuis Windows : `\\wsl.localhost\Ubuntu\home\nzaou\work\dev\listpreview\manifest.json`).
3. Passer la liste en **vue Cartes** (menu d'affichage de la liste des messages).
4. Console d'erreurs (Ctrl+Maj+J) : les logs sont préfixés `[ListPreview]`.

Un module temporaire disparaît au redémarrage — recharger depuis `about:debugging`
après chaque modification du code.

## Limites connues (prototype)

- Vue Cartes uniquement (pas la vue Tableau ni la multi-lignes Betterbird).
- Premier affichage d'un dossier : un streaming MIME par message visible,
  le texte apparaît avec un léger différé (puis cache via la propriété
  `preview` du header).
- Experiment API : à re-tester à chaque montée de version majeure
  (les internals d'`about3Pane` bougent entre ESR).

## Périmètre

Le module se limite volontairement à **l'aperçu du corps** dans la liste.
Les avatars expéditeur (rond initiales/photo/logo) sont délégués au module
[Auto Profile Picture](https://github.com/noam-sc/thunderbird-auto-profile-picture),
qui monte son avatar dans la 1re colonne des cartes (nous : la 2e) — les deux
cohabitent. Sa CSS détecte la densité par hauteur de carte exacte
(`[style="height: 60px;"]`), que notre surcharge de hauteur fait diverger :
impact cosmétique mineur possible.

## Pistes

- Support de la vue multi-lignes Betterbird (patch de `thread-row`).
- Activation/désactivation par dossier.
- Packaging XPI (`zip -r listpreview.xpi manifest.json background.js api
  options.html options.js icon.svg`) pour une installation permanente (les
  modules temporaires disparaissent au redémarrage).
