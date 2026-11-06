export const WELCOME = `# Welcome to Margin

Margin is a notebook for **Markdown files only**. Everything here is an example you can edit or delete.

==Select any text and tap the highlighter to mark it.== Highlights come in ==green:green==, ==pink:pink== and ==blue:blue== too, and every highlight from every note is collected under **Highlights** in the library.

## What you can do

- **Upload .md** files from your phone or computer. Other file types are skipped.
- Read them in the **Read** view, or edit the Markdown in **Edit**.
- Everything saves automatically on this device and works offline.
- **Download .md** or **Share** a note. In Chrome or Edge on a computer, **Save to file** writes straight back to the original file.
- **Version history** keeps the last 20 versions of each note, so you can roll back.
- **Find** (Ctrl F) searches the open note. The search box in the library searches every note.

## Code is coloured, ABAP included

\`\`\`abap
define view entity ZI_SalesOrder
  as select from vbak
  association [0..*] to ZI_SalesItem as _Item
    on $projection.SalesOrder = _Item.SalesOrder
{
  key vbeln as SalesOrder,
  @Semantics.amount.currencyCode: 'Currency'
      netwr as NetAmount,
      waerk as Currency,
      _Item
}
\`\`\`

\`\`\`javascript
const total = items.reduce((sum, item) => sum + item.price, 0);
\`\`\`

## Checklist

- [x] Open Margin
- [ ] Upload your first .md file
- [ ] Install Margin on your home screen

## Keyboard shortcuts

| Action | Windows | Mac |
| --- | --- | --- |
| Save to file | Ctrl S | Cmd S |
| Find in note | Ctrl F | Cmd F |
| Switch Edit / Read | Ctrl E | Cmd E |
| Bold / Italic | Ctrl B / Ctrl I | Cmd B / Cmd I |
| Highlight | Ctrl Shift H | Cmd Shift H |
| Link | Ctrl K | Cmd K |

## Install Margin

- **iPhone or iPad (Safari):** tap Share, then *Add to Home Screen*.
- **Android (Chrome):** tap the menu, then *Install app*.
- **Windows or Mac (Chrome or Edge):** click the install icon at the right of the address bar. Then right-click any .md file and choose *Open with → Margin*.
- **Mac (Safari):** File → *Add to Dock*.

> Tip: tap **Outline** to jump between headings in long notes.
`;
