import { askAgent, submitComments } from "@web/api.js";
import { Button } from "@web/components/ui/index.js";
import type { ApprovalMethod, DraftComment, ReviewRecord } from "@web/types.js";
import type { FC, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { ApprovalPanel } from "./ApprovalPanel.js";
import { DraftCommentList } from "./DraftCommentList.js";
import { getSubmittedComments, hasDraftComments, ReviewActionModalButtons } from "./ReviewActionModalButtons.js";
import { useApproval } from "./useApproval.js";

type ReviewActionModalProps = {
  /** True when the header's Approve button asked this modal to start an approval. */
  approveRequested?: boolean;
  drafts: DraftComment[];
  generalComment: string;
  isOpen: boolean;
  onApproveRequestHandled?: () => void;
  onClose: () => void;
  onDraftsChange: (drafts: DraftComment[]) => void;
  onGeneralCommentChange: (value: string) => void;
  onReload: () => Promise<void>;
  review: ReviewRecord;
};

/**
 * Collects final review actions in one dialog: approve, general note, or submit comments.
 */
export const ReviewActionModal: FC<ReviewActionModalProps> = (props) => {
  const { askGeneralComment, isAsking } = useGeneralCommentAsk(props);
  const diffHash = props.review.iterations.at(-1)?.diffHash ?? "";
  const [approvalNeedsDecision, setApprovalNeedsDecision] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const pendingApproval = useRef<(() => Promise<void>) | undefined>(undefined);
  const discardOnSuccess = useRef(false);
  const approval = useApproval(diffHash, async (method) => {
    // Discarding is only recorded once the approval itself succeeded. A cancelled passkey, a missing passkey or a
    // changed review leaves the drafts exactly where they were.
    if (discardOnSuccess.current) {
      discardOnSuccess.current = false;
      props.onDraftsChange([]);
      props.onGeneralCommentChange("");
    }
    await props.onReload();
    closeReviewPage(getApprovedMessage(method));
  });

  useEffect(() => {
    // A draft typed after "Discard and approve" cancels the pending discard, so the person is asked again.
    if (discardOnSuccess.current && hasDraftComments(props.drafts, props.generalComment)) {
      discardOnSuccess.current = false;
      setApprovalNeedsDecision(true);
    }
  }, [props.drafts, props.generalComment]);

  useEffect(() => {
    if (!props.isOpen || props.approveRequested !== true) return;
    props.onApproveRequestHandled?.();
    pendingApproval.current = approval.approve;
    if (hasDraftComments(props.drafts, props.generalComment)) setApprovalNeedsDecision(true);
    else void approval.approve();
  }, [props.approveRequested, props.isOpen]);

  if (!props.isOpen) {
    return undefined;
  }

  const close = (): void => {
    setApprovalNeedsDecision(false);
    setSubmitError(undefined);
    pendingApproval.current = undefined;
    discardOnSuccess.current = false;
    props.onClose();
  };

  /** Every approval path comes through here; with a draft it asks first, and never clears one. */
  const startApproval = (action: () => Promise<void>): void => {
    pendingApproval.current = action;
    // After an explicit discard, the person has already answered the question: the drafts stay until this attempt
    // succeeds, and a retry does not ask again.
    if (discardOnSuccess.current || !hasDraftComments(props.drafts, props.generalComment)) {
      void action();
      return;
    }
    setSubmitError(undefined);
    setApprovalNeedsDecision(true);
  };

  const submitReview = async (): Promise<void> => {
    const comments = getSubmittedComments(props.drafts, props.generalComment);
    if (comments.length === 0) return;
    try {
      await submitComments(comments);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The comments were not submitted.");
      return;
    }
    discardOnSuccess.current = false;
    props.onDraftsChange([]);
    props.onGeneralCommentChange("");
    await props.onReload();
    closeReviewPage("Review submitted. You can close this tab.");
  };

  const discardAndApprove = (): void => {
    const action = pendingApproval.current ?? approval.approve;
    discardOnSuccess.current = true;
    setApprovalNeedsDecision(false);
    setSubmitError(undefined);
    void action();
  };

  const keepReviewing = (): void => {
    pendingApproval.current = undefined;
    discardOnSuccess.current = false;
    setApprovalNeedsDecision(false);
    setSubmitError(undefined);
  };

  const guardedApprove = (): void => {
    startApproval(approval.approve);
  };

  const guardedApproveElsewhere = (): void => {
    startApproval(approval.approveElsewhere);
  };

  const guardedRegister = (): void => {
    startApproval(approval.register);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-6">
      <section className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-2xl">
        {renderModalHeader(close)}
        {renderReviewCommentField({
          isAsking,
          onAsk: askGeneralComment,
          onChange: props.onGeneralCommentChange,
          value: props.generalComment,
        })}
        <div className="mt-4">
          <h3 className="font-medium">Draft line comments</h3>
          <DraftCommentList drafts={props.drafts} />
        </div>
        {submitError !== undefined && !approvalNeedsDecision ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            {submitError}
          </p>
        ) : undefined}
        {approvalNeedsDecision ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="alert">
            <p className="font-medium">You have draft comments.</p>
            <p className="mt-1">
              Approving does not submit them. Submitting lets the agent answer; discarding removes them before the
              approval starts.
            </p>
            {submitError === undefined ? undefined : <p className="mt-2 text-red-800">{submitError}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button className="px-3 py-1.5" onClick={() => void submitReview()} variant="primary">
                Submit comments
              </Button>
              <Button
                className="border-red-300 px-3 py-1.5 text-red-800"
                onClick={discardAndApprove}
                variant="secondary"
              >
                Discard comments and approve
              </Button>
              <Button className="px-3 py-1.5" onClick={keepReviewing} variant="link">
                Keep reviewing
              </Button>
            </div>
          </div>
        ) : (
          <ReviewActionModalButtons
            drafts={props.drafts}
            generalComment={props.generalComment}
            onApprove={guardedApprove}
            onClose={close}
            onSubmitReview={submitReview}
            review={props.review}
          />
        )}
        <ApprovalPanel
          onApprove={guardedApprove}
          onApproveInPi={guardedApproveElsewhere}
          onRegister={guardedRegister}
          onReset={() => {
            discardOnSuccess.current = false;
            approval.reset();
          }}
          state={approval.state}
        />
      </section>
    </div>
  );
};

