// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  approveInPi: vi.fn(async () => ({ ok: false, message: "The approval was declined in Pi." })),
  askAgent: vi.fn(async () => undefined),
  fetchApprovalOptions: vi.fn(async () => ({ method: "none", canRegister: false })),
  registerPasskey: vi.fn(),
  submitComments: vi.fn(async () => undefined),
}));
vi.mock("@web/api.js", () => api);

import type { DraftComment, ReviewRecord } from "@web/types.js";

import { ReviewActionModal } from "./ReviewActionModal.js";

const draft: DraftComment = { id: "d1", body: "Please keep the null check.", filePath: "src/a.ts", line: 2, side: "new" };
const review: ReviewRecord = {
  id: "r1",
  headSha: "abcdef1234567890",
  fileScope: "branch",
  status: "awaiting-review",
  createdAt: "2026-11-07T00:00:00.000Z",
  updatedAt: "2026-11-07T00:00:00.000Z",
  comments: [],
  resolutions: [],
  iterations: [{ id: 1, createdAt: "2026-11-07T00:00:00.000Z", diff: "diff --git a/a b/a\n", diffHash: "shown", submittedCommentIds: [], resolutionIds: [] }],
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let drafts: DraftComment[];

function click(text: string): void {
  const button = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === text);
  assert.ok(button, `button ${text} exists`);
  act(() => {
    button.click();
  });
}

function App(): ReturnType<typeof createElement> {
  const [currentDrafts, setDrafts] = useState<DraftComment[]>([draft]);
  const [currentGeneral, setGeneral] = useState("");
  drafts = currentDrafts;
  return createElement(
    "div",
    undefined,
    createElement(
      "button",
      { onClick: () => setDrafts([...currentDrafts, { ...draft, id: `new-${currentDrafts.length}` }]) },
      "Add draft",
    ),
    createElement(ReviewActionModal, {
      drafts: currentDrafts,
      generalComment: currentGeneral,
      isOpen: true,
      onClose: () => undefined,
      onDraftsChange: setDrafts,
      onGeneralCommentChange: setGeneral,
      onReload: async () => undefined,
      review,
    }),
  );
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(App));
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  window.close = vi.fn();
  api.approveInPi.mockReset();
  api.approveInPi.mockResolvedValue({ ok: false, message: "The approval was declined in Pi." });
  api.submitComments.mockReset();
  api.submitComments.mockResolvedValue(undefined);
  api.fetchApprovalOptions.mockReset();
  api.fetchApprovalOptions.mockResolvedValue({ method: "none", canRegister: false });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("approving with drafts", () => {
  test("discarding starts approval, and a declined approval keeps the drafts", async () => {
    await render();
    click("Approve");
    assert.match(host.textContent ?? "", /You have draft comments/);
    click("Discard comments and approve");
    assert.equal(drafts.length, 1, "discard waits for the approval to succeed");
    await act(async () => {
      await Promise.resolve();
    });
    click("Approve in Pi instead");
    await act(async () => undefined);
    assert.equal(drafts.length, 1, "a declined approval must not lose the comment");
    assert.match(host.textContent ?? "", /declined in Pi/);
  });

  test("discarding clears the drafts only after the approval succeeds", async () => {
    api.approveInPi.mockResolvedValue({ ok: true, method: "page-and-pi" } as unknown as {
      ok: boolean;
      message: string;
    });
    await render();
    click("Approve");
    click("Discard comments and approve");
    await act(async () => {
      await Promise.resolve();
    });
    click("Approve in Pi instead");
    await act(async () => undefined);
    assert.equal(drafts.length, 0);
  });


  test("Try again after a discarded approval does not ask a second time and still waits for success", async () => {
    api.fetchApprovalOptions.mockRejectedValueOnce(new Error("The review server is unreachable."));
    await render();
    click("Approve");
    click("Discard comments and approve");
    await act(async () => {
      await Promise.resolve();
    });
    assert.match(host.textContent ?? "", /Try again/);
    assert.equal(drafts.length, 1, "a failed approval keeps the drafts");
    api.fetchApprovalOptions.mockResolvedValue({ method: "none", canRegister: false });
    api.approveInPi.mockResolvedValue({ ok: true, method: "page-and-pi" } as unknown as {
      ok: boolean;
      message: string;
    });
    click("Try again");
    await act(async () => {
      await Promise.resolve();
    });
    click("Approve in Pi instead");
    await act(async () => undefined);
    assert.equal(drafts.length, 0);
  });

  test("submit comments is the other path and a failed submit keeps the drafts and shows the error", async () => {
    api.submitComments.mockRejectedValue(new Error("The review server is unreachable."));
    await render();
    click("Approve");
    click("Submit comments");
    await act(async () => undefined);
    assert.equal(drafts.length, 1);
    assert.match(host.textContent ?? "", /The review server is unreachable/);
    assert.equal(api.approveInPi.mock.calls.length, 0, "submitting is not approving");
  });
});

describe("a draft typed while a discard is pending", () => {
  test("cancels the discard and asks again", async () => {
    api.approveInPi.mockImplementation(() => new Promise(() => undefined));
    await render();
    click("Approve");
    click("Discard comments and approve");
    click("Add draft");
    assert.match(host.textContent ?? "", /You have draft comments/);
    assert.equal(drafts.length, 2);
  });
});
