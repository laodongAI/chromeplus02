# UI Updates (2025-11)

## Video capture panel
- Replaced the placeholder card with the production control surface that lists every detected `<video>` element, shows resolution/duration data, and gates actions on the current scan status.
- Added play / pause / toggle transport buttons plus dedicated start / stop recording controls, including per-row busy indicators and continuous recording timers.
- Side panel now listens to `VIDEO_RECORDING_STATUS` events so users immediately see when a capture starts, completes, or fails.

## Audio capture panel
- Centralized the Chrome tab messaging helpers so the panel can re-inject `content_script.js` automatically when the receiving end is missing.
- Improved the user-facing error copy to explain why “Could not establish connection” appears and how to resolve it (open the side panel on a supported site).
