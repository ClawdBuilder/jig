// Starts a test process in which no package of Pi can be loaded: a first import of anything whose specifier starts with
// `@earendil-works/` fails, as it would on a machine where Pi is not installed. Everything else is as in test/support/host.mjs:
// the isolated environment of test/support/hermetic.mjs comes first. `npm run test:engine` starts the engine's tests with it, to
// show that the engine loads and runs a call with no Pi (design 5.5).
//
// A type import is erased before it runs, so a test or a file of the engine may still name a Pi type.
import { registerHooks } from "node:module";
import "./hermetic.mjs";

const PI_PACKAGES = "@earendil-works/";

registerHooks({
    resolve(specifier, context, next) {
        if (specifier.startsWith(PI_PACKAGES)) {
            throw new Error(
                `${specifier} was imported in a process that has no Pi: the engine must run with no Pi package loaded`,
            );
        }
        return next(specifier, context);
    },
});
