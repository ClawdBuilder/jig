### Fixed

- `jig setup jira` says what is true of every way to sign in: "Jig never signs in for you: it reads a token from a store you choose, or sends requests through a session relay that holds your sign-in." The old line said Jig reads a token, which is wrong when the sign-in is a relay and there is no Jira token. Logs' setup has no such line.
