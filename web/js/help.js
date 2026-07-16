/* In-product help topics.

   Help is DATA, not markup. Every topic is markdown source that renderHelpBody
   turns into HTML here. Today the topics ship in the bundle (HELP below); the
   seam for serving them from the API instead is helpRemote — see the note above
   helpTopic().

   Because the endgame is a wiki on the web side where USERS write these, the
   renderer never trusts a topic body. This webview holds a live pywebview
   bridge (config writes, folder pickers), so HTML injected through a help topic
   would be code execution, not a nuisance popup. Two rules keep that shut:
   escape the whole source FIRST and only then apply markdown to the escaped
   text, and support no construct that can carry a URL. There are deliberately
   no links — help describes the page you're already on. */

const HELP = {
  'mail-directories': {
    title: 'Setting up your SWG mail folders',
    summary: "SWG doesn't write mail to disk until you run /mailsave in-game.",
    body: `
SWG keeps your mail on the server, not on your PC. Nothing appears on disk —
and there's nothing for this app to read — until you export it from inside the
game with **/mailsave**. That export is per-character, which is why each folder
below is tied to one character.

## Exporting a character's mail

1. Log in as the character whose mail you want tracked.
2. Type \`/mailsave\` in the chat box and press Enter.
3. It tells you how many mails it's saving — something like **300 mails**. They
   get written out in the background, and a full mailbox takes several minutes.
   Don't expect it to finish while you watch.
4. Run \`/mailsave\` again whenever you want to check on it. The number it reports
   is how many are **left** — 300, then 250, and so on down.
5. When it's finished it says it **saved successfully**, and tells you the folder
   it wrote to. That folder is exactly what goes in the box below, so it's worth
   not missing.
6. Repeat for each character. \`/mailsave\` only ever exports the character that
   ran it.

## Pointing the app at the folder

Pick the character in the dropdown, then paste the folder from that “saved
successfully” message, or use the folder button to browse to it.

### If you missed the message

You can find the folder yourself — it's named \`mail_\` followed by the character
name, somewhere under the \`profiles\` folder inside your SWG install. The exact
path isn't the same on every machine, so don't go looking for a specific one:
start at your SWG install, open \`profiles\`, and keep opening folders until you
see the \`mail_\` ones. That's the level you want.

If there are no \`mail_\` folders anywhere, either \`/mailsave\` hasn't run for
any character yet, or it's still working — give it a few minutes and look again.

## Keeping it current

\`/mailsave\` exports what's in the mailbox at that moment — it isn't a live
feed. Run it again whenever mail you want tracked has come in. With mail
monitoring on, the app notices the new files and uploads them on its own.
`,
  },

  'scanner': {
    title: 'Scanning resources out of the game',
    summary: 'Point the scan area at an Examine window once, then one hotkey reads the stats for you.',
    body: `
The scanner reads a resource's stats straight off the screen, so you don't have
to type them in. You line up a scan area over the game's **Examine** window
once, and from then on a single hotkey grabs whatever is inside it, reads the
text, and queues it here for review — even while the game has focus.

## One-time setup

1. Open the Scanner page and press **Position scan area**. A dashed outline
   appears that always stays on top.
2. In game, examine a resource so its stats window is open.
3. Drag the outline over the Examine window (or move the game window under it),
   and resize it to fit snugly around the name and stats.
4. Press **Test scan** to check the fit — a capture should land in the queue
   with the stats read out.
5. Press **Save**. The scanner reads that exact spot from now on.

## Day-to-day use

Examine a resource, press the scan hotkey (**ctrl+shift+x** unless you changed
it), and keep playing — each press captures one resource. A second hotkey
(**ctrl+shift+a**) shows or hides the scan-area outline if you need to reposition
it. You'll hear a sound when a scan lands: the chosen success sound when text
was read, and a low error sound when something went wrong. Both can be changed
or turned off in Settings.

Captures pile up in the queue on the Scanner page. Each one shows what was
read, the stats it parsed, and the closest matches from the resource database —
stats are matched exactly, so even a mangled name usually finds the right
resource. Pick the match, press **Add to stockpile**, done.

## If a scan fails

- **No text found** — the Examine window probably wasn't inside the outline.
  Show the outline and check the fit.
- **Capture blocked** — on a Mac, screen capture needs permission the first
  time: allow it under Privacy & Security, Screen Recording, then relaunch.
- **Wrong numbers** — OCR can misread a digit. The capture image is shown next
  to what was read, so a quick glance catches it before it goes anywhere.

Scanning needs the built-in text recognition of Windows 10 or newer (or macOS).
Nothing extra to install.
`,
  },

  'mail-handling': {
    title: 'What happens to a mail after it uploads',
    summary: 'Choose whether processed mail files are kept, deleted, or moved aside.',
    body: `
Once a mail file has been read and uploaded, the app can leave it alone or clear
it out of the way. The mail itself is already safe on the server at that point —
this only decides what happens to the local file \`/mailsave\` wrote.

- **Keep it where it is** — nothing is touched. Your SWG mail folders grow over
  time, since \`/mailsave\` re-exports mail you've already uploaded.
- **Delete it** — the file is removed after a successful upload. This keeps the
  mail folders small and makes each \`/mailsave\` faster.
- **Move it to** — the file is moved to a folder you choose. Same tidiness as
  deleting, but the originals stay on disk. You have to pick the destination
  folder before this option can be selected.

Uploads happen first either way, so a failed upload never loses a file.
`,
  },
};

