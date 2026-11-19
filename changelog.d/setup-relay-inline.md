### Fixed

- `jig setup`: "Through a session relay" is now always one of Jira's and logs' sign-in choices. Picking Jira before `Transports`, the natural order, used to hide it; now, when no relay exists yet, choosing it asks the relay's questions right there (name, address, where its token is kept, a health check without the token), then carries on with the pick of that relay and the time limit, and one save at the end writes both.
