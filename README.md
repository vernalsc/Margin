# Margin

Margin is a notes app for Markdown files only. You can upload, read, edit, highlight and save `.md` files. It installs on phones and computers and works offline.

**Open it:** https://vernalsc.github.io/Margin/

## What it does

- **Upload .md:** pick Markdown files from your phone or computer, or drag them onto the window. Any other file type is skipped and the app tells you why.
- **Read:** the formatted view, with an outline of your headings and coloured code (ABAP and ABAP CDS included).
- **Edit:** a Markdown editor that colours its own syntax. A formatting toolbar rides above the phone keyboard, and lists continue when you press Enter.
- **Highlight:**
  - `==text==` gives a yellow highlight. `==green:text==`, `==pink:text==` and `==blue:text==` give the other colours.
  - The **Highlights** tab in the library collects every highlight from every note.
  - Find (Ctrl F) and the library search highlight their matches.
  - Code blocks are coloured too.
- **Save:**
  - Notes save automatically on your device.
  - **Download .md** or **Share** a note.
  - In Chrome or Edge on a computer, **Save to file** (Ctrl S) writes back to the original file. If that file changed outside Margin since you opened it, Margin warns you before overwriting.
- **Version history:** Margin keeps the last 20 versions of each note.
- **Library:** pin notes to the top and sort by date edited, name or date added.
- **Reading comfort:** text size from S to XL, light and dark themes, and a focus mode.
- **Backup:** download every note as a `.zip`, or restore from one.

## Install

| Device | How |
| --- | --- |
| iPhone / iPad | Open the link in Safari → Share → **Add to Home Screen** |
| Android | Open the link in Chrome → menu → **Install app** |
| Windows / Mac (Chrome or Edge) | Click the install icon at the right of the address bar. Then right-click any `.md` file → **Open with → Margin** |
| Mac (Safari) | File → **Add to Dock** |

## Where your notes live

Notes are stored in your browser's storage (IndexedDB) on each device. Nothing is sent to a server. Notes don't sync between devices, so use **Download all (.zip)** in Settings to back up or move them.

## Develop

Margin is plain HTML, CSS and JavaScript, with no build step.

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Bump `VERSION` in `sw.js` whenever you change a file, so installed copies pick up the update.

## Credits

The app uses these libraries and fonts, bundled in `vendor/` and `fonts/` with their licences:

- [marked](https://github.com/markedjs/marked) (MIT)
- [DOMPurify](https://github.com/cure53/DOMPurify) (Apache-2.0 / MPL-2.0)
- [highlight.js](https://highlightjs.org) (BSD-3-Clause)
- IBM Plex Sans and IBM Plex Mono (SIL OFL 1.1)
- Source Serif 4 (SIL OFL 1.1)
