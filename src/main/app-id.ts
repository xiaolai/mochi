/**
 * Who this application is, to the operating system.
 *
 * Its own module for one reason: `index.ts` imports electron, so nothing there
 * can be reached by a test -- and this value has a twin in
 * `electron-builder.yml` that has to match it. A constant nobody can compare is
 * a constant that drifts.
 *
 * Without an explicit AppUserModelID, Windows identifies the process by its
 * executable -- `electron.exe` in development -- and groups the taskbar button
 * and any notifications under that identity rather than ours. It must be set
 * before any window exists.
 */
export const APP_USER_MODEL_ID = 'com.mochi.companion'
