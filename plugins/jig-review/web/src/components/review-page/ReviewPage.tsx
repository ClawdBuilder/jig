import type { ReviewFile } from "@web/review-file.js";
import type { DraftComment, ReviewRecord, ReviewSettings } from "@web/types.js";
import type { FC } from "react";
import { useState } from "react";

import { ReviewActionModal } from "./components/ReviewActionModal.js";
import { ReviewHeader } from "./components/ReviewHeader.js";
import { ReviewPageLayout } from "./components/ReviewPageLayout.js";
import { useReviewPageState } from "./useReviewPageState.js";

type DraftsChangeHandler = (
  drafts: DraftComment[] | ((current: DraftComment[]) => DraftComment[]),
) => void;

type ReviewPageProps = {
  drafts: DraftComment[];
  files: ReviewFile[];
  generalComment: string;
  onDraftsChange: DraftsChangeHandler;
  onGeneralCommentChange: (value: string) => void;
  onReload: () => Promise<void>;
  review: ReviewRecord;
  settings: ReviewSettings;
};

/**
 * Renders the full review page layout.
 */
export const ReviewPage: FC<ReviewPageProps> = ({
  drafts,
  files,
  generalComment,
  onDraftsChange,
  onGeneralCommentChange,
  onReload,
  review,
  settings,
}) => {
  const [approvalRequested, setApprovalRequested] = useState(false);
  const state = useReviewPageState({
    drafts,
    files,
    onDraftsChange,
    onReload,
    review,
    settings,
  });

  const openActionModal = (): void => {
    setApprovalRequested(false);
    state.setIsActionModalOpen(true);
  };

  const requestApproval = (): void => {
    setApprovalRequested(true);
    state.setIsActionModalOpen(true);
  };

  const closeActionModal = (): void => {
    setApprovalRequested(false);
    state.setIsActionModalOpen(false);
  };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <ReviewHeader
        draftCount={drafts.length + (generalComment.trim() === "" ? 0 : 1)}
        drafts={drafts}
        onApprove={requestApproval}
        onOpenActions={openActionModal}
        onViewTypeChange={state.changeViewType}
        review={review}
        viewType={state.viewType}
      />
      <ReviewPageLayout
        addDraft={state.addDraft}
        askDraft={state.askDraft}
        drafts={drafts}
        fileMetrics={state.fileMetrics}
        globalStats={state.globalStats}
        removeDraft={state.removeDraft}
        review={review}
        updateDraft={state.updateDraft}
        viewType={state.viewType}
      />
      <ReviewActionModal
        approveRequested={approvalRequested}
        drafts={drafts}
        generalComment={generalComment}
        isOpen={state.isActionModalOpen}
        onApproveRequestHandled={() => {
          setApprovalRequested(false);
        }}
        onClose={closeActionModal}
        onDraftsChange={(nextDrafts) => {
          onDraftsChange(nextDrafts);
        }}
        onGeneralCommentChange={onGeneralCommentChange}
        onReload={onReload}
        review={review}
      />
    </main>
  );
};
