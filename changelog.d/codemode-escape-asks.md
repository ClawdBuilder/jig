### Fixed

- A codemode script that contains a `\u` escape now asks before it runs, as one that names `models` does: `\u006dodels` spelled the word without writing it, so the text check let the script through as a plain read. A `\u` inside a string asks too, which is the safe side. The dialog says "the script writes an escaped name" only when the escape is the sole reason; a script that also names `models` keeps that reason. The check reads text and is a speed bump in front of the ask, not a proof.
