/* `server-only` exists to make a build fail if server code is imported into the
   browser. That guard has nothing to enforce inside the test runner, where
   there is no client bundle to leak into — so it stands in for the real one. */
export {};