/* Topics live in the help_topics table on swgtracker.com and are edited through
   admin/help_topics.php — that's the source of truth, and an edit reaches users
   on their next app start with no bundle deploy. HELP above is the offline
   fallback for a first run with no connection, so it's worth keeping roughly in
   step with the live copy but it doesn't have to be exact.

   Remote bodies go through the same escape-first rendering as local ones. Whoever
   edited the row is untrusted input as far as this renderer is concerned. */
let helpRemote = null;

function helpTopic(id) {
  return (helpRemote && helpRemote[id]) || HELP[id] || null;
}

/* Fire-and-forget on boot: the bundle copy is already usable, so a failure here
   costs nothing and must never block the UI. Public endpoint — help has to work
   before an API key is entered, which is exactly when someone needs the setup
   topics most. */
async function loadHelpTopics() {
  try {
    const res = await apiFetch('GET', 'api/help.php');
    const topics = res && res.ok && res.data && res.data.results;
    if (!Array.isArray(topics) || !topics.length) return;
    const next = {};
    topics.forEach((t) => {
      if (t && t.slug && t.title && t.body) next[t.slug] = t;
    });
    if (Object.keys(next).length) helpRemote = next;
  } catch (_) { /* offline or endpoint not deployed — the bundle copy stands */ }
}

// The hover summary for a [data-help] element — initTooltips() pulls this.
function helpSummary(id) {
  const topic = helpTopic(id);
  return topic ? `${topic.summary}\nClick for the full guide.` : '';
}

// Inline markdown, applied to ALREADY-ESCAPED text. Nothing here can introduce a
// URL: code spans and bold only.
function helpInline(escaped) {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/* Markdown subset -> HTML: "## " headings, "1. " steps, "- " bullets, and blank-
   line-separated paragraphs. Everything else is literal text. Each line is
   escaped before it's matched, so a body full of angle brackets renders as the
   characters the author typed. */
function renderHelpBody(src) {
  const out = [];
  let list = null; // { tag: 'ol' | 'ul', items: [] }
  let para = [];

  const flushList = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${helpInline(para.join(' '))}</p>`);
    para = [];
  };
  const pushItem = (tag, html) => {
    if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
    list.items.push(html);
  };

  String(src).split('\n').forEach((raw) => {
    const line = escapeHtml(raw.trim());
    if (!line) { flushPara(); flushList(); return; }
    let m;
    if ((m = line.match(/^(#{2,3})\s+(.*)$/))) {
      flushPara(); flushList();
      const tag = m[1].length === 2 ? 'h3' : 'h4'; // "##" section, "###" subsection
      out.push(`<${tag}>${helpInline(m[2])}</${tag}>`);
    } else if ((m = line.match(/^\d+\.\s+(.*)$/))) {
      flushPara();
      pushItem('ol', helpInline(m[1]));
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      flushPara();
      pushItem('ul', helpInline(m[1]));
    } else if (list) {
      // a wrapped continuation line belongs to the item above it
      list.items[list.items.length - 1] += ` ${helpInline(line)}`;
    } else {
      para.push(line);
    }
  });
  flushPara();
  flushList();
  return out.join('');
}

// Opens the topic dialog. Esc, the close button, and a backdrop click all close.
function openHelp(id) {
  const topic = helpTopic(id);
  const modal = $('#help-modal');
  if (!topic || !modal) return;
  $('#help-title').textContent = topic.title;
  $('#help-body').innerHTML = renderHelpBody(topic.body);
  $('#help-body').scrollTop = 0;
  modal.hidden = false;
  $('#help-body').focus(); // the scroll region, not the ✕ — see index.html

  const close = () => {
    modal.hidden = true;
    modal.removeEventListener('keydown', onKey);
    modal.removeEventListener('click', onBackdrop);
    $('#help-close').removeEventListener('click', close);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const onBackdrop = (e) => { if (e.target === modal) close(); };
  modal.addEventListener('keydown', onKey);
  modal.addEventListener('click', onBackdrop);
  $('#help-close').addEventListener('click', close);
}

/* One delegated listener for every help icon in the app, present or future — a
   [data-help] attribute is the whole contract, so JS-rendered rows need no
   wiring. The hover summary rides the existing tooltip engine the same way. */
function initHelp() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-help]');
    if (!el) return;
    e.preventDefault();
    openHelp(el.dataset.help);
  });
  loadHelpTopics(); // not awaited — the bundle copy covers us until it lands
}
