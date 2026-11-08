// Custom message types Jig plugins put into Pi's conversation, and the labels /context gives them. One definition: jig-memory
// and jig-session both read these names from here, so a rename cannot leave one of them matching nothing.
export const MEMORY_NOTES_MESSAGE = "jig-memory-notes";
export const MEMORY_RECALL_MESSAGE = "jig-memory-recall";
export const MEMORY_EMPTY_FILES_MESSAGE = "jig-memory-empty-files";
export const MEMORY_CHECKS_MESSAGE = "jig-memory-checks";
export const MEMORY_CARD_REQUEST_MESSAGE = "jig-memory-card-request";
export const MEMORY_CARD_FIX_MESSAGE = "jig-memory-card-fix";

/** The label for each custom type; distinct, so two kinds never collapse into one row. */
export const MESSAGE_LABELS: Readonly<Record<string, string>> = {
    [MEMORY_NOTES_MESSAGE]: "Ticket notes",
    [MEMORY_RECALL_MESSAGE]: "Recall results",
    [MEMORY_EMPTY_FILES_MESSAGE]: "Empty ticket files",
    [MEMORY_CHECKS_MESSAGE]: "Open ticket checks",
    [MEMORY_CARD_REQUEST_MESSAGE]: "Ticket card request",
    [MEMORY_CARD_FIX_MESSAGE]: "Ticket card fix",
};
