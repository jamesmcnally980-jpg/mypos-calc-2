# Venue Rota Maker – desktop app

Electron wrapper around `index.html`. Data is saved locally in the app's own storage
(use the Export / Import tab for backups).

## Run
    npm install
    npm start

## Build an installer (run on the target OS)
    npm run build:win     # Windows .exe installer
    npm run build:mac     # macOS .dmg
    npm run build:linux   # Linux AppImage
Output goes to `dist/`.
