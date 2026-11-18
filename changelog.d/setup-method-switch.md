### Fixed

- `jig setup` no longer leaves the old sign-in's fields beside the new one's. Choosing a sign-in method removes the fields of the methods it replaces (an email and a token when you pick a relay, a token when you pick a token command), keeps a setting that belongs to no method, such as a time limit, and runs the plugin's own check on the result before keeping it; when the check still fails, the sign-in is left as it was and the check's words are shown. A wrong value beside a sign-in, such as a time limit of 500, is asked again on the main screen too.
