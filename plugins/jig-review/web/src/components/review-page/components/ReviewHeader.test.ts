import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test } from "vitest";

import type { ReviewRecord, ReviewSettings } from "@web/types.js";

import { approvalIssue, ReviewHeader } from "./ReviewHeader.js";

const review: ReviewRecord = {
  id: "r1",
  headSha: "abcdef1234567890",
  fileScope: "branch",
  status: "awaiting-review",
  createdAt: "2026-11-07T00:00:00.000Z",
  updatedAt: "2026-11-07T00:00:00.000Z",
  comments: [],
  resolutions: [],
  iterations: [],
};

const noop = (): void => undefined;

function render(record: ReviewRecord, drafts = 0): string {
  return renderToStaticMarkup(
    createElement(ReviewHeader, {
      draftCount: drafts,
      drafts: [],
      onApprove: noop,
      onOpenActions: noop,
      onViewTypeChange: (_viewType: ReviewSettings["diffView"]) => undefined,
      review: record,
      viewType: "unified",
    }),
  );
}

describe("the header's Approve button", () => {
  test("is visible from the start, with the draft count and a usable Finish review beside it", () => {
    const html = render(review, 2);
    assert.match(html, />Approve \(2\)</);
    assert.match(html, />Finish review \(2\)</);
    assert.doesNotMatch(html, /\sdisabled(?==|\s|>)/);
  });

  test("is disabled with words when approval is not available", () => {
    for (const [status, words] of [
      ["approved", "Approved already"],
      ["awaiting-agent", "Waiting for the agent"],
      ["abandoned", "abandoned"],
    ] as const) {
      const html = render({ ...review, status });
      assert.match(html, /Approve<\/button>/);
      assert.match(html, /\sdisabled(?==|\s|>)/);
      assert.match(html, new RegExp(words));
    }
  });

  test("is disabled after a page approval until Pi answers", () => {
    const html = render({ ...review, pageApprovedAt: "2026-11-07T00:01:00.000Z" });
    assert.match(html, /answer y in Pi/);
    assert.match(html, /\sdisabled(?==|\s|>)/);
  });

  test("the issue is undefined exactly when the status allows approval", () => {
    assert.equal(approvalIssue(review), undefined);
    assert.match(approvalIssue({ ...review, status: "approved" }) ?? "", /Approved already/);
    assert.match(approvalIssue({ ...review, status: "awaiting-agent" }) ?? "", /Waiting for the agent/);
  });
});
