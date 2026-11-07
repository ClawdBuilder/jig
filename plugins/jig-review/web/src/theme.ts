// Install the shared browser theme before React paints: the user's stored choice, else jig.json's ui.theme (injected by
// the review server), else the system. The selector is injected by the same helper.
import { installTheme } from "../../../jig-core/src/kit/theme-client";

installTheme();
