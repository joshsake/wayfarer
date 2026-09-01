// ---------------------------------------------------------------------------
// Vitest setup — runs before each unit-test file's imports.
//
// LEARNING NOTE: Companion to the dummy env vars in vitest.config.ts. Creating
// the Supabase client (which unit tests reach transitively via the matching
// engine) also constructs a realtime client, and on Node < 22 that throws at
// import time because there's no global WebSocket. Unit tests never open a
// connection, so a do-nothing stub satisfies the constructor's capability
// check. `??=` means on Node 22+ (like CI) the real WebSocket is untouched.
// ---------------------------------------------------------------------------

(globalThis as { WebSocket?: unknown }).WebSocket ??= class StubWebSocket {
  constructor() {
    throw new Error("Unit tests must never open a WebSocket connection.");
  }
};
