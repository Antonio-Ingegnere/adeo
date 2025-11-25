# Electron Hello World

Simple TypeScript-based Electron boilerplate that opens a single window showing "Hello World".

## Setup

1. Install dependencies: `npm install`
2. Build and run: `npm start`

The entry point is compiled from `src/main.ts` to `dist/main.js`, which creates a `BrowserWindow` loading `index.html`. The preload script (`src/preload.ts`) runs in an isolated context and populates the displayed Electron version.
