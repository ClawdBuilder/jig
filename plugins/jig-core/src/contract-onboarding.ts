// The onboarding types: what a company's people must supply, the sign-in methods a plugin's section accepts, and what a
// plugin's own setup asks. They live here so that `contract.ts` (which only re-exports the public ones) stays readable;
// a company plugin imports them from `contract.ts`, as before.
import type { DetectName } from "./detect.ts";

/** What a company's people must supply, in the order setup asks (`onboarding.register`). */
export interface OnboardingEntry {
    /** The company's preferred secret store for its references, such as `"op"` or `"pass"`. */
    preferredStore?: OnboardingStore;
    /** Ask these in this order. Each names where the answer goes, or says something before the questions. */
    items: readonly OnboardingItem[];
    /** Which registered method is the company's default, which to hide, and any company-only fixed method. */
    methods?: Readonly<Record<string, OnboardingMethodChoice>>;
}

/** The company's choice among the methods a plugin registered for one section. It may only name ids the plugin owns. */
export interface OnboardingMethodChoice {
    /** The id of the method setup offers first. */
    default?: string;
    /** Ids setup does not offer. A user may still write one by hand; doctor warns, never refuses. */
    hide?: readonly string[];
    /** Company-only methods whose fields are all fixed values, for its own transport or sign-in service. */
    add?: readonly OnboardingMethod[];
}

/** One sign-in method a plugin's section accepts. The shape is inferred from the fields; no id is written to jig.json. */
export interface OnboardingMethod {
    /** A stable id, such as `cloud-basic` or `transport`. */
    id: string;
    /** The plain answer to “How do you sign in?”. */
    label: string;
    /** One line for the picker, such as “Jira Cloud” or “Data Center”. */
    who?: string;
    /** The fields this method writes, relative to the section. A `*` segment stands for one dynamic name. */
    fields: readonly OnboardingMethodField[];
    /** A path relative to the object a `*` matched that must already exist; `ci` for a service's CI methods. */
    requires?: string;
    /** True for a method only a company plugin makes usable, such as its sign-in service or transport: setup offers it
     *  only while a company is active, and a company's `add` still prefills it. */
    companyOnly?: boolean;
    /** True for a method that sends the tool's requests through a transport, whose name is its one required `text` field:
     *  setup offers it while a transport exists (the person's `transports`, a company's defaults, one a company plugin
     *  registered, or one answered earlier in the same run), asks which as a pick of those names, and writes the name. */
    viaTransport?: boolean;
}

/** One field of an `OnboardingMethod`. A plugin method has no `value`; a company-only method fixes every field. */
export type OnboardingMethodField =
    | {
          kind: "text";
          /** A dotted path inside the section; `*` stands for one dynamic name. */
          path: string;
          label: string;
          why?: string;
          placeholder?: string;
          optional?: boolean;
          /** A fixed answer, for a company-only method. */
          value?: string;
      }
    | {
          kind: "pick";
          path: string;
          label: string;
          choices: readonly string[];
          why?: string;
          /** A fixed answer, for a company-only method. */
          value?: string;
      }
    | {
          kind: "reference";
          path: string;
          label: string;
          stores?: readonly OnboardingStore[];
          preferredStore?: OnboardingStore;
          suggested?: Readonly<Partial<Record<OnboardingStore, string>>>;
          addHints?: Readonly<Partial<Record<OnboardingStore, string>>>;
          why?: string;
      };

/** The secret stores a company can prefer. The names are `jig.json`'s. */
export type OnboardingStore = "pass" | "env" | "keychain" | "op" | "cmd" | "file";

/** One question inside a new object: its path is relative to the object, such as `uri` or `via.ssh.host`. */
export type OnboardingObjectField =
    | {
          kind: "text";
          path: string;
          label: string;
          why?: string;
          placeholder?: string;
          optional?: boolean;
          /** The answer is a simple list, such as environment names: one per line, or separated by commas. */
          list?: boolean;
      }
    | {
          kind: "pick";
          path: string;
          label: string;
          choices: readonly string[];
          why?: string;
      }
    | {
          kind: "reference";
          path: string;
          label: string;
          /** The stores to offer; left out, all the stores this machine has. */
          stores?: readonly OnboardingStore[];
          /** A reference *shape* per store, never a value. */
          suggested?: Readonly<Partial<Record<OnboardingStore, string>>>;
          /** What to tell the person to add it, per store. */
          addHints?: Readonly<Partial<Record<OnboardingStore, string>>>;
          why?: string;
      };

