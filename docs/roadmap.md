# Roadmap

## Next

- Guided first-run setup for HEY CLI and Pi. Settings already shows runtime status; installation and login still happen outside the app.
- Signed in-app updates, with approval before restarting and existing data preserved. Releases and manual installation are working.

## Still needs testing

- Switching between two real linked accounts. The laptop install passed; live two-account testing is still outstanding.
- Watch for the reported startup typing lockup. Keyboard routing and modal focus have been fixed, but that specific hide/show recovery case was never reproduced. Investigate if it returns; don't add automatic refocus loops.

## Possible later

- Richer mail formatting controls and “Write Like Me” using explicitly selected writing samples.
- Helper import/export and cross-machine sync. Custom Helpers already work locally.
- Desktop notifications for new mail. Sound settings and action cues already exist.
- Session working-directory selection.
- Broader Linux and ARM64 testing. Omarchy x86-64 is the tested platform.

## Revisit with CLI support

- RSVP, creating events from ordinary emails, and calendar management. Invitation attachment previews and adding a personal calendar copy already work; a copy does not send an RSVP.
- An All Files browser, including files from a contact. Don't crawl the mailbox to approximate it.
- Sticky/merge bulk actions.

Automations, scheduled/unattended Helpers, and Workflow Organizer remain on hold. They are not part of the next release plan.
