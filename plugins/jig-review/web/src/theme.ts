// Install the shared browser theme before React paints: the user's stored choice, else jig.json's ui.theme (injected by
// the review server), else the system. The selector is injected by the same helper.
import { installTheme } from "../../../jig-core/src/kit/theme-client";
import { updateReviewSettings } from "./api.js";

installTheme((theme) => {
  void updateReviewSettings({ theme }).catch(() => {
    // The choice still applies to this visit; it is saved on the next page that can reach the server.
  });
});
