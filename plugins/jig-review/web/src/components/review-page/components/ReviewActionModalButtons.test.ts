import assert from "node:assert/strict";
import { test } from "vitest";

import { getSubmittedComments, hasDraftComments } from "./ReviewActionModalButtons.js";

test("approving with any draft asks first, line comment or general note", () => {
  assert.equal(hasDraftComments([], ""), false);
  assert.equal(hasDraftComments([], "  "), false);
  assert.equal(hasDraftComments([], "A whole-review note"), true);
  assert.equal(
    hasDraftComments([{ id: "d1", body: "Fix this", filePath: "src/a.ts", line: 2, side: "new" }], ""),
    true,
  );
  assert.equal(getSubmittedComments([], "A whole-review note").length, 1);
});
