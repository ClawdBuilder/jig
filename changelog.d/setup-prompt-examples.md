### Fixed

- `jig setup`: an example in a prompt no longer looks like a default. "The relay's address (http://127.0.0.1:8700):" followed by Enter was refused, so every required question now says "(for example http://127.0.0.1:8700)", as the optional ones did; a value already set stays "(Now: ...)", which Enter keeps. The name of an object (a relay, a log environment) says "(press Enter to skip; for example orders-relay)", because an empty name adds nothing. The refusal reads as a sentence: "Please enter a value for the relay's address."
