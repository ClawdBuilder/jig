// Starts a test process in which no package of Pi can be loaded: a first import of anything whose specifier starts with
// `@earendil-works/` fails, as it would on a machine where Pi is not installed. Everything else is as in test/support/host.mjs:
// the isolated environment of test/support/hermetic.mjs comes first, then the guard (test/support/refuse-pi.mjs, which a child process
// can use on its own). `npm run test:engine` starts the engine's tests with it, to show that the engine loads and runs a call with no Pi (design 5.5).
//
// A type import is erased before it runs, so a test or a file of the engine may still name a Pi type.
import "./hermetic.mjs";
import "./refuse-pi.mjs";