/** One shape a new object may take: the questions whose answers make it, and the words that pick it. */
export interface OnboardingObjectForm {
    /** The plain answer to "Which kind of …?", such as "Directly at its address"; needed when there is more than one form. */
    label?: string;
    /** One line for the picker, such as "The database this machine can reach". */
    who?: string;
    /** Asks this form only while the section's merged value at `path` is `equals`; a form without one is the fallback. */
    when?: { path: string; equals: string };
    /** Values written into every object of this form without asking, by path inside the object, such as `kind`. */
    fixed?: Readonly<Record<string, string | number | boolean>>;
    /** Ask these in order; each answer goes inside the new object at its own path. */
    fields: readonly OnboardingObjectField[];
}

/** An onboarding answer's section and dotted path, and the words that ask for it. */
interface OnboardingAnswer {
    /** The section of `jig.json` the answer goes to, such as `"acme"`. */
    section: string;
    /** A dotted path inside it, such as `"bastion.user"`. */
    path: string;
    label: string;
    why?: string;
}

/** One step of a company's onboarding list; a `text` or `pick` step may name a `detect` probe. */
export type OnboardingItem =
    | ({
          kind: "text";
          placeholder?: string;
          optional?: boolean;
          /** The answer is a simple list, such as project keys: one entry per line, or separated by commas. */
          list?: boolean;
          detect?: DetectName;
      } & OnboardingAnswer)
    | ({
          kind: "pick";
          choices: readonly string[];
          detect?: DetectName;
      } & OnboardingAnswer)
    | ({
          kind: "reference";
          /** The stores to offer; left out, all the stores this machine has. */
          stores?: readonly OnboardingStore[];
          /** The store marked as the company's choice; overrides the entry's `preferredStore`. */
          preferredStore?: OnboardingStore;
          /** A reference *shape* per store, never a value: `{ "pass": "acme/sso-token" }`. */
          suggested?: Readonly<Partial<Record<OnboardingStore, string>>>;
          /** What to tell the person to add it, per store: `{ "pass": "pass insert acme/sso-token" }`. */
          addHints?: Readonly<Partial<Record<OnboardingStore, string>>>;
      } & OnboardingAnswer)
    | ({
          kind: "entry";
          /** The map inside the section, such as `accounts`: the answer becomes `path.key`. */
          keyLabel: string;
          keyPlaceholder?: string;
          /** The question for the entry's value. */
          valueLabel: string;
          valuePlaceholder?: string;
          /** A probe that proposes the value, filled in as for a `text` item. */
          detect?: DetectName;
          /** Ask for another entry after this one is accepted. */
          repeat?: boolean;
          /** An empty key leaves the map unset, so nothing is written for the item; a `detect` may still fill the value. */
          optional?: boolean;
      } & OnboardingAnswer)
    | ({
          /** One named object in the map at `path`: the name is asked, then one form's questions, and the answers are one
           *  object written as `path.<name>`. An empty `path` means the section itself is the map, as `transports` is. */
          kind: "object";
          /** The question for the object's name. */
          keyLabel: string;
          keyPlaceholder?: string;
          /** The shapes one object may take; the first is offered first, and a form without `when` is the fallback. */
          forms: readonly OnboardingObjectForm[];
          /** Ask for another object after this one is accepted. */
          repeat?: boolean;
          /** An empty name leaves the map as it is even when it has no object yet, so nothing is written. */
          optional?: boolean;
      } & OnboardingAnswer)
    | {
          kind: "login";
          /** The program that owns the login, such as `"gh"`. */
          tool: string;
          /** The command that asks whether it is logged in; the answer's exit code is the check. */
          status: readonly string[];
          /** The command the person runs to log in. */
          login: string;
          label: string;
          why?: string;
      }
    | {
          kind: "info";
          label: string;
          detail?: string;
          url?: string;
      }
    | ProposalItem;

/** A company's proposed entry for a section the person owns: setup asks once and writes it only on a yes. */
export interface ProposalItem {
    kind: "proposal";
    section: string;
    path?: string;
    key?: string;
    value: unknown;
    label: string;
    why?: string;
}

/**
 * What a plugin's own section needs, in the plugin's words: `registerSection`'s `setup`. Setup shows every plugin that
 * registered one in its list; a section that is not set up is offered with the summary and its questions.
 */
export interface OnboardingSetup {
    /** One line for setup's list and the doctor's line: what the plugin does for the person. */
    summary: string;
    /** The questions, in the plugin's order. Each answer goes to this plugin's section. Left out when it asks nothing.
     *  A plugin asks for the entries of its own maps with `entry` and for one named object of a map with `object`;
     *  `proposal` is only for a company's list. */
    items?: readonly OnboardingItem[];
    /** Set when the plugin needs configuration that setup cannot ask for yet: what to read, and a section to add by
     *  hand. A plugin with `items` does not need it. */
    pending?: {
        /** A page in the Jig package, such as `plugins/jig-logs/README.md`. */
        doc: string;
        /** A minimal section to add to `jig.json` by hand. */
        example: Readonly<Record<string, unknown>>;
    };
}
