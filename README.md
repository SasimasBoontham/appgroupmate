# SentAppToAjarn - Submission Ready Notes

## 1) Project Summary
This is a single-page web app for group collaboration with these features:
- Account sign up/sign in (email domain restricted)
- Group create/join
- Group chat with reactions
- Notes and calendar views
- Local persistence with optional Firebase Realtime Database sync

## 2) Final Architecture
- Entry point: script.js (ES Module)
- Styling: styles.css
- Page structure: index.html
- Utility modules under js/

### Modules
- js/constants.js: shared constants and storage keys
- js/auth-utils.js: email normalization and auth helpers
- js/date-utils.js: date/time formatting
- js/ui-utils.js: clipboard + keyboard activation helpers
- js/group-id-utils.js: group id generation/normalization helpers
- js/realtime-persistence.js: autosave engine (debounce + heartbeat + lifecycle flush)
- js/database-config.js: Firebase config placeholders
- js/database.js: database read/write adapter with structured sections

## 3) Data Structure (Database)
Remote payload is organized by sections for clear grading and review:
- meta
- summary
- sections.auth
- sections.groups
- sections.chat
- sections.notes
- sections.calendar
- sections.session
- state (full compatibility snapshot)

## 4) Run Instructions
1. Open the folder in VS Code
2. Start a static server (example):
   python3 -m http.server 5501
3. Open:
   http://localhost:5501

## 5) Firebase Setup (Optional but recommended)
1. Create Firebase project
2. Enable Realtime Database
3. Copy web config values into js/database-config.js
4. Reload app

If config is not set, app still works with localStorage fallback.

## 6) Submission Checklist
- [x] ES module structure applied
- [x] Realtime autosave enabled
- [x] Database adapter integrated
- [x] Structured database schema implemented
- [x] Local fallback preserved
- [x] No current file-level errors in core project files

## 7) Known Demo Constraints
- Authentication is demo-level (client-side state)
- Forgot-password flow is demo behavior
- For production: add Firebase Auth and server-side password handling