type GeneralCommentAsk = {
  askGeneralComment: () => Promise<void>;
  isAsking: boolean;
};

function useGeneralCommentAsk(props: ReviewActionModalProps): GeneralCommentAsk {
  const [isAsking, setIsAsking] = useState(false);

  return {
    askGeneralComment: async (): Promise<void> => {
      const body = props.generalComment.trim();

      if (body.length === 0) {
        return;
      }

      setIsAsking(true);

      try {
        await askAgent({ id: crypto.randomUUID(), body });
        props.onGeneralCommentChange("");
        await props.onReload();
      } finally {
        setIsAsking(false);
      }
    },
    isAsking,
  };
}

function renderModalHeader(onClose: () => void): ReactNode {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold">Finish review</h2>
        <p className="mt-1 text-sm text-slate-600">
          Approve the changes, or submit your drafted line comments for the agent.
        </p>
      </div>
      <Button className="px-3 py-1 text-sm" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

type GeneralCommentFieldOptions = {
  isAsking: boolean;
  onAsk: () => Promise<void>;
  onChange: (value: string) => void;
  value: string;
};

function renderReviewCommentField(options: GeneralCommentFieldOptions): ReactNode {
  return (
    <>
      <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="general-comment">
        General comment
      </label>
      <textarea
        className="mt-2 h-28 w-full rounded-md border border-slate-300 p-2"
        id="general-comment"
        onChange={(event) => {
          options.onChange(event.target.value);
        }}
        placeholder="Optional whole-review comment"
        value={options.value}
      />
      <div className="mt-2 flex justify-end">
        <Button
          className="px-3 py-1 text-sm"
          disabled={options.isAsking}
          onClick={() => {
            void options.onAsk();
          }}
          title="Ask the agent now without submitting the whole review. The agent can answer or change code immediately."
          variant="link"
        >
          {options.isAsking ? "Asking…" : "Ask"}
        </Button>
      </div>
    </>
  );
}

function getApprovedMessage(method: ApprovalMethod): string {
  return method === "passkey"
    ? "Review approved with your passkey. You can close this tab."
    : "Review approved in the page and in Pi. You can close this tab.";
}

function closeReviewPage(message: string): void {
  window.close();
  window.setTimeout(() => {
    const main = document.createElement("main");

    main.setAttribute("style", "font-family: system-ui; padding: 2rem;");
    main.textContent = message;
    document.body.replaceChildren(main);
  }, 150);
}
