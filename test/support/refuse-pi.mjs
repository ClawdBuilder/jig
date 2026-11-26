// The guard: a first import of anything whose specifier starts with `@earendil-works/` fails, as it would on a machine where Pi is not
// installed. It sets up nothing else, so a process that starts with it keeps its own environment: test/support/no-pi.mjs adds it to the
// isolated world of hermetic.mjs for the engine's tests, and a test that starts the gateway as a child process uses it alone, so that the
// child keeps the state folder its parent gave it.
//
// A type import is erased before it runs, so a test or a file of the engine may still name a Pi type.
import { registerHooks } from "node:module";

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
