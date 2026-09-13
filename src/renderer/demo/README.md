# Demo font

Quit the installed app, then run `npm run dev:demo` from the repo.
Use `npm run dev` to return to normal. No setting or data is saved.

Flow Rounded covers mail subjects/previews, address fields, calendar titles/notes,
and chat tab/context titles. Controls, avatars, attachments, email bodies, and AI
responses remain readable. This is a visual aid, not secure redaction: original
text still exists in the page, clipboard, and accessibility tree. Unsupported
characters, other screens, and error messages may remain readable. Check your
recording before sharing it.

The Vite plugin runs only when serving in `demo` mode. These files are outside
`public`, aren't imported by the app, and aren't included in production builds.
Remove this folder, the `dev:demo` script, and the demo plugin to undo the feature.

Font: [Flow Rounded](https://github.com/google/fonts/tree/main/ofl/flowrounded),
by the Flow Project Authors, under the included SIL Open Font License.
