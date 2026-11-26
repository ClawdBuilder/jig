import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// plugins/jig-core/src/client.ts
var API = /* @__PURE__ */ Symbol.for("jig.core.api/v1");
var slot = globalThis;
function jig() {
  const api = slot[API];
  if (api === void 0) throw new Error("jig-core is not loaded: enable jig-core, which governs every Jig tool");
  return api;
}

// plugins/jig-core/src/kit/values.ts
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var InputError = class extends TypeError {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
};

// plugins/jig-core/src/kit/fields.ts
function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      previous = current;
    }
  }
  return row[b.length];
}
function closestField(key, valid) {
  let best;
  let bestDistance = 3;
  for (const name of valid) {
    const distance = editDistance(key.toLowerCase(), name.toLowerCase());
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best;
}
function unknownField(path3, key, valid) {
  const near = closestField(key, valid);
  const hint = near === void 0 ? "" : ` Did you mean "${near}"?`;
  const at2 = path3 === "" ? key : `${path3}.${key}`;
  return `${at2}: unknown field.${hint} Valid keys: ${valid.join(", ")}`;
}

// plugins/jig-git/src/names.ts
var BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
var REV = /^[A-Za-z0-9_@][A-Za-z0-9._/@^~{}+-]*$/;
var REMOTE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function checkBranch(value, label = "branch") {
  if (typeof value !== "string" || value === "") throw new Error(`${label} is required`);
  const parts = value.split("/");
  const bad = value.length > 200 || !BRANCH.test(value) || value.includes("..") || value.includes("//") || value.endsWith("/") || value.endsWith(".") || parts.some((part) => part.startsWith(".") || part.endsWith(".lock"));
  if (bad) throw new Error(`${label} "${value.slice(0, 80)}" is not a valid branch name`);
  return value;
}
function checkTag(value, label = "tag") {
  return checkBranch(value, label);
}
function checkRemote(value) {
  if (typeof value !== "string" || !REMOTE.test(value) || value.length > 100) {
    throw new Error(`remote "${String(value).slice(0, 80)}" is not a valid remote name`);
  }
  return value;
}
function checkRev(value, label = "rev") {
  if (typeof value !== "string" || value === "") throw new Error(`${label} is required`);
  if (value.length > 200 || !REV.test(value) || value.includes("..")) {
    throw new Error(`${label} "${value.slice(0, 80)}" is not a valid revision`);
  }
  return value;
}
function checkCommitMessage(value) {
  if (typeof value !== "string" || value.trim() === "") throw new Error("message is required");
  if (value.length > 1e4) throw new Error("message is too long (10000 characters at most)");
  if (value.includes("\0")) throw new Error("message contains a NUL character");
  return value.trim();
}
function checkTitle(value) {
  if (typeof value !== "string" || value.trim() === "") throw new Error("title is required");
  const title = value.trim();
  if (title.length > 256 || /[\r\n\0]/.test(title))
    throw new Error("title must be one line of at most 256 characters");
  return title;
}
function checkBody(value, label = "body") {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
  if (value.length > 6e4 || value.includes("\0"))
    throw new Error(`${label} is too long or contains a NUL character`);
  return value;
}
function checkNumber(value, label = "number") {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1e8) {
    throw new Error(`${label} is required: a positive whole number`);
  }
  return value;
}
function checkLine(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
  if (value.length > 300 || /[\0\r\n]/.test(value))
    throw new Error(`${label} must be one line of at most 300 characters`);
  return value;
}
function checkWords(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must list at least one name`);
  if (value.length > 30) throw new Error(`${label}: at most 30 names`);
  return value.map((item) => {
    if (typeof item !== "string" || item.trim() === "" || item.length > 100 || /[\0\r\n,]/.test(item)) {
      throw new Error(`${label}: "${String(item).slice(0, 40)}" is not a valid name`);
    }
    return item.trim();
  });
}

// plugins/jig-git/src/onboarding.ts
var GIT_SETUP = {
  summary: "Work with git, pull requests and releases.",
  items: [
    {
      kind: "login",
      tool: "gh",
      status: ["gh", "auth", "status"],
      login: "gh auth login",
      label: "GitHub login",
      why: "Pull requests, reviews and releases go through gh."
    },
    {
      kind: "entry",
      section: "git",
      path: "accounts",
      label: "Which GitHub account should Jig use for a set of repositories?",
      keyLabel: "Which repositories?",
      keyPlaceholder: "github.com:acme/*",
      valueLabel: "Which gh account?",
      valuePlaceholder: "acme-work",
      // Optional: a person with one gh account, or none, leaves the map unset. The probe fills the value, not the
      // key, so an empty key still means "no mapping".
      optional: true,
      repeat: true,
      detect: "gh-account",
      why: "With more than one gh account, the first pattern that matches the remote picks the account; Jig never switches your active account."
    }
  ]
};

// plugins/jig-core/src/kit/accounts.ts
var HOST = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
var PATH = /^[A-Za-z0-9_.*/-]+$/;
var ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
function validateAccounts(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [
      'git.accounts must map remote patterns to gh account names, such as { "github.com:acme/*": "acme-work" }'
    ];
  }
  const errors = [];
  const entries = Object.entries(value);
  if (entries.length > 100) errors.push("git.accounts must have at most 100 entries");
  for (const [pattern, account] of entries) {
    const colon = pattern.indexOf(":");
    const host = colon > 0 ? pattern.slice(0, colon) : "";
    const path3 = colon > 0 ? pattern.slice(colon + 1) : "";
    if (colon <= 0 || !HOST.test(host) || host.length > 100 || !PATH.test(path3) || !path3.includes("/") || path3.length > 300) {
      errors.push(
        `git.accounts["${pattern.slice(0, 80)}"] must be a remote pattern of "host:owner/name" or "host:owner/*", such as "github.com:acme/*"`
      );
      continue;
    }
    if (typeof account !== "string" || !ACCOUNT.test(account)) {
      errors.push(`git.accounts["${pattern.slice(0, 80)}"] must be a gh account name, such as "acme-work"`);
    }
  }
  return errors;
}
function accountPattern(pattern) {
  const colon = pattern.indexOf(":");
  const host = pattern.slice(0, colon).toLowerCase();
  const path3 = pattern.slice(colon + 1).toLowerCase();
  const quote = (text) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${quote(host)}:${quote(path3).replace(/\*/g, ".*")}$`);
}
function accountFor(accounts, remote) {
  if (accounts === void 0) return void 0;
  const target = remote.toLowerCase();
  for (const [pattern, account] of Object.entries(accounts)) {
    if (accountPattern(pattern).test(target)) return account;
  }
  return void 0;
}

// plugins/jig-git/src/config.ts
var DEFAULT_CLONE_HOST = "github.com";
var TOP = /* @__PURE__ */ new Set([
  "base",
  "protected",
  "commitMessage",
  "branchName",
  "prTitle",
  "prTemplate",
  "cloneHost",
  "watchComments",
  "watchBots",
  "forges",
  "accounts"
]);
var MOVED = { watch: "ops.watch", artifacts: "ops.artifacts" };
var BRANCH_PATTERN = /^[A-Za-z0-9._/*-]+$/;
var HOST2 = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function checkRegExp(value, key, errors) {
  if (typeof value !== "string" || value === "") {
    errors.push(`${key} must be a non-empty regular expression`);
    return;
  }
  try {
    new RegExp(value);
  } catch (error) {
    errors.push(`${key} is not a valid regular expression: ${error.message}`);
  }
}
var isForge = (value) => value === "github" || value === "gitlab";
function validForgeEntry(entry2) {
  if (isForge(entry2)) return true;
  if (!isObject(entry2) || !isForge(entry2.forge)) return false;
  if (Object.keys(entry2).some((key) => key !== "forge" && key !== "host")) return false;
  return entry2.host === void 0 || typeof entry2.host === "string" && HOST2.test(entry2.host) && entry2.host.length <= 100;
}
function validForges(value) {
  if (!isObject(value)) return false;
  return Object.entries(value).every(
    ([host, entry2]) => HOST2.test(host) && host.length <= 100 && validForgeEntry(entry2)
  );
}
function validateGitSection(raw) {
  if (!isObject(raw)) return ["git must be an object"];
  const errors = [];
  for (const key of Object.keys(raw)) {
    if (Object.hasOwn(MOVED, key)) errors.push(`git.${key} moved to ${MOVED[key]}, which jig-ops reads`);
    else if (!TOP.has(key)) errors.push(unknownField("git", key, [...TOP]));
  }
  if (raw.base !== void 0) {
    try {
      checkBranch(raw.base);
    } catch {
      errors.push("git.base must be a branch name");
    }
  }
  if (raw.protected !== void 0) {
    const list = raw.protected;
    if (!Array.isArray(list) || list.some((item) => typeof item !== "string" || !BRANCH_PATTERN.test(item))) {
      errors.push("git.protected must be a list of branch names, where * matches any characters");
    }
  }
  if (raw.commitMessage !== void 0) checkRegExp(raw.commitMessage, "git.commitMessage", errors);
  if (raw.branchName !== void 0) checkRegExp(raw.branchName, "git.branchName", errors);
  if (raw.prTitle !== void 0) checkRegExp(raw.prTitle, "git.prTitle", errors);
  if (raw.prTemplate !== void 0 && (typeof raw.prTemplate !== "string" || raw.prTemplate === "")) {
    errors.push("git.prTemplate must be the path of a Markdown file");
  }
  if (raw.cloneHost !== void 0 && (typeof raw.cloneHost !== "string" || !HOST2.test(raw.cloneHost) || raw.cloneHost.length > 100)) {
    errors.push("git.cloneHost must be a host name or an ssh alias such as github.com");
  }
  if (raw.watchComments !== void 0 && raw.watchComments !== "after-create" && raw.watchComments !== "off") {
    errors.push('git.watchComments must be "after-create" or "off"');
  }
  if (raw.watchBots !== void 0 && typeof raw.watchBots !== "boolean") {
    errors.push("git.watchBots must be true or false");
  }
  if (raw.accounts !== void 0) errors.push(...validateAccounts(raw.accounts));
  if (raw.forges !== void 0 && !validForges(raw.forges)) {
    errors.push(
      'git.forges must map host names to "github" or "gitlab", such as { "gitlab.example.com": "gitlab" }, or to { "forge": ..., "host": ... } when the host is an ssh alias for a real one, such as { "github.com-work": { "forge": "github", "host": "github.com" } }'
    );
  }
  return errors;
}
function registerGitSection(api) {
  api.config.registerSection("git", validateGitSection, { first: ["accounts"], setup: GIT_SETUP });
}
function accountsFrom(value) {
  return isObject(value) && validateAccounts(value).length === 0 ? value : void 0;
}
function forgesFrom(value) {
  if (!isObject(value) || Object.keys(value).length === 0) return void 0;
  return Object.fromEntries(
    Object.entries(value).map(([host, entry2]) => {
      const given = entry2;
      if (typeof given === "string") return [host.toLowerCase(), given];
      return [
        host.toLowerCase(),
        given.host === void 0 ? { forge: given.forge } : { forge: given.forge, host: given.host.toLowerCase() }
      ];
    })
  );
}
function settingsFrom(raw) {
  const section = isObject(raw) && validateGitSection(raw).length === 0 ? raw : {};
  const forges = forgesFrom(section.forges);
  const accounts = accountsFrom(section.accounts);
  return {
    base: section.base,
    protected: section.protected,
    commitMessage: section.commitMessage,
    branchName: section.branchName,
    prTitle: section.prTitle,
    prTemplate: section.prTemplate,
    cloneHost: section.cloneHost ?? DEFAULT_CLONE_HOST,
    watchComments: section.watchComments ?? "after-create",
    watchBots: section.watchBots ?? false,
    ...forges === void 0 ? {} : { forges },
    ...accounts === void 0 ? {} : { accounts }
  };
}
function gitSettings() {
  return settingsFrom(jig().config.section("git"));
}

// node_modules/typebox/build/system/memory/memory.mjs
var memory_exports = {};
__export(memory_exports, {
  Assign: () => Assign,
  Clone: () => Clone,
  Create: () => Create,
  Discard: () => Discard,
  Metrics: () => Metrics,
  Update: () => Update
});

// node_modules/typebox/build/system/memory/metrics.mjs
var Metrics = {
  assign: 0,
  create: 0,
  clone: 0,
  discard: 0,
  update: 0
};

// node_modules/typebox/build/system/settings/settings.mjs
var settings_exports = {};
__export(settings_exports, {
  Get: () => Get,
  Reset: () => Reset,
  Set: () => Set2
});

// node_modules/typebox/build/guard/guard.mjs
var guard_exports = {};
__export(guard_exports, {
  Counted: () => Counted,
  Entries: () => Entries,
  EntriesRegExp: () => EntriesRegExp,
  Every: () => Every,
  EveryAll: () => EveryAll,
  GraphemeCount: () => GraphemeCount2,
  HasPropertyKey: () => HasPropertyKey,
  IsArray: () => IsArray,
  IsBigInt: () => IsBigInt,
  IsBoolean: () => IsBoolean,
  IsClassInstance: () => IsClassInstance,
  IsConstructor: () => IsConstructor,
  IsDeepEqual: () => IsDeepEqual,
  IsEqual: () => IsEqual,
  IsFunction: () => IsFunction,
  IsGreaterEqualThan: () => IsGreaterEqualThan,
  IsGreaterThan: () => IsGreaterThan,
  IsInteger: () => IsInteger,
  IsLessEqualThan: () => IsLessEqualThan,
  IsLessThan: () => IsLessThan,
  IsMaxLength: () => IsMaxLength2,
  IsMinLength: () => IsMinLength2,
  IsMultipleOf: () => IsMultipleOf,
  IsNull: () => IsNull,
  IsNumber: () => IsNumber,
  IsObject: () => IsObject,
  IsObjectNotArray: () => IsObjectNotArray,
  IsString: () => IsString,
  IsSymbol: () => IsSymbol,
  IsUndefined: () => IsUndefined,
  IsUnsafePropertyKey: () => IsUnsafePropertyKey,
  IsValueLike: () => IsValueLike,
  Keys: () => Keys,
  ShiftLeft: () => ShiftLeft,
  Some: () => Some,
  SomeAll: () => SomeAll,
  Symbols: () => Symbols,
  Values: () => Values
});

// node_modules/typebox/build/guard/string.mjs
function IsBetween(value, min, max) {
  return value >= min && value <= max;
}
function IsZeroWidthJoiner(value) {
  return value === 8205;
}
function IsHighSurrogate(value) {
  return IsBetween(value, 55296, 56319);
}
function IsRegionalIndicator(value) {
  return IsBetween(value, 127462, 127487);
}
function IsVariationSelector(value) {
  return IsBetween(value, 65024, 65039);
}
function IsCombiningMark(value) {
  return IsBetween(value, 768, 879) || IsBetween(value, 6832, 6911) || IsBetween(value, 7616, 7679) || IsBetween(value, 65056, 65071);
}
function CodePointLength(value) {
  return value > 65535 ? 2 : 1;
}
function ConsumeModifiers(value, index) {
  while (index < value.length) {
    const point = value.codePointAt(index);
    if (IsCombiningMark(point) || IsVariationSelector(point)) {
      index += CodePointLength(point);
    } else {
      break;
    }
  }
  return index;
}
function NextGraphemeClusterIndex(value, clusterStart) {
  const startCP = value.codePointAt(clusterStart);
  let clusterEnd = clusterStart + CodePointLength(startCP);
  clusterEnd = ConsumeModifiers(value, clusterEnd);
  while (clusterEnd < value.length - 1 && IsZeroWidthJoiner(value.codePointAt(clusterEnd))) {
    const nextCP = value.codePointAt(clusterEnd + 1);
    clusterEnd += 1 + CodePointLength(nextCP);
    clusterEnd = ConsumeModifiers(value, clusterEnd);
  }
  if (IsRegionalIndicator(startCP) && clusterEnd < value.length && IsRegionalIndicator(value.codePointAt(clusterEnd))) {
    clusterEnd += CodePointLength(value.codePointAt(clusterEnd));
  }
  return clusterEnd;
}
function IsGraphemeCodePoint(value) {
  return value >= 768 && // above special range
  (IsHighSurrogate(value) || IsCombiningMark(value) || IsVariationSelector(value) || IsZeroWidthJoiner(value));
}
function GraphemeCount(value) {
  let count2 = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count2++;
  }
  return count2;
}
function IsMinLengthSegmented(value, minLength) {
  let count2 = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    if (++count2 >= minLength)
      return true;
  }
  return false;
}
function IsMaxLengthSegmented(value, maxLength) {
  let count2 = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    if (++count2 > maxLength)
      return false;
  }
  return true;
}
function IsMinLength(value, minLength) {
  if (minLength === 0)
    return true;
  if (value.length < minLength)
    return false;
  let index = 0;
  while (true) {
    if (IsGraphemeCodePoint(value.charCodeAt(index))) {
      return IsMinLengthSegmented(value, minLength);
    }
    if (++index >= minLength)
      return true;
  }
}
function IsMaxLength(value, maxLength) {
  if (value.length <= maxLength)
    return true;
  let index = 0;
  while (true) {
    if (IsGraphemeCodePoint(value.charCodeAt(index))) {
      return IsMaxLengthSegmented(value, maxLength);
    }
    if (++index > maxLength)
      return false;
  }
}

// node_modules/typebox/build/guard/guard.mjs
function IsArray(value) {
  return Array.isArray(value);
}
function IsBigInt(value) {
  return IsEqual(typeof value, "bigint");
}
function IsBoolean(value) {
  return IsEqual(typeof value, "boolean");
}
function IsConstructor(value) {
  if (IsUndefined(value) || !IsFunction(value))
    return false;
  const result = Function.prototype.toString.call(value);
  if (/^class\s/.test(result))
    return true;
  if (/\[native code\]/.test(result))
    return true;
  return false;
}
function IsFunction(value) {
  return IsEqual(typeof value, "function");
}
function IsInteger(value) {
  return Number.isInteger(value);
}
function IsNull(value) {
  return IsEqual(value, null);
}
function IsNumber(value) {
  return Number.isFinite(value);
}
function IsObjectNotArray(value) {
  return IsObject(value) && !IsArray(value);
}
function IsObject(value) {
  return IsEqual(typeof value, "object") && !IsNull(value);
}
function IsString(value) {
  return IsEqual(typeof value, "string");
}
function IsSymbol(value) {
  return IsEqual(typeof value, "symbol");
}
function IsUndefined(value) {
  return IsEqual(value, void 0);
}
function IsEqual(left, right) {
  return left === right;
}
function IsGreaterThan(left, right) {
  return left > right;
}
function IsLessThan(left, right) {
  return left < right;
}
function IsLessEqualThan(left, right) {
  return left <= right;
}
function IsGreaterEqualThan(left, right) {
  return left >= right;
}
function IsMultipleOf(dividend, divisor) {
  if (IsBigInt(dividend) || IsBigInt(divisor)) {
    return BigInt(dividend) % BigInt(divisor) === 0n;
  }
  const tolerance = 1e-10;
  if (!IsNumber(dividend))
    return true;
  if (IsInteger(dividend) && 1 / divisor % 1 === 0)
    return true;
  const mod = dividend % divisor;
  return Math.min(Math.abs(mod), Math.abs(mod - divisor), Math.abs(mod + divisor)) < tolerance;
}
function IsClassInstance(value) {
  if (!IsObject(value))
    return false;
  const proto = globalThis.Object.getPrototypeOf(value);
  if (IsNull(proto))
    return false;
  return IsEqual(typeof proto.constructor, "function") && !(IsEqual(proto.constructor, globalThis.Object) || IsEqual(proto.constructor.name, "Object"));
}
function IsValueLike(value) {
  return IsBigInt(value) || IsBoolean(value) || IsNull(value) || IsNumber(value) || IsString(value) || IsUndefined(value);
}
function GraphemeCount2(value) {
  return GraphemeCount(value);
}
function IsMaxLength2(value, length) {
  return IsMaxLength(value, length);
}
function IsMinLength2(value, length) {
  return IsMinLength(value, length);
}
function Every(value, offset, callback) {
  return value.every((item, index) => index < offset || callback(item, index));
}
function EveryAll(value, offset, callback) {
  let result = true;
  value.forEach((item, index) => {
    if (index >= offset && !callback(item, index))
      result = false;
  });
  return result;
}
function Some(value, callback) {
  return value.some((value2, index) => callback(value2, index));
}
function SomeAll(value, callback) {
  let result = false;
  value.forEach((item, index) => {
    if (callback(item, index))
      result = true;
  });
  return result;
}
function Counted(value, callback) {
  return value.reduce((result, value2, index) => callback(value2, index) ? ++result : result, 0);
}
function ShiftLeft(array, true_, false_) {
  return IsEqual(array.length, 0) ? false_() : true_(array[0], array.slice(1));
}
function IsUnsafePropertyKey(key) {
  return IsEqual(key, "__proto__") || IsEqual(key, "constructor") || IsEqual(key, "prototype");
}
function HasPropertyKey(value, key) {
  return IsUnsafePropertyKey(key) ? Object.prototype.hasOwnProperty.call(value, key) : key in value;
}
function EntriesRegExp(value) {
  return Keys(value).map((key) => [new RegExp(`^${key}$`), value[key]]);
}
function Entries(value) {
  return Object.entries(value);
}
function Keys(value) {
  return Object.getOwnPropertyNames(value);
}
function Symbols(value) {
  return Object.getOwnPropertySymbols(value);
}
function Values(value) {
  return Object.values(value);
}
function DeepEqualObject(left, right) {
  if (!IsObject(right))
    return false;
  const keys = Keys(left);
  return IsEqual(keys.length, Keys(right).length) && keys.every((key) => IsDeepEqual(left[key], right[key]));
}
function DeepEqualArray(left, right) {
  return IsArray(right) && IsEqual(left.length, right.length) && left.every((_, index) => IsDeepEqual(left[index], right[index]));
}
function IsDeepEqual(left, right) {
  return IsArray(left) ? DeepEqualArray(left, right) : IsObject(left) ? DeepEqualObject(left, right) : IsEqual(left, right);
}

// node_modules/typebox/build/guard/globals.mjs
var globals_exports = {};
__export(globals_exports, {
  IsBigInt64Array: () => IsBigInt64Array,
  IsBigUint64Array: () => IsBigUint64Array,
  IsBoolean: () => IsBoolean2,
  IsDate: () => IsDate,
  IsFloat32Array: () => IsFloat32Array,
  IsFloat64Array: () => IsFloat64Array,
  IsInt16Array: () => IsInt16Array,
  IsInt32Array: () => IsInt32Array,
  IsInt8Array: () => IsInt8Array,
  IsMap: () => IsMap,
  IsNumber: () => IsNumber2,
  IsRegExp: () => IsRegExp,
  IsSet: () => IsSet,
  IsString: () => IsString2,
  IsTypeArray: () => IsTypeArray,
  IsUint16Array: () => IsUint16Array,
  IsUint32Array: () => IsUint32Array,
  IsUint8Array: () => IsUint8Array,
  IsUint8ClampedArray: () => IsUint8ClampedArray
});
function IsBoolean2(value) {
  return value instanceof Boolean;
}
function IsNumber2(value) {
  return value instanceof Number;
}
function IsString2(value) {
  return value instanceof String;
}
function IsTypeArray(value) {
  return globalThis.ArrayBuffer.isView(value);
}
function IsInt8Array(value) {
  return value instanceof globalThis.Int8Array;
}
function IsUint8Array(value) {
  return value instanceof globalThis.Uint8Array;
}
function IsUint8ClampedArray(value) {
  return value instanceof globalThis.Uint8ClampedArray;
}
function IsInt16Array(value) {
  return value instanceof globalThis.Int16Array;
}
function IsUint16Array(value) {
  return value instanceof globalThis.Uint16Array;
}
function IsInt32Array(value) {
  return value instanceof globalThis.Int32Array;
}
function IsUint32Array(value) {
  return value instanceof globalThis.Uint32Array;
}
function IsFloat32Array(value) {
  return value instanceof globalThis.Float32Array;
}
function IsFloat64Array(value) {
  return value instanceof globalThis.Float64Array;
}
function IsBigInt64Array(value) {
  return value instanceof globalThis.BigInt64Array;
}
function IsBigUint64Array(value) {
  return value instanceof globalThis.BigUint64Array;
}
function IsRegExp(value) {
  return value instanceof globalThis.RegExp;
}
function IsDate(value) {
  return value instanceof globalThis.Date;
}
function IsSet(value) {
  return value instanceof globalThis.Set;
}
function IsMap(value) {
  return value instanceof globalThis.Map;
}

// node_modules/typebox/build/system/settings/settings.mjs
var settings = {
  immutableTypes: false,
  maxErrors: 8,
  maxInstantiationCount: 128,
  useAcceleration: true,
  exactOptionalPropertyTypes: false,
  enumerableKind: false,
  correctiveParse: false,
  unionPrioritySort: true
};
function Reset() {
  settings.immutableTypes = false;
  settings.maxErrors = 8;
  settings.maxInstantiationCount = 128;
  settings.useAcceleration = true;
  settings.exactOptionalPropertyTypes = false;
  settings.enumerableKind = false;
  settings.correctiveParse = false;
  settings.unionPrioritySort = true;
}
function Set2(options2) {
  for (const key of guard_exports.Keys(options2)) {
    const value = options2[key];
    if (value !== void 0) {
      Object.defineProperty(settings, key, { value });
    }
  }
}
function Get() {
  return settings;
}

// node_modules/typebox/build/system/memory/freeze.mjs
function Freeze(value) {
  return settings_exports.Get().immutableTypes ? Object.freeze(value) : value;
}

// node_modules/typebox/build/system/memory/assign.mjs
function Assign(left, right) {
  Metrics.assign += 1;
  return Freeze({ ...left, ...right });
}

// node_modules/typebox/build/system/memory/clone.mjs
function FromClassInstance(value) {
  return value;
}
function IsSchemaObject(value) {
  return guard_exports.HasPropertyKey(value, "~kind") || guard_exports.HasPropertyKey(value, "~unsafe");
}
function FromSchemaObject(value) {
  const result = {};
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    descriptor.value = FromValue(descriptor.value);
    if (guard_exports.IsEqual(descriptor.enumerable, true)) {
      result[key] = descriptor.value;
    } else {
      Object.defineProperty(result, key, descriptor);
    }
  }
  return result;
}
function FromPlainObject(value) {
  const result = {};
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    result[key] = FromValue(value[key]);
  }
  for (const key of guard_exports.Symbols(value)) {
    result[key] = FromValue(value[key]);
  }
  return result;
}
function FromObject(value) {
  return guard_exports.IsClassInstance(value) ? FromClassInstance(value) : IsSchemaObject(value) ? FromSchemaObject(value) : FromPlainObject(value);
}
function FromArray(value) {
  return value.map((element) => FromValue(element));
}
function FromTypedArray(value) {
  return value.slice();
}
function FromRegExp(value) {
  return new RegExp(value.source, value.flags);
}
function FromMap(value) {
  return new Map(FromValue([...value.entries()]));
}
function FromSet(value) {
  return new Set(FromValue([...value.values()]));
}
function FromValue(value) {
  return globals_exports.IsTypeArray(value) ? FromTypedArray(value) : globals_exports.IsRegExp(value) ? FromRegExp(value) : globals_exports.IsMap(value) ? FromMap(value) : globals_exports.IsSet(value) ? FromSet(value) : guard_exports.IsArray(value) ? FromArray(value) : guard_exports.IsObject(value) ? FromObject(value) : value;
}
function Clone(value) {
  Metrics.clone += 1;
  return FromValue(value);
}

// node_modules/typebox/build/system/memory/create.mjs
function MergeHidden(left, right) {
  for (const key of Object.keys(right)) {
    Object.defineProperty(left, key, {
      configurable: true,
      writable: true,
      enumerable: false,
      value: right[key]
    });
  }
  return left;
}
function Merge(left, right) {
  return { ...left, ...right };
}
function Create(hidden, enumerable, options2 = {}) {
  Metrics.create += 1;
  const withOptions = Merge(enumerable, options2);
  const withHidden = settings_exports.Get().enumerableKind ? Merge(withOptions, hidden) : MergeHidden(withOptions, hidden);
  return Freeze(withHidden);
}

// node_modules/typebox/build/system/memory/discard.mjs
function Discard(value, propertyKeys) {
  Metrics.discard += 1;
  const result = {};
  for (const key of guard_exports.Keys(value)) {
    if (propertyKeys.includes(key))
      continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    descriptor.value = Clone(descriptor.value);
    Object.defineProperty(result, key, descriptor);
  }
  return Freeze(result);
}

// node_modules/typebox/build/system/memory/update.mjs
function Update(current, hidden, enumerable) {
  Metrics.update += 1;
  const settings2 = settings_exports.Get();
  const result = Clone(current);
  for (const key of Object.keys(hidden)) {
    Object.defineProperty(result, key, {
      configurable: true,
      writable: true,
      enumerable: settings2.enumerableKind,
      value: hidden[key]
    });
  }
  for (const key of Object.keys(enumerable)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: enumerable[key]
    });
  }
  return Freeze(result);
}

// node_modules/typebox/build/type/types/schema.mjs
function IsKind(value, kind) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], kind);
}
function IsSchema(value) {
  return guard_exports.IsObject(value);
}

// node_modules/typebox/build/type/types/deferred.mjs
function Deferred(action, parameters, options2) {
  return memory_exports.Create({ "~kind": "Deferred" }, { type: "deferred", action, parameters, options: options2 }, {});
}
function IsDeferred(value) {
  return IsKind(value, "Deferred");
}

// node_modules/typebox/build/type/engine/readonly/instantiate_add.mjs
function AddReadonlyOperation(type) {
  return memory_exports.Update(type, { "~readonly": true }, {});
}
function AddReadonlyAction(type, options2) {
  const result = memory_exports.Update(AddReadonlyOperation(type), {}, options2);
  return result;
}
function AddReadonlyInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddReadonlyAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/engine/optional/instantiate_add.mjs
function AddOptionalOperation(type) {
  return memory_exports.Update(type, { "~optional": true }, {});
}
function AddOptionalAction(type, options2) {
  const result = memory_exports.Update(AddOptionalOperation(type), {}, options2);
  return result;
}
function AddOptionalInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddOptionalAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/types/array.mjs
function _Array_(items, options2) {
  return memory_exports.Create({ "~kind": "Array" }, { type: "array", items }, options2);
}
function IsArray2(value) {
  return IsKind(value, "Array");
}
function ArrayOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items"]);
}

// node_modules/typebox/build/type/types/constructor.mjs
function Constructor(parameters, instanceType, options2 = {}) {
  return memory_exports.Create({ "~kind": "Constructor" }, { type: "constructor", parameters, instanceType }, options2);
}
function IsConstructor2(value) {
  return IsKind(value, "Constructor");
}
function ConstructorOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "instanceType"]);
}

// node_modules/typebox/build/type/types/function.mjs
function _Function_(parameters, returnType, options2 = {}) {
  return memory_exports.Create({ ["~kind"]: "Function" }, { type: "function", parameters, returnType }, options2);
}
function IsFunction2(value) {
  return IsKind(value, "Function");
}
function FunctionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "returnType"]);
}

// node_modules/typebox/build/type/types/ref.mjs
function Ref(ref, options2) {
  return memory_exports.Create({ ["~kind"]: "Ref" }, { $ref: ref }, options2);
}
function IsRef(value) {
  return IsKind(value, "Ref");
}

// node_modules/typebox/build/type/types/generic.mjs
function Generic(parameters, expression) {
  return memory_exports.Create({ "~kind": "Generic" }, { type: "generic", parameters, expression });
}
function IsGeneric(value) {
  return IsKind(value, "Generic");
}

// node_modules/typebox/build/type/types/any.mjs
function Any(options2) {
  return memory_exports.Create({ ["~kind"]: "Any" }, {}, options2);
}
function IsAny(value) {
  return IsKind(value, "Any");
}

// node_modules/typebox/build/type/types/never.mjs
var NeverPattern = "(?!)";
function Never(options2) {
  return memory_exports.Create({ "~kind": "Never" }, { not: {} }, options2);
}
function IsNever(value) {
  return IsKind(value, "Never");
}

// node_modules/typebox/build/type/action/_add_optional.mjs
function AddOptionalDeferred(type, options2 = {}) {
  return Deferred("AddOptional", [type], options2);
}
function AddOptional(type, options2 = {}) {
  return AddOptionalAction(type, options2);
}

// node_modules/typebox/build/type/types/_optional.mjs
function Optional(type) {
  return AddOptional(type);
}
function IsOptional(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~optional");
}

// node_modules/typebox/build/type/types/properties.mjs
function RequiredArray(properties) {
  return guard_exports.Keys(properties).filter((key) => !IsOptional(properties[key]));
}
function PropertyKeys(properties) {
  return guard_exports.Keys(properties);
}
function PropertyValues(properties) {
  return guard_exports.Values(properties);
}

// node_modules/typebox/build/type/types/object.mjs
function _Object_(properties, options2 = {}) {
  const requiredKeys = RequiredArray(properties);
  const required = requiredKeys.length > 0 ? { required: requiredKeys } : {};
  return memory_exports.Create({ "~kind": "Object" }, { type: "object", ...required, properties }, options2);
}
function IsObject2(value) {
  return IsKind(value, "Object");
}
function ObjectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "properties", "required"]);
}

// node_modules/typebox/build/type/types/unknown.mjs
function Unknown(options2) {
  return memory_exports.Create({ ["~kind"]: "Unknown" }, {}, options2);
}
function IsUnknown(value) {
  return IsKind(value, "Unknown");
}

// node_modules/typebox/build/type/types/cyclic.mjs
function Cyclic($defs, $ref, options2) {
  const defs = guard_exports.Keys($defs).reduce((result, key) => {
    return { ...result, [key]: memory_exports.Update($defs[key], {}, { $id: key }) };
  }, {});
  return memory_exports.Create({ ["~kind"]: "Cyclic" }, { $defs: defs, $ref }, options2);
}
function IsCyclic(value) {
  return IsKind(value, "Cyclic");
}

// node_modules/typebox/build/type/types/unsafe.mjs
function Unsafe(schema) {
  return memory_exports.Update(schema, { ["~unsafe"]: null }, {});
}
function IsUnsafe(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "~unsafe") && guard_exports.IsNull(value["~unsafe"]);
}

// node_modules/typebox/build/system/arguments/arguments.mjs
var arguments_exports = {};
__export(arguments_exports, {
  Match: () => Match
});
function Match(args, match) {
  return match[args.length]?.(...args) ?? (() => {
    throw Error("Invalid Arguments");
  })();
}

// node_modules/typebox/build/type/types/infer.mjs
function Infer(...args) {
  const [name, extends_] = arguments_exports.Match(args, {
    2: (name2, extends_2) => [name2, extends_2, extends_2],
    1: (name2) => [name2, Unknown(), Unknown()]
  });
  return memory_exports.Create({ ["~kind"]: "Infer" }, { type: "infer", name, extends: extends_ }, {});
}
function IsInfer(value) {
  return IsKind(value, "Infer");
}

// node_modules/typebox/build/type/types/dependent.mjs
function Dependent(if_, then_, else_, options2 = {}) {
  return memory_exports.Create({ "~kind": "Dependent" }, { if: if_, then: then_, else: else_ }, options2);
}
function IsDependent(value) {
  return IsKind(value, "Dependent");
}
function DependentOptions(type) {
  return memory_exports.Discard(type, ["~kind", "if", "then", "else"]);
}

// node_modules/typebox/build/type/engine/enum/typescript_enum_to_enum_values.mjs
function IsTypeScriptEnumLike(value) {
  return guard_exports.IsObjectNotArray(value);
}
function TypeScriptEnumToEnumValues(type) {
  const keys = guard_exports.Keys(type).filter((key) => isNaN(key));
  return keys.reduce((result, key) => [...result, type[key]], []);
}

// node_modules/typebox/build/type/types/enum.mjs
function IsEnumValue(value) {
  return guard_exports.IsString(value) || guard_exports.IsNumber(value);
}
function Enum(value, options2) {
  const values = IsTypeScriptEnumLike(value) ? TypeScriptEnumToEnumValues(value) : value;
  return memory_exports.Create({ "~kind": "Enum" }, { enum: values }, options2);
}
function IsEnum(value) {
  return IsKind(value, "Enum");
}

// node_modules/typebox/build/type/types/intersect.mjs
function Intersect(types, options2 = {}) {
  return memory_exports.Create({ "~kind": "Intersect" }, { allOf: types }, options2);
}
function IsIntersect(value) {
  return IsKind(value, "Intersect");
}
function IntersectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "allOf"]);
}

// node_modules/typebox/build/system/unreachable/unreachable.mjs
function Unreachable() {
  throw new Error("Unreachable");
}

// node_modules/typebox/build/system/hashing/hash.mjs
var ByteMarker;
(function(ByteMarker2) {
  ByteMarker2[ByteMarker2["Array"] = 0] = "Array";
  ByteMarker2[ByteMarker2["BigInt"] = 1] = "BigInt";
  ByteMarker2[ByteMarker2["Boolean"] = 2] = "Boolean";
  ByteMarker2[ByteMarker2["Date"] = 3] = "Date";
  ByteMarker2[ByteMarker2["Constructor"] = 4] = "Constructor";
  ByteMarker2[ByteMarker2["Function"] = 5] = "Function";
  ByteMarker2[ByteMarker2["Null"] = 6] = "Null";
  ByteMarker2[ByteMarker2["Number"] = 7] = "Number";
  ByteMarker2[ByteMarker2["Object"] = 8] = "Object";
  ByteMarker2[ByteMarker2["RegExp"] = 9] = "RegExp";
  ByteMarker2[ByteMarker2["String"] = 10] = "String";
  ByteMarker2[ByteMarker2["Symbol"] = 11] = "Symbol";
  ByteMarker2[ByteMarker2["TypeArray"] = 12] = "TypeArray";
  ByteMarker2[ByteMarker2["Undefined"] = 13] = "Undefined";
})(ByteMarker || (ByteMarker = {}));
var Accumulator = BigInt("14695981039346656037");
var [Prime, Size] = [BigInt("1099511628211"), BigInt(
  "18446744073709551616"
  /* 2 ^ 64 */
)];
var Bytes = Array.from({ length: 256 }).map((_, i) => BigInt(i));
var F64 = new Float64Array(1);
var F64In = new DataView(F64.buffer);
var F64Out = new Uint8Array(F64.buffer);
var encoder = new TextEncoder();

// node_modules/typebox/build/type/types/_codec.mjs
var EncodeBuilder = class {
  constructor(type, decode) {
    this.type = type;
    this.decode = decode;
  }
  Encode(callback) {
    const type = this.type;
    const decode = IsCodec(type) ? (value) => this.decode(type["~codec"].decode(value)) : this.decode;
    const encode = IsCodec(type) ? (value) => type["~codec"].encode(callback(value)) : callback;
    const codec = { decode, encode };
    return memory_exports.Update(this.type, { "~codec": codec }, {});
  }
};
var DecodeBuilder = class {
  constructor(type) {
    this.type = type;
  }
  Decode(callback) {
    return new EncodeBuilder(this.type, callback);
  }
};
function Codec(type) {
  return new DecodeBuilder(type);
}
function Decode(type, callback) {
  return Codec(type).Decode(callback).Encode(() => {
    throw Error("Encode not implemented");
  });
}
function Encode(type, callback) {
  return Codec(type).Decode(() => {
    throw Error("Decode not implemented");
  }).Encode(callback);
}
function IsCodec(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~codec") && guard_exports.IsObject(value["~codec"]) && guard_exports.HasPropertyKey(value["~codec"], "encode") && guard_exports.HasPropertyKey(value["~codec"], "decode");
}

// node_modules/typebox/build/type/types/_immutable.mjs
function Immutable(type) {
  return AddImmutable(type);
}
function IsImmutable(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~immutable");
}

// node_modules/typebox/build/type/action/_add_readonly.mjs
function AddReadonlyDeferred(type, options2 = {}) {
  return Deferred("AddReadonly", [type], options2);
}
function AddReadonly(type, options2 = {}) {
  return AddReadonlyAction(type, options2);
}

// node_modules/typebox/build/type/types/_readonly.mjs
function Readonly(type) {
  return AddReadonly(type);
}
function IsReadonly(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~readonly");
}

// node_modules/typebox/build/type/types/_refine.mjs
function RefineAdd(type, refinement) {
  const refinements = IsRefine(type) ? [...type["~refine"], refinement] : [refinement];
  return memory_exports.Update(type, { "~refine": refinements }, {});
}
function Refine(...args) {
  const [type, check, error] = arguments_exports.Match(args, {
    3: (type2, check2, error2) => [type2, check2, error2],
    2: (type2, check2) => [type2, check2, () => "Refine Error"]
  });
  return RefineAdd(type, { check, error });
}
function IsRefinement(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "check") && guard_exports.HasPropertyKey(value, "error") && guard_exports.IsFunction(value.check) && guard_exports.IsFunction(value.error);
}
function IsRefine(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~refine") && guard_exports.IsArray(value["~refine"]) && guard_exports.Every(value["~refine"], 0, (value2) => IsRefinement(value2));
}

// node_modules/typebox/build/type/types/bigint.mjs
var BigIntPattern = "-?(?:0|[1-9][0-9]*)n";
function BigInt2(options2) {
  return memory_exports.Create({ "~kind": "BigInt" }, { type: "bigint" }, options2);
}
function IsBigInt2(value) {
  return IsKind(value, "BigInt");
}

// node_modules/typebox/build/type/types/boolean.mjs
function Boolean2(options2) {
  return memory_exports.Create({ "~kind": "Boolean" }, { type: "boolean" }, options2);
}
function IsBoolean3(value) {
  return IsKind(value, "Boolean");
}

// node_modules/typebox/build/type/types/identifier.mjs
function Identifier(name) {
  return memory_exports.Create({ "~kind": "Identifier" }, { name });
}
function IsIdentifier(value) {
  return IsKind(value, "Identifier");
}

// node_modules/typebox/build/type/types/integer.mjs
var IntegerPattern = "-?(?:0|[1-9][0-9]*)";
function Integer(options2) {
  return memory_exports.Create({ "~kind": "Integer" }, { type: "integer" }, options2);
}
function IsInteger2(value) {
  return IsKind(value, "Integer");
}

// node_modules/typebox/build/type/types/literal.mjs
var InvalidLiteralValue = class extends Error {
  constructor(value) {
    super(`Invalid Literal value`);
    Object.defineProperty(this, "cause", {
      value: { value },
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
};
function LiteralTypeName(value) {
  return guard_exports.IsBigInt(value) ? "bigint" : guard_exports.IsBoolean(value) ? "boolean" : guard_exports.IsNumber(value) ? "number" : guard_exports.IsString(value) ? "string" : (() => {
    throw new InvalidLiteralValue(value);
  })();
}
function Literal(value, options2) {
  return memory_exports.Create({ "~kind": "Literal" }, { type: LiteralTypeName(value), const: value }, options2);
}
function IsLiteralValue(value) {
  return guard_exports.IsBigInt(value) || guard_exports.IsBoolean(value) || guard_exports.IsNumber(value) || guard_exports.IsString(value);
}
function IsLiteralNumber(value) {
  return IsLiteral(value) && guard_exports.IsNumber(value.const);
}
function IsLiteralString(value) {
  return IsLiteral(value) && guard_exports.IsString(value.const);
}
function IsLiteral(value) {
  return IsKind(value, "Literal");
}

// node_modules/typebox/build/type/types/null.mjs
function Null(options2) {
  return memory_exports.Create({ "~kind": "Null" }, { type: "null" }, options2);
}
function IsNull2(value) {
  return IsKind(value, "Null");
}

// node_modules/typebox/build/type/types/number.mjs
var NumberPattern = "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?";
function Number2(options2) {
  return memory_exports.Create({ "~kind": "Number" }, { type: "number" }, options2);
}
function IsNumber3(value) {
  return IsKind(value, "Number");
}

// node_modules/typebox/build/type/types/symbol.mjs
function Symbol2(options2) {
  return memory_exports.Create({ "~kind": "Symbol" }, { type: "symbol" }, options2);
}
function IsSymbol2(value) {
  return IsKind(value, "Symbol");
}

// node_modules/typebox/build/type/types/parameter.mjs
function Parameter(...args) {
  const [name, extends_, equals] = arguments_exports.Match(args, {
    3: (name2, extends_2, equals2) => [name2, extends_2, equals2],
    2: (name2, extends_2) => [name2, extends_2, extends_2],
    1: (name2) => [name2, Unknown(), Unknown()]
  });
  return memory_exports.Create({ "~kind": "Parameter" }, { name, extends: extends_, equals }, {});
}
function IsParameter(value) {
  return IsKind(value, "Parameter");
}

// node_modules/typebox/build/type/types/string.mjs
var StringPattern = ".*";
function String2(options2) {
  return memory_exports.Create({ "~kind": "String" }, { type: "string" }, options2);
}
function IsString3(value) {
  return IsKind(value, "String");
}

// node_modules/typebox/build/type/types/union.mjs
function Union(anyOf, options2 = {}) {
  return memory_exports.Create({ "~kind": "Union" }, { anyOf }, options2);
}
function IsUnion(value) {
  return IsKind(value, "Union");
}
function UnionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "anyOf"]);
}

// node_modules/typebox/build/type/engine/patterns/pattern.mjs
function ParsePatternIntoTypes(pattern) {
  const parsed = Pattern(pattern);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : [];
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/is_finite.mjs
function FromLiteral(_value) {
  return true;
}
function FromTypesReduce(types) {
  return guard_exports.ShiftLeft(types, (left, right) => FromType(left) ? FromTypesReduce(right) : false, () => true);
}
function FromTypes(types) {
  const result = guard_exports.IsEqual(types.length, 0) ? false : FromTypesReduce(types);
  return result;
}
function FromType(type) {
  return IsUnion(type) ? FromTypes(type.anyOf) : IsLiteral(type) ? FromLiteral(type.const) : false;
}
function IsTemplateLiteralFinite(types) {
  const result = FromTypes(types);
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/create.mjs
function TemplateLiteralCreate(pattern) {
  return memory_exports.Create({ ["~kind"]: "TemplateLiteral" }, { type: "string", pattern }, {});
}

// node_modules/typebox/build/type/engine/template_literal/decode.mjs
function FromLiteralPush(variants, value, result = []) {
  return guard_exports.ShiftLeft(variants, (left, right) => FromLiteralPush(right, value, [...result, `${left}${value}`]), () => result);
}
function FromLiteral2(variants, value) {
  return guard_exports.IsEqual(variants.length, 0) ? [`${value}`] : FromLiteralPush(variants, value);
}
function FromUnion(variants, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => FromUnion(variants, right, [...result, ...FromType2(variants, left)]), () => result);
}
function FromType2(variants, type) {
  const result = IsUnion(type) ? FromUnion(variants, type.anyOf) : IsLiteral(type) ? FromLiteral2(variants, type.const) : Unreachable();
  return result;
}
function DecodeFromSpan(variants, types) {
  return guard_exports.ShiftLeft(types, (left, right) => DecodeFromSpan(FromType2(variants, left), right), () => variants);
}
function VariantsToLiterals(variants) {
  return variants.map((variant) => Literal(variant));
}
function DecodeTypesAsUnion(types) {
  const variants = DecodeFromSpan([], types);
  const literals = VariantsToLiterals(variants);
  const result = Union(literals);
  return result;
}
function DecodeTypes(types) {
  return guard_exports.IsEqual(types.length, 0) ? Unreachable() : (
    // Literal('') :
    guard_exports.IsEqual(types.length, 1) && IsLiteral(types[0]) ? types[0] : DecodeTypesAsUnion(types)
  );
}
function TemplateLiteralDecodeUnsafe(pattern) {
  const types = ParsePatternIntoTypes(pattern);
  const result = guard_exports.IsEqual(types.length, 0) ? String2() : IsTemplateLiteralFinite(types) ? DecodeTypes(types) : TemplateLiteralCreate(pattern);
  return result;
}
function TemplateLiteralDecode(pattern) {
  const decoded = TemplateLiteralDecodeUnsafe(pattern);
  const result = IsTemplateLiteral(decoded) ? String2() : decoded;
  return result;
}

// node_modules/typebox/build/type/engine/record/record_create.mjs
function CreateRecord(key, value) {
  const type = "object";
  const patternProperties = { [key]: value };
  return memory_exports.Create({ ["~kind"]: "Record" }, { type, patternProperties });
}

// node_modules/typebox/build/type/engine/record/from_key_any.mjs
function FromAnyKey(value) {
  return CreateRecord(StringKey, value);
}

// node_modules/typebox/build/type/engine/record/from_key_boolean.mjs
function FromBooleanKey(value) {
  return _Object_({ true: value, false: value });
}

// node_modules/typebox/build/type/types/tuple.mjs
function Tuple(types, options2 = {}) {
  const [items, minItems, additionalItems] = [types, types.length, false];
  return memory_exports.Create({ ["~kind"]: "Tuple" }, { type: "array", additionalItems, items, minItems }, options2);
}
function IsTuple(value) {
  return IsKind(value, "Tuple");
}
function TupleOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items", "minItems", "additionalItems"]);
}

// node_modules/typebox/build/type/engine/readonly/instantiate_remove.mjs
function RemoveReadonlyOperation(type) {
  return memory_exports.Discard(type, ["~readonly"]);
}
function RemoveReadonlyAction(type, options2) {
  const result = memory_exports.Update(RemoveReadonlyOperation(type), {}, options2);
  return result;
}
function RemoveReadonlyInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveReadonlyAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/action/_remove_readonly.mjs
function RemoveReadonlyDeferred(type, options2 = {}) {
  return Deferred("RemoveReadonly", [type], options2);
}
function RemoveReadonly(type, options2 = {}) {
  return RemoveReadonlyAction(type, options2);
}

// node_modules/typebox/build/type/engine/optional/instantiate_remove.mjs
function RemoveOptionalOperation(type) {
  return memory_exports.Discard(type, ["~optional"]);
}
function RemoveOptionalAction(type, options2) {
  const result = memory_exports.Update(RemoveOptionalOperation(type), {}, options2);
  return result;
}
function RemoveOptionalInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveOptionalAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/action/_remove_optional.mjs
function RemoveOptionalDeferred(type, options2 = {}) {
  return Deferred("RemoveOptional", [type], options2);
}
function RemoveOptional(type, options2 = {}) {
  return RemoveOptionalAction(type, options2);
}

// node_modules/typebox/build/type/engine/tuple/to_object.mjs
function TupleElementsToProperties(types) {
  const result = types.reduceRight((result2, right, index) => {
    return { [index]: right, ...result2 };
  }, {});
  return result;
}
function TupleToObject(type) {
  const properties = TupleElementsToProperties(type.items);
  const result = _Object_(properties);
  return result;
}

// node_modules/typebox/build/type/engine/evaluate/composite.mjs
function CanComposite(type) {
  return IsObject2(type) || IsTuple(type);
}
function IsReadonlyProperty(left, right) {
  return IsReadonly(left) ? IsReadonly(right) ? true : false : false;
}
function IsOptionalProperty(left, right) {
  return IsOptional(left) ? IsOptional(right) ? true : false : false;
}
function CompositeProperty(left, right) {
  const isReadonly = IsReadonlyProperty(left, right);
  const isOptional = IsOptionalProperty(left, right);
  const evaluated = EvaluateIntersect([left, right]);
  const property = RemoveReadonly(RemoveOptional(evaluated));
  return isReadonly && isOptional ? AddReadonly(AddOptional(property)) : isReadonly && !isOptional ? AddReadonly(property) : !isReadonly && isOptional ? AddOptional(property) : property;
}
function CompositePropertyKey(left, right, key) {
  return key in left ? key in right ? CompositeProperty(left[key], right[key]) : left[key] : key in right ? right[key] : Never();
}
function CompositeProperties(left, right) {
  const keys = /* @__PURE__ */ new Set([...guard_exports.Keys(left), ...guard_exports.Keys(right)]);
  const result = [...keys].reduce((result2, key) => {
    return { ...result2, [key]: CompositePropertyKey(left, right, key) };
  }, {});
  return result;
}
function GetProperties(type) {
  const result = IsObject2(type) ? type.properties : IsTuple(type) ? TupleElementsToProperties(type.items) : {};
  return result;
}
function Composite(left, right) {
  const leftProperties = GetProperties(left);
  const rightProperties = GetProperties(right);
  const properties = CompositeProperties(leftProperties, rightProperties);
  const result = _Object_(properties);
  return result;
}

// node_modules/typebox/build/type/engine/evaluate/narrow.mjs
function NarrowCompareRule(left, right) {
  const result = Compare(left, right);
  return guard_exports.IsEqual(result, CompareResultLeftInside) ? left : guard_exports.IsEqual(result, CompareResultRightInside) ? right : guard_exports.IsEqual(result, CompareResultEqual) ? right : Never();
}
function NarrowCompositeRule(left, right) {
  const canCompositeLeft = CanComposite(left);
  const canCompositeRight = CanComposite(right);
  return canCompositeLeft && canCompositeRight ? Composite(left, right) : canCompositeLeft && !canCompositeRight ? left : !canCompositeLeft && canCompositeRight ? right : NarrowCompareRule(left, right);
}
function Narrow(left, right) {
  return IsNever(left) ? left : IsAny(left) ? left : IsUnknown(left) ? right : IsNever(right) ? right : IsAny(right) ? right : IsUnknown(right) ? left : NarrowCompositeRule(left, right);
}

// node_modules/typebox/build/type/engine/evaluate/distribute.mjs
function ShouldEvaluate(left, right) {
  const result = IsUnion(left) || IsUnion(right);
  return result;
}
function DistributeOperation(left, right) {
  const evaluatedLeft = EvaluateType(left);
  const evaluatedRight = EvaluateType(right);
  const shouldEvaluate = ShouldEvaluate(evaluatedLeft, evaluatedRight);
  const result = shouldEvaluate ? EvaluateIntersect([evaluatedLeft, evaluatedRight]) : Narrow(evaluatedLeft, evaluatedRight);
  return result;
}
function DistributeType(type, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => DistributeType(type, right, [...result, DistributeOperation(left, type)]), () => guard_exports.IsEqual(result.length, 0) ? [type] : result);
}
function DistributeUnion(types, distribution, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => DistributeUnion(right, distribution, [...result, ...Distribute([left], distribution)]), () => result);
}
function Distribute(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => IsUnion(left) ? Distribute(right, DistributeUnion(left.anyOf, result)) : Distribute(right, DistributeType(left, result)), () => result);
}

// node_modules/typebox/build/type/engine/exclude/operation.mjs
function ExcludeType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [] : [left];
  return result;
}
function ExcludeUnion(left, right, result = []) {
  return guard_exports.ShiftLeft(left, (head, tail) => ExcludeUnion(tail, right, [...result, ...ExcludeType(head, right)]), () => result);
}
function ExcludeOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExcludeUnion(canonical, right);
  const result = EvaluateUnion(remaining);
  return result;
}

// node_modules/typebox/build/type/engine/evaluate/evaluate.mjs
function EvaluateDependent(if_, then_, else_) {
  const intersected = EvaluateIntersect([if_, then_]);
  const excluded = ExcludeOperation(else_, if_);
  const result = EvaluateUnion([intersected, excluded]);
  return result;
}
function EvaluateEnum(values, result = []) {
  return guard_exports.ShiftLeft(values, (left, right) => EvaluateEnum(right, [...result, Literal(left)]), () => EvaluateUnion(result));
}
function EvaluateIntersect(types) {
  const distribution = Distribute(types);
  const broadend = Broaden(distribution);
  const result = EvaluateUnion(broadend);
  return result;
}
function EvaluateTemplateLiteral(pattern) {
  const evaluated = TemplateLiteralDecode(pattern);
  const result = EvaluateType(evaluated);
  return result;
}
function EvaluateUnion(types) {
  const broadend = Broaden(types);
  const result = EvaluateUnionFast(broadend);
  return result;
}
function EvaluateType(type) {
  const result = IsDependent(type) ? EvaluateDependent(type.if, type.then, type.else) : IsEnum(type) ? EvaluateEnum(type.enum) : IsIntersect(type) ? EvaluateIntersect(type.allOf) : IsTemplateLiteral(type) ? EvaluateTemplateLiteral(type.pattern) : IsUnion(type) ? EvaluateUnion(type.anyOf) : type;
  return result;
}
function EvaluateUnionFast(types) {
  const result = guard_exports.IsEqual(types.length, 1) ? types[0] : guard_exports.IsEqual(types.length, 0) ? Never() : Union(types);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_enum.mjs
function FromEnumKey(values, value) {
  const unionKey = EvaluateEnum(values);
  const result = FromKey(unionKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_integer.mjs
function FromIntegerKey(_key, value) {
  const result = CreateRecord(IntegerKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_intersect.mjs
function FromIntersectKey(types, value) {
  const evaluatedKey = EvaluateIntersect(types);
  const result = FromKey(evaluatedKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_literal.mjs
function FromLiteralKey(key, value) {
  return guard_exports.IsString(key) || guard_exports.IsNumber(key) ? _Object_({ [key]: value }) : guard_exports.IsEqual(key, false) ? _Object_({ false: value }) : guard_exports.IsEqual(key, true) ? _Object_({ true: value }) : _Object_({});
}

// node_modules/typebox/build/type/engine/record/from_key_number.mjs
function FromNumberKey(_key, value) {
  const result = CreateRecord(NumberKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_string.mjs
function FromStringKey(key, value) {
  return guard_exports.HasPropertyKey(key, "pattern") && (guard_exports.IsString(key.pattern) || key.pattern instanceof RegExp) ? CreateRecord(key.pattern.toString(), value) : CreateRecord(StringKey, value);
}

// node_modules/typebox/build/type/engine/record/from_key_template_literal.mjs
function FromTemplateKey(pattern, value) {
  const types = ParsePatternIntoTypes(pattern);
  const finite = IsTemplateLiteralFinite(types);
  const result = finite ? FromKey(EvaluateTemplateLiteral(pattern), value) : CreateRecord(pattern, value);
  return result;
}

// node_modules/typebox/build/type/engine/evaluate/flatten.mjs
function FlattenType(type) {
  const result = IsUnion(type) ? Flatten(type.anyOf) : [type];
  return result;
}
function Flatten(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => Flatten(right, [...result, ...FlattenType(left)]), () => result);
}

// node_modules/typebox/build/type/engine/record/from_key_union.mjs
function StringOrNumberCheck(types) {
  return types.some((type) => IsString3(type) || IsNumber3(type) || IsInteger2(type));
}
function TryBuildRecord(types, value) {
  return guard_exports.IsEqual(StringOrNumberCheck(types), true) ? CreateRecord(StringKey, value) : void 0;
}
function CreateProperties(types, value) {
  return types.reduce((result, left) => {
    return IsLiteral(left) && (guard_exports.IsString(left.const) || guard_exports.IsNumber(left.const)) ? { ...result, [left.const]: value } : result;
  }, {});
}
function CreateObject(types, value) {
  const properties = CreateProperties(types, value);
  const result = _Object_(properties);
  return result;
}
function FromUnionKey(types, value) {
  const flattened = Flatten(types);
  const record = TryBuildRecord(flattened, value);
  return IsSchema(record) ? record : CreateObject(flattened, value);
}

// node_modules/typebox/build/type/engine/record/from_key.mjs
function FromKey(key, value) {
  const result = IsAny(key) ? FromAnyKey(value) : IsBoolean3(key) ? FromBooleanKey(value) : IsEnum(key) ? FromEnumKey(key.enum, value) : IsInteger2(key) ? FromIntegerKey(key, value) : IsIntersect(key) ? FromIntersectKey(key.allOf, value) : IsLiteral(key) ? FromLiteralKey(key.const, value) : IsNumber3(key) ? FromNumberKey(key, value) : IsUnion(key) ? FromUnionKey(key.anyOf, value) : IsString3(key) ? FromStringKey(key, value) : IsTemplateLiteral(key) ? FromTemplateKey(key.pattern, value) : _Object_({});
  return result;
}

// node_modules/typebox/build/type/engine/record/instantiate.mjs
function RecordAction(key, value, options2) {
  const result = CanInstantiate([key]) ? memory_exports.Update(FromKey(key, value), {}, options2) : RecordDeferred(key, value, options2);
  return result;
}
function RecordInstantiate(context, state, key, value, options2) {
  const instantiatedKey = InstantiateType(context, state, key);
  const instantiatedValue = InstantiateType(context, state, value);
  return RecordAction(instantiatedKey, instantiatedValue, options2);
}

// node_modules/typebox/build/type/types/record.mjs
var IntegerKey = `^${IntegerPattern}$`;
var NumberKey = `^${NumberPattern}$`;
var StringKey = `^${StringPattern}$`;
function RecordDeferred(key, value, options2 = {}) {
  return Deferred("Record", [key, value], options2);
}
function Record(key, value, options2 = {}) {
  return RecordAction(key, value, options2);
}
function RecordFromPattern(pattern, value) {
  return CreateRecord(pattern, value);
}
function RecordPatternToType(pattern) {
  const result = guard_exports.IsEqual(pattern, StringKey) ? String2() : guard_exports.IsEqual(pattern, IntegerKey) ? Integer() : guard_exports.IsEqual(pattern, NumberKey) ? Number2() : TemplateLiteralDecodeUnsafe(pattern);
  return result;
}
function RecordPattern(type) {
  return guard_exports.Keys(type.patternProperties)[0];
}
function RecordKey(type) {
  const pattern = RecordPattern(type);
  const result = RecordPatternToType(pattern);
  return result;
}
function RecordValue(type) {
  return type.patternProperties[RecordPattern(type)];
}
function IsRecord(value) {
  return IsKind(value, "Record");
}

// node_modules/typebox/build/type/types/rest.mjs
function Rest(type) {
  return memory_exports.Create({ "~kind": "Rest" }, { type: "rest", items: type }, {});
}
function IsRest(value) {
  return IsKind(value, "Rest");
}

// node_modules/typebox/build/type/types/this.mjs
function This(options2) {
  return memory_exports.Create({ ["~kind"]: "This" }, { $ref: "#" }, options2);
}
function IsThis(value) {
  return IsKind(value, "This");
}

// node_modules/typebox/build/type/types/undefined.mjs
function Undefined(options2) {
  return memory_exports.Create({ "~kind": "Undefined" }, { type: "undefined" }, options2);
}
function IsUndefined2(value) {
  return IsKind(value, "Undefined");
}

// node_modules/typebox/build/type/types/void.mjs
function Void(options2) {
  return memory_exports.Create({ "~kind": "Void" }, { type: "void" }, options2);
}
function IsVoid(value) {
  return IsKind(value, "Void");
}

// node_modules/typebox/build/type/script/mapping.mjs
function IntrinsicOrCall(ref, parameters) {
  return guard_exports.IsEqual(ref, "Array") ? _Array_(parameters[0]) : guard_exports.IsEqual(ref, "Capitalize") ? CapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ConstructorParameters") ? ConstructorParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Evaluate") ? EvaluateDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Exclude") ? ExcludeDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Extract") ? ExtractDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Index") ? IndexDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "InstanceType") ? InstanceTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Lowercase") ? LowercaseDeferred(parameters[0]) : guard_exports.IsEqual(ref, "NonNullable") ? NonNullableDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Omit") ? OmitDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Parameters") ? ParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Partial") ? PartialDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Pick") ? PickDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Readonly") ? ReadonlyObjectDeferred(parameters[0]) : guard_exports.IsEqual(ref, "KeyOf") ? KeyOfDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Record") ? RecordDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Required") ? RequiredDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ReturnType") ? ReturnTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uncapitalize") ? UncapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uppercase") ? UppercaseDeferred(parameters[0]) : CallConstruct(Ref(ref), parameters);
}
function Unreachable2() {
  throw Error("Unreachable");
}
function DelimitedDecode(input, result = []) {
  return guard_exports.ShiftLeft(input, (left, right) => DelimitedDecode(right, [...result, left[1]]), () => result);
}
function Delimited(input) {
  return guard_exports.IsEqual(input.length, 3) ? [input[0], ...DelimitedDecode(input[1])] : [];
}
function GenericParameterExtendsEqualsMapping(input) {
  return Parameter(input[0], input[2], input[4]);
}
function GenericParameterExtendsMapping(input) {
  return Parameter(input[0], input[2], input[2]);
}
function GenericParameterEqualsMapping(input) {
  return Parameter(input[0], Unknown(), input[2]);
}
function GenericParameterIdentifierMapping(input) {
  return Parameter(input, Unknown(), Unknown());
}
function GenericParameterMapping(input) {
  return input;
}
function GenericParameterListMapping(input) {
  return Delimited(input);
}
function GenericParametersMapping(input) {
  return input[1];
}
function GenericCallArgumentListMapping(input) {
  return Delimited(input);
}
function GenericCallArgumentsMapping(input) {
  return input[1];
}
function GenericCallMapping(input) {
  return IntrinsicOrCall(input[0], input[1]);
}
function OptionalSemiColonMapping(input) {
  return null;
}
function KeywordStringMapping(input) {
  return String2();
}
function KeywordNumberMapping(input) {
  return Number2();
}
function KeywordBooleanMapping(input) {
  return Boolean2();
}
function KeywordUndefinedMapping(input) {
  return Undefined();
}
function KeywordNullMapping(input) {
  return Null();
}
function KeywordIntegerMapping(input) {
  return Integer();
}
function KeywordBigIntMapping(input) {
  return BigInt2();
}
function KeywordUnknownMapping(input) {
  return Unknown();
}
function KeywordAnyMapping(input) {
  return Any();
}
function KeywordObjectMapping(input) {
  return _Object_({});
}
function KeywordNeverMapping(input) {
  return Never();
}
function KeywordSymbolMapping(input) {
  return Symbol2();
}
function KeywordVoidMapping(input) {
  return Void();
}
function KeywordThisMapping(input) {
  return This();
}
function LiteralBigIntMapping(input) {
  return Literal(BigInt(input));
}
function LiteralBooleanMapping(input) {
  return Literal(guard_exports.IsEqual(input, "true"));
}
function LiteralNumberMapping(input) {
  return Literal(parseFloat(input));
}
function LiteralStringMapping(input) {
  return Literal(input);
}
function TemplateInterpolateMapping(input) {
  return input[1];
}
function TemplateSpanMapping(input) {
  return Literal(input);
}
function TemplateBodyMapping(input) {
  return guard_exports.IsEqual(input.length, 3) ? [input[0], input[1], ...input[2]] : [input[0]];
}
function TemplateLiteralTypesMapping(input) {
  return input[1];
}
function TemplateLiteralMapping(input) {
  return TemplateLiteralDeferred(input);
}
function DependentMapping(input) {
  return guard_exports.IsEqual(input.length, 6) ? Dependent(input[1], input[3], input[5]) : Dependent(input[1], input[3], Unknown());
}
function KeyOfMapping(input) {
  return input.length > 0;
}
function IndexArrayMapping(input) {
  return input.reduce((result, current) => {
    return guard_exports.IsEqual(current.length, 3) ? [...result, [current[1]]] : [...result, []];
  }, []);
}
function ExtendsMapping(input) {
  return guard_exports.IsEqual(input.length, 6) ? [input[1], input[3], input[5]] : [];
}
function BaseMapping(input) {
  return guard_exports.IsArray(input) && guard_exports.IsEqual(input.length, 3) ? input[1] : input;
}
function WithMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
}
function FactorIndexArray(Type2, indexArray) {
  return indexArray.reduce((result, left) => {
    const _left = left;
    return guard_exports.IsEqual(_left.length, 1) ? IndexDeferred(result, _left[0]) : guard_exports.IsEqual(_left.length, 0) ? _Array_(result) : Unreachable2();
  }, Type2);
}
function FactorExtends(type, extend) {
  return guard_exports.IsEqual(extend.length, 3) ? ConditionalDeferred(type, extend[0], extend[1], extend[2]) : type;
}
function FactorWith(type, withClause) {
  return guard_exports.IsArray(withClause) && guard_exports.IsEqual(withClause.length, 0) ? type : WithDeferred(type, withClause);
}
function FactorMapping(input) {
  const [keyOf, type, indexArray, extend, withClause] = input;
  return FactorWith(keyOf ? FactorExtends(KeyOfDeferred(FactorIndexArray(type, indexArray)), extend) : FactorExtends(FactorIndexArray(type, indexArray), extend), withClause);
}
function ExprBinaryMapping(left, rest) {
  return guard_exports.IsEqual(rest.length, 3) ? (() => {
    const [operator, right, next] = rest;
    const Schema = ExprBinaryMapping(right, next);
    if (guard_exports.IsEqual(operator, "&")) {
      return IsIntersect(Schema) ? Intersect([left, ...Schema.allOf]) : Intersect([left, Schema]);
    }
    if (guard_exports.IsEqual(operator, "|")) {
      return IsUnion(Schema) ? Union([left, ...Schema.anyOf]) : Union([left, Schema]);
    }
    Unreachable2();
  })() : left;
}
function ExprTermTailMapping(input) {
  return input;
}
function ExprTermMapping(input) {
  const [left, rest] = input;
  return ExprBinaryMapping(left, rest);
}
function ExprTailMapping(input) {
  return input;
}
function ExprMapping(input) {
  const [left, rest] = input;
  return ExprBinaryMapping(left, rest);
}
function ExprReadonlyMapping(input) {
  return AddImmutableDeferred(input[1]);
}
function ExprPipeMapping(input) {
  return input[1];
}
function GenericTypeMapping(input) {
  return Generic(input[0], input[2]);
}
function InferTypeMapping(input) {
  return guard_exports.IsEqual(input.length, 4) ? Infer(input[1], input[3]) : guard_exports.IsEqual(input.length, 2) ? Infer(input[1], Unknown()) : Unreachable2();
}
function TypeMapping(input) {
  return input;
}
function PropertyKeyNumberMapping(input) {
  return `${input}`;
}
function PropertyKeyIdentMapping(input) {
  return input;
}
function PropertyKeyQuotedMapping(input) {
  return input;
}
function PropertyKeyIndexMapping(input) {
  return IsInteger2(input[3]) ? IntegerKey : IsNumber3(input[3]) ? NumberKey : IsSymbol2(input[3]) ? StringKey : IsString3(input[3]) ? StringKey : Unreachable2();
}
function PropertyKeyMapping(input) {
  return input;
}
function ReadonlyMapping(input) {
  return input.length > 0;
}
function OptionalMapping(input) {
  return input.length > 0;
}
function PropertyMapping(input) {
  const [isReadonly, key, isOptional, _colon, type] = input;
  return {
    [key]: isReadonly && isOptional ? AddReadonlyDeferred(AddOptionalDeferred(type)) : isReadonly && !isOptional ? AddReadonlyDeferred(type) : !isReadonly && isOptional ? AddOptionalDeferred(type) : type
  };
}
function PropertyDelimiterMapping(input) {
  return input;
}
function PropertyListMapping(input) {
  return Delimited(input);
}
function PropertiesReduce(propertyList) {
  return propertyList.reduce((result, left) => {
    const isPatternProperties = guard_exports.HasPropertyKey(left, IntegerKey) || guard_exports.HasPropertyKey(left, NumberKey) || guard_exports.HasPropertyKey(left, StringKey);
    return isPatternProperties ? [result[0], memory_exports.Assign(result[1], left)] : [memory_exports.Assign(result[0], left), result[1]];
  }, [{}, {}]);
}
function PropertiesMapping(input) {
  return PropertiesReduce(input[1]);
}
function _Object_Mapping(input) {
  const [properties, patternProperties] = input;
  const options2 = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return _Object_(properties, options2);
}
function ElementNamedMapping(input) {
  return guard_exports.IsEqual(input.length, 5) ? AddReadonlyDeferred(AddOptionalDeferred(input[4])) : guard_exports.IsEqual(input.length, 3) ? input[2] : guard_exports.IsEqual(input.length, 4) ? guard_exports.IsEqual(input[2], "readonly") ? AddReadonlyDeferred(input[3]) : AddOptionalDeferred(input[3]) : Unreachable2();
}
function ElementBaseMapping(input) {
  if (!guard_exports.IsArray(input) || !guard_exports.IsEqual(input.length, 3))
    return input;
  const [isReadonly, type, isOptional] = input;
  return isReadonly && isOptional ? AddReadonlyDeferred(AddOptionalDeferred(type)) : isReadonly && !isOptional ? AddReadonlyDeferred(type) : !isReadonly && isOptional ? AddOptionalDeferred(type) : type;
}
function ElementMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
}
function ElementListMapping(input) {
  return Delimited(input);
}
function _Tuple_Mapping(input) {
  return Tuple(input[1]);
}
function ParameterReadonlyOptionalMapping(input) {
  return AddReadonlyDeferred(AddOptionalDeferred(input[4]));
}
function ParameterReadonlyMapping(input) {
  return AddReadonlyDeferred(input[3]);
}
function ParameterOptionalMapping(input) {
  return AddOptionalDeferred(input[3]);
}
function ParameterTypeMapping(input) {
  return input[2];
}
function ParameterBaseMapping(input) {
  return input;
}
function ParameterMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
}
function ParameterListMapping(input) {
  return Delimited(input);
}
function _Function_Mapping(input) {
  return _Function_(input[1], input[4]);
}
function _Constructor_Mapping(input) {
  return Constructor(input[2], input[5]);
}
function ApplyReadonly(state, type) {
  return guard_exports.IsEqual(state, "remove") ? RemoveReadonlyDeferred(type) : guard_exports.IsEqual(state, "add") ? AddReadonlyDeferred(type) : type;
}
function MappedReadonlyMapping(input) {
  return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
}
function ApplyOptional(state, type) {
  return guard_exports.IsEqual(state, "remove") ? RemoveOptionalDeferred(type) : guard_exports.IsEqual(state, "add") ? AddOptionalDeferred(type) : type;
}
function MappedOptionalMapping(input) {
  return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
}
function MappedAsMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? [input[1]] : [];
}
function _Mapped_Mapping(input) {
  return guard_exports.IsArray(input[6]) && guard_exports.IsEqual(input[6].length, 1) ? MappedDeferred(Identifier(input[3]), input[5], input[6][0], ApplyReadonly(input[1], ApplyOptional(input[8], input[10]))) : MappedDeferred(Identifier(input[3]), input[5], Ref(input[3]), ApplyReadonly(input[1], ApplyOptional(input[8], input[10])));
}
function ReferenceMapping(input) {
  return Ref(input);
}
function WithBigIntMapping(input) {
  return BigInt(input);
}
function WithNumberMapping(input) {
  return parseFloat(input);
}
function WithBooleanMapping(input) {
  return guard_exports.IsEqual(input, "true");
}
function WithStringMapping(input) {
  return input;
}
function WithNullMapping(input) {
  return null;
}
function WithUndefinedMapping(input) {
  return void 0;
}
function WithPropertyMapping(input) {
  return { [input[0]]: input[2] };
}
function WithPropertyListMapping(input) {
  return Delimited(input);
}
function WithObjectMappingReduce(propertyList) {
  return propertyList.reduce((result, left) => {
    return memory_exports.Assign(result, left);
  }, {});
}
function WithObjectMapping(input) {
  return WithObjectMappingReduce(input[1]);
}
function WithElementListMapping(input) {
  return Delimited(input);
}
function WithArrayMapping(input) {
  return input[1];
}
function WithValueMapping(input) {
  return input;
}
function PatternBigIntMapping(input) {
  return BigInt2();
}
function PatternStringMapping(input) {
  return String2();
}
function PatternNumberMapping(input) {
  return Number2();
}
function PatternIntegerMapping(input) {
  return Integer();
}
function PatternNeverMapping(input) {
  return Never();
}
function PatternTextMapping(input) {
  return Literal(input);
}
function PatternBaseMapping(input) {
  return input;
}
function PatternGroupMapping(input) {
  return Union(input[1]);
}
function PatternUnionMapping(input) {
  return input.length === 3 ? [...input[0], ...input[2]] : input.length === 1 ? [...input[0]] : [];
}
function PatternTermMapping(input) {
  return [input[0], ...input[1]];
}
function PatternBodyMapping(input) {
  return input;
}
function PatternMapping(input) {
  return input[1];
}
function InterfaceDeclarationHeritageListMapping(input) {
  return Delimited(input);
}
function InterfaceDeclarationHeritageMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
}
function InterfaceDeclarationGenericMapping(input) {
  const parameters = input[2];
  const heritage = input[3];
  const [properties, patternProperties] = input[4];
  const options2 = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return { [input[1]]: Generic(parameters, InterfaceDeferred(heritage, properties, options2)) };
}
function InterfaceDeclarationMapping(input) {
  const heritage = input[2];
  const [properties, patternProperties] = input[3];
  const options2 = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return { [input[1]]: InterfaceDeferred(heritage, properties, options2) };
}
function TypeAliasDeclarationGenericMapping(input) {
  return { [input[1]]: Generic(input[2], input[4]) };
}
function TypeAliasDeclarationMapping(input) {
  return { [input[1]]: input[3] };
}
function ExportKeywordMapping(input) {
  return null;
}
function ModuleDeclarationDelimiterMapping(input) {
  return input;
}
function ModuleDeclarationListMapping(input) {
  return Delimited(input);
}
function ModuleDeclarationMapping(input) {
  return input[1];
}
function ModuleMapping(input) {
  const [moduleDeclaration, moduleDeclarationList] = [input[0], input[1]];
  return ModuleDeferred(memory_exports.Assign(moduleDeclaration, PropertiesReduce(moduleDeclarationList)[0]));
}
function ScriptMapping(input) {
  return input;
}

// node_modules/typebox/build/type/script/token/internal/match.mjs
function IsMatch(value) {
  return IsEqual(value.length, 2);
}
function Match2(input, ok, fail) {
  return IsMatch(input) ? ok(input[0], input[1]) : fail();
}

// node_modules/typebox/build/type/script/token/internal/take.mjs
function TakeVariant(variant, input) {
  return IsEqual(input.indexOf(variant), 0) ? [variant, input.slice(variant.length)] : [];
}
function Take(variants, input) {
  for (let i = 0; i < variants.length; i++) {
    const result = TakeVariant(variants[i], input);
    if (IsMatch(result))
      return result;
  }
  return [];
}

// node_modules/typebox/build/type/script/token/internal/char.mjs
function Range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => String.fromCharCode(start + i));
}
var Alpha = [
  ...Range(97, 122),
  // Lowercase
  ...Range(65, 90)
  // Uppercase
];
var Zero = "0";
var NonZero = Range(49, 57);
var Digit = [Zero, ...NonZero];
var WhiteSpace = " ";
var NewLine = "\n";
var UnderScore = "_";
var Dot = ".";
var DollarSign = "$";
var Hyphen = "-";

// node_modules/typebox/build/type/script/token/internal/trim.mjs
var LineComment = "//";
var OpenComment = "/*";
var CloseComment = "*/";
function DiscardMultilineComment(input) {
  const index = input.indexOf(CloseComment);
  const result = IsEqual(index, -1) ? "" : input.slice(index + 2);
  return result;
}
function DiscardLineComment(input) {
  const index = input.indexOf(NewLine);
  const result = IsEqual(index, -1) ? "" : input.slice(index);
  return result;
}
function TrimStartUntilNewline(input) {
  return input.replace(/^[ \t\r\f\v]+/, "");
}
function TrimWhitespace(input) {
  const trimmed = TrimStartUntilNewline(input);
  return trimmed.startsWith(OpenComment) ? TrimWhitespace(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? TrimWhitespace(DiscardLineComment(trimmed.slice(2))) : trimmed;
}
function Trim(input) {
  const trimmed = input.trimStart();
  return trimmed.startsWith(OpenComment) ? Trim(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? Trim(DiscardLineComment(trimmed.slice(2))) : trimmed;
}

// node_modules/typebox/build/type/script/token/internal/optional.mjs
function Optional2(value, input) {
  return Match2(Take([value], input), (Optional4, Rest2) => [Optional4, Rest2], () => ["", input]);
}

// node_modules/typebox/build/type/script/token/internal/many.mjs
function IsDiscard(discard, input) {
  return discard.includes(input);
}
function Many(allowed, discard, input, result = "") {
  return Match2(Take(allowed, input), (Char, Rest2) => IsDiscard(discard, Char) ? Many(allowed, discard, Rest2, result) : Many(allowed, discard, Rest2, `${result}${Char}`), () => [result, input]);
}

// node_modules/typebox/build/type/script/token/unsigned_integer.mjs
function TakeNonZero(input) {
  return Take(NonZero, input);
}
var AllowedDigits = [...Digit, UnderScore];
function TakeDigits(input) {
  return Many(AllowedDigits, [UnderScore], input);
}
function TakeUnsignedInteger(input) {
  return Match2(Take([Zero], input), (Zero2, ZeroRest) => [Zero2, ZeroRest], () => Match2(
    TakeNonZero(input),
    (NonZero2, NonZeroRest) => Match2(TakeDigits(NonZeroRest), (Digits, DigitsRest) => [`${NonZero2}${Digits}`, DigitsRest], () => []),
    // fail: did not match Digits
    () => []
  ));
}
function UnsignedInteger(input) {
  return TakeUnsignedInteger(Trim(input));
}

// node_modules/typebox/build/type/script/token/integer.mjs
function TakeSign(input) {
  return Optional2(Hyphen, input);
}
function TakeSignedInteger(input) {
  return Match2(
    TakeSign(input),
    (Sign, SignRest) => Match2(UnsignedInteger(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
    // fail: did not match unsigned integer
    () => []
  );
}
function Integer2(input) {
  return TakeSignedInteger(Trim(input));
}

// node_modules/typebox/build/type/script/token/bigint.mjs
function TakeBigInt(input) {
  return Match2(
    Integer2(input),
    (Integer3, IntegerRest) => Match2(Take(["n"], IntegerRest), (_N, NRest) => [`${Integer3}`, NRest], () => []),
    // fail: did not match 'n'
    () => []
  );
}
function BigInt3(input) {
  return TakeBigInt(input);
}

// node_modules/typebox/build/type/script/token/const.mjs
function TakeConst(const_, input) {
  return Take([const_], input);
}
function Const(const_, input) {
  return IsEqual(const_, "") ? ["", input] : const_.startsWith(NewLine) ? TakeConst(const_, TrimWhitespace(input)) : const_.startsWith(WhiteSpace) ? TakeConst(const_, input) : TakeConst(const_, Trim(input));
}

// node_modules/typebox/build/type/script/token/ident.mjs
var Initial = [...Alpha, UnderScore, DollarSign];
function TakeInitial(input) {
  return Take(Initial, input);
}
var Remaining = [...Initial, ...Digit];
function TakeRemaining(input, result = "") {
  return Match2(Take(Remaining, input), (Remaining2, RemainingRest) => TakeRemaining(RemainingRest, `${result}${Remaining2}`), () => [result, input]);
}
function TakeIdent(input) {
  return Match2(
    TakeInitial(input),
    (Initial2, InitialRest) => Match2(TakeRemaining(InitialRest), (Remaining2, RemainingRest) => [`${Initial2}${Remaining2}`, RemainingRest], () => []),
    // fail: did not match Remaining
    () => []
  );
}
function Ident(input) {
  return TakeIdent(Trim(input));
}

// node_modules/typebox/build/type/script/token/unsigned_number.mjs
var AllowedDigits2 = [...Digit, UnderScore];
function IsLeadingDot(input) {
  return IsMatch(Take([Dot], input));
}
function TakeFractional(input) {
  return Match2(Many(AllowedDigits2, [UnderScore], input), (Digits, DigitsRest) => IsEqual(Digits, "") ? [] : [Digits, DigitsRest], () => []);
}
function LeadingDot(input) {
  return Match2(
    Take([Dot], input),
    (Dot2, DotRest) => Match2(TakeFractional(DotRest), (Fractional, FractionalRest) => [`0${Dot2}${Fractional}`, FractionalRest], () => []),
    // fail: did not match Fractional
    () => []
  );
}
function LeadingInteger(input) {
  return Match2(
    UnsignedInteger(input),
    (Integer3, IntegerRest) => Match2(
      Take([Dot], IntegerRest),
      (Dot2, DotRest) => Match2(TakeFractional(DotRest), (Fractional, FractionalRest) => [`${Integer3}${Dot2}${Fractional}`, FractionalRest], () => [`${Integer3}`, DotRest]),
      // fail: did not match Fractional, use Integer
      () => [`${Integer3}`, IntegerRest]
    ),
    // fail: did not match Dot, use Integer
    () => []
  );
}
function TakeUnsignedNumber(input) {
  return IsLeadingDot(input) ? LeadingDot(input) : LeadingInteger(input);
}
function UnsignedNumber(input) {
  return TakeUnsignedNumber(Trim(input));
}

// node_modules/typebox/build/type/script/token/number.mjs
function TakeSign2(input) {
  return Optional2(Hyphen, input);
}
function TakeSignedNumber(input) {
  return Match2(
    TakeSign2(input),
    (Sign, SignRest) => Match2(UnsignedNumber(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
    // fail: did not match unsigned integer
    () => []
  );
}
function Number3(input) {
  return TakeSignedNumber(Trim(input));
}

// node_modules/typebox/build/type/script/token/until.mjs
function TakeOne(input) {
  const result = IsEqual(input, "") ? [] : [input.slice(0, 1), input.slice(1)];
  return result;
}
function IsInputMatchSentinal(end, input) {
  return ShiftLeft(end, (left, right) => input.startsWith(left) ? true : IsInputMatchSentinal(right, input), () => false);
}
function Until(end, input, result = "") {
  return Match2(
    TakeOne(input),
    (One, Rest2) => IsInputMatchSentinal(end, input) ? [result, input] : Until(end, Rest2, `${result}${One}`),
    () => []
  );
}

// node_modules/typebox/build/type/script/token/span.mjs
function MultiLine(start, end, input) {
  return Match2(
    Take([start], input),
    (_, Rest2) => Match2(
      Until([end], Rest2),
      (Until2, UntilRest) => Match2(Take([end], UntilRest), (_2, Rest3) => [`${Until2}`, Rest3], () => []),
      // fail: did not match End
      () => []
    ),
    // fail: did not match Until
    () => []
  );
}
function SingleLine(start, end, input) {
  return Match2(
    Take([start], input),
    (_, Rest2) => Match2(
      Until([NewLine, end], Rest2),
      (Until2, UntilRest) => Match2(Take([end], UntilRest), (_2, EndRest) => [`${Until2}`, EndRest], () => []),
      // fail: did not match End
      () => []
    ),
    // fail: did not match Until
    () => []
  );
}
function Span(start, end, multiLine, input) {
  return multiLine ? MultiLine(start, end, Trim(input)) : SingleLine(start, end, Trim(input));
}

// node_modules/typebox/build/type/script/token/string.mjs
function TakeInitial2(quotes, input) {
  return Take(quotes, input);
}
function TakeSpan(quote, input) {
  return Span(quote, quote, false, input);
}
function TakeString(quotes, input) {
  return Match2(TakeInitial2(quotes, input), (Initial2, InitialRest) => TakeSpan(Initial2, `${Initial2}${InitialRest}`), () => []);
}
function String3(quotes, input) {
  return TakeString(quotes, Trim(input));
}

// node_modules/typebox/build/type/script/token/until_1.mjs
function Until_1(end, input) {
  return Match2(Until(end, input), (Until2, UntilRest) => IsEqual(Until2, "") ? [] : [Until2, UntilRest], () => []);
}

// node_modules/typebox/build/type/script/parser.mjs
var If = (result, left, right = () => []) => result.length === 2 ? left(result) : right();
var GenericParameterExtendsEquals = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("extends", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => If(Const("=", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [GenericParameterExtendsEqualsMapping(_0), input2]);
var GenericParameterExtends = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("extends", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterExtendsMapping(_0), input2]);
var GenericParameterEquals = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("=", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterEqualsMapping(_0), input2]);
var GenericParameterIdentifier = (input) => If(Ident(input), ([_0, input2]) => [GenericParameterIdentifierMapping(_0), input2]);
var GenericParameter = (input) => If(If(GenericParameterExtendsEquals(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterExtends(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterEquals(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterIdentifier(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [GenericParameterMapping(_0), input2]);
var GenericParameterList_0 = (input, result = []) => If(If(Const(",", input), ([_0, input2]) => If(GenericParameter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericParameterList_0(input2, [...result, _0]), () => [result, input]);
var GenericParameterList = (input) => If(If(If(GenericParameter(input), ([_0, input2]) => If(GenericParameterList_0(input2), ([_1, input3]) => If(If(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [GenericParameterListMapping(_0), input2]);
var GenericParameters = (input) => If(If(Const("<", input), ([_0, input2]) => If(GenericParameterList(input2), ([_1, input3]) => If(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParametersMapping(_0), input2]);
var GenericCallArgumentList_0 = (input, result = []) => If(If(Const(",", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericCallArgumentList_0(input2, [...result, _0]), () => [result, input]);
var GenericCallArgumentList = (input) => If(If(If(Type(input), ([_0, input2]) => If(GenericCallArgumentList_0(input2), ([_1, input3]) => If(If(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [GenericCallArgumentListMapping(_0), input2]);
var GenericCallArguments = (input) => If(If(Const("<", input), ([_0, input2]) => If(GenericCallArgumentList(input2), ([_1, input3]) => If(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericCallArgumentsMapping(_0), input2]);
var GenericCall = (input) => If(If(Ident(input), ([_0, input2]) => If(GenericCallArguments(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericCallMapping(_0), input2]);
var OptionalSemiColon = (input) => If(If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalSemiColonMapping(_0), input2]);
var KeywordString = (input) => If(Const("string", input), ([_0, input2]) => [KeywordStringMapping(_0), input2]);
var KeywordNumber = (input) => If(Const("number", input), ([_0, input2]) => [KeywordNumberMapping(_0), input2]);
var KeywordBoolean = (input) => If(Const("boolean", input), ([_0, input2]) => [KeywordBooleanMapping(_0), input2]);
var KeywordUndefined = (input) => If(Const("undefined", input), ([_0, input2]) => [KeywordUndefinedMapping(_0), input2]);
var KeywordNull = (input) => If(Const("null", input), ([_0, input2]) => [KeywordNullMapping(_0), input2]);
var KeywordInteger = (input) => If(Const("integer", input), ([_0, input2]) => [KeywordIntegerMapping(_0), input2]);
var KeywordBigInt = (input) => If(Const("bigint", input), ([_0, input2]) => [KeywordBigIntMapping(_0), input2]);
var KeywordUnknown = (input) => If(Const("unknown", input), ([_0, input2]) => [KeywordUnknownMapping(_0), input2]);
var KeywordAny = (input) => If(Const("any", input), ([_0, input2]) => [KeywordAnyMapping(_0), input2]);
var KeywordObject = (input) => If(Const("object", input), ([_0, input2]) => [KeywordObjectMapping(_0), input2]);
var KeywordNever = (input) => If(Const("never", input), ([_0, input2]) => [KeywordNeverMapping(_0), input2]);
var KeywordSymbol = (input) => If(Const("symbol", input), ([_0, input2]) => [KeywordSymbolMapping(_0), input2]);
var KeywordVoid = (input) => If(Const("void", input), ([_0, input2]) => [KeywordVoidMapping(_0), input2]);
var KeywordThis = (input) => If(Const("this", input), ([_0, input2]) => [KeywordThisMapping(_0), input2]);
var TemplateInterpolate = (input) => If(If(Const("${", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateInterpolateMapping(_0), input2]);
var TemplateSpan = (input) => If(Until(["${", "`"], input), ([_0, input2]) => [TemplateSpanMapping(_0), input2]);
var TemplateBody = (input) => If(If(If(TemplateSpan(input), ([_0, input2]) => If(TemplateInterpolate(input2), ([_1, input3]) => If(TemplateBody(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [TemplateBodyMapping(_0), input2]);
var TemplateLiteralTypes = (input) => If(If(Const("`", input), ([_0, input2]) => If(TemplateBody(input2), ([_1, input3]) => If(Const("`", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateLiteralTypesMapping(_0), input2]);
var TemplateLiteral = (input) => If(TemplateLiteralTypes(input), ([_0, input2]) => [TemplateLiteralMapping(_0), input2]);
var Dependent2 = (input) => If(If(If(Const("if", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("then", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => If(Const("else", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If(If(Const("if", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("then", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [DependentMapping(_0), input2]);
var LiteralBigInt = (input) => If(BigInt3(input), ([_0, input2]) => [LiteralBigIntMapping(_0), input2]);
var LiteralBoolean = (input) => If(If(Const("true", input), ([_0, input2]) => [_0, input2], () => If(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [LiteralBooleanMapping(_0), input2]);
var LiteralNumber = (input) => If(Number3(input), ([_0, input2]) => [LiteralNumberMapping(_0), input2]);
var LiteralString = (input) => If(String3(["'", '"'], input), ([_0, input2]) => [LiteralStringMapping(_0), input2]);
var KeyOf = (input) => If(If(If(Const("keyof", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [KeyOfMapping(_0), input2]);
var IndexArray_0 = (input, result = []) => If(If(If(Const("[", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(Const("[", input), ([_0, input2]) => If(Const("]", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => IndexArray_0(input2, [...result, _0]), () => [result, input]);
var IndexArray = (input) => If(IndexArray_0(input), ([_0, input2]) => [IndexArrayMapping(_0), input2]);
var Extends2 = (input) => If(If(If(Const("extends", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("?", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => If(Const(":", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExtendsMapping(_0), input2]);
var Base = (input) => If(If(If(Const("(", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(KeywordString(input), ([_0, input2]) => [_0, input2], () => If(KeywordNumber(input), ([_0, input2]) => [_0, input2], () => If(KeywordBoolean(input), ([_0, input2]) => [_0, input2], () => If(KeywordUndefined(input), ([_0, input2]) => [_0, input2], () => If(KeywordNull(input), ([_0, input2]) => [_0, input2], () => If(KeywordInteger(input), ([_0, input2]) => [_0, input2], () => If(KeywordBigInt(input), ([_0, input2]) => [_0, input2], () => If(KeywordUnknown(input), ([_0, input2]) => [_0, input2], () => If(KeywordAny(input), ([_0, input2]) => [_0, input2], () => If(KeywordObject(input), ([_0, input2]) => [_0, input2], () => If(KeywordNever(input), ([_0, input2]) => [_0, input2], () => If(KeywordSymbol(input), ([_0, input2]) => [_0, input2], () => If(KeywordVoid(input), ([_0, input2]) => [_0, input2], () => If(KeywordThis(input), ([_0, input2]) => [_0, input2], () => If(LiteralBigInt(input), ([_0, input2]) => [_0, input2], () => If(LiteralBoolean(input), ([_0, input2]) => [_0, input2], () => If(LiteralNumber(input), ([_0, input2]) => [_0, input2], () => If(LiteralString(input), ([_0, input2]) => [_0, input2], () => If(TemplateLiteral(input), ([_0, input2]) => [_0, input2], () => If(Dependent2(input), ([_0, input2]) => [_0, input2], () => If(_Object_2(input), ([_0, input2]) => [_0, input2], () => If(_Tuple_(input), ([_0, input2]) => [_0, input2], () => If(_Constructor_(input), ([_0, input2]) => [_0, input2], () => If(_Function_2(input), ([_0, input2]) => [_0, input2], () => If(_Mapped_(input), ([_0, input2]) => [_0, input2], () => If(GenericCall(input), ([_0, input2]) => [_0, input2], () => If(Reference(input), ([_0, input2]) => [_0, input2], () => [])))))))))))))))))))))))))))), ([_0, input2]) => [BaseMapping(_0), input2]);
var With = (input) => If(If(If(Const("with", input), ([_0, input2]) => If(WithObject(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithMapping(_0), input2]);
var Factor = (input) => If(If(KeyOf(input), ([_0, input2]) => If(Base(input2), ([_1, input3]) => If(IndexArray(input3), ([_2, input4]) => If(Extends2(input4), ([_3, input5]) => If(With(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [FactorMapping(_0), input2]);
var ExprTermTail = (input) => If(If(If(Const("&", input), ([_0, input2]) => If(Factor(input2), ([_1, input3]) => If(ExprTermTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTermTailMapping(_0), input2]);
var ExprTerm = (input) => If(If(Factor(input), ([_0, input2]) => If(ExprTermTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprTermMapping(_0), input2]);
var ExprTail = (input) => If(If(If(Const("|", input), ([_0, input2]) => If(ExprTerm(input2), ([_1, input3]) => If(ExprTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTailMapping(_0), input2]);
var Expr = (input) => If(If(ExprTerm(input), ([_0, input2]) => If(ExprTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprMapping(_0), input2]);
var ExprReadonly = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprReadonlyMapping(_0), input2]);
var ExprPipe = (input) => If(If(Const("|", input), ([_0, input2]) => If(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprPipeMapping(_0), input2]);
var GenericType = (input) => If(If(GenericParameters(input), ([_0, input2]) => If(Const("=", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericTypeMapping(_0), input2]);
var InferType = (input) => If(If(If(Const("infer", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const("extends", input3), ([_2, input4]) => If(Expr(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Const("infer", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InferTypeMapping(_0), input2]);
var Type = (input) => If(If(InferType(input), ([_0, input2]) => [_0, input2], () => If(ExprPipe(input), ([_0, input2]) => [_0, input2], () => If(ExprReadonly(input), ([_0, input2]) => [_0, input2], () => If(Expr(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [TypeMapping(_0), input2]);
var PropertyKeyNumber = (input) => If(Number3(input), ([_0, input2]) => [PropertyKeyNumberMapping(_0), input2]);
var PropertyKeyIdent = (input) => If(Ident(input), ([_0, input2]) => [PropertyKeyIdentMapping(_0), input2]);
var PropertyKeyQuoted = (input) => If(String3(["'", '"'], input), ([_0, input2]) => [PropertyKeyQuotedMapping(_0), input2]);
var PropertyKeyIndex = (input) => If(If(Const("[", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(If(KeywordInteger(input4), ([_02, input5]) => [_02, input5], () => If(KeywordNumber(input4), ([_02, input5]) => [_02, input5], () => If(KeywordString(input4), ([_02, input5]) => [_02, input5], () => If(KeywordSymbol(input4), ([_02, input5]) => [_02, input5], () => [])))), ([_3, input5]) => If(Const("]", input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyKeyIndexMapping(_0), input2]);
var PropertyKey = (input) => If(If(PropertyKeyNumber(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyIdent(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyQuoted(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyIndex(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [PropertyKeyMapping(_0), input2]);
var Readonly2 = (input) => If(If(If(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ReadonlyMapping(_0), input2]);
var Optional3 = (input) => If(If(If(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalMapping(_0), input2]);
var Property = (input) => If(If(Readonly2(input), ([_0, input2]) => If(PropertyKey(input2), ([_1, input3]) => If(Optional3(input3), ([_2, input4]) => If(Const(":", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyMapping(_0), input2]);
var PropertyDelimiter = (input) => If(If(If(Const(",", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(",", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))))), ([_0, input2]) => [PropertyDelimiterMapping(_0), input2]);
var PropertyList_0 = (input, result = []) => If(If(PropertyDelimiter(input), ([_0, input2]) => If(Property(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => PropertyList_0(input2, [...result, _0]), () => [result, input]);
var PropertyList = (input) => If(If(If(Property(input), ([_0, input2]) => If(PropertyList_0(input2), ([_1, input3]) => If(If(PropertyDelimiter(input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [PropertyListMapping(_0), input2]);
var Properties = (input) => If(If(Const("{", input), ([_0, input2]) => If(PropertyList(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PropertiesMapping(_0), input2]);
var _Object_2 = (input) => If(Properties(input), ([_0, input2]) => [_Object_Mapping(_0), input2]);
var ElementNamed = (input) => If(If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Const("readonly", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Const("readonly", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ElementNamedMapping(_0), input2]);
var ElementBase = (input) => If(If(ElementNamed(input), ([_0, input2]) => [_0, input2], () => If(If(Readonly2(input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Optional3(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ElementBaseMapping(_0), input2]);
var Element = (input) => If(If(If(Const("...", input), ([_0, input2]) => If(ElementBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(ElementBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ElementMapping(_0), input2]);
var ElementList_0 = (input, result = []) => If(If(Const(",", input), ([_0, input2]) => If(Element(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ElementList_0(input2, [...result, _0]), () => [result, input]);
var ElementList = (input) => If(If(If(Element(input), ([_0, input2]) => If(ElementList_0(input2), ([_1, input3]) => If(If(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ElementListMapping(_0), input2]);
var _Tuple_ = (input) => If(If(Const("[", input), ([_0, input2]) => If(ElementList(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_Tuple_Mapping(_0), input2]);
var ParameterReadonlyOptional = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Const("readonly", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [ParameterReadonlyOptionalMapping(_0), input2]);
var ParameterReadonly = (input) => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Const("readonly", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterReadonlyMapping(_0), input2]);
var ParameterOptional = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterOptionalMapping(_0), input2]);
var ParameterType = (input) => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ParameterTypeMapping(_0), input2]);
var ParameterBase = (input) => If(If(ParameterReadonlyOptional(input), ([_0, input2]) => [_0, input2], () => If(ParameterReadonly(input), ([_0, input2]) => [_0, input2], () => If(ParameterOptional(input), ([_0, input2]) => [_0, input2], () => If(ParameterType(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ParameterBaseMapping(_0), input2]);
var Parameter2 = (input) => If(If(If(Const("...", input), ([_0, input2]) => If(ParameterBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(ParameterBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ParameterMapping(_0), input2]);
var ParameterList_0 = (input, result = []) => If(If(Const(",", input), ([_0, input2]) => If(Parameter2(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ParameterList_0(input2, [...result, _0]), () => [result, input]);
var ParameterList = (input) => If(If(If(Parameter2(input), ([_0, input2]) => If(ParameterList_0(input2), ([_1, input3]) => If(If(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ParameterListMapping(_0), input2]);
var _Function_2 = (input) => If(If(Const("(", input), ([_0, input2]) => If(ParameterList(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => If(Const("=>", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_Function_Mapping(_0), input2]);
var _Constructor_ = (input) => If(If(Const("new", input), ([_0, input2]) => If(Const("(", input2), ([_1, input3]) => If(ParameterList(input3), ([_2, input4]) => If(Const(")", input4), ([_3, input5]) => If(Const("=>", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_Constructor_Mapping(_0), input2]);
var MappedReadonly = (input) => If(If(If(Const("+", input), ([_0, input2]) => If(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("-", input), ([_0, input2]) => If(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedReadonlyMapping(_0), input2]);
var MappedOptional = (input) => If(If(If(Const("+", input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("-", input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedOptionalMapping(_0), input2]);
var MappedAs = (input) => If(If(If(Const("as", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [MappedAsMapping(_0), input2]);
var _Mapped_ = (input) => If(If(Const("{", input), ([_0, input2]) => If(MappedReadonly(input2), ([_1, input3]) => If(Const("[", input3), ([_2, input4]) => If(Ident(input4), ([_3, input5]) => If(Const("in", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => If(MappedAs(input7), ([_6, input8]) => If(Const("]", input8), ([_7, input9]) => If(MappedOptional(input9), ([_8, input10]) => If(Const(":", input10), ([_9, input11]) => If(Type(input11), ([_10, input12]) => If(OptionalSemiColon(input12), ([_11, input13]) => If(Const("}", input13), ([_12, input14]) => [[_0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12], input14]))))))))))))), ([_0, input2]) => [_Mapped_Mapping(_0), input2]);
var Reference = (input) => If(Ident(input), ([_0, input2]) => [ReferenceMapping(_0), input2]);
var WithBigInt = (input) => If(BigInt3(input), ([_0, input2]) => [WithBigIntMapping(_0), input2]);
var WithNumber = (input) => If(Number3(input), ([_0, input2]) => [WithNumberMapping(_0), input2]);
var WithBoolean = (input) => If(If(Const("true", input), ([_0, input2]) => [_0, input2], () => If(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithBooleanMapping(_0), input2]);
var WithString = (input) => If(String3(['"', "'"], input), ([_0, input2]) => [WithStringMapping(_0), input2]);
var WithNull = (input) => If(Const("null", input), ([_0, input2]) => [WithNullMapping(_0), input2]);
var WithUndefined = (input) => If(Const("undefined", input), ([_0, input2]) => [WithUndefinedMapping(_0), input2]);
var WithProperty = (input) => If(If(PropertyKey(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(WithValue(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithPropertyMapping(_0), input2]);
var WithPropertyList_0 = (input, result = []) => If(If(PropertyDelimiter(input), ([_0, input2]) => If(WithProperty(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithPropertyList_0(input2, [...result, _0]), () => [result, input]);
var WithPropertyList = (input) => If(If(If(WithProperty(input), ([_0, input2]) => If(WithPropertyList_0(input2), ([_1, input3]) => If(If(PropertyDelimiter(input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithPropertyListMapping(_0), input2]);
var WithObject = (input) => If(If(Const("{", input), ([_0, input2]) => If(WithPropertyList(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithObjectMapping(_0), input2]);
var WithElementList_0 = (input, result = []) => If(If(Const(",", input), ([_0, input2]) => If(WithValue(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithElementList_0(input2, [...result, _0]), () => [result, input]);
var WithElementList = (input) => If(If(If(WithValue(input), ([_0, input2]) => If(WithElementList_0(input2), ([_1, input3]) => If(If(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithElementListMapping(_0), input2]);
var WithArray = (input) => If(If(Const("[", input), ([_0, input2]) => If(WithElementList(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithArrayMapping(_0), input2]);
var WithValue = (input) => If(If(WithBigInt(input), ([_0, input2]) => [_0, input2], () => If(WithNumber(input), ([_0, input2]) => [_0, input2], () => If(WithBoolean(input), ([_0, input2]) => [_0, input2], () => If(WithString(input), ([_0, input2]) => [_0, input2], () => If(WithNull(input), ([_0, input2]) => [_0, input2], () => If(WithUndefined(input), ([_0, input2]) => [_0, input2], () => If(WithObject(input), ([_0, input2]) => [_0, input2], () => If(WithArray(input), ([_0, input2]) => [_0, input2], () => [])))))))), ([_0, input2]) => [WithValueMapping(_0), input2]);
var PatternBigInt = (input) => If(Const("-?(?:0|[1-9][0-9]*)n", input), ([_0, input2]) => [PatternBigIntMapping(_0), input2]);
var PatternString = (input) => If(Const(".*", input), ([_0, input2]) => [PatternStringMapping(_0), input2]);
var PatternNumber = (input) => If(Const("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", input), ([_0, input2]) => [PatternNumberMapping(_0), input2]);
var PatternInteger = (input) => If(Const("-?(?:0|[1-9][0-9]*)", input), ([_0, input2]) => [PatternIntegerMapping(_0), input2]);
var PatternNever = (input) => If(Const("(?!)", input), ([_0, input2]) => [PatternNeverMapping(_0), input2]);
var PatternText = (input) => If(Until_1(["-?(?:0|[1-9][0-9]*)n", ".*", "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", "-?(?:0|[1-9][0-9]*)", "(?!)", "(", ")", "$", "|"], input), ([_0, input2]) => [PatternTextMapping(_0), input2]);
var PatternBase = (input) => If(If(PatternBigInt(input), ([_0, input2]) => [_0, input2], () => If(PatternString(input), ([_0, input2]) => [_0, input2], () => If(PatternNumber(input), ([_0, input2]) => [_0, input2], () => If(PatternInteger(input), ([_0, input2]) => [_0, input2], () => If(PatternNever(input), ([_0, input2]) => [_0, input2], () => If(PatternGroup(input), ([_0, input2]) => [_0, input2], () => If(PatternText(input), ([_0, input2]) => [_0, input2], () => []))))))), ([_0, input2]) => [PatternBaseMapping(_0), input2]);
var PatternGroup = (input) => If(If(Const("(", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternGroupMapping(_0), input2]);
var PatternUnion = (input) => If(If(If(PatternTerm(input), ([_0, input2]) => If(Const("|", input2), ([_1, input3]) => If(PatternUnion(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(PatternTerm(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [PatternUnionMapping(_0), input2]);
var PatternTerm = (input) => If(If(PatternBase(input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [PatternTermMapping(_0), input2]);
var PatternBody = (input) => If(If(PatternUnion(input), ([_0, input2]) => [_0, input2], () => If(PatternTerm(input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [PatternBodyMapping(_0), input2]);
var Pattern = (input) => If(If(Const("^", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const("$", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternMapping(_0), input2]);
var InterfaceDeclarationHeritageList_0 = (input, result = []) => If(If(Const(",", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => InterfaceDeclarationHeritageList_0(input2, [...result, _0]), () => [result, input]);
var InterfaceDeclarationHeritageList = (input) => If(If(If(Type(input), ([_0, input2]) => If(InterfaceDeclarationHeritageList_0(input2), ([_1, input3]) => If(If(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InterfaceDeclarationHeritageListMapping(_0), input2]);
var InterfaceDeclarationHeritage = (input) => If(If(If(Const("extends", input), ([_0, input2]) => If(InterfaceDeclarationHeritageList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InterfaceDeclarationHeritageMapping(_0), input2]);
var InterfaceDeclarationGeneric = (input) => If(If(Const("interface", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(GenericParameters(input3), ([_2, input4]) => If(InterfaceDeclarationHeritage(input4), ([_3, input5]) => If(Properties(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [InterfaceDeclarationGenericMapping(_0), input2]);
var InterfaceDeclaration = (input) => If(If(Const("interface", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(InterfaceDeclarationHeritage(input3), ([_2, input4]) => If(Properties(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [InterfaceDeclarationMapping(_0), input2]);
var TypeAliasDeclarationGeneric = (input) => If(If(Const("type", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(GenericParameters(input3), ([_2, input4]) => If(Const("=", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [TypeAliasDeclarationGenericMapping(_0), input2]);
var TypeAliasDeclaration = (input) => If(If(Const("type", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const("=", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [TypeAliasDeclarationMapping(_0), input2]);
var ExportKeyword = (input) => If(If(If(Const("export", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExportKeywordMapping(_0), input2]);
var ModuleDeclarationDelimiter = (input) => If(If(If(Const(";", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ModuleDeclarationDelimiterMapping(_0), input2]);
var ModuleDeclarationList_0 = (input, result = []) => If(If(ModuleDeclarationDelimiter(input), ([_0, input2]) => If(ModuleDeclaration(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ModuleDeclarationList_0(input2, [...result, _0]), () => [result, input]);
var ModuleDeclarationList = (input) => If(If(If(ModuleDeclaration(input), ([_0, input2]) => If(ModuleDeclarationList_0(input2), ([_1, input3]) => If(If(ModuleDeclarationDelimiter(input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ModuleDeclarationListMapping(_0), input2]);
var ModuleDeclaration = (input) => If(If(ExportKeyword(input), ([_0, input2]) => If(If(InterfaceDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If(InterfaceDeclaration(input2), ([_02, input3]) => [_02, input3], () => If(TypeAliasDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If(TypeAliasDeclaration(input2), ([_02, input3]) => [_02, input3], () => [])))), ([_1, input3]) => If(OptionalSemiColon(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ModuleDeclarationMapping(_0), input2]);
var Module = (input) => If(If(ModuleDeclaration(input), ([_0, input2]) => If(ModuleDeclarationList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ModuleMapping(_0), input2]);
var Script = (input) => If(If(Module(input), ([_0, input2]) => [_0, input2], () => If(GenericType(input), ([_0, input2]) => [_0, input2], () => If(Type(input), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ScriptMapping(_0), input2]);

// node_modules/typebox/build/type/engine/patterns/template.mjs
function ParseTemplateIntoTypes(template) {
  const parsed = TemplateLiteralTypes(`\`${template}\``);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : Unreachable();
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/encode.mjs
function JoinString(input) {
  return input.join("|");
}
function UnwrapTemplateLiteralPattern(pattern) {
  return pattern.slice(1, pattern.length - 1);
}
function EncodeLiteral(value, right, pattern) {
  return EncodeTypes(right, `${pattern}${value}`);
}
function EncodeBigInt(right, pattern) {
  return EncodeTypes(right, `${pattern}${BigIntPattern}`);
}
function EncodeInteger(right, pattern) {
  return EncodeTypes(right, `${pattern}${IntegerPattern}`);
}
function EncodeNumber(right, pattern) {
  return EncodeTypes(right, `${pattern}${NumberPattern}`);
}
function EncodeBoolean(right, pattern) {
  return EncodeType(Union([Literal("false"), Literal("true")]), right, pattern);
}
function EncodeString(right, pattern) {
  return EncodeTypes(right, `${pattern}${StringPattern}`);
}
function EncodeTemplateLiteral(templatePattern, right, pattern) {
  return EncodeTypes(right, `${pattern}${UnwrapTemplateLiteralPattern(templatePattern)}`);
}
function EncodeTemplateLiteralDeferred(types, right, pattern) {
  const templateLiteral = TemplateLiteralAction(types, {});
  const result = EncodeType(templateLiteral, right, pattern);
  return result;
}
function EncodeEnum(values, right, pattern) {
  const evaluated = EvaluateEnum(values);
  return EncodeType(evaluated, right, pattern);
}
function EncodeUnion(types, right, pattern, result = []) {
  return guard_exports.ShiftLeft(types, (head, tail) => EncodeUnion(tail, right, pattern, [...result, EncodeType(head, [], "")]), () => EncodeTypes(right, `${pattern}(${JoinString(result)})`));
}
function EncodeType(type, right, pattern) {
  return IsEnum(type) ? EncodeEnum(type.enum, right, pattern) : IsInteger2(type) ? EncodeInteger(right, pattern) : IsLiteral(type) ? EncodeLiteral(type.const, right, pattern) : IsBigInt2(type) ? EncodeBigInt(right, pattern) : IsBoolean3(type) ? EncodeBoolean(right, pattern) : IsNumber3(type) ? EncodeNumber(right, pattern) : IsString3(type) ? EncodeString(right, pattern) : IsTemplateLiteral(type) ? EncodeTemplateLiteral(type.pattern, right, pattern) : IsTemplateLiteralDeferred(type) ? EncodeTemplateLiteralDeferred(type.parameters[0], right, pattern) : IsUnion(type) ? EncodeUnion(type.anyOf, right, pattern) : NeverPattern;
}
function EncodeTypes(types, pattern) {
  return guard_exports.ShiftLeft(types, (left, right) => EncodeType(left, right, pattern), () => pattern);
}
function EncodePattern(types) {
  const encoded = EncodeTypes(types, "");
  const result = `^${encoded}$`;
  return result;
}
function TemplateLiteralEncode(types) {
  const pattern = EncodePattern(types);
  const result = TemplateLiteralCreate(pattern);
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/instantiate.mjs
function TemplateLiteralAction(types, options2) {
  const result = CanInstantiate(types) ? memory_exports.Update(TemplateLiteralEncode(types), {}, options2) : TemplateLiteralDeferred(types, options2);
  return result;
}
function TemplateLiteralInstantiate(context, state, types, options2) {
  const instantiatedTypes = InstantiateTypes(context, state, types);
  return TemplateLiteralAction(instantiatedTypes, options2);
}

// node_modules/typebox/build/type/types/template_literal.mjs
function TemplateLiteralDeferred(types, options2 = {}) {
  return Deferred("TemplateLiteral", [types], options2);
}
function IsTemplateLiteralDeferred(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "TemplateLiteral");
}
function TemplateLiteralFromTypes(types) {
  return TemplateLiteralAction(types, {});
}
function TemplateLiteralFromString(template) {
  const types = ParseTemplateIntoTypes(template);
  return TemplateLiteralFromTypes(types);
}
function TemplateLiteral2(input, options2 = {}) {
  const type = guard_exports.IsString(input) ? TemplateLiteralFromString(input) : TemplateLiteralFromTypes(input);
  return memory_exports.Update(type, {}, options2);
}
function IsTemplateLiteral(value) {
  return IsKind(value, "TemplateLiteral");
}

// node_modules/typebox/build/type/extends/result.mjs
var result_exports = {};
__export(result_exports, {
  ExtendsFalse: () => ExtendsFalse,
  ExtendsTrue: () => ExtendsTrue,
  ExtendsUnion: () => ExtendsUnion,
  IsExtendsFalse: () => IsExtendsFalse,
  IsExtendsTrue: () => IsExtendsTrue,
  IsExtendsTrueLike: () => IsExtendsTrueLike,
  IsExtendsUnion: () => IsExtendsUnion,
  Match: () => Match3
});
function ExtendsUnion(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsUnion" }, { inferred });
}
function IsExtendsUnion(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsUnion") && guard_exports.IsObject(value.inferred);
}
function ExtendsTrue(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsTrue" }, { inferred });
}
function IsExtendsTrue(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsTrue") && guard_exports.IsObject(value.inferred);
}
function ExtendsFalse() {
  return memory_exports.Create({ ["~kind"]: "ExtendsFalse" }, {});
}
function IsExtendsFalse(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], "ExtendsFalse");
}
function IsExtendsTrueLike(value) {
  return IsExtendsUnion(value) || IsExtendsTrue(value);
}
function Match3(result, true_, false_) {
  return IsExtendsTrueLike(result) ? true_(result.inferred) : false_();
}

// node_modules/typebox/build/type/extends/extends_right.mjs
function ExtendsRightInfer(inferred, name, left, right) {
  return Match3(ExtendsLeft(inferred, left, right), (checkInferred) => ExtendsTrue(memory_exports.Assign(memory_exports.Assign(inferred, checkInferred), { [name]: left })), () => ExtendsFalse());
}
function ExtendsRightAny(inferred, _left) {
  return ExtendsTrue(inferred);
}
function ExtendsRightDependent(inferred, left, if_, then_, else_) {
  return Match3(ExtendsLeft(inferred, left, if_), (inferred2) => Match3(ExtendsLeft(inferred2, left, then_), (inferred3) => ExtendsTrue(inferred3), () => ExtendsFalse()), () => Match3(ExtendsLeft(inferred, left, else_), (inferred2) => ExtendsTrue(inferred2), () => ExtendsFalse()));
}
function ExtendsRightEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightIntersect(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match3(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsRightIntersect(inferred2, left, tail), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsRightTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightUnion(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match3(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsRightUnion(inferred, left, tail)), () => ExtendsFalse());
}
function ExtendsRight(inferred, left, right) {
  return IsAny(right) ? ExtendsRightAny(inferred, left) : IsDependent(right) ? ExtendsRightDependent(inferred, left, right.if, right.then, right.else) : IsEnum(right) ? ExtendsRightEnum(inferred, left, right.enum) : IsInfer(right) ? ExtendsRightInfer(inferred, right.name, left, right.extends) : IsIntersect(right) ? ExtendsRightIntersect(inferred, left, right.allOf) : IsTemplateLiteral(right) ? ExtendsRightTemplateLiteral(inferred, left, right.pattern) : IsUnion(right) ? ExtendsRightUnion(inferred, left, right.anyOf) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/any.mjs
function ExtendsAny(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsUnion(inferred);
}

// node_modules/typebox/build/type/extends/array.mjs
function ExtendsImmutable(left, right) {
  const isImmutableLeft = IsImmutable(left);
  const isImmutableRight = IsImmutable(right);
  return isImmutableLeft && isImmutableRight ? true : !isImmutableLeft && isImmutableRight ? true : isImmutableLeft && !isImmutableRight ? false : true;
}
function ExtendsArray(inferred, arrayLeft, left, right) {
  return IsArray2(right) ? ExtendsImmutable(arrayLeft, right) ? ExtendsLeft(inferred, left, right.items) : ExtendsFalse() : ExtendsRight(inferred, arrayLeft, right);
}

// node_modules/typebox/build/type/extends/bigint.mjs
function ExtendsBigInt(inferred, left, right) {
  return IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/boolean.mjs
function ExtendsBoolean(inferred, left, right) {
  return IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/parameters.mjs
function ParameterCompare(inferred, left, leftRest, right, rightRest) {
  const checkLeft = IsInfer(right) ? left : right;
  const checkRight = IsInfer(right) ? right : left;
  const isLeftOptional = IsOptional(left);
  const isRightOptional = IsOptional(right);
  return !isLeftOptional && isRightOptional ? ExtendsFalse() : Match3(ExtendsLeft(inferred, checkLeft, checkRight), (inferred2) => ExtendsParameters(inferred2, leftRest, rightRest), () => ExtendsFalse());
}
function ParameterRight(inferred, left, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ParameterCompare(inferred, left, leftRest, head, tail), () => IsOptional(left) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function ParametersLeft(inferred, left, rightRest) {
  return guard_exports.ShiftLeft(left, (head, tail) => ParameterRight(inferred, head, tail, rightRest), () => ExtendsTrue(inferred));
}
function ExtendsParameters(inferred, left, right) {
  return ParametersLeft(inferred, left, right);
}

// node_modules/typebox/build/type/extends/return_type.mjs
function ExtendsReturnType(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsLeft(inferred, left, right);
}

// node_modules/typebox/build/type/extends/constructor.mjs
function ExtendsConstructor(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsConstructor2(right) ? Match3(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["instanceType"]), () => ExtendsFalse()) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/dependent.mjs
function ExtendsDependent(inferred, if_, then_, else_, right) {
  return Match3(ExtendsLeft(inferred, if_, right), () => ExtendsLeft(inferred, then_, right), () => ExtendsLeft(inferred, else_, right));
}

// node_modules/typebox/build/type/extends/enum.mjs
function ExtendsEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/typebox/build/type/extends/function.mjs
function ExtendsFunction(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsFunction2(right) ? Match3(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["returnType"]), () => ExtendsFalse()) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/integer.mjs
function ExtendsInteger(inferred, left, right) {
  return IsInteger2(right) ? ExtendsTrue(inferred) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/intersect.mjs
function ExtendsIntersect(inferred, left, right) {
  const evaluated = EvaluateIntersect(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/typebox/build/type/extends/literal.mjs
function ExtendsLiteralValue(inferred, left, right) {
  return left === right ? ExtendsTrue(inferred) : ExtendsFalse();
}
function ExtendsLiteralBigInt(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralBoolean(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralNumber(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralString(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteral(inferred, left, right) {
  return guard_exports.IsBigInt(left.const) ? ExtendsLiteralBigInt(inferred, left.const, right) : guard_exports.IsBoolean(left.const) ? ExtendsLiteralBoolean(inferred, left.const, right) : guard_exports.IsNumber(left.const) ? ExtendsLiteralNumber(inferred, left.const, right) : guard_exports.IsString(left.const) ? ExtendsLiteralString(inferred, left.const, right) : Unreachable();
}

// node_modules/typebox/build/type/extends/never.mjs
function ExtendsNever(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : ExtendsTrue(inferred);
}

// node_modules/typebox/build/type/extends/null.mjs
function ExtendsNull(inferred, left, right) {
  return IsNull2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/number.mjs
function ExtendsNumber(inferred, left, right) {
  return IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/object.mjs
function ExtendsPropertyOptional(inferred, left, right) {
  return IsOptional(left) ? IsOptional(right) ? ExtendsTrue(inferred) : ExtendsFalse() : ExtendsTrue(inferred);
}
function ExtendsProperty(inferred, left, right) {
  return (
    // Right TInfer<TNever> is TExtendsFalse
    IsInfer(right) && IsNever(right.extends) ? ExtendsFalse() : Match3(ExtendsLeft(inferred, left, right), (inferred2) => ExtendsPropertyOptional(inferred2, left, right), () => ExtendsFalse())
  );
}
function ExtractInferredProperties(keys, properties) {
  return keys.reduce((result, key) => {
    return key in properties ? IsExtendsTrueLike(properties[key]) ? { ...result, ...properties[key].inferred } : Unreachable() : Unreachable();
  }, {});
}
function ExtendsPropertiesComparer(inferred, left, right) {
  const properties = {};
  for (const rightKey of guard_exports.Keys(right)) {
    properties[rightKey] = rightKey in left ? ExtendsProperty({}, left[rightKey], right[rightKey]) : IsOptional(right[rightKey]) ? IsInfer(right[rightKey]) ? ExtendsTrue(memory_exports.Assign(inferred, { [right[rightKey].name]: right[rightKey].extends })) : ExtendsTrue(inferred) : ExtendsFalse();
  }
  const checked = guard_exports.Values(properties).every((result) => IsExtendsTrueLike(result));
  const extracted = checked ? ExtractInferredProperties(guard_exports.Keys(properties), properties) : {};
  return checked ? ExtendsTrue(extracted) : ExtendsFalse();
}
function ExtendsProperties(inferred, left, right) {
  const compared = ExtendsPropertiesComparer(inferred, left, right);
  return IsExtendsTrueLike(compared) ? ExtendsTrue(memory_exports.Assign(inferred, compared.inferred)) : ExtendsFalse();
}
function ExtendsObjectToObject(inferred, left, right) {
  return ExtendsProperties(inferred, left, right);
}
function RecordMergeInferred(left, right) {
  return guard_exports.Keys(right).reduce((result, key) => {
    return {
      ...result,
      [key]: guard_exports.HasPropertyKey(left, key) ? IsUnion(result[key]) ? Union([...result[key].anyOf, right[key]]) : Union([left[key], right[key]]) : right[key]
    };
  }, left);
}
function ExtendsRecordComparer(properties, keys, type, result) {
  return guard_exports.ShiftLeft(keys, (left, right) => Match3(ExtendsLeft({}, properties[left], type), (inferred) => ExtendsRecordComparer(properties, right, type, RecordMergeInferred(result, inferred)), () => ExtendsFalse()), () => ExtendsTrue(result));
}
function ExtendsObjectToRecord(inferred, properties, _pattern, value) {
  const keys = guard_exports.Keys(properties);
  const result = ExtendsRecordComparer(properties, keys, value, inferred);
  return result;
}
function ExtendsObject(inferred, left, right) {
  return IsRecord(right) ? ExtendsObjectToRecord(inferred, left, RecordPattern(right), RecordValue(right)) : IsObject2(right) ? ExtendsObjectToObject(inferred, left, right.properties) : ExtendsRight(inferred, _Object_(left), right);
}

// node_modules/typebox/build/type/extends/record.mjs
function FromObject2(inferred, properties) {
  return guard_exports.IsEqual(guard_exports.Keys(properties).length, 0) ? ExtendsTrue(inferred) : ExtendsFalse();
}
function FromRecord(inferred, _leftKey, leftValue, _rightKey, rightValue) {
  return ExtendsLeft(inferred, leftValue, rightValue);
}
function ExtendsRecord(inferred, leftPattern, leftValue, right) {
  return IsRecord(right) ? FromRecord(inferred, RecordPatternToType(leftPattern), leftValue, RecordPatternToType(RecordPattern(right)), RecordValue(right)) : IsObject2(right) ? FromObject2(inferred, right.properties) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/string.mjs
function ExtendsString(inferred, left, right) {
  return IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/symbol.mjs
function ExtendsSymbol(inferred, left, right) {
  return IsSymbol2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/template_literal.mjs
function ExtendsTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/typebox/build/type/extends/inference.mjs
function Inferrable(name, type) {
  return memory_exports.Create({ "~kind": "Inferrable" }, { name, type }, {});
}
function IsInferable(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "name") && guard_exports.HasPropertyKey(value, "type") && guard_exports.IsEqual(value["~kind"], "Inferrable") && guard_exports.IsString(value.name) && guard_exports.IsObject(value.type);
}
function TryRestInferable(type) {
  return IsRest(type) ? IsInfer(type.items) ? IsArray2(type.items.extends) ? Inferrable(type.items.name, type.items.extends.items) : IsUnknown(type.items.extends) ? Inferrable(type.items.name, type.items.extends) : void 0 : Unreachable() : void 0;
}
function TryInferable(type) {
  return IsInfer(type) ? Inferrable(type.name, type.extends) : void 0;
}
function TryInferResults(rest, right, result = []) {
  return guard_exports.ShiftLeft(rest, (head, tail) => Match3(ExtendsLeft({}, head, right), () => TryInferResults(tail, right, [...result, head]), () => void 0), () => result);
}
function InferTupleResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Tuple(results) })) : ExtendsFalse();
}
function InferUnionResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Union(results) })) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/tuple.mjs
function Reverse(types) {
  return [...types].reverse();
}
function ApplyReverse(types, reversed) {
  return reversed ? Reverse(types) : types;
}
function Reversed(types) {
  const first = types.length > 0 ? types[0] : void 0;
  const inferrable = IsSchema(first) ? TryRestInferable(first) : void 0;
  return IsSchema(inferrable);
}
function ElementsCompare(inferred, reversed, left, leftRest, right, rightRest) {
  return Match3(ExtendsLeft(inferred, left, right), (checkInferred) => Elements(checkInferred, reversed, leftRest, rightRest), () => ExtendsFalse());
}
function ElementsLeft(inferred, reversed, leftRest, right, rightRest) {
  const inferable = TryRestInferable(right);
  return (
    // Rest Inferrable Right Means we delegate to TInferTupleResult to Generate a Result
    IsInferable(inferable) ? InferTupleResult(inferred, inferable["name"], ApplyReverse(leftRest, reversed), inferable["type"]) : guard_exports.ShiftLeft(leftRest, (head, tail) => ElementsCompare(inferred, reversed, head, tail, right, rightRest), () => ExtendsFalse())
  );
}
function ElementsRight(inferred, reversed, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ElementsLeft(inferred, reversed, leftRest, head, tail), () => guard_exports.IsEqual(leftRest.length, 0) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function Elements(inferred, reversed, leftRest, rightRest) {
  return ElementsRight(inferred, reversed, leftRest, rightRest);
}
function ExtendsTupleToTuple(inferred, left, right) {
  const instantiatedRight = InstantiateElements(inferred, State([], []), right);
  const reversed = Reversed(instantiatedRight);
  return Elements(inferred, reversed, ApplyReverse(left, reversed), ApplyReverse(instantiatedRight, reversed));
}
function ExtendsTupleToArray(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable["name"], left, inferrable["type"]) : guard_exports.ShiftLeft(left, (head, tail) => Match3(ExtendsLeft(inferred, head, right), (inferred2) => ExtendsTupleToArray(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsTuple(inferred, left, right) {
  const instantiatedLeft = InstantiateElements(inferred, State([], []), left);
  return IsTuple(right) ? ExtendsTupleToTuple(inferred, instantiatedLeft, right.items) : IsArray2(right) ? ExtendsTupleToArray(inferred, instantiatedLeft, right.items) : ExtendsRight(inferred, Tuple(instantiatedLeft), right);
}

// node_modules/typebox/build/type/extends/undefined.mjs
function ExtendsUndefined(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : IsUndefined2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/union.mjs
function ExtendsUnionSome(inferred, type, unionTypes) {
  return guard_exports.ShiftLeft(unionTypes, (head, tail) => Match3(ExtendsLeft(inferred, type, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsUnionSome(inferred, type, tail)), () => ExtendsFalse());
}
function ExtendsUnionLeft(inferred, left, right) {
  return guard_exports.ShiftLeft(left, (head, tail) => Match3(ExtendsUnionSome(inferred, head, right), (inferred2) => ExtendsUnionLeft(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsUnion2(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable.name, left, inferrable.type) : IsUnion(right) ? ExtendsUnionLeft(inferred, left, right.anyOf) : ExtendsUnionLeft(inferred, left, [right]);
}

// node_modules/typebox/build/type/extends/unknown.mjs
function ExtendsUnknown(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/void.mjs
function ExtendsVoid(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/extends_left.mjs
function ExtendsLeft(inferred, left, right) {
  return IsAny(left) ? ExtendsAny(inferred, left, right) : IsArray2(left) ? ExtendsArray(inferred, left, left.items, right) : IsBigInt2(left) ? ExtendsBigInt(inferred, left, right) : IsBoolean3(left) ? ExtendsBoolean(inferred, left, right) : IsConstructor2(left) ? ExtendsConstructor(inferred, left.parameters, left.instanceType, right) : IsDependent(left) ? ExtendsDependent(inferred, left.if, left.then, left.else, right) : IsEnum(left) ? ExtendsEnum(inferred, left.enum, right) : IsFunction2(left) ? ExtendsFunction(inferred, left.parameters, left.returnType, right) : IsInteger2(left) ? ExtendsInteger(inferred, left, right) : IsIntersect(left) ? ExtendsIntersect(inferred, left.allOf, right) : IsLiteral(left) ? ExtendsLiteral(inferred, left, right) : IsNever(left) ? ExtendsNever(inferred, left, right) : IsNull2(left) ? ExtendsNull(inferred, left, right) : IsNumber3(left) ? ExtendsNumber(inferred, left, right) : IsObject2(left) ? ExtendsObject(inferred, left.properties, right) : IsRecord(left) ? ExtendsRecord(inferred, RecordPattern(left), RecordValue(left), right) : IsString3(left) ? ExtendsString(inferred, left, right) : IsSymbol2(left) ? ExtendsSymbol(inferred, left, right) : IsTemplateLiteral(left) ? ExtendsTemplateLiteral(inferred, left.pattern, right) : IsTuple(left) ? ExtendsTuple(inferred, left.items, right) : IsUndefined2(left) ? ExtendsUndefined(inferred, left, right) : IsUnion(left) ? ExtendsUnion2(inferred, left.anyOf, right) : IsUnknown(left) ? ExtendsUnknown(inferred, left, right) : IsVoid(left) ? ExtendsVoid(inferred, left, right) : ExtendsFalse();
}

// node_modules/typebox/build/type/engine/interface/instantiate.mjs
function InterfaceOperation(heritage, properties) {
  const result = EvaluateIntersect([...heritage, _Object_(properties)]);
  return result;
}
function InterfaceAction(heritage, properties, options2) {
  const result = CanInstantiate(heritage) ? memory_exports.Update(InterfaceOperation(heritage, properties), {}, options2) : InterfaceDeferred(heritage, properties, options2);
  return result;
}
function InterfaceInstantiate(context, state, heritage, properties, options2) {
  const instantiatedHeritage = InstantiateTypes(context, state, heritage);
  const instantiatedProperties = InstantiateProperties(context, state, properties);
  return InterfaceAction(instantiatedHeritage, instantiatedProperties, options2);
}

// node_modules/typebox/build/type/action/interface.mjs
function InterfaceDeferred(heritage, properties, options2 = {}) {
  return Deferred("Interface", [heritage, properties], options2);
}
function IsInterfaceDeferred(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "Interface");
}
function Interface(heritage, properties, options2 = {}) {
  return InterfaceAction(heritage, properties, options2);
}

// node_modules/typebox/build/type/engine/cyclic/check.mjs
function FromRef(stack, context, ref) {
  return stack.includes(ref) ? true : FromType3([...stack, ref], context, context[ref]);
}
function FromProperties(stack, context, properties) {
  const types = PropertyValues(properties);
  return FromTypes2(stack, context, types);
}
function FromTypes2(stack, context, types) {
  return guard_exports.ShiftLeft(types, (left, right) => FromType3(stack, context, left) ? true : FromTypes2(stack, context, right), () => false);
}
function FromType3(stack, context, type) {
  return IsRef(type) ? FromRef(stack, context, type.$ref) : IsArray2(type) ? FromType3(stack, context, type.items) : IsConstructor2(type) ? FromTypes2(stack, context, [...type.parameters, type.instanceType]) : IsFunction2(type) ? FromTypes2(stack, context, [...type.parameters, type.returnType]) : IsInterfaceDeferred(type) ? FromProperties(stack, context, type.parameters[1]) : IsIntersect(type) ? FromTypes2(stack, context, type.allOf) : IsObject2(type) ? FromProperties(stack, context, type.properties) : IsUnion(type) ? FromTypes2(stack, context, type.anyOf) : IsTuple(type) ? FromTypes2(stack, context, type.items) : IsRecord(type) ? FromType3(stack, context, RecordValue(type)) : false;
}
function CyclicCheck(stack, context, type) {
  const result = FromType3(stack, context, type);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/candidates.mjs
function ResolveCandidateKeys(context, keys) {
  return keys.reduce((result, left) => {
    return CyclicCheck([left], context, context[left]) ? [...result, left] : result;
  }, []);
}
function CyclicCandidates(context) {
  const keys = PropertyKeys(context);
  const result = ResolveCandidateKeys(context, keys);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/dependencies.mjs
function FromRef2(context, ref, result) {
  return result.includes(ref) ? result : ref in context ? FromType4(context, context[ref], [...result, ref]) : Unreachable();
}
function FromProperties2(context, properties, result) {
  const types = PropertyValues(properties);
  return FromTypes3(context, types, result);
}
function FromTypes3(context, types, result) {
  return types.reduce((result2, left) => {
    return FromType4(context, left, result2);
  }, result);
}
function FromType4(context, type, result) {
  return IsRef(type) ? FromRef2(context, type.$ref, result) : IsArray2(type) ? FromType4(context, type.items, result) : IsConstructor2(type) ? FromTypes3(context, [...type.parameters, type.instanceType], result) : IsFunction2(type) ? FromTypes3(context, [...type.parameters, type.returnType], result) : IsInterfaceDeferred(type) ? FromProperties2(context, type.parameters[1], result) : IsIntersect(type) ? FromTypes3(context, type.allOf, result) : IsObject2(type) ? FromProperties2(context, type.properties, result) : IsUnion(type) ? FromTypes3(context, type.anyOf, result) : IsTuple(type) ? FromTypes3(context, type.items, result) : IsRecord(type) ? FromType4(context, RecordValue(type), result) : result;
}
function CyclicDependencies(context, key, type) {
  const result = FromType4(context, type, [key]);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/extends.mjs
function FromRef3(_ref) {
  return Any();
}
function FromProperties3(properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: FromType5(properties[key]) };
  }, {});
}
function FromTypes4(types) {
  return types.reduce((result, left) => {
    return [...result, FromType5(left)];
  }, []);
}
function FromType5(type) {
  return IsRef(type) ? FromRef3(type.$ref) : IsArray2(type) ? _Array_(FromType5(type.items), ArrayOptions(type)) : IsConstructor2(type) ? Constructor(FromTypes4(type.parameters), FromType5(type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes4(type.parameters), FromType5(type.returnType)) : IsIntersect(type) ? Intersect(FromTypes4(type.allOf)) : IsObject2(type) ? _Object_(FromProperties3(type.properties)) : IsRecord(type) ? Record(RecordKey(type), FromType5(RecordValue(type))) : IsUnion(type) ? Union(FromTypes4(type.anyOf)) : IsTuple(type) ? Tuple(FromTypes4(type.items)) : type;
}
function CyclicAnyFromParameters(defs, ref) {
  return ref in defs ? FromType5(defs[ref]) : Unknown();
}
function CyclicExtends(type) {
  return CyclicAnyFromParameters(type.$defs, type.$ref);
}

// node_modules/typebox/build/type/engine/cyclic/instantiate.mjs
function CyclicInterface(context, heritage, properties) {
  const instantiatedHeritage = InstantiateTypes(context, State([], []), heritage);
  const instantiatedProperties = InstantiateProperties({}, State([], []), properties);
  const evaluatedInterface = EvaluateIntersect([...instantiatedHeritage, _Object_(instantiatedProperties)]);
  return evaluatedInterface;
}
function CyclicDefinitions(context, dependencies) {
  const keys = guard_exports.Keys(context).filter((key) => dependencies.includes(key));
  return keys.reduce((result, key) => {
    const type = context[key];
    const instantiatedType = IsInterfaceDeferred(type) ? CyclicInterface(context, type.parameters[0], type.parameters[1]) : type;
    return { ...result, [key]: instantiatedType };
  }, {});
}
function InstantiateCyclic(context, ref, type) {
  const dependencies = CyclicDependencies(context, ref, type);
  const definitions = CyclicDefinitions(context, dependencies);
  const result = Cyclic(definitions, ref);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/target.mjs
function Resolve(defs, ref) {
  return ref in defs ? IsRef(defs[ref]) ? Resolve(defs, defs[ref].$ref) : defs[ref] : Never();
}
function CyclicTarget(defs, ref) {
  const result = Resolve(defs, ref);
  return result;
}

// node_modules/typebox/build/type/extends/extends.mjs
function Canonical(type) {
  return IsCyclic(type) ? CyclicExtends(type) : IsUnsafe(type) ? Unknown() : type;
}
function Extends(inferred, left, right) {
  const canonicalLeft = Canonical(left);
  const canonicalRight = Canonical(right);
  return ExtendsLeft(inferred, canonicalLeft, canonicalRight);
}

// node_modules/typebox/build/type/engine/evaluate/compare.mjs
var CompareResultEqual = 0;
var CompareResultDisjoint = 1;
var CompareResultLeftInside = 2;
var CompareResultRightInside = 3;
function Compare(left, right) {
  const extendsCheck = [Extends({}, left, right), Extends({}, right, left)];
  return result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? CompareResultEqual : result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsFalse(extendsCheck[1]) ? CompareResultLeftInside : result_exports.IsExtendsFalse(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? CompareResultRightInside : CompareResultDisjoint;
}

// node_modules/typebox/build/type/engine/evaluate/broaden.mjs
function BroadenFilter(type, types, result = [], all = types) {
  return guard_exports.ShiftLeft(types, (left, right) => {
    const compare = Compare(type, left);
    return guard_exports.IsEqual(compare, CompareResultLeftInside) || guard_exports.IsEqual(compare, CompareResultEqual) ? all : guard_exports.IsEqual(compare, CompareResultDisjoint) ? BroadenFilter(type, right, [...result, left], all) : BroadenFilter(type, right, result, all);
  }, () => [...result, type]);
}
function BroadenType(type, types, result) {
  const evaluated = EvaluateType(type);
  return IsAny(evaluated) ? [evaluated] : (
    // terminate (always the most broad)
    IsUnknown(evaluated) ? [evaluated] : (
      // terminate (always the most broad)
      IsNever(evaluated) ? BroadenTypes(types, result) : (
        // ignored: never is dropped
        IsObject2(evaluated) ? BroadenTypes(types, [...result, evaluated]) : (
          // objects are always considered (too expensive to compare)
          BroadenTypes(types, BroadenFilter(evaluated, result))
        )
      )
    )
  );
}
function BroadenTypes(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => BroadenType(left, right, result), () => result);
}
function Broaden(types) {
  const broadened = BroadenTypes(types);
  const flattened = Flatten(broadened);
  return flattened;
}

// node_modules/typebox/build/type/engine/evaluate/instantiate.mjs
function EvaluateAction(type, options2) {
  const result = memory_exports.Update(EvaluateType(type), {}, options2);
  return result;
}
function EvaluateInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return EvaluateAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/engine/call/distribute_arguments.mjs
function CollectDistributionNames(expression, result = []) {
  return (
    // Conditional
    IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? IsRef(expression.parameters[0]) ? CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], [...result, expression.parameters[0]["$ref"]])) : CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], result)) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? IsDeferred(expression.parameters[1]) && guard_exports.IsEqual(expression.parameters[1].action, "KeyOf") && IsRef(expression.parameters[1].parameters[0]) ? [...result, expression.parameters[1].parameters[0]["$ref"]] : result : result
  );
}
function BuildDistributionArray(parameters, names) {
  return parameters.reduce((result, left) => [...result, names.includes(left.name)], []);
}
function ZipDistributionArray(arguments_, distributionArray, result = []) {
  return guard_exports.ShiftLeft(arguments_, (argumentLeft, argumentRight) => guard_exports.ShiftLeft(distributionArray, (booleanLeft, booleanRight) => ZipDistributionArray(argumentRight, booleanRight, [...result, [booleanLeft, argumentLeft]]), () => result), () => result);
}
function CanonicalArgument(type) {
  return IsTemplateLiteral(type) ? EvaluateTemplateLiteral(type.pattern) : IsEnum(type) ? EvaluateEnum(type.enum) : type;
}
function Expand(type) {
  const canonicalArgument = CanonicalArgument(type);
  return IsUnion(canonicalArgument) ? [...canonicalArgument.anyOf] : [canonicalArgument];
}
function Append(current, type) {
  return current.reduce((result, left) => [...result, [...left, type]], []);
}
function Cross(current, variants) {
  return variants.reduce((result, left) => {
    return [...result, ...Append(current, left)];
  }, []);
}
function Distribute2(zipped) {
  return zipped.reduce((result, left) => {
    return guard_exports.IsEqual(left[0], true) ? Cross(result, Expand(left[1])) : Cross(result, [left[1]]);
  }, [[]]);
}
function DistributeArguments(parameters, arguments_, expression) {
  const distributionNames = CollectDistributionNames(expression);
  const distributionArray = BuildDistributionArray(parameters, distributionNames);
  const zippedArguments = ZipDistributionArray(arguments_, distributionArray);
  return IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? Distribute2(zippedArguments) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? Distribute2(zippedArguments) : [arguments_];
}

// node_modules/typebox/build/type/engine/call/resolve_target.mjs
function FromNotResolvable() {
  return ["(not-resolvable)", Never()];
}
function FromNotGeneric() {
  return ["(not-generic)", Never()];
}
function FromGeneric(name, parameters, expression) {
  return [name, Generic(parameters, expression)];
}
function FromRef4(context, ref, arguments_) {
  return ref in context ? FromType6(context, ref, context[ref], arguments_) : FromNotResolvable();
}
function FromType6(context, name, target, arguments_) {
  return IsGeneric(target) ? FromGeneric(name, target.parameters, target.expression) : IsRef(target) ? FromRef4(context, target.$ref, arguments_) : FromNotGeneric();
}
function ResolveTarget(context, target, arguments_) {
  return FromType6(context, "(anonymous)", target, arguments_);
}

// node_modules/typebox/build/type/engine/call/resolve_arguments.mjs
function AssertArgumentExtends(name, type, extends_) {
  if (IsInfer(type) || IsCall(type) || result_exports.IsExtendsTrueLike(Extends({}, type, extends_)))
    return;
  const cause = { parameter: name, expect: extends_, actual: type };
  throw new Error(`Argument for parameter ${name} does not satisfy constraint`, { cause });
}
function BindArgument(context, state, name, extends_, type) {
  const instantiatedArgument = InstantiateType(context, state, type);
  AssertArgumentExtends(name, instantiatedArgument, extends_);
  return memory_exports.Assign(context, { [name]: instantiatedArgument });
}
function BindArguments(context, state, parameterLeft, parameterRight, arguments_) {
  const instantiatedExtends = InstantiateType(context, state, parameterLeft.extends);
  const instantiatedEquals = InstantiateType(context, state, parameterLeft.equals);
  return guard_exports.ShiftLeft(arguments_, (left, right) => BindParameters(BindArgument(context, state, parameterLeft["name"], instantiatedExtends, left), state, parameterRight, right), () => BindParameters(BindArgument(context, state, parameterLeft["name"], instantiatedExtends, instantiatedEquals), state, parameterRight, []));
}
function BindParameters(context, state, parameters, arguments_) {
  return guard_exports.ShiftLeft(parameters, (left, right) => BindArguments(context, state, left, right, arguments_), () => context);
}
function ResolveArgumentsContext(context, state, parameters, arguments_) {
  return BindParameters(context, state, parameters, arguments_);
}

// node_modules/typebox/build/type/engine/call/instantiate.mjs
var instantiationDepth = 0;
var instantiationCount = 0;
function InstantiationAssert() {
  if (guard_exports.IsLessThan(instantiationCount, settings_exports.Get().maxInstantiationCount))
    return;
  throw Error("Type instantiation is excessively deep and possibly infinite");
}
function InstantiationIncrement() {
  InstantiationAssert();
  instantiationCount++;
  instantiationDepth++;
}
function InstantiationDecrement() {
  instantiationDepth--;
  if (guard_exports.IsEqual(instantiationDepth, 0))
    instantiationCount = 0;
}
function Peek(state) {
  const result = guard_exports.IsGreaterThan(state.callstack.length, 0) ? state.callstack[state.callstack.length - 1] : "";
  return result;
}
function IsTailCall(state, name) {
  const result = guard_exports.IsEqual(Peek(state), name);
  return result;
}
function CallDispatch(context, state, target, parameters, expression, arguments_) {
  InstantiationIncrement();
  try {
    const argumentsContext = ResolveArgumentsContext(context, state, parameters, arguments_);
    const returnType = InstantiateType(argumentsContext, State([...state["callstack"], target["$ref"]], state["visited"]), expression);
    return InstantiateType(argumentsContext, State([], []), returnType);
  } finally {
    InstantiationDecrement();
  }
}
function CallDistributed(context, state, target, parameters, expression, distributedArguments) {
  return distributedArguments.reduce((result, arguments_) => {
    const returnType = CallDispatch(context, state, target, parameters, expression, arguments_);
    return [...result, returnType];
  }, []);
}
function CallImmediate(context, state, target, parameters, expression, arguments_) {
  const distributedArguments = DistributeArguments(parameters, arguments_, expression);
  const returnTypes = CallDistributed(context, state, target, parameters, expression, distributedArguments);
  const result = guard_exports.IsEqual(returnTypes.length, 1) ? returnTypes[0] : EvaluateUnion(returnTypes);
  return result;
}
function CallInstantiate(context, state, target, arguments_) {
  const instantiatedArguments = InstantiateTypes(context, state, arguments_);
  const resolved2 = ResolveTarget(context, target, arguments_);
  const name = resolved2[0];
  const type = resolved2[1];
  const result = IsGeneric(type) ? IsTailCall(state, name) ? CallConstruct(Ref(name), instantiatedArguments) : CallImmediate(context, state, Ref(name), type.parameters, type.expression, instantiatedArguments) : CallConstruct(target, instantiatedArguments);
  return result;
}

// node_modules/typebox/build/type/types/call.mjs
function CallConstruct(target, arguments_) {
  return memory_exports.Create({ ["~kind"]: "Call" }, { type: "call", target, arguments: arguments_ }, {});
}
function Call(target, arguments_) {
  return CallInstantiate({}, State([], []), target, arguments_);
}
function IsCall(value) {
  return IsKind(value, "Call");
}

// node_modules/typebox/build/type/engine/immutable/instantiate_remove.mjs
function RemoveImmutableOperation(type) {
  return memory_exports.Discard(type, ["~immutable"]);
}
function RemoveImmutableAction(type, options2) {
  const result = memory_exports.Update(RemoveImmutableOperation(type), {}, options2);
  return result;
}
function RemoveImmutableInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveImmutableAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/engine/intrinsics/mapping.mjs
function ApplyMapping(mapping, value) {
  return mapping(value);
}

// node_modules/typebox/build/type/engine/intrinsics/from_literal.mjs
function FromLiteral3(mapping, value) {
  return guard_exports.IsString(value) ? Literal(ApplyMapping(mapping, value)) : Literal(value);
}

// node_modules/typebox/build/type/engine/intrinsics/from_template_literal.mjs
function FromTemplateLiteral(mapping, pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType7(mapping, evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/intrinsics/from_union.mjs
function FromUnion2(mapping, types) {
  const result = types.map((type) => FromType7(mapping, type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/intrinsics/from_type.mjs
function FromType7(mapping, type) {
  return IsLiteral(type) ? FromLiteral3(mapping, type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral(mapping, type.pattern) : IsUnion(type) ? FromUnion2(mapping, type.anyOf) : type;
}

// node_modules/typebox/build/type/action/capitalize.mjs
function CapitalizeDeferred(type, options2 = {}) {
  return Deferred("Capitalize", [type], options2);
}
function Capitalize(type, options2 = {}) {
  return CapitalizeAction(type, options2);
}

// node_modules/typebox/build/type/action/lowercase.mjs
function LowercaseDeferred(type, options2 = {}) {
  return Deferred("Lowercase", [type], options2);
}
function Lowercase(type, options2 = {}) {
  return LowercaseAction(type, options2);
}

// node_modules/typebox/build/type/action/uncapitalize.mjs
function UncapitalizeDeferred(type, options2 = {}) {
  return Deferred("Uncapitalize", [type], options2);
}
function Uncapitalize(type, options2 = {}) {
  return UncapitalizeAction(type, options2);
}

// node_modules/typebox/build/type/action/uppercase.mjs
function UppercaseDeferred(type, options2 = {}) {
  return Deferred("Uppercase", [type], options2);
}
function Uppercase(type, options2 = {}) {
  return UppercaseAction(type, options2);
}

// node_modules/typebox/build/type/engine/intrinsics/instantiate.mjs
var CapitalizeMapping = (input) => input[0].toUpperCase() + input.slice(1);
var LowercaseMapping = (input) => input.toLowerCase();
var UncapitalizeMapping = (input) => input[0].toLowerCase() + input.slice(1);
var UppercaseMapping = (input) => input.toUpperCase();
function CapitalizeAction(type, options2) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(CapitalizeMapping, type), {}, options2) : CapitalizeDeferred(type, options2);
  return result;
}
function LowercaseAction(type, options2) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(LowercaseMapping, type), {}, options2) : LowercaseDeferred(type, options2);
  return result;
}
function UncapitalizeAction(type, options2) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UncapitalizeMapping, type), {}, options2) : UncapitalizeDeferred(type, options2);
  return result;
}
function UppercaseAction(type, options2) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UppercaseMapping, type), {}, options2) : UppercaseDeferred(type, options2);
  return result;
}
function CapitalizeInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return CapitalizeAction(instantiatedType, options2);
}
function LowercaseInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return LowercaseAction(instantiatedType, options2);
}
function UncapitalizeInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return UncapitalizeAction(instantiatedType, options2);
}
function UppercaseInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return UppercaseAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/action/conditional.mjs
function ConditionalDeferred(left, right, true_, false_, options2 = {}) {
  return Deferred("Conditional", [left, right, true_, false_], options2);
}
function Conditional(left, right, true_, false_, options2 = {}) {
  return ConditionalAction({}, State([], []), left, right, true_, false_, options2);
}

// node_modules/typebox/build/type/engine/conditional/instantiate.mjs
function ConditionalOperation(context, state, left, right, true_, false_) {
  const extendsResult = Extends(context, left, right);
  return result_exports.IsExtendsUnion(extendsResult) ? Union([InstantiateType(extendsResult.inferred, state, true_), InstantiateType(context, state, false_)]) : result_exports.IsExtendsTrue(extendsResult) ? InstantiateType(extendsResult.inferred, state, true_) : InstantiateType(context, state, false_);
}
function ConditionalAction(context, state, left, right, true_, false_, options2) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ConditionalOperation(context, state, left, right, true_, false_), {}, options2) : ConditionalDeferred(left, right, true_, false_, options2);
  return result;
}
function ConditionalInstantiate(context, state, left, right, true_, false_, options2) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ConditionalAction(context, state, instantiatedLeft, instantiatedRight, true_, false_, options2);
}

// node_modules/typebox/build/type/action/constructor_parameters.mjs
function ConstructorParametersDeferred(type, options2 = {}) {
  return Deferred("ConstructorParameters", [type], options2);
}
function ConstructorParameters(type, options2 = {}) {
  return ConstructorParametersAction(type, options2);
}

// node_modules/typebox/build/type/engine/constructor_parameters/instantiate.mjs
function ConstructorParametersOperation(type) {
  const parameters = IsConstructor2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ConstructorParametersAction(type, options2) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ConstructorParametersOperation(type), {}, options2) : ConstructorParametersDeferred(type, options2);
  return result;
}
function ConstructorParametersInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return ConstructorParametersAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/action/exclude.mjs
function ExcludeDeferred(left, right, options2 = {}) {
  return Deferred("Exclude", [left, right], options2);
}
function Exclude(left, right, options2 = {}) {
  return ExcludeAction(left, right, options2);
}

// node_modules/typebox/build/type/engine/exclude/instantiate.mjs
function ExcludeAction(left, right, options2) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExcludeOperation(left, right), {}, options2) : ExcludeDeferred(left, right, options2);
  return result;
}
function ExcludeInstantiate(context, state, left, right, options2) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ExcludeAction(instantiatedLeft, instantiatedRight, options2);
}

// node_modules/typebox/build/type/action/extract.mjs
function ExtractDeferred(left, right, options2 = {}) {
  return Deferred("Extract", [left, right], options2);
}
function Extract(left, right, options2 = {}) {
  return ExtractAction(left, right, options2);
}

// node_modules/typebox/build/type/engine/extract/operation.mjs
function ExtractType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [left] : [];
  return result;
}
function ExtractUnion(left, right, result = []) {
  return guard_exports.ShiftLeft(left, (head, tail) => ExtractUnion(tail, right, [...result, ...ExtractType(head, right)]), () => result);
}
function ExtractOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExtractUnion(canonical, right);
  const result = EvaluateUnion(remaining);
  return result;
}

// node_modules/typebox/build/type/engine/extract/instantiate.mjs
function ExtractAction(left, right, options2) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExtractOperation(left, right), {}, options2) : ExtractDeferred(left, right, options2);
  return result;
}
function ExtractInstantiate(context, state, left, right, options2) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ExtractAction(instantiatedLeft, instantiatedRight, options2);
}

// node_modules/typebox/build/type/engine/helpers/keys_to_indexer.mjs
function KeysToLiterals(keys) {
  return keys.reduce((result, left) => {
    return IsLiteralValue(left) ? [...result, Literal(left)] : result;
  }, []);
}
function KeysToIndexer(keys) {
  const literals = KeysToLiterals(keys);
  const result = Union(literals);
  return result;
}

// node_modules/typebox/build/type/action/indexed.mjs
function IndexDeferred(type, indexer, options2 = {}) {
  return Deferred("Index", [type, indexer], options2);
}
function Index(type, indexer_or_keys, options2 = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return IndexAction(type, indexer, options2);
}

// node_modules/typebox/build/type/engine/object/from_cyclic.mjs
function FromCyclic(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType8(target);
  return result;
}

// node_modules/typebox/build/type/engine/object/from_dependent.mjs
function FromDependent(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType8(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/object/from_intersect.mjs
function CollapseIntersectProperties(left, right) {
  const leftKeys = guard_exports.Keys(left).filter((key) => !guard_exports.HasPropertyKey(right, key));
  const rightKeys = guard_exports.Keys(right).filter((key) => !guard_exports.HasPropertyKey(left, key));
  const sharedKeys = guard_exports.Keys(left).filter((key) => guard_exports.HasPropertyKey(right, key));
  const leftProperties = leftKeys.reduce((result, key) => ({ ...result, [key]: left[key] }), {});
  const rightProperties = rightKeys.reduce((result, key) => ({ ...result, [key]: right[key] }), {});
  const sharedProperties = sharedKeys.reduce((result, key) => ({ ...result, [key]: EvaluateIntersect([left[key], right[key]]) }), {});
  const unique = memory_exports.Assign(leftProperties, rightProperties);
  const shared = memory_exports.Assign(unique, sharedProperties);
  return shared;
}
function FromIntersect(types) {
  return types.reduce((result, left) => {
    return CollapseIntersectProperties(result, FromType8(left));
  }, {});
}

// node_modules/typebox/build/type/engine/object/from_object.mjs
function FromObject3(properties) {
  return properties;
}

// node_modules/typebox/build/type/engine/object/from_tuple.mjs
function FromTuple(types) {
  const object = TupleToObject(Tuple(types));
  const result = FromType8(object);
  return result;
}

// node_modules/typebox/build/type/engine/object/from_union.mjs
function CollapseUnionProperties(left, right) {
  const sharedKeys = guard_exports.Keys(left).filter((key) => key in right);
  const result = sharedKeys.reduce((result2, key) => {
    return { ...result2, [key]: EvaluateUnion([left[key], right[key]]) };
  }, {});
  return result;
}
function ReduceVariants(types, result) {
  return guard_exports.ShiftLeft(types, (left, right) => ReduceVariants(right, CollapseUnionProperties(result, FromType8(left))), () => result);
}
function FromUnion3(types) {
  return guard_exports.ShiftLeft(types, (left, right) => ReduceVariants(right, FromType8(left)), () => Unreachable());
}

// node_modules/typebox/build/type/engine/object/from_type.mjs
function FromType8(type) {
  return IsCyclic(type) ? FromCyclic(type.$defs, type.$ref) : IsDependent(type) ? FromDependent(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect(type.allOf) : IsUnion(type) ? FromUnion3(type.anyOf) : IsTuple(type) ? FromTuple(type.items) : IsObject2(type) ? FromObject3(type.properties) : {};
}

// node_modules/typebox/build/type/engine/object/collapse.mjs
function CollapseToObject(type) {
  const properties = FromType8(type);
  const result = _Object_(properties);
  return result;
}

// node_modules/typebox/build/type/engine/helpers/keys.mjs
var integerKeyPattern = new RegExp("^(?:0|[1-9][0-9]*)$");
function ConvertToIntegerKey(value) {
  const normal = `${value}`;
  return integerKeyPattern.test(normal) ? parseInt(normal) : value;
}

// node_modules/typebox/build/type/engine/indexed/from_array.mjs
function NormalizeLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function NormalizeIndexerTypes(types) {
  return types.map((type) => NormalizeIndexer(type));
}
function NormalizeIndexer(type) {
  return IsIntersect(type) ? Intersect(NormalizeIndexerTypes(type.allOf)) : IsUnion(type) ? Union(NormalizeIndexerTypes(type.anyOf)) : IsLiteral(type) ? NormalizeLiteral(type.const) : type;
}
function FromArray2(type, indexer) {
  const normalizedIndexer = NormalizeIndexer(indexer);
  const check = Extends({}, normalizedIndexer, Number2());
  const result = (
    // indexer
    result_exports.IsExtendsTrueLike(check) ? type : IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Number2() : Never()
  );
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_cyclic.mjs
function FromCyclic2(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType9(target);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_dependent.mjs
function FromDependent2(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_enum.mjs
function FromEnum(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_intersect.mjs
function FromIntersect2(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_literal.mjs
function FromLiteral4(value) {
  const result = [`${value}`];
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_template_literal.mjs
function FromTemplateLiteral2(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_union.mjs
function FromUnion4(types) {
  return types.reduce((result, left) => {
    return [...result, ...FromType9(left)];
  }, []);
}

// node_modules/typebox/build/type/engine/indexable/from_type.mjs
function FromType9(type) {
  return IsCyclic(type) ? FromCyclic2(type.$defs, type.$ref) : IsDependent(type) ? FromDependent2(type.if, type.then, type.else) : IsEnum(type) ? FromEnum(type.enum) : IsIntersect(type) ? FromIntersect2(type.allOf) : IsLiteral(type) ? FromLiteral4(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral2(type.pattern) : IsUnion(type) ? FromUnion4(type.anyOf) : [];
}

// node_modules/typebox/build/type/engine/indexable/to_indexable_keys.mjs
function ToIndexableKeys(type) {
  const result = FromType9(type);
  return result;
}

// node_modules/typebox/build/type/engine/this/expand_this.mjs
function FromTypes5(properties, types) {
  return types.map((type) => FromType10(properties, type));
}
function FromType10(properties, type) {
  return IsArray2(type) ? _Array_(FromType10(properties, type.items)) : IsConstructor2(type) ? Constructor(FromTypes5(properties, type.parameters), FromType10(properties, type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes5(properties, type.parameters), FromType10(properties, type.returnType)) : IsTuple(type) ? Tuple(FromTypes5(properties, type.items)) : IsUnion(type) ? Union(FromTypes5(properties, type.anyOf)) : IsIntersect(type) ? Intersect(FromTypes5(properties, type.allOf)) : IsThis(type) ? _Object_(properties) : type;
}
function ExpandThis(properties, type) {
  const result = FromType10(properties, type);
  return result;
}

// node_modules/typebox/build/type/engine/indexed/from_object.mjs
function IndexProperty(properties, key) {
  const selectedType = key in properties ? properties[key] : Never();
  const result = ExpandThis(properties, selectedType);
  return result;
}
function IndexProperties(properties, keys) {
  return keys.reduce((result, left) => {
    return [...result, IndexProperty(properties, left)];
  }, []);
}
function FromIndexer(properties, indexer) {
  const keys = ToIndexableKeys(indexer);
  const variants = IndexProperties(properties, keys);
  const result = EvaluateUnion(variants);
  return result;
}
var NumericKeyPattern = new RegExp(IntegerKey);
function NumericKeys(keys) {
  const result = keys.filter((key) => NumericKeyPattern.test(key));
  return result;
}
function FromIndexerNumber(properties) {
  const keys = PropertyKeys(properties);
  const numericKeys = NumericKeys(keys);
  const variants = IndexProperties(properties, numericKeys);
  const result = EvaluateUnion(variants);
  return result;
}
function FromObject4(properties, indexer) {
  const result = IsNumber3(indexer) ? FromIndexerNumber(properties) : FromIndexer(properties, indexer);
  return result;
}

// node_modules/typebox/build/type/engine/indexed/array_indexer.mjs
function ConvertLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function ArrayIndexerTypes(types) {
  return types.map((type) => FormatArrayIndexer(type));
}
function FormatArrayIndexer(type) {
  return IsIntersect(type) ? Intersect(ArrayIndexerTypes(type.allOf)) : IsUnion(type) ? Union(ArrayIndexerTypes(type.anyOf)) : IsLiteral(type) ? ConvertLiteral(type.const) : type;
}

// node_modules/typebox/build/type/engine/indexed/from_tuple.mjs
function IndexElementsWithIndexer(types, indexer) {
  return types.reduceRight((result, right, index) => {
    const check = Extends({}, Literal(index), indexer);
    return result_exports.IsExtendsTrueLike(check) ? [right, ...result] : result;
  }, []);
}
function FromTupleWithIndexer(types, indexer) {
  const formattedArrayIndexer = FormatArrayIndexer(indexer);
  const elements = IndexElementsWithIndexer(types, formattedArrayIndexer);
  return EvaluateUnionFast(elements);
}
function FromTupleWithoutIndexer(types) {
  return EvaluateUnionFast(types);
}
function FromTuple2(types, indexer) {
  return (
    // length (intrinsic)
    IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Literal(types.length) : IsNumber3(indexer) || IsInteger2(indexer) ? FromTupleWithoutIndexer(types) : FromTupleWithIndexer(types, indexer)
  );
}

// node_modules/typebox/build/type/engine/indexed/from_type.mjs
function FromType11(type, indexer) {
  return IsArray2(type) ? FromArray2(type.items, indexer) : IsObject2(type) ? FromObject4(type.properties, indexer) : IsTuple(type) ? FromTuple2(type.items, indexer) : Never();
}

// node_modules/typebox/build/type/engine/indexed/instantiate.mjs
function NormalizeType(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function IndexAction(type, indexer, options2) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType11(NormalizeType(type), indexer), {}, options2) : IndexDeferred(type, indexer, options2);
  return result;
}
function IndexInstantiate(context, state, type, indexer, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return IndexAction(instantiatedType, instantiatedIndexer, options2);
}

// node_modules/typebox/build/type/action/instance_type.mjs
function InstanceTypeDeferred(type, options2 = {}) {
  return Deferred("InstanceType", [type], options2);
}
function InstanceType(type, options2 = {}) {
  return InstanceTypeAction(type, options2);
}

// node_modules/typebox/build/type/engine/instance_type/instantiate.mjs
function InstanceTypeOperation(type) {
  return IsConstructor2(type) ? type["instanceType"] : Never();
}
function InstanceTypeAction(type, options2) {
  const result = CanInstantiate([type]) ? memory_exports.Update(InstanceTypeOperation(type), {}, options2) : InstanceTypeDeferred(type, options2);
  return result;
}
function InstanceTypeInstantiate(context, state, type, options2 = {}) {
  const instantiatedType = InstantiateType(context, state, type);
  return InstanceTypeAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/action/keyof.mjs
function KeyOfDeferred(type, options2 = {}) {
  return Deferred("KeyOf", [type], options2);
}
function KeyOf2(type, options2 = {}) {
  return KeyOfAction(type, options2);
}

// node_modules/typebox/build/type/engine/keyof/from_any.mjs
function FromAny() {
  return Union([Number2(), String2(), Symbol2()]);
}

// node_modules/typebox/build/type/engine/keyof/from_array.mjs
function FromArray3(_type) {
  return Number2();
}

// node_modules/typebox/build/type/engine/keyof/from_object.mjs
function FromPropertyKeys(keys) {
  const result = keys.reduce((result2, left) => {
    return IsLiteralValue(left) ? [...result2, Literal(ConvertToIntegerKey(left))] : Unreachable();
  }, []);
  return result;
}
function FromObject5(properties) {
  const propertyKeys = guard_exports.Keys(properties);
  const variants = FromPropertyKeys(propertyKeys);
  const result = EvaluateUnionFast(variants);
  return result;
}

// node_modules/typebox/build/type/engine/keyof/from_record.mjs
function FromRecord2(type) {
  return RecordKey(type);
}

// node_modules/typebox/build/type/engine/keyof/from_tuple.mjs
function FromTuple3(types) {
  const result = types.map((_, index) => Literal(index));
  return EvaluateUnionFast(result);
}

// node_modules/typebox/build/type/engine/keyof/from_type.mjs
function FromType12(type) {
  return IsAny(type) ? FromAny() : IsArray2(type) ? FromArray3(type.items) : IsObject2(type) ? FromObject5(type.properties) : IsRecord(type) ? FromRecord2(type) : IsTuple(type) ? FromTuple3(type.items) : Never();
}

// node_modules/typebox/build/type/engine/keyof/instantiate.mjs
function NormalizeType2(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function KeyOfAction(type, options2) {
  return CanInstantiate([type]) ? memory_exports.Update(FromType12(NormalizeType2(type)), {}, options2) : KeyOfDeferred(type, options2);
}
function KeyOfInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return KeyOfAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/action/mapped.mjs
function MappedDeferred(identifier, type, as, property, options2 = {}) {
  return Deferred("Mapped", [identifier, type, as, property], options2);
}
function Mapped(identifier, type, as, property, options2 = {}) {
  return MappedAction({}, State([], []), identifier, type, as, property, options2);
}

// node_modules/typebox/build/type/engine/mapped/mapped_variants.mjs
function FromTemplateLiteral3(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType13(evaluated);
  return result;
}
function FromUnion5(types) {
  return types.reduce((result, left) => {
    return [...result, ...FromType13(left)];
  }, []);
}
function FromEnum2(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType13(evaluated);
  return result;
}
function FromLiteral5(value) {
  const result = guard_exports.IsNumber(value) ? [Literal(`${value}`)] : [Literal(value)];
  return result;
}
function FromType13(type) {
  const result = IsEnum(type) ? FromEnum2(type.enum) : IsLiteral(type) ? FromLiteral5(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral3(type.pattern) : IsUnion(type) ? FromUnion5(type.anyOf) : [type];
  return result;
}
function MappedVariants(type) {
  const result = FromType13(type);
  return result;
}

// node_modules/typebox/build/type/engine/mapped/mapped_operation.mjs
function CanonicalAs(instantiatedAs) {
  const result = IsTemplateLiteral(instantiatedAs) ? EvaluateTemplateLiteral(instantiatedAs.pattern) : instantiatedAs;
  return result;
}
function MappedVariant(context, state, identifier, variant, as, property) {
  const variantContext = memory_exports.Assign(context, { [identifier["name"]]: variant });
  const instantiatedAs = InstantiateType(variantContext, state, as);
  const canonicalAs = CanonicalAs(instantiatedAs);
  const instantiatedProperty = InstantiateType(variantContext, state, property);
  return IsLiteralNumber(canonicalAs) || IsLiteralString(canonicalAs) ? { [canonicalAs.const]: instantiatedProperty } : {};
}
function MappedProperties(context, state, identifier, variants, as, property) {
  return variants.reduce((result, left) => {
    return [...result, MappedVariant(context, state, identifier, left, as, property)];
  }, []);
}
function MappedObjects(properties) {
  return properties.reduce((result, left) => {
    return [...result, _Object_(left)];
  }, []);
}
function MappedOperation(context, state, identifier, type, as, property) {
  const variants = MappedVariants(type);
  const mappedProperties = MappedProperties(context, state, identifier, variants, as, property);
  const mappedObjects = MappedObjects(mappedProperties);
  const result = EvaluateIntersect(mappedObjects);
  return result;
}

// node_modules/typebox/build/type/engine/mapped/instantiate.mjs
function MappedAction(context, state, identifier, type, as, property, options2) {
  const result = CanInstantiate([type]) ? memory_exports.Update(MappedOperation(context, state, identifier, type, as, property), {}, options2) : MappedDeferred(identifier, type, as, property, options2);
  return result;
}
function MappedInstantiate(context, state, identifier, type, as, property, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return MappedAction(context, state, identifier, instantiatedType, as, property, options2);
}

// node_modules/typebox/build/type/engine/module/instantiate.mjs
function InstantiateCyclics(context, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateCyclic(declarationContext, key, declarations[key]) };
  }, {});
}
function InstantiateNonCyclics(context, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => !cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateType(declarationContext, State([], []), declarations[key]) };
  }, {});
}
function InstantiateModule(context, declarations, options2) {
  const cyclicCandidates = CyclicCandidates(declarations);
  const instantiatedCyclics = InstantiateCyclics(context, declarations, cyclicCandidates);
  const instantiatedNonCyclics = InstantiateNonCyclics(context, declarations, cyclicCandidates);
  const instantiatedModule = { ...instantiatedCyclics, ...instantiatedNonCyclics };
  return memory_exports.Update(instantiatedModule, {}, options2);
}
function ModuleInstantiate(context, _state, declarations, options2) {
  const instantiatedModule = InstantiateModule(context, declarations, options2);
  return instantiatedModule;
}

// node_modules/typebox/build/type/action/non_nullable.mjs
function NonNullableDeferred(type, options2 = {}) {
  return Deferred("NonNullable", [type], options2);
}
function NonNullable(type, options2 = {}) {
  return NonNullableAction(type, options2);
}

// node_modules/typebox/build/type/engine/non_nullable/instantiate.mjs
function NonNullableOperation(type) {
  const excluded = Union([Null(), Undefined()]);
  return ExcludeAction(type, excluded, {});
}
function NonNullableAction(type, options2) {
  const result = CanInstantiate([type]) ? memory_exports.Update(NonNullableOperation(type), {}, options2) : NonNullableDeferred(type, options2);
  return result;
}
function NonNullableInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return NonNullableAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/action/omit.mjs
function OmitDeferred(type, indexer, options2 = {}) {
  return Deferred("Omit", [type, indexer], options2);
}
function Omit(type, indexer_or_keys, options2 = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return OmitAction(type, indexer, options2);
}

// node_modules/typebox/build/type/engine/indexable/to_indexable.mjs
function ToIndexable(type) {
  const collapsed = CollapseToObject(type);
  const result = IsObject2(collapsed) ? collapsed.properties : Unreachable();
  return result;
}

// node_modules/typebox/build/type/engine/omit/from_type.mjs
function FromKeys(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? result2 : { ...result2, [key]: properties[key] };
  }, {});
  return result;
}
function FromType14(type, indexer) {
  const indexable = ToIndexable(type);
  const indexableKeys = ToIndexableKeys(indexer);
  const omitted = FromKeys(indexable, indexableKeys);
  const result = _Object_(omitted);
  return result;
}

// node_modules/typebox/build/type/engine/omit/instantiate.mjs
function OmitAction(type, indexer, options2) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType14(type, indexer), {}, options2) : OmitDeferred(type, indexer, options2);
  return result;
}
function OmitInstantiate(context, state, type, indexer, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return OmitAction(instantiatedType, instantiatedIndexer, options2);
}

// node_modules/typebox/build/type/action/parameters.mjs
function ParametersDeferred(type, options2 = {}) {
  return Deferred("Parameters", [type], options2);
}
function Parameters(type, options2 = {}) {
  return ParametersAction(type, options2);
}

// node_modules/typebox/build/type/engine/parameters/instantiate.mjs
function ParametersOperation(type) {
  const parameters = IsFunction2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ParametersAction(type, options2) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ParametersOperation(type), {}, options2) : ParametersDeferred(type, options2);
  return result;
}
function ParametersInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return ParametersAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/action/partial.mjs
function PartialDeferred(type, options2 = {}) {
  return Deferred("Partial", [type], options2);
}
function Partial(type, options2 = {}) {
  return PartialAction(type, options2);
}

// node_modules/typebox/build/type/engine/partial/from_cyclic.mjs
function FromCyclic3(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType15(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_dependent.mjs
function FromDependent3(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType15(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_intersect.mjs
function FromIntersect3(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType15(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_union.mjs
function FromUnion6(types) {
  const result = types.map((type) => FromType15(type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/partial/from_object.mjs
function FromObject6(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_type.mjs
function FromType15(type) {
  return IsCyclic(type) ? FromCyclic3(type.$defs, type.$ref) : IsDependent(type) ? FromDependent3(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect3(type.allOf) : IsUnion(type) ? FromUnion6(type.anyOf) : IsObject2(type) ? FromObject6(type.properties) : _Object_({});
}

// node_modules/typebox/build/type/engine/partial/instantiate.mjs
function PartialAction(type, options2) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType15(type), {}, options2) : PartialDeferred(type, options2);
  return result;
}
function PartialInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return PartialAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/action/pick.mjs
function PickDeferred(type, indexer, options2 = {}) {
  return Deferred("Pick", [type, indexer], options2);
}
function Pick(type, indexer_or_keys, options2 = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return PickAction(type, indexer, options2);
}

// node_modules/typebox/build/type/engine/pick/from_type.mjs
function FromKeys2(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? memory_exports.Assign(result2, { [key]: properties[key] }) : result2;
  }, {});
  return result;
}
function FromType16(type, indexer) {
  const indexable = ToIndexable(type);
  const keys = ToIndexableKeys(indexer);
  const applied = FromKeys2(indexable, keys);
  const result = _Object_(applied);
  return result;
}

// node_modules/typebox/build/type/engine/pick/instantiate.mjs
function PickAction(type, indexer, options2) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType16(type, indexer), {}, options2) : PickDeferred(type, indexer, options2);
  return result;
}
function PickInstantiate(context, state, type, indexer, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return PickAction(instantiatedType, instantiatedIndexer, options2);
}

// node_modules/typebox/build/type/action/readonly_object.mjs
function ReadonlyObjectDeferred(type, options2 = {}) {
  return Deferred("ReadonlyObject", [type], options2);
}
function ReadonlyObject(type, options2 = {}) {
  return ReadonlyObjectAction(type, options2);
}
var ReadonlyType = ReadonlyObject;

// node_modules/typebox/build/type/engine/readonly_object/from_array.mjs
function FromArray4(type) {
  const result = AddImmutable(_Array_(type));
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_cyclic.mjs
function FromCyclic4(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType17(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_dependent.mjs
function FromDependent4(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType17(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_intersect.mjs
function FromIntersect4(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType17(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_object.mjs
function FromObject7(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddReadonly(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_tuple.mjs
function FromTuple4(types) {
  const result = AddImmutable(Tuple(types));
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_union.mjs
function FromUnion7(types) {
  const result = types.map((type) => FromType17(type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/readonly_object/from_type.mjs
function FromType17(type) {
  return IsArray2(type) ? FromArray4(type.items) : IsCyclic(type) ? FromCyclic4(type.$defs, type.$ref) : IsDependent(type) ? FromDependent4(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect4(type.allOf) : IsObject2(type) ? FromObject7(type.properties) : IsTuple(type) ? FromTuple4(type.items) : IsUnion(type) ? FromUnion7(type.anyOf) : type;
}

// node_modules/typebox/build/type/engine/readonly_object/instantiate.mjs
function ReadonlyObjectAction(type, options2) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType17(type), {}, options2) : ReadonlyObjectDeferred(type);
  return result;
}
function ReadonlyObjectInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return ReadonlyObjectAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/engine/ref/instantiate.mjs
function RefInstantiate(context, state, type, ref) {
  return state.visited.includes(ref) ? type : ref in context ? InstantiateType(context, State(state["callstack"], [...state["visited"], ref]), context[ref]) : type;
}

// node_modules/typebox/build/type/engine/required/from_cyclic.mjs
function FromCyclic5(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType18(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_dependent.mjs
function FromDependent5(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType18(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_intersect.mjs
function FromIntersect5(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType18(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_union.mjs
function FromUnion8(types) {
  const result = types.map((type) => FromType18(type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/required/from_object.mjs
function FromObject8(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: RemoveOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_type.mjs
function FromType18(type) {
  return IsCyclic(type) ? FromCyclic5(type.$defs, type.$ref) : IsDependent(type) ? FromDependent5(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect5(type.allOf) : IsUnion(type) ? FromUnion8(type.anyOf) : IsObject2(type) ? FromObject8(type.properties) : _Object_({});
}

// node_modules/typebox/build/type/action/required.mjs
function RequiredDeferred(type, options2 = {}) {
  return Deferred("Required", [type], options2);
}
function Required(type, options2 = {}) {
  return RequiredAction(type, options2);
}

// node_modules/typebox/build/type/engine/required/instantiate.mjs
function RequiredAction(type, options2) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType18(type), {}, options2) : RequiredDeferred(type, options2);
  return result;
}
function RequiredInstantiate(context, state, type, options2) {
  const instaniatedType = InstantiateType(context, state, type);
  return RequiredAction(instaniatedType, options2);
}

// node_modules/typebox/build/type/action/return_type.mjs
function ReturnTypeDeferred(type, options2 = {}) {
  return Deferred("ReturnType", [type], options2);
}
function ReturnType(type, options2 = {}) {
  return ReturnTypeAction(type, options2);
}

// node_modules/typebox/build/type/engine/return_type/instantiate.mjs
function ReturnTypeOperation(type) {
  return IsFunction2(type) ? type["returnType"] : Never();
}
function ReturnTypeAction(type, options2) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ReturnTypeOperation(type), {}, options2) : ReturnTypeDeferred(type, options2);
  return result;
}
function ReturnTypeInstantiate(context, state, type, options2 = {}) {
  const instantiatedType = InstantiateType(context, state, type);
  return ReturnTypeAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/action/with.mjs
function WithDeferred(type, options2) {
  return Deferred("With", [type, options2], {});
}
function With2(type, options2) {
  return WithAction(type, options2);
}

// node_modules/typebox/build/type/engine/with/instantiate.mjs
function WithAction(type, options2) {
  const result = CanInstantiate([type]) ? memory_exports.Update(type, {}, options2) : WithDeferred(type, options2);
  return result;
}
function WithInstantiate(context, state, type, options2) {
  const instaniatedType = InstantiateType(context, state, type);
  return WithAction(instaniatedType, options2);
}

// node_modules/typebox/build/type/engine/rest/spread.mjs
function SpreadElement(type) {
  const result = IsRest(type) ? IsTuple(type.items) ? RestSpread(type.items.items) : IsInfer(type.items) ? [type] : IsRef(type.items) ? [type] : [Never()] : [type];
  return result;
}
function RestSpread(types) {
  const result = types.reduce((result2, left) => {
    return [...result2, ...SpreadElement(left)];
  }, []);
  return result;
}

// node_modules/typebox/build/type/engine/instantiate.mjs
function State(callstack, visited) {
  return { callstack, visited };
}
function CanInstantiate(types) {
  return guard_exports.ShiftLeft(types, (left, right) => IsRef(left) ? false : CanInstantiate(right), () => true);
}
function InstantiateProperties(context, state, properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: InstantiateType(context, state, properties[key]) };
  }, {});
}
function InstantiateElements(context, state, types) {
  const elements = InstantiateTypes(context, state, types);
  const result = RestSpread(elements);
  return result;
}
function InstantiateTypes(context, state, types) {
  return types.map((type) => InstantiateType(context, state, type));
}
function WithModifiers(type, instantiatedType) {
  const withOptional = IsOptional(type) ? AddOptionalAction(instantiatedType, {}) : instantiatedType;
  const withReadonly = IsReadonly(type) ? AddReadonlyAction(withOptional, {}) : withOptional;
  const withImmutable = IsImmutable(type) ? AddImmutableAction(withReadonly, {}) : withReadonly;
  return withImmutable;
}
function InstantiateDeferred(context, state, action, parameters, options2) {
  return (
    // Modifiers
    guard_exports.IsEqual(action, "AddImmutable") ? AddImmutableInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "RemoveImmutable") ? RemoveImmutableInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "AddReadonly") ? AddReadonlyInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "RemoveReadonly") ? RemoveReadonlyInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "AddOptional") ? AddOptionalInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "RemoveOptional") ? RemoveOptionalInstantiate(context, state, parameters[0], options2) : (
      // Actions
      guard_exports.IsEqual(action, "Capitalize") ? CapitalizeInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "Conditional") ? ConditionalInstantiate(context, state, parameters[0], parameters[1], parameters[2], parameters[3], options2) : guard_exports.IsEqual(action, "ConstructorParameters") ? ConstructorParametersInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "Evaluate") ? EvaluateInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "Exclude") ? ExcludeInstantiate(context, state, parameters[0], parameters[1], options2) : guard_exports.IsEqual(action, "Extract") ? ExtractInstantiate(context, state, parameters[0], parameters[1], options2) : guard_exports.IsEqual(action, "Index") ? IndexInstantiate(context, state, parameters[0], parameters[1], options2) : guard_exports.IsEqual(action, "InstanceType") ? InstanceTypeInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "Interface") ? InterfaceInstantiate(context, state, parameters[0], parameters[1], options2) : guard_exports.IsEqual(action, "KeyOf") ? KeyOfInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "Lowercase") ? LowercaseInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "Mapped") ? MappedInstantiate(context, state, parameters[0], parameters[1], parameters[2], parameters[3], options2) : guard_exports.IsEqual(action, "Module") ? ModuleInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "NonNullable") ? NonNullableInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "Pick") ? PickInstantiate(context, state, parameters[0], parameters[1], options2) : guard_exports.IsEqual(action, "Parameters") ? ParametersInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "Partial") ? PartialInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "Omit") ? OmitInstantiate(context, state, parameters[0], parameters[1], options2) : guard_exports.IsEqual(action, "ReadonlyObject") ? ReadonlyObjectInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "Record") ? RecordInstantiate(context, state, parameters[0], parameters[1], options2) : guard_exports.IsEqual(action, "Required") ? RequiredInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "ReturnType") ? ReturnTypeInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "TemplateLiteral") ? TemplateLiteralInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "Uncapitalize") ? UncapitalizeInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "Uppercase") ? UppercaseInstantiate(context, state, parameters[0], options2) : guard_exports.IsEqual(action, "With") ? WithInstantiate(context, state, parameters[0], parameters[1]) : Deferred(action, parameters, options2)
    )
  );
}
function InstantiateImmediate(context, state, type) {
  const instantiatedType = IsRef(type) ? RefInstantiate(context, state, type, type.$ref) : IsArray2(type) ? _Array_(InstantiateType(context, state, type.items), ArrayOptions(type)) : IsCall(type) ? CallInstantiate(context, state, type.target, type.arguments) : IsConstructor2(type) ? Constructor(InstantiateTypes(context, state, type.parameters), InstantiateType(context, state, type.instanceType), ConstructorOptions(type)) : IsFunction2(type) ? _Function_(InstantiateTypes(context, state, type.parameters), InstantiateType(context, state, type.returnType), FunctionOptions(type)) : IsDependent(type) ? Dependent(InstantiateType(context, state, type.if), InstantiateType(context, state, type.then), InstantiateType(context, state, type.else), DependentOptions(type)) : IsIntersect(type) ? Intersect(InstantiateTypes(context, state, type.allOf), IntersectOptions(type)) : IsObject2(type) ? _Object_(InstantiateProperties(context, state, type.properties), ObjectOptions(type)) : IsRecord(type) ? RecordFromPattern(RecordPattern(type), InstantiateType(context, state, RecordValue(type))) : IsRest(type) ? Rest(InstantiateType(context, state, type.items)) : IsTuple(type) ? Tuple(InstantiateElements(context, state, type.items), TupleOptions(type)) : IsUnion(type) ? Union(InstantiateTypes(context, state, type.anyOf), UnionOptions(type)) : type;
  const withModifiers = WithModifiers(type, instantiatedType);
  return withModifiers;
}
function InstantiateType(context, state, type) {
  const result = IsDeferred(type) ? InstantiateDeferred(context, state, type.action, type.parameters, type.options) : InstantiateImmediate(context, state, type);
  return result;
}
function Instantiate(context, type) {
  return InstantiateType(context, State([], []), type);
}

// node_modules/typebox/build/type/engine/immutable/instantiate_add.mjs
function AddImmutableOperation(type) {
  return memory_exports.Update(type, { "~immutable": true }, {});
}
function AddImmutableAction(type, options2) {
  const result = memory_exports.Update(AddImmutableOperation(type), {}, options2);
  return result;
}
function AddImmutableInstantiate(context, state, type, options2) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddImmutableAction(instantiatedType, options2);
}

// node_modules/typebox/build/type/action/_add_immutable.mjs
function AddImmutableDeferred(type, options2 = {}) {
  return Deferred("AddImmutable", [type], options2);
}
function AddImmutable(type, options2 = {}) {
  return AddImmutableAction(type, options2);
}

// node_modules/typebox/build/type/action/evaluate.mjs
function EvaluateDeferred(type, options2 = {}) {
  return Deferred("Evaluate", [type], options2);
}
function Evaluate(type, options2 = {}) {
  return EvaluateAction(type, options2);
}

// node_modules/typebox/build/type/action/module.mjs
function ModuleDeferred(declarations, options2 = {}) {
  return Deferred("Module", [declarations], options2);
}
function Module2(declarations, options2 = {}) {
  return ModuleInstantiate({}, State([], []), declarations, options2);
}

// node_modules/typebox/build/type/script/script.mjs
function Script2(...args) {
  const [context, input, options2] = arguments_exports.Match(args, {
    2: (script, options3) => guard_exports.IsString(script) ? [{}, script, options3] : [script, options3, {}],
    3: (context2, script, options3) => [context2, script, options3],
    1: (script) => [{}, script, {}]
  });
  const result = Script(input);
  const parsed = guard_exports.IsArray(result) && guard_exports.IsEqual(result.length, 2) ? InstantiateType(context, State([], []), result[0]) : Never();
  return memory_exports.Update(parsed, {}, options2);
}

// node_modules/typebox/build/typebox.mjs
var typebox_exports = {};
__export(typebox_exports, {
  Any: () => Any,
  Array: () => _Array_,
  BigInt: () => BigInt2,
  Boolean: () => Boolean2,
  Call: () => Call,
  Capitalize: () => Capitalize,
  Codec: () => Codec,
  Conditional: () => Conditional,
  Constructor: () => Constructor,
  ConstructorParameters: () => ConstructorParameters,
  Cyclic: () => Cyclic,
  Decode: () => Decode,
  DecodeBuilder: () => DecodeBuilder,
  Dependent: () => Dependent,
  Encode: () => Encode,
  EncodeBuilder: () => EncodeBuilder,
  Enum: () => Enum,
  Evaluate: () => Evaluate,
  Exclude: () => Exclude,
  Extends: () => Extends,
  ExtendsResult: () => result_exports,
  Extract: () => Extract,
  Function: () => _Function_,
  Generic: () => Generic,
  Identifier: () => Identifier,
  Immutable: () => Immutable,
  Index: () => Index,
  Infer: () => Infer,
  InstanceType: () => InstanceType,
  Instantiate: () => Instantiate,
  Integer: () => Integer,
  Interface: () => Interface,
  Intersect: () => Intersect,
  IsAny: () => IsAny,
  IsArray: () => IsArray2,
  IsBigInt: () => IsBigInt2,
  IsBoolean: () => IsBoolean3,
  IsCall: () => IsCall,
  IsCodec: () => IsCodec,
  IsConstructor: () => IsConstructor2,
  IsCyclic: () => IsCyclic,
  IsDependent: () => IsDependent,
  IsEnum: () => IsEnum,
  IsEnumValue: () => IsEnumValue,
  IsFunction: () => IsFunction2,
  IsGeneric: () => IsGeneric,
  IsIdentifier: () => IsIdentifier,
  IsImmutable: () => IsImmutable,
  IsInfer: () => IsInfer,
  IsInteger: () => IsInteger2,
  IsIntersect: () => IsIntersect,
  IsKind: () => IsKind,
  IsLiteral: () => IsLiteral,
  IsNever: () => IsNever,
  IsNull: () => IsNull2,
  IsNumber: () => IsNumber3,
  IsObject: () => IsObject2,
  IsOptional: () => IsOptional,
  IsParameter: () => IsParameter,
  IsReadonly: () => IsReadonly,
  IsRecord: () => IsRecord,
  IsRef: () => IsRef,
  IsRefine: () => IsRefine,
  IsRest: () => IsRest,
  IsSchema: () => IsSchema,
  IsString: () => IsString3,
  IsSymbol: () => IsSymbol2,
  IsTemplateLiteral: () => IsTemplateLiteral,
  IsThis: () => IsThis,
  IsTuple: () => IsTuple,
  IsUndefined: () => IsUndefined2,
  IsUnion: () => IsUnion,
  IsUnknown: () => IsUnknown,
  IsUnsafe: () => IsUnsafe,
  IsVoid: () => IsVoid,
  KeyOf: () => KeyOf2,
  Literal: () => Literal,
  Lowercase: () => Lowercase,
  Mapped: () => Mapped,
  Module: () => Module2,
  Never: () => Never,
  NonNullable: () => NonNullable,
  Null: () => Null,
  Number: () => Number2,
  Object: () => _Object_,
  Omit: () => Omit,
  Optional: () => Optional,
  Parameter: () => Parameter,
  Parameters: () => Parameters,
  Partial: () => Partial,
  Pick: () => Pick,
  Readonly: () => Readonly,
  ReadonlyObject: () => ReadonlyObject,
  ReadonlyType: () => ReadonlyType,
  Record: () => Record,
  RecordKey: () => RecordKey,
  RecordPattern: () => RecordPattern,
  RecordValue: () => RecordValue,
  Ref: () => Ref,
  Refine: () => Refine,
  Required: () => Required,
  Rest: () => Rest,
  ReturnType: () => ReturnType,
  Script: () => Script2,
  String: () => String2,
  Symbol: () => Symbol2,
  TemplateLiteral: () => TemplateLiteral2,
  This: () => This,
  Tuple: () => Tuple,
  Uncapitalize: () => Uncapitalize,
  Undefined: () => Undefined,
  Union: () => Union,
  Unknown: () => Unknown,
  Unsafe: () => Unsafe,
  Uppercase: () => Uppercase,
  Void: () => Void,
  With: () => With2
});

// plugins/jig-core/src/kit/schema.ts
function stringEnum(values, options2 = {}) {
  return typebox_exports.Unsafe({
    type: "string",
    enum: [...values],
    ...options2.description === void 0 ? {} : { description: options2.description },
    ...options2.default === void 0 ? {} : { default: options2.default }
  });
}

// plugins/jig-core/src/kit/actions.ts
function signature(spec) {
  return `{${[...spec.required ?? [], ...(spec.optional ?? []).map((name) => `${name}?`)].join(", ")}}`;
}
function usageLine(tool, action, spec) {
  return `Usage: ${tool} ${action} ${signature(spec)}`;
}
function unknownAction(tool, action, actions) {
  let listed = [...actions];
  while (listed.length > 1 && listed.join(", ").length > 100) listed = listed.slice(0, -1);
  const suffix = listed.length < actions.length ? ", ..." : "";
  return `${tool}: unknown action ${JSON.stringify(String(action).slice(0, 40))}. Usage: ${tool} <action> (${listed.join(", ")}${suffix})`;
}
function checkParams(tool, table, params) {
  const input = params;
  const action = input.action;
  if (typeof action !== "string" || !Object.hasOwn(table, action)) {
    throw new Error(unknownAction(tool, action, Object.keys(table)));
  }
  const spec = table[action];
  const usage = usageLine(tool, action, spec);
  const accepted = /* @__PURE__ */ new Set([
    "action",
    ...spec.required ?? [],
    ...(spec.optional ?? []).map((name) => name)
  ]);
  for (const [name, value] of Object.entries(input)) {
    if (value !== void 0 && !accepted.has(name))
      throw new Error(`${tool} ${action} does not use ${name}. ${usage}`);
  }
  const missing = (spec.required ?? []).filter((name) => input[name] === void 0);
  if (missing.length > 0) throw new Error(`${tool} ${action} needs ${missing.join(", ")}. ${usage}`);
  return action;
}
function describeActions(table) {
  return Object.entries(table).map(([action, spec]) => `- ${action}: ${spec.summary}`).join("\n");
}
function previewChanged(label, detail) {
  return `${label}: changed since the preview${detail === void 0 ? "" : ` (${detail})`}. Nothing was changed; run it again to see the new preview.`;
}

// plugins/jig-git/src/pr-write.ts
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";

// plugins/jig-git/src/ci.ts
var FAILED = /* @__PURE__ */ new Set([
  "failure",
  "timed_out",
  "cancelled",
  "canceled",
  "action_required",
  "startup_failure",
  "stale",
  "error"
]);
var PASSED = /* @__PURE__ */ new Set(["success", "neutral", "passed"]);
function bucketOf(status, conclusion) {
  const outcome = (conclusion ?? "").toLowerCase();
  const state = (status ?? "").toLowerCase();
  if (state !== "" && state !== "completed") return "pending";
  if (outcome === "" || outcome === "pending" || outcome === "expected" || outcome === "queued" || outcome === "in_progress" || outcome === "waiting")
    return "pending";
  if (outcome === "skipped" || outcome === "skipping") return "skipped";
  if (FAILED.has(outcome)) return "fail";
  return PASSED.has(outcome) ? "pass" : "fail";
}
function fromRollup(item) {
  const isStatus = item.__typename === "StatusContext" || item.context !== void 0 && item.name === void 0;
  return {
    name: item.name ?? item.context ?? "check",
    bucket: isStatus ? bucketOf("completed", item.state === "PENDING" ? "pending" : item.state) : bucketOf(item.status, item.conclusion),
    detail: (item.conclusion || item.state || item.status || "").toLowerCase() || void 0,
    url: item.detailsUrl ?? item.targetUrl
  };
}
function count(checks) {
  const counts = { pass: 0, fail: 0, pending: 0, skipped: 0 };
  for (const check of checks) counts[check.bucket]++;
  return counts;
}
function describeCounts(counts) {
  return `${counts.pass} pass, ${counts.fail} fail, ${counts.pending} pending, ${counts.skipped} skipped`;
}

// plugins/jig-git/src/origin-host.ts
var GITHUB_COM = "github.com";
var GITLAB_COM = "gitlab.com";
var T_SSH_G = 3e3;
var RETRY_MS = 6e4;
var HOST3 = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function isSshOrigin(url) {
  const address = url.trim();
  if (/^ssh:\/\//i.test(address)) return true;
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(address) && /^[^@/\s]+@[^/:\s]+:/.test(address);
}
function byConvention(host) {
  if (host.startsWith("github.com-") || host === "ssh.github.com") return GITHUB_COM;
  return host === "altssh.gitlab.com" ? GITLAB_COM : host;
}
var known = /* @__PURE__ */ new Map();
var asking = /* @__PURE__ */ new Map();
async function askSsh(host) {
  try {
    const result = await jig().exec.run("ssh", ["-G", host], { timeoutMs: T_SSH_G, input: "" });
    if (result.code !== 0 || result.timedOut) return void 0;
    const name = /^hostname[ \t]+(\S+)[ \t]*$/m.exec(result.stdout)?.[1]?.toLowerCase();
    return name !== void 0 && HOST3.test(name) ? name : void 0;
  } catch {
    return void 0;
  }
}
async function sshHostname(host) {
  if (!HOST3.test(host)) return void 0;
  const earlier = known.get(host);
  if (earlier !== void 0 && earlier.until > Date.now()) return earlier.answer;
  let pending = asking.get(host);
  if (pending === void 0) {
    pending = askSsh(host).then((answer) => {
      known.set(host, { answer, until: answer === void 0 ? Date.now() + RETRY_MS : Number.POSITIVE_INFINITY });
      asking.delete(host);
      return answer;
    });
    asking.set(host, pending);
  }
  return pending;
}
async function originHost(url, host, settings2) {
  const alias = host.toLowerCase();
  const answered = isSshOrigin(url) ? await sshHostname(alias) : void 0;
  const real = byConvention(answered ?? alias);
  const entry2 = settings2.forges?.[alias] ?? settings2.forges?.[real];
  const configured = typeof entry2 === "string" ? entry2 : entry2?.forge;
  const named = typeof entry2 === "object" ? entry2.host : void 0;
  return {
    alias,
    real,
    ...configured === void 0 ? {} : { configured },
    told: named ?? real,
    explicit: named !== void 0
  };
}
function accountHosts(host, settings2) {
  const hosts = [host.told];
  if (isGithubOrigin(host, settings2)) hosts.push(githubHostOf(host));
  hosts.push(host.real, host.alias);
  return [...new Set(hosts.map((name) => name.toLowerCase()))];
}
function isGithubOrigin(host, settings2) {
  return host.real === GITHUB_COM || host.alias === settings2.cloneHost.toLowerCase();
}
function githubHostOf(host) {
  return host.real === host.alias ? GITHUB_COM : host.real;
}

// plugins/jig-git/src/repo.ts
import fs from "node:fs";
import path from "node:path";

// plugins/jig-git/src/run.ts
var T_LOCAL = 3e4;
var T_NETWORK = 6e4;
var T_PUSH = 12e4;
function networkEnv() {
  const socket = process.env.SSH_AUTH_SOCK;
  return socket === void 0 ? {} : { SSH_AUTH_SOCK: socket };
}
function git(repo, args, options2 = {}) {
  return jig().exec.git(repo, args, {
    timeoutMs: options2.timeoutMs ?? (options2.network ? T_NETWORK : T_LOCAL),
    signal: options2.signal,
    input: options2.input,
    maxOutputBytes: options2.maxBytes,
    env: options2.network ? { ...networkEnv(), ...options2.env } : options2.env
  });
}
function scrub(text) {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1");
}
function summaryOf(text, count2 = 3) {
  const lines2 = scrub(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const joined = lines2.slice(0, count2).join("; ");
  return joined.length > 400 ? `${joined.slice(0, 400)}...` : joined;
}
function failure(args, result) {
  const sub = args.find((arg) => !arg.startsWith("-") && !arg.includes("=")) ?? "command";
  if (result.timedOut) return new Error(`git ${sub} timed out`);
  return new Error(`git ${sub} failed: ${summaryOf(result.stderr || result.stdout) || `exit ${result.code}`}`);
}
async function gitOut(repo, args, options2 = {}) {
  const result = await git(repo, args, options2);
  if (result.code !== 0 || result.timedOut) throw failure(args, result);
  return result.stdout;
}
async function gitTry(repo, args, options2 = {}) {
  const result = await git(repo, args, options2);
  return result.code === 0 && !result.timedOut ? result.stdout : void 0;
}
async function revParse(repo, ref, signal) {
  const out = await gitTry(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { signal });
  return out?.trim() || void 0;
}
async function refExists(repo, ref, signal) {
  return await revParse(repo, ref, signal) !== void 0;
}
async function currentBranch(repo, signal) {
  const out = await gitTry(repo, ["branch", "--show-current"], { signal });
  return out?.trim() || void 0;
}
function mayHaveLanded(result) {
  if (result.timedOut) return true;
  if (result.code === 0) return false;
  return /timed? ?out|deadline exceeded|connection (?:reset|closed|aborted)|broken pipe|unexpected eof|\beof\b|hung up|tls handshake|HTTP 5\d\d|\b50[0-4]\b/i.test(
    result.stderr
  );
}

// plugins/jig-git/src/repo.ts
var DIR_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
var startDirectory = process.cwd();
function workingDirectory() {
  return startDirectory;
}
function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
async function topLevel(dir, signal) {
  if (!isDirectory(dir)) return void 0;
  const out = await gitTry(dir, ["rev-parse", "--show-toplevel"], { signal });
  if (out === void 0 || out.trim() === "") return void 0;
  try {
    return fs.realpathSync(out.trim());
  } catch {
    return void 0;
  }
}
async function repoHere(signal, cwd) {
  const root = await topLevel(cwd ?? workingDirectory(), signal);
  return root === void 0 ? void 0 : { root, name: path.basename(root) };
}
async function workspaceRoot(signal, cwd) {
  const here = await repoHere(signal, cwd);
  const folder = here === void 0 ? cwd ?? workingDirectory() : path.dirname(here.root);
  try {
    return fs.realpathSync(folder);
  } catch {
    return folder;
  }
}
async function resolveRepo(input, signal, cwd) {
  const start = cwd ?? workingDirectory();
  if (input === void 0 || input === "") {
    const here = await repoHere(signal, cwd);
    if (here) return here;
    throw new Error(
      `repo is required: Pi was not started inside a git repository. Name a folder in ${await workspaceRoot(signal, cwd)} or give an absolute path`
    );
  }
  if (input.includes("\0") || input.length > 1e3) throw new Error("repo is not a valid name or path");
  const workspace = await workspaceRoot(signal, cwd);
  const byName = !path.isAbsolute(input);
  if (byName && !DIR_NAME.test(input)) {
    if (/^[^/\s]+\/[^/\s]+$/.test(input)) {
      const matches = [];
      try {
        for (const name of fs.readdirSync(workspace)) {
          if (name.startsWith(".")) continue;
          const candidate = path.join(workspace, name);
          try {
            if (!fs.statSync(candidate).isDirectory()) continue;
            const root2 = await topLevel(candidate, signal);
            if (root2 === void 0) continue;
            const remote = parseRemote(await originUrl({ root: root2, name }, signal));
            if (remote?.slug === input) matches.push(name);
          } catch {
          }
        }
      } catch {
      }
      if (matches.length === 1)
        return { root: path.join(workspace, matches[0]), name: matches[0] };
      throw new Error(
        matches.length === 0 ? `repo "${input.slice(0, 80)}": no folder in ${workspace} has that origin` : `repo "${input.slice(0, 80)}" matches several folders: ${matches.slice(0, 10).join(", ")}; use one name`
      );
    }
    throw new Error(
      `repo "${input.slice(0, 80)}" must be a folder name in ${workspace}, an owner/name whose origin matches one folder, or an absolute path inside a git work tree`
    );
  }
  if (!byName && input.split("/").includes(".."))
    throw new Error(`repo path must not contain "..": ${input.slice(0, 120)}`);
  const wanted = byName ? path.join(workspace, input) : input;
  const fallback = byName ? path.join(start, input) : input;
  let real;
  try {
    real = fs.realpathSync(wanted);
    if (!fs.statSync(real).isDirectory()) throw new Error("not a directory");
  } catch {
    try {
      real = fs.realpathSync(fallback);
      if (!fs.statSync(real).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new Error(
        byName ? `repo "${input}" not found in ${workspace} or ${start}` : `repo path ${input.slice(0, 120)} is not an existing directory`
      );
    }
  }
  const root = await topLevel(real, signal);
  if (root === void 0) throw new Error(`"${input.slice(0, 120)}" is not inside a git work tree`);
  if (byName) {
    const inside = (parent) => real === parent || real.startsWith(parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`);
    if (!inside(workspace) && !inside(start))
      throw new Error(`repo "${input}" resolves outside ${workspace} and ${start}`);
    if (root !== real) throw new Error(`"${input}" in ${workspace} is not the root of a git repository`);
  }
  return { root, name: byName ? input : root };
}
function parseRemote(url) {
  if (!url) return void 0;
  const match = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|git:\/\/|[^@/\s]+@)([^/:\s]+)(?::\d+)?[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
    url.trim()
  );
  if (!match) return void 0;
  const [, host, owner, name] = match;
  return { host, owner, name, slug: `${owner}/${name}` };
}
var PATH_PART = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
var MAX_PATH_PARTS = 20;
function parseRemotePath(url) {
  if (!url) return void 0;
  const match = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|git:\/\/|[^@/\s]+@)([^/:\s]+)(?::\d+)?[/:]([^\s?#]+?)(?:\.git)?\/?$/.exec(
    url.trim()
  );
  if (!match) return void 0;
  const [, host, path3] = match;
  const parts = path3.split("/");
  if (parts.length < 2 || parts.length > MAX_PATH_PARTS || !parts.every((part) => PATH_PART.test(part)))
    return void 0;
  return { host, path: parts.join("/") };
}
async function originUrl(repo, signal) {
  const out = await gitTry(repo.root, ["config", "--get", "remote.origin.url"], { signal });
  return out === void 0 ? void 0 : scrub(out.trim());
}
async function githubRepo(repo, settings2, signal) {
  const url = await originUrl(repo, signal);
  const remote = parseRemote(url);
  if (!remote || url === void 0) return void 0;
  const origin = await originHost(url, remote.host, settings2);
  if (origin.configured === "gitlab") return void 0;
  const account = accountHosts(origin, settings2).map((name) => accountFor(settings2.accounts, `${name}:${remote.slug}`)).find((found) => found !== void 0);
  const withAccount = account === void 0 ? {} : { account };
  if (origin.configured === "github") return { ...remote, host: origin.told, ...withAccount };
  return isGithubOrigin(origin, settings2) ? { ...remote, host: githubHostOf(origin), ...withAccount } : void 0;
}
var defaults = /* @__PURE__ */ new Map();
async function defaultBranch(repo, signal) {
  const known2 = defaults.get(repo.root);
  if (known2 !== void 0) return known2;
  let name = (await gitTry(repo.root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { signal }))?.trim().replace(/^origin\//, "");
  if (!name) {
    const asked = await gitTry(repo.root, ["ls-remote", "--symref", "origin", "HEAD"], {
      signal,
      network: true,
      timeoutMs: T_NETWORK
    });
    name = /^ref: refs\/heads\/(\S+)\s+HEAD/m.exec(asked ?? "")?.[1];
  }
  if (!name) {
    for (const guess of ["main", "master"]) {
      if (await refExists(repo.root, `refs/remotes/origin/${guess}`, signal) || await refExists(repo.root, `refs/heads/${guess}`, signal)) {
        name = guess;
        break;
      }
    }
  }
  if (name) defaults.set(repo.root, name);
  return name;
}
async function baseBranch(repo, settings2, signal) {
  const base = settings2.base ?? await defaultBranch(repo, signal);
  if (!base) throw new Error(`cannot tell the default branch of ${repo.name}; set git.base in jig.json`);
  return base;
}

// plugins/jig-git/src/forge.ts
var UnknownForgeHost = class extends Error {
  constructor(name, host, real = host) {
    super(
      real === host ? `origin of ${name} is on ${host}, which jig-git does not know as GitHub or GitLab; name it in jig.json, such as "git": { "forges": { "${host}": "gitlab" } }, or, when it is an ssh alias for a real host, "git": { "forges": { "${host}": { "forge": "github", "host": "github.com" } } }` : `origin of ${name} is on ${host}, which ssh resolves to ${real}, which jig-git does not know as GitHub or GitLab; name it in jig.json, such as "git": { "forges": { "${real}": "gitlab" } }`
    );
    this.name = "UnknownForgeHost";
  }
};
async function forgeOf(repo, settings2, signal) {
  const url = await originUrl(repo, signal);
  const remote = parseRemotePath(url);
  if (remote === void 0 || url === void 0) return { forge: "github" };
  const origin = await originHost(url, remote.host, settings2);
  if (origin.configured === "github") {
    return origin.explicit || origin.told !== origin.alias ? { forge: "github", host: origin.told } : { forge: "github" };
  }
  if (origin.configured === "gitlab") return { forge: "gitlab", host: origin.told, path: remote.path };
  if (isGithubOrigin(origin, settings2)) return { forge: "github" };
  if (origin.real === GITLAB_COM) return { forge: "gitlab", host: GITLAB_COM, path: remote.path };
  throw new UnknownForgeHost(repo.name, origin.alias, origin.real);
}
async function gitlabHome(repo, settings2, signal) {
  try {
    const home = await forgeOf(repo, settings2, signal);
    return home.forge === "gitlab" ? home : void 0;
  } catch (error) {
    if (error instanceof UnknownForgeHost) return void 0;
    throw error;
  }
}

// plugins/jig-git/src/api-output.ts
function parseApiOutput(result) {
  const head = /^HTTP\/[\d.]+ (\d{3})[^\n]*\r?\n/.exec(result.stdout);
  if (!head) {
    const status = /HTTP (\d{3})/.exec(result.stderr)?.[1];
    return { status: status ? Number(status) : result.code === 0 ? 200 : 0, headers: {}, body: result.stdout };
  }
  const rest = result.stdout.slice(head[0].length);
  const split = rest.search(/\r?\n\r?\n/);
  const headerText = split < 0 ? rest : rest.slice(0, split);
  const body = split < 0 ? "" : rest.slice(split).replace(/^\r?\n\r?\n/, "");
  const headers = {};
  for (const line of headerText.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { status: Number(head[1]), headers, body };
}

// plugins/jig-git/src/github.ts
var T_GH_READ = 3e4;
var T_GH_WRITE = 9e4;
var lastTarget;
async function targetFor(cwd, signal) {
  if (cwd === void 0) return void 0;
  const settings2 = gitSettings();
  if (settings2.accounts === void 0) return void 0;
  try {
    const url = await originUrl({ root: cwd, name: cwd }, signal);
    const remote = parseRemote(url);
    if (url === void 0 || remote === void 0) return void 0;
    const origin = await originHost(url, remote.host, settings2);
    const account = accountHosts(origin, settings2).map((name) => accountFor(settings2.accounts, `${name}:${remote.slug}`)).find((found) => found !== void 0);
    const host = origin.explicit ? origin.told : isGithubOrigin(origin, settings2) ? githubHostOf(origin) : origin.told;
    return account === void 0 ? void 0 : { account, host, remote: `${host}:${remote.slug}` };
  } catch {
    return void 0;
  }
}
async function gh(args, options2 = {}) {
  const target = options2.account === void 0 ? await targetFor(options2.cwd, options2.signal) : { account: options2.account, host: options2.host ?? GITHUB_COM, remote: options2.host ?? GITHUB_COM };
  lastTarget = target;
  const host = options2.host ?? target?.host;
  return jig().exec.run("gh", args, {
    cwd: options2.cwd,
    timeoutMs: options2.timeoutMs ?? T_GH_READ,
    signal: options2.signal,
    input: options2.input,
    maxOutputBytes: options2.maxBytes,
    // Jig reads the account's token and attaches it: this plugin names the account and never sees the token.
    ...target === void 0 ? {} : { credential: { program: "gh", account: target.account, host: target.host } },
    ...host === void 0 || host === GITHUB_COM ? {} : { env: { GH_HOST: host } }
  });
}
var SIGN_IN = /gh auth login|not logged in|HTTP 401|bad credentials|authentication required|no oauth token/i;
function ghFailure(what, result) {
  const reason = result.timedOut ? "timed out" : summaryOf(result.stderr || result.stdout) || `exit ${result.code}`;
  const hint = SIGN_IN.test(result.stderr) ? " (gh is not signed in: run gh auth login yourself)" : "";
  const target = lastTarget;
  const missed = target !== void 0 && /could not resolve to a repository|HTTP 404|\bnot found\b/i.test(`${result.stderr}
${result.stdout}`);
  const accountHint = missed && target !== void 0 ? ` (used gh account "${target.account}" for ${target.remote}; if that account cannot see it, add a "git.accounts" entry for this remote, or run "gh auth login" for that account)` : "";
  return new Error(`${what} failed: ${reason}${hint}${accountHint}`);
}
function ghJson(what, result) {
  if (result.code !== 0 || result.timedOut) throw ghFailure(what, result);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${what} returned output that is not JSON`);
  }
}
function repoArgument(remote) {
  return remote.host === GITHUB_COM ? remote.slug : `${remote.host}/${remote.slug}`;
}
async function repoFlags(repo, settings2, signal) {
  const remote = await githubRepo(repo, settings2, signal);
  return remote ? ["-R", repoArgument(remote)] : [];
}
async function requireRemote(repo, settings2, signal) {
  const remote = await githubRepo(repo, settings2, signal);
  if (!remote)
    throw new Error(`origin of ${repo.name} is not a GitHub repository, so GitHub cannot be asked about it`);
  return remote;
}
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
async function graphql(query, variables, options2 = {}) {
  const result = await gh(["api", "graphql", "--input", "-"], {
    ...options2,
    input: JSON.stringify({ query, variables })
  });
  const parsed = safeJson(result.stdout);
  if (parsed?.errors?.length) throw new Error(`GitHub: ${parsed.errors[0]?.message ?? "the query failed"}`);
  if (result.code !== 0 || result.timedOut || parsed?.data === void 0) throw ghFailure("gh api graphql", result);
  return parsed.data;
}
async function ghWrite(what, args, options2 = {}) {
  let result;
  try {
    result = await gh(args, { ...options2, timeoutMs: options2.timeoutMs ?? T_GH_WRITE });
  } catch (error) {
    if (options2.signal?.aborted) return { kind: "lost", why: "the call was cancelled" };
    throw error;
  }
  if (result.code === 0 && !result.timedOut) return { kind: "sent", result };
  if (options2.signal?.aborted || mayHaveLanded(result)) {
    return {
      kind: "lost",
      why: result.timedOut ? `timed out after ${Math.round((options2.timeoutMs ?? T_GH_WRITE) / 1e3)} s` : options2.signal?.aborted ? "the call was cancelled" : summaryOf(result.stderr)
    };
  }
  throw ghFailure(what, result);
}
async function afterLostReply(what, why, look, where = "GitHub") {
  let found;
  try {
    found = await look();
  } catch (error) {
    throw new Error(
      `${what}: the reply was lost (${why}) and the check failed too (${error.message}). Look at ${where} before trying again. Nothing was sent twice.`
    );
  }
  if (found === void 0) {
    throw new Error(
      `${what}: the reply was lost (${why}) and one check shows it did not go through. Nothing was sent twice; run it again if you still want it.`
    );
  }
  return {
    text: `${found}
(The reply was lost (${why}); one check shows it went through. Nothing was sent twice.)`
  };
}
function prNumberFromUrl(text) {
  const matches = [...text.matchAll(/\/pull\/(\d+)\b/g)];
  const last = matches.at(-1);
  return last ? Number(last[1]) : void 0;
}
function lastLine(text) {
  return text.trim().split("\n").filter(Boolean).at(-1) ?? "";
}

// plugins/jig-git/src/gitlab.ts
var T_READ = 3e4;
var T_WRITE = 9e4;
async function glab(args, options2 = {}) {
  return jig().exec.run("glab", args, {
    cwd: options2.cwd ?? process.cwd(),
    timeoutMs: options2.timeoutMs ?? T_READ,
    signal: options2.signal,
    input: options2.input,
    maxOutputBytes: options2.maxBytes
  });
}
var SIGN_IN2 = /glab auth login|not logged in|\b401\b|unauthorized|bad credentials|no token|authentication required|invalid token/i;
function statusOf(result) {
  const found = /\(HTTP (\d{3})\)|\bHTTP (\d{3})\b/.exec(result.stderr);
  return found ? Number(found[1] ?? found[2]) : void 0;
}
function glabFailure(what, result, host, hints = {}) {
  const reason = result.timedOut ? "timed out" : summaryOf(result.stderr || result.stdout) || `exit ${result.code}`;
  const status = statusOf(result);
  let hint = "";
  if (SIGN_IN2.test(result.stderr))
    hint = ` (glab is not signed in${host ? ` for ${host}` : ""}: run glab auth login${host ? ` --hostname ${host}` : ""} yourself)`;
  else if (status !== void 0 && hints[status] !== void 0) hint = ` (${hints[status]})`;
  else if (status === 403) hint = " (GitLab refused it: your role, or the token's scope, does not allow this)";
  else if (status === 404)
    hint = " (GitLab has nothing at that address: it is gone, or the account glab is signed in as cannot see it)";
  return new Error(`${what} failed: ${reason}${hint}`);
}
function responseFailure(what, response, host) {
  const message = parse(response.body)?.message;
  const said = typeof message === "string" && message !== "" ? message : response.body;
  return glabFailure(
    what,
    { code: 1, stdout: "", stderr: `glab: ${said || "no answer"} (HTTP ${response.status})`, timedOut: false },
    host
  );
}
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
function projectBase(home) {
  return `projects/${encodeURIComponent(home.path)}`;
}
function withQuery(path3, params) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== void 0) query.set(name, String(value));
  const text = query.toString();
  return text === "" ? path3 : `${path3}?${text}`;
}
function apiArgs(home, endpoint2, request = {}) {
  const method = request.method ?? "GET";
  return [
    "api",
    ...request.include ? ["-i"] : [],
    "--hostname",
    home.host,
    ...method === "GET" ? [] : ["-X", method],
    ...request.etag ? ["-H", `If-None-Match: ${request.etag}`] : [],
    ...request.body === void 0 ? [] : ["--input", "-"],
    endpoint2
  ];
}
async function glabJson(home, what, endpoint2, options2 = {}) {
  const result = await glab(apiArgs(home, endpoint2), options2);
  if (result.code !== 0 || result.timedOut) throw glabFailure(what, result, home.host);
  const value = parse(result.stdout);
  if (value === void 0) throw new Error(`${what} returned output that is not JSON`);
  return value;
}
async function glabResponse(home, endpoint2, options2 = {}) {
  const result = await glab(apiArgs(home, endpoint2, { include: true, etag: options2.etag }), options2);
  const response = parseApiOutput(result);
  if (response.status === 0) return { ...response, body: summaryOf(result.stderr || result.stdout) };
  return response;
}
async function glabPages(home, what, endpoint2, maxPages, options2 = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const response = await glabResponse(
      home,
      `${endpoint2}${endpoint2.includes("?") ? "&" : "?"}page=${page}`,
      options2
    );
    if (response.status < 200 || response.status >= 300) throw responseFailure(what, response, home.host);
    const list = parse(response.body);
    if (!Array.isArray(list)) throw new Error(`${what} returned output that is not a list`);
    items.push(...list);
    if ((response.headers["x-next-page"] ?? "") === "") return { items, more: false };
  }
  return { items, more: true };
}
async function glabWrite(what, home, method, endpoint2, body, options2 = {}) {
  const args = apiArgs(home, endpoint2, { method, body });
  const input = JSON.stringify(body);
  let result;
  try {
    result = await glab(args, { ...options2, input, timeoutMs: options2.timeoutMs ?? T_WRITE });
  } catch (error) {
    if (options2.signal?.aborted) return { kind: "lost", why: "the call was cancelled" };
    throw error;
  }
  if (result.code === 0 && !result.timedOut) return { kind: "sent", result };
  if (options2.signal?.aborted || mayHaveLanded(result)) {
    return {
      kind: "lost",
      why: result.timedOut ? `timed out after ${Math.round((options2.timeoutMs ?? T_WRITE) / 1e3)} s` : options2.signal?.aborted ? "the call was cancelled" : summaryOf(result.stderr)
    };
  }
  throw glabFailure(what, result, home.host, options2.hints);
}
function answerOf(sent) {
  return parse(sent.result.stdout);
}
function mrUrl(home, iid) {
  return `https://${home.host}/${home.path}/-/merge_requests/${iid}`;
}

// plugins/jig-git/src/events.ts
var PUSHED_EVENT = "jig-git:pushed";
var publish = () => {
};
async function openPullRequest(repo, settings2, branch, signal) {
  try {
    const flags = await repoFlags(repo, settings2, signal);
    const result = await gh(
      ["pr", "list", "--head", branch, "--state", "open", "--limit", "1", "--json", "number", ...flags],
      { cwd: repo.root, signal }
    );
    return ghJson("gh pr list", result)[0]?.number;
  } catch {
    return void 0;
  }
}
async function openMergeRequest(repo, home, branch, signal) {
  try {
    const rows = await glabJson(
      home,
      "glab api (merge requests)",
      `${projectBase(home)}/${withQuery("merge_requests", { source_branch: branch, state: "opened", per_page: 1 })}`,
      { cwd: repo.root, signal }
    );
    return rows[0]?.iid;
  } catch {
    return void 0;
  }
}
function openWatches() {
  try {
    return new Map(
      jig().watches.list().filter((watch) => watch.status !== "done").map((watch) => [watch.id, watch.title])
    );
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
async function announcePushed(push) {
  const { repo, settings: settings2, branch, sha, signal } = push;
  const remote = await githubRepo(repo, settings2, signal);
  let name;
  let pr;
  let forge;
  if (remote) {
    forge = "github";
    name = remote.slug;
    pr = push.pr ?? await openPullRequest(repo, settings2, branch, signal);
  } else {
    const home = await gitlabHome(repo, settings2, signal);
    if (!home) return { published: false, watches: [] };
    forge = "gitlab";
    name = home.path;
    pr = push.pr ?? await openMergeRequest(repo, home, branch, signal);
  }
  const payload = { repo: name, branch, sha, ...pr === void 0 ? {} : { pr } };
  const before = openWatches();
  try {
    publish(PUSHED_EVENT, payload);
  } catch {
    return { published: false, forge, ...pr === void 0 ? {} : { pr }, watches: [] };
  }
  const watches = [...openWatches()].filter(([id]) => !before.has(id)).map(([id, title]) => ({ id, title }));
  return { published: true, forge, ...pr === void 0 ? {} : { pr }, watches };
}

// plugins/jig-git/src/previews.ts
import { createHash } from "node:crypto";
function digest(...parts) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}
function checkSeen(seen, planned, label) {
  if (seen?.fingerprint === void 0 || planned.preview.fingerprint === void 0) return;
  if (seen.fingerprint !== planned.preview.fingerprint) {
    throw new Error(previewChanged(label));
  }
}
function readOnly(summary, run2) {
  return { preview: { summary }, run: run2 };
}
function reviewPreview(summary, body, fingerprint, format = "markdown") {
  return { summary, body, format, fingerprint };
}

// plugins/jig-git/src/text.ts
function clip(text, max) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
function firstLines(text, maxLines) {
  const all = text.replace(/\n$/, "").split("\n");
  return { text: all.slice(0, maxLines).join("\n"), cut: Math.max(0, all.length - maxLines) };
}
function plural(count2, noun2) {
  return `${count2} ${noun2}${count2 === 1 ? "" : "s"}`;
}
function lines(...parts) {
  return parts.filter((part) => part !== void 0 && part !== false && part !== "").join("\n");
}

// plugins/jig-git/src/pr-read.ts
var VIEW_FIELDS = "number,title,state,isDraft,author,baseRefName,headRefName,headRefOid,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,url,body,labels,reviewRequests,autoMergeRequest";
var BODY_CHARS = 6e3;
async function selectorFor(repo, params, signal) {
  if (params.number !== void 0) return String(checkNumber(params.number));
  if (params.branch !== void 0) return checkBranch(params.branch);
  const branch = await currentBranch(repo.root, signal);
  if (!branch) throw new Error(`HEAD is detached in ${repo.name}; pass number or branch`);
  return branch;
}
async function viewPr(repo, selector, call, fields = VIEW_FIELDS) {
  const flags = await repoFlags(repo, call.settings, call.signal);
  return ghJson(
    "gh pr view",
    await gh(["pr", "view", selector, "--json", fields, ...flags], { cwd: repo.root, signal: call.signal })
  );
}
function checksOfPr(pr) {
  return (pr.statusCheckRollup ?? []).map(fromRollup);
}
function who(pr) {
  return pr.author?.login ? ` by @${pr.author.login}` : "";
}
function formatPr(repo, pr) {
  const checks = checksOfPr(pr);
  const counts = count(checks);
  const failing = checks.filter((check) => check.bucket === "fail").map((check) => check.name);
  const flags = [pr.state.toLowerCase(), pr.isDraft ? "draft" : ""].filter(Boolean).join(", ");
  const body = (pr.body ?? "").trim();
  const reviewers = (pr.reviewRequests ?? []).map((request) => request.login ?? request.name ?? request.slug ?? "").filter(Boolean);
  const merge = pr.autoMergeRequest ? `auto-merge on (${(pr.autoMergeRequest.mergeMethod ?? "merge").toLowerCase()})` : void 0;
  return [
    `PR #${pr.number} ${pr.title} [${flags}]${who(pr)} in ${repo.name}`,
    `${pr.headRefName} -> ${pr.baseRefName} at ${pr.headRefOid.slice(0, 7)}; mergeable: ${pr.mergeable || "UNKNOWN"}; review: ${pr.reviewDecision || "none"}`,
    `checks: ${describeCounts(counts)}${failing.length > 0 ? `; failing: ${failing.slice(0, 5).join(", ")}` : ""}`,
    (pr.labels ?? []).length > 0 ? `labels: ${(pr.labels ?? []).map((label) => label.name).join(", ")}` : "",
    reviewers.length > 0 ? `review requested from: ${reviewers.join(", ")}` : "",
    merge ?? "",
    pr.url,
    body ? `
${clip(body, BODY_CHARS)}${body.length > BODY_CHARS ? `
(${body.length - BODY_CHARS} more characters)` : ""}` : ""
  ].filter((line) => line !== "").join("\n");
}
function planView(params, call) {
  return readOnly(`pr view ${params.number ?? params.branch ?? "here"} in ${params.repo ?? "here"}`, async () => {
    const repo = await resolveRepo(params.repo, call.signal, call.cwd);
    const pr = await viewPr(repo, await selectorFor(repo, params, call.signal), call);
    return {
      text: formatPr(repo, pr),
      facts: { pr: pr.number },
      details: { number: pr.number, head: pr.headRefOid, state: pr.state }
    };
  });
}
function planList(params, call) {
  const state = params.state ?? "open";
  if (!["open", "closed", "merged", "all"].includes(state))
    throw new Error("pr list: state must be one of open, closed, merged, all");
  const author = params.author === void 0 ? void 0 : checkLine(params.author, "author");
  const head = params.branch === void 0 ? void 0 : checkBranch(params.branch);
  const limit = Math.max(1, Math.min(50, Math.trunc(params.limit ?? 20)));
  return readOnly(`pr list in ${params.repo ?? "here"}`, async () => {
    const repo = await resolveRepo(params.repo, call.signal, call.cwd);
    const flags = await repoFlags(repo, call.settings, call.signal);
    const args = [
      "pr",
      "list",
      "--state",
      state,
      "--limit",
      String(limit),
      "--json",
      "number,title,state,isDraft,headRefName,baseRefName,url,author",
      ...author ? [`--author=${author}`] : [],
      ...head ? ["--head", head] : [],
      ...flags
    ];
    const rows = ghJson("gh pr list", await gh(args, { cwd: repo.root, signal: call.signal }));
    if (rows.length === 0) return { text: `No pull requests match in ${repo.name}.` };
    const lines2 = rows.map(
      (row) => `#${row.number} ${row.state.toLowerCase()}${row.isDraft ? " draft" : ""} ${row.headRefName} -> ${row.baseRefName}  ${clip(row.title, 100)}${row.author?.login ? `  @${row.author.login}` : ""}`
    );
    return {
      text: `${repo.name}: ${plural(rows.length, "pull request")}
${lines2.join("\n")}`,
      details: { numbers: rows.map((row) => row.number) }
    };
  });
}
var QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      url
      comments(first: 100) { totalCount nodes { author { login } body createdAt url } }
      reviews(first: 100) { totalCount nodes { author { login } state body submittedAt url } }
      reviewThreads(first: 100) {
        totalCount
        nodes { id isResolved isOutdated path line comments(first: 50) { nodes { author { login } body createdAt url } } }
      }
    }
  }
}`;
var login = (node) => node.author?.login ?? "unknown";
var MAX_CHARS = 6e4;
var BODY_LIMIT = 6e3;
function entry(head, body) {
  const text = body.trim();
  return `${head}
${clip(text, BODY_LIMIT).replace(/^/gm, "    ")}${text.length > BODY_LIMIT ? `
    (${text.length - BODY_LIMIT} more characters)` : ""}`;
}
function planComments(params, call) {
  const author = params.author === void 0 ? void 0 : checkLine(params.author, "author").replace(/^@/, "");
  return readOnly(`pr comments ${params.number ?? params.branch ?? "here"} in ${params.repo ?? "here"}`, async () => {
    const repo = await resolveRepo(params.repo, call.signal, call.cwd);
    const remote = await requireRemote(repo, call.settings, call.signal);
    const { slug } = remote;
    const number = params.number ?? ghJson(
      "gh pr view",
      await gh(
        [
          "pr",
          "view",
          await selectorFor(repo, params, call.signal),
          "--json",
          "number",
          ...await repoFlags(repo, call.settings, call.signal)
        ],
        { cwd: repo.root, signal: call.signal }
      )
    ).number;
    const [owner = "", name = ""] = slug.split("/");
    const data = await graphql(
      QUERY,
      { owner, name, number },
      { cwd: repo.root, signal: call.signal, host: remote.host }
    );
    const pr = data.repository.pullRequest;
    if (!pr) throw new Error(`pull request ${number} was not found in ${slug}`);
    const mentions = (node) => author === void 0 || login(node).toLowerCase() === author.toLowerCase();
    const items = [];
    if (!params.unresolved) {
      for (const comment of pr.comments.nodes.filter(mentions))
        items.push({
          at: comment.createdAt ?? "",
          text: entry(
            `${(comment.createdAt ?? "").slice(0, 16)} comment @${login(comment)}`,
            comment.body ?? ""
          )
        });
      for (const review of pr.reviews.nodes.filter((node) => mentions(node) && (node.body ?? "").trim() !== "")) {
        items.push({
          at: review.submittedAt ?? "",
          text: entry(
            `${(review.submittedAt ?? "").slice(0, 16)} review ${(review.state ?? "").toLowerCase()} @${login(review)}`,
            review.body ?? ""
          )
        });
      }
    }
    for (const thread of pr.reviewThreads.nodes) {
      if (params.unresolved && thread.isResolved) continue;
      if (author !== void 0 && !thread.comments.nodes.some(mentions)) continue;
      const where = `${thread.path}${thread.line ? `:${thread.line}` : ""}`;
      const state = `${thread.isResolved ? "resolved" : "unresolved"}${thread.isOutdated ? ", outdated" : ""}`;
      const inner = thread.comments.nodes.map(
        (comment, index) => entry(
          `${index === 0 ? "" : "reply "}@${login(comment)} ${(comment.createdAt ?? "").slice(0, 16)}`,
          comment.body ?? ""
        ).replace(/^/gm, "  ")
      ).join("\n");
      items.push({
        at: thread.comments.nodes[0]?.createdAt ?? "",
        text: `thread ${thread.id} ${where} [${state}]
${inner}`
      });
    }
    items.sort((a, b) => a.at.localeCompare(b.at));
    const shown = [];
    let size = 0;
    for (const item of items) {
      if (size + item.text.length > MAX_CHARS && shown.length > 0) break;
      shown.push(item.text);
      size += item.text.length;
    }
    const left = items.length - shown.length;
    const more = [
      pr.comments.totalCount > 100 ? "comments" : "",
      pr.reviews.totalCount > 100 ? "reviews" : "",
      pr.reviewThreads.totalCount > 100 ? "threads" : ""
    ].filter(Boolean);
    if (items.length === 0)
      return {
        text: `pull request ${number}: nothing to show${params.unresolved ? " (no unresolved threads)" : ""}.`
      };
    return {
      text: [
        `pull request ${number}: ${plural(items.length, "item")}`,
        ...shown,
        left > 0 ? `... ${left} more items; filter by author or unresolved` : "",
        more.length > 0 ? `(GitHub holds more than 100 ${more.join(", ")}; only the first 100 of each are read)` : ""
      ].filter(Boolean).join("\n"),
      details: { threads: pr.reviewThreads.nodes.map((thread) => thread.id) }
    };
  });
}

// plugins/jig-git/src/pr-watch.ts
var WATCH_KIND = "pr-comments";
var WATCH_DAYS = 7;
var MAX_WAIT_MS = 10 * 6e4;
var isGitlab = (spec) => spec.forge === "gitlab";
var noun = (spec) => isGitlab(spec) ? "merge request" : "pull request";
var titleOf = (spec) => isGitlab(spec) ? `comments on merge request ${spec.number} in ${spec.host}/${spec.slug}` : `comments on pull request ${spec.number} in ${spec.host === void 0 ? "" : `${spec.host}/`}${spec.slug}`;
function startCommentWatch(spec) {
  const title = titleOf(spec);
  const open = jig().watches.list().find((watch) => watch.kind === WATCH_KIND && watch.title === title && watch.status !== "done");
  if (open !== void 0) return { id: open.id, already: true };
  const minutes = WATCH_DAYS * 24 * 60;
  const id = jig().watches.start({ kind: WATCH_KIND, spec, title, timeoutMinutes: minutes, stallMinutes: minutes });
  return { id, already: false };
}
function watchingText(spec, id, already) {
  return `${already ? "Already watching" : "Watching"} the comments on ${noun(spec)} ${spec.number} in ${spec.slug} as ${id}. New comments from people reach you in one message, checked about once a minute. The watch ends when the ${noun(spec)} is merged or closed, after ${WATCH_DAYS} days, or when the watch tool stops it.`;
}

// plugins/jig-git/src/pr-write.ts
var TEMPLATE_FILES = [
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
  "docs/PULL_REQUEST_TEMPLATE.md"
];
function readTemplate(repo, prTemplate, candidates = TEMPLATE_FILES) {
  const files = prTemplate === void 0 ? candidates.map((file) => path2.join(repo.root, file)) : [path2.resolve(repo.root, prTemplate.replace(/^~(?=\/|$)/, os.homedir()))];
  for (const file of files) {
    try {
      return fs2.readFileSync(file, "utf8");
    } catch {
    }
  }
  return void 0;
}
function ruledTitle(value, settings2) {
  const title = checkTitle(value);
  const pattern = settings2.prTitle;
  if (pattern !== void 0 && !new RegExp(pattern).test(title))
    throw new Error(`the pull request title does not match git.prTitle (${pattern})`);
  return title;
}
async function openPrFor(repo, branch, call) {
  const flags = await repoFlags(repo, call.settings, call.signal);
  const result = await gh(
    [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--limit",
      "5",
      "--json",
      "number,title,url,baseRefName,headRefName",
      ...flags
    ],
    { cwd: repo.root, signal: call.signal }
  );
  return ghJson("gh pr list", result).find((row) => row.headRefName === branch);
}
async function options(repo, call) {
  const remote = await githubRepo(repo, call.settings, call.signal);
  return {
    flags: remote === void 0 ? [] : ["-R", repoArgument(remote)],
    run: {
      cwd: repo.root,
      signal: call.signal,
      ...remote?.account === void 0 ? {} : { account: remote.account }
    }
  };
}
function afterwards(call) {
  return { ...call, signal: void 0 };
}
async function planCreate(params, call) {
  const repo = await resolveRepo(params.repo, call.signal, call.cwd);
  const { signal, settings: settings2 } = call;
  const title = ruledTitle(params.title, settings2);
  if (params.body === void 0 || params.body.trim() === "") {
    const template = readTemplate(repo, settings2.prTemplate);
    throw new InputError(
      `pr create needs body: write the description.${template === void 0 ? "" : `
Fill in this template:
---
${template.trimEnd()}
---`}`
    );
  }
  const body = checkBody(params.body);
  const branch = params.branch === void 0 ? await currentBranch(repo.root, signal) : checkBranch(params.branch);
  if (!branch) throw new InputError(`HEAD is detached in ${repo.name}; pass branch`);
  const base = params.base === void 0 ? await baseBranch(repo, settings2, signal) : checkBranch(params.base, "base");
  if (base === branch)
    throw new InputError(`head and base are both ${branch}; open the pull request from another branch`);
  const local = await revParse(repo.root, `refs/heads/${branch}`, signal);
  const remote = await revParse(repo.root, `refs/remotes/origin/${branch}`, signal);
  if (!local) throw new InputError(`branch ${branch} does not exist locally`);
  if (remote !== local)
    throw new InputError(
      `${branch} is not pushed to origin at its local tip; run git push first (this tool does not push)`
    );
  const existing = await openPrFor(repo, branch, call);
  const github = await githubRepo(repo, settings2, signal);
  const slug = github?.slug ?? repo.name;
  if (github !== void 0) {
    const { run: ghRun } = await options(repo, call);
    const seen = await gh(["repo", "view", repoArgument(github), "--json", "name"], { ...ghRun, signal });
    if (seen.code !== 0) {
      throw new InputError(
        `pr create: the gh account cannot see ${slug}; set git.accounts for this remote, or sign in to that account with gh auth login`
      );
    }
  }
  const draft = params.draft === true;
  const summary = existing ? `pull request ${existing.number} is already open for ${branch}; nothing will be created` : `create a pull request ${branch} -> ${base}${draft ? " (draft)" : ""} at ${local.slice(0, 7)} in ${repo.name}`;
  return {
    preview: reviewPreview(
      summary,
      `# ${title}

${body}`,
      digest("pr create", slug, branch, base, local, title, body, draft)
    ),
    run: async () => {
      if (existing) {
        return {
          text: `Pull request #${existing.number} is already open for ${branch} (base ${existing.baseRefName}): ${existing.url}. No new one was created.`,
          details: { number: existing.number, created: false }
        };
      }
      const { flags, run: run2 } = await options(repo, call);
      const sent = await ghWrite(
        "gh pr create",
        [
          "pr",
          "create",
          "--base",
          base,
          "--head",
          branch,
          `--title=${title}`,
          "--body-file",
          "-",
          ...draft ? ["--draft"] : [],
          ...flags
        ],
        { ...run2, input: body }
      );
      if (sent.kind === "sent") {
        const url = lastLine(sent.result.stdout);
        const number2 = prNumberFromUrl(url);
        if (number2 === void 0)
          throw new Error(
            `gh pr create printed no pull request URL; run pr list for ${branch} before trying again`
          );
        return finishCreate(
          repo,
          call,
          number2,
          branch,
          base,
          local,
          `Created pull request #${number2} ${branch} -> ${base} in ${repo.name}: ${url}`
        );
      }
      let number = 0;
      const found = await afterLostReply("gh pr create", sent.why, async () => {
        const row = await openPrFor(repo, branch, afterwards(call));
        if (!row) return void 0;
        number = row.number;
        return `Created pull request #${row.number} ${branch} -> ${base} in ${repo.name}: ${row.url}`;
      });
      return finishCreate(repo, call, number, branch, base, local, found.text);
    }
  };
}
async function finishCreate(repo, call, number, branch, base, sha, text) {
  await announcePushed({ repo, settings: call.settings, branch, sha, pr: number, signal: call.signal });
  const watching = await watchComments(repo, call, number);
  return {
    text: watching === void 0 ? text : `${text}
${watching.text}`,
    facts: { pr: number },
    details: { number, created: true, base, ...watching?.id === void 0 ? {} : { watch: watching.id } }
  };
}
async function watchComments(repo, call, number) {
  if (call.settings.watchComments !== "after-create") return void 0;
  try {
    const remote = await githubRepo(repo, call.settings, call.signal);
    if (!remote) return void 0;
    const spec = {
      slug: remote.slug,
      number,
      ...remote.host === GITHUB_COM ? {} : { host: remote.host },
      ...remote.account === void 0 ? {} : { account: remote.account }
    };
    const { id, already } = startCommentWatch(spec);
    return { id, text: watchingText(spec, id, already) };
  } catch (error) {
    return {
      text: `(The watch on its comments could not start: ${error.message}. pr watch starts it.)`
    };
  }
}
async function planEdit(params, call) {
  const number = checkNumber(params.number);
  const edit = {
    title: params.title === void 0 ? void 0 : ruledTitle(params.title, call.settings),
    body: params.body === void 0 ? void 0 : checkBody(params.body),
    base: params.base === void 0 ? void 0 : checkBranch(params.base, "base"),
    labels: params.labels === void 0 ? void 0 : checkWords(params.labels, "labels"),
    reviewers: params.reviewers === void 0 ? void 0 : checkWords(params.reviewers, "reviewers")
  };
  if (Object.values(edit).every((value) => value === void 0))
    throw new InputError(
      "pr edit needs title, body, base, labels or reviewers. Usage: pr edit {number, title?, body?, base?, labels?, reviewers?, repo?}"
    );
  const repo = await resolveRepo(params.repo, call.signal, call.cwd);
  const shown = lines(
    edit.title !== void 0 && `Title: ${edit.title}`,
    edit.base !== void 0 && `Base: ${edit.base}`,
    edit.labels !== void 0 && `Add labels: ${edit.labels.join(", ")}`,
    edit.reviewers !== void 0 && `Request review from: ${edit.reviewers.join(", ")}`,
    edit.body !== void 0 && `
New description (replaces the whole old one):

${edit.body}`
  );
  const changing = Object.entries(edit).filter(([, value]) => value !== void 0).map(([name]) => name);
  return {
    preview: reviewPreview(
      `edit the ${changing.join(", ")} of pull request ${number} in ${repo.name}`,
      shown,
      digest("pr edit", repo.root, number, edit)
    ),
    run: async () => {
      const { flags, run: run2 } = await options(repo, call);
      const args = [
        "pr",
        "edit",
        String(number),
        ...edit.title === void 0 ? [] : [`--title=${edit.title}`],
        ...edit.base === void 0 ? [] : ["--base", edit.base],
        ...edit.labels === void 0 ? [] : [`--add-label=${edit.labels.join(",")}`],
        ...edit.reviewers === void 0 ? [] : [`--add-reviewer=${edit.reviewers.join(",")}`],
        ...edit.body === void 0 ? [] : ["--body-file", "-"],
        ...flags
      ];
      const done = `Edited the ${changing.join(", ")} of pull request #${number} in ${repo.name}.`;
      const sent = await ghWrite("gh pr edit", args, { ...run2, input: edit.body });
      if (sent.kind === "sent") return { text: done, details: { number, changed: changing } };
      return afterLostReply("gh pr edit", sent.why, async () => {
        const now = await viewPr(
          repo,
          String(number),
          afterwards(call),
          "title,body,baseRefName,labels,reviewRequests"
        );
        const labels = (now.labels ?? []).map((label) => label.name);
        const asked = (now.reviewRequests ?? []).map(
          (request) => request.login ?? request.name ?? request.slug ?? ""
        );
        const same = (edit.title === void 0 || now.title === edit.title) && (edit.body === void 0 || (now.body ?? "").trim() === edit.body.trim()) && (edit.base === void 0 || now.baseRefName === edit.base) && (edit.labels === void 0 || edit.labels.every((label) => labels.includes(label))) && (edit.reviewers === void 0 || edit.reviewers.every((reviewer) => asked.includes(reviewer)));
        return same ? done : void 0;
      });
    }
  };
}
async function planReady(params, call) {
  const number = checkNumber(params.number);
  const repo = await resolveRepo(params.repo, call.signal, call.cwd);
  return {
    preview: {
      summary: `mark pull request ${number} in ${repo.name} ready for review`,
      fingerprint: digest("pr ready", repo.root, number)
    },
    run: async () => {
      const { flags, run: run2 } = await options(repo, call);
      const done = `Pull request #${number} in ${repo.name} is ready for review.`;
      const sent = await ghWrite("gh pr ready", ["pr", "ready", String(number), ...flags], run2);
      if (sent.kind === "sent") return { text: done };
      return afterLostReply(
        "gh pr ready",
        sent.why,
        async () => (await viewPr(repo, String(number), afterwards(call), "isDraft")).isDraft ? void 0 : done
      );
    }
  };
}
async function planComment(params, call) {
  const number = checkNumber(params.number);
  const body = checkBody(params.body);
  const repo = await resolveRepo(params.repo, call.signal, call.cwd);
  return {
    preview: reviewPreview(
      `comment on pull request ${number} in ${repo.name}`,
      body,
      digest("pr comment", repo.root, number, body)
    ),
    run: async () => {
      const started = (/* @__PURE__ */ new Date()).toISOString();
      const { flags, run: run2 } = await options(repo, call);
      const sent = await ghWrite(
        "gh pr comment",
        ["pr", "comment", String(number), "--body-file", "-", ...flags],
        { ...run2, input: body }
      );
      if (sent.kind === "sent") {
        const url = lastLine(sent.result.stdout);
        return {
          text: `Commented on pull request #${number} in ${repo.name}${url.startsWith("http") ? `: ${url}` : "."}`,
          details: { number, url: url || void 0 }
        };
      }
      return afterLostReply("gh pr comment", sent.why, async () => {
        const now = ghJson(
          "gh pr view",
          await gh(["pr", "view", String(number), "--json", "comments", ...flags], { cwd: repo.root })
        );
        const found = now.comments.slice(-10).find(
          (comment) => comment.body.trim() === body.trim() && comment.createdAt >= started.slice(0, 19)
        );
        return found ? `Commented on pull request #${number} in ${repo.name}: ${found.url}` : void 0;
      });
    }
  };
}
var REPLY = `mutation($thread: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $thread, body: $body}) { comment { url } }
}`;
var RESOLVE = `mutation($thread: ID!) {
  resolveReviewThread(input: {threadId: $thread}) { thread { isResolved } }
}`;
var THREAD = `query($thread: ID!) {
  node(id: $thread) { ... on PullRequestReviewThread { isResolved comments(last: 5) { nodes { body url createdAt } } } }
}`;
function checkThread(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_=-]{8,200}$/.test(value))
    throw new Error("thread must be a review thread id such as PRRT_kwDO...; pr comments lists them");
  return value;
}
async function mutate(what, query, variables, run2, look, done) {
  const sent = await ghWrite(what, ["api", "graphql", "--input", "-"], {
    ...run2,
    input: JSON.stringify({ query, variables })
  });
  if (sent.kind === "lost") return afterLostReply(what, sent.why, look);
  const parsed = JSON.parse(sent.result.stdout || "{}");
  if (parsed.errors?.length) throw new Error(`${what} failed: ${parsed.errors[0]?.message ?? "GitHub refused it"}`);
  return { text: done(parsed.data) };
}
async function planReply(params, call) {
  const thread = checkThread(params.thread);
  const body = checkBody(params.body);
  return {
    preview: reviewPreview(`reply in review thread ${thread}`, body, digest("pr reply", thread, body)),
    run: () => {
      const started = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19);
      return mutate(
        "gh api graphql (reply)",
        REPLY,
        { thread, body },
        { signal: call.signal },
        async () => {
          const now = await graphql(THREAD, { thread });
          const found = now.node?.comments?.nodes.find(
            (comment) => comment.body.trim() === body.trim() && comment.createdAt >= started
          );
          return found ? `Replied in review thread ${thread}: ${found.url}` : void 0;
        },
        (data) => `Replied in review thread ${thread}: ${data?.addPullRequestReviewThreadReply?.comment?.url ?? ""}`.trimEnd()
      );
    }
  };
}
async function planResolve(params, call) {
  const thread = checkThread(params.thread);
  return {
    preview: { summary: `resolve review thread ${thread}`, fingerprint: digest("pr resolve", thread) },
    run: () => mutate(
      "gh api graphql (resolve)",
      RESOLVE,
      { thread },
      { signal: call.signal },
      async () => (await graphql(THREAD, { thread })).node?.isResolved ? `Resolved review thread ${thread}.` : void 0,
      () => `Resolved review thread ${thread}.`
    )
  };
}
async function planReview(params, call) {
  const number = checkNumber(params.number);
  if (params.event !== "comment" && params.event !== "request_changes")
    throw new Error(
      "pr review sends a comment or requests changes. It never approves: approval stays with a person."
    );
  const body = checkBody(params.body);
  const repo = await resolveRepo(params.repo, call.signal, call.cwd);
  const verb = params.event === "comment" ? "a review comment" : "a request for changes";
  return {
    preview: reviewPreview(
      `send ${verb} on pull request ${number} in ${repo.name}`,
      body,
      digest("pr review", repo.root, number, params.event, body)
    ),
    run: async () => {
      const started = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19);
      const { flags, run: run2 } = await options(repo, call);
      const flag = params.event === "comment" ? "--comment" : "--request-changes";
      const done = `Sent ${verb} on pull request #${number} in ${repo.name}.`;
      const sent = await ghWrite(
        "gh pr review",
        ["pr", "review", String(number), flag, "--body-file", "-", ...flags],
        { ...run2, input: body }
      );
      if (sent.kind === "sent") return { text: done };
      return afterLostReply("gh pr review", sent.why, async () => {
        const now = ghJson(
          "gh pr view",
          await gh(["pr", "view", String(number), "--json", "reviews", ...flags], { cwd: repo.root })
        );
        const state = params.event === "comment" ? "COMMENTED" : "CHANGES_REQUESTED";
        return now.reviews.slice(-10).some(
          (review) => review.state === state && review.body.trim() === body.trim() && review.submittedAt >= started
        ) ? done : void 0;
      });
    }
  };
}
var METHODS = ["merge", "squash", "rebase"];
async function planMerge(params, call) {
  const number = checkNumber(params.number);
  if (!METHODS.includes(params.method)) throw new Error("method is required: merge, squash or rebase");
  const method = params.method;
  const auto = params.auto === true;
  const repo = await resolveRepo(params.repo, call.signal, call.cwd);
  const pr = await viewPr(repo, String(number), call);
  const state = pr.state ?? "OPEN";
  if (state !== "OPEN") throw new Error(`pull request ${number} is ${state.toLowerCase()}, not open`);
  if (pr.isDraft) throw new Error(`pull request ${number} is a draft; mark it ready for review first`);
  if (pr.mergeable === "CONFLICTING")
    throw new Error(
      `pull request ${number} conflicts with ${pr.baseRefName}; resolve the conflicts on ${pr.headRefName} first`
    );
  const counts = count(checksOfPr(pr));
  const head = pr.headRefOid;
  if (!head)
    throw new Error(`GitHub did not say which commit pull request ${number} is at, so the merge cannot be pinned`);
  const what = auto ? `turn on auto-merge (${method}) for` : `${method}-merge`;
  return {
    preview: {
      summary: `${what} pull request ${number} into ${pr.baseRefName} in ${repo.name}: ${pr.title} (head ${head.slice(0, 7)})`,
      body: lines(
        `${pr.title}`,
        `From ${pr.headRefName} at ${head.slice(0, 7)} into ${pr.baseRefName}, by ${method}.`,
        `Checks: ${describeCounts(counts)}. Review: ${pr.reviewDecision || "none"}.`,
        `It merges only while the head is still ${head.slice(0, 7)}.`
      ),
      format: "text",
      fingerprint: digest("pr merge", repo.root, number, pr.title, method, head, pr.baseRefName, auto)
    },
    run: async () => {
      const { flags, run: run2 } = await options(repo, call);
      const done = auto ? `Auto-merge is on for pull request #${number} (${method}) in ${repo.name}: it merges when its requirements are met.` : `Merged pull request #${number} into ${pr.baseRefName} (${method}) at ${head.slice(0, 7)} in ${repo.name}.`;
      const sent = await ghWrite(
        "gh pr merge",
        [
          "pr",
          "merge",
          String(number),
          `--${method}`,
          "--match-head-commit",
          head,
          ...auto ? ["--auto"] : [],
          ...flags
        ],
        run2
      );
      if (sent.kind === "sent") return { text: done, details: { number, head, method } };
      return afterLostReply("gh pr merge", sent.why, async () => {
        const now = ghJson(
          "gh pr view",
          await gh(["pr", "view", String(number), "--json", "state,autoMergeRequest", ...flags], {
            cwd: repo.root
          })
        );
        return (auto ? now.autoMergeRequest !== null && now.autoMergeRequest !== void 0 : now.state === "MERGED") ? done : void 0;
      });
    }
  };
}

// plugins/jig-git/src/gitlab-pr-read.ts
var BODY_CHARS2 = 6e3;
var JOB_LIMIT = 100;
var DISCUSSION_PAGES = 5;
function getGlobal(gl, what, endpoint2) {
  return glabJson(gl.home, what, endpoint2, { cwd: gl.repo.root, signal: gl.call.signal });
}
function get(gl, what, endpoint2) {
  return glabJson(gl.home, what, `${projectBase(gl.home)}/${endpoint2}`, {
    cwd: gl.repo.root,
    signal: gl.call.signal
  });
}
function getMr(gl, iid) {
  return get(gl, "glab api (merge request)", `merge_requests/${iid}`);
}
var fromThisProject = (mr) => mr.source_project_id === void 0 || mr.target_project_id === void 0 || mr.source_project_id === mr.target_project_id;
async function openMrFor(gl, branch) {
  const rows = await get(
    gl,
    "glab api (merge requests)",
    withQuery("merge_requests", {
      source_branch: branch,
      state: "opened",
      per_page: 5,
      order_by: "updated_at",
      sort: "desc"
    })
  );
  return rows.find((row) => row.source_branch === branch && fromThisProject(row));
}
async function mrNumber(gl, params) {
  if (params.number !== void 0) return checkNumber(params.number);
  const branch = params.branch !== void 0 ? checkBranch(params.branch) : await currentBranch(gl.repo.root, gl.call.signal);
  if (!branch) throw new Error(`HEAD is detached in ${gl.repo.name}; pass number or branch`);
  const open = await openMrFor(gl, branch);
  if (open) return open.iid;
  const any = await get(
    gl,
    "glab api (merge requests)",
    withQuery("merge_requests", {
      source_branch: branch,
      state: "all",
      per_page: 5,
      order_by: "updated_at",
      sort: "desc"
    })
  );
  const found = any.find((row) => row.source_branch === branch && fromThisProject(row));
  if (!found)
    throw new Error(`no merge request for ${branch} in ${gl.repo.name}: pass number, or open one with pr create`);
  return found.iid;
}
var DRAFT_PREFIX = /^\s*(?:\[draft\]|\(draft\)|draft:|draft\s+-\s+)\s*/i;
var isDraft = (mr) => mr.draft === true || DRAFT_PREFIX.test(mr.title);
function plainTitle(title) {
  let rest = title;
  while (DRAFT_PREFIX.test(rest)) rest = rest.replace(DRAFT_PREFIX, "");
  return rest;
}
function jobCheck(job) {
  let conclusion;
  switch (job.status) {
    case "success":
      conclusion = "success";
      break;
    case "failed":
      conclusion = job.allow_failure === true ? "neutral" : "failure";
      break;
    case "canceled":
    case "canceling":
      conclusion = "cancelled";
      break;
    case "skipped":
      conclusion = "skipped";
      break;
    case "created":
    case "pending":
    case "running":
    case "preparing":
    case "scheduled":
    case "manual":
    case "waiting_for_resource":
    case "waiting_for_callback":
      conclusion = "";
      break;
    default:
      conclusion = "failure";
  }
  return {
    name: job.name,
    bucket: bucketOf(conclusion === "" ? "pending" : "completed", conclusion),
    detail: job.status,
    ...job.web_url ? { url: job.web_url } : {}
  };
}
async function checksOf(gl, mr) {
  if (!mr.head_pipeline) return void 0;
  const jobs = await get(
    gl,
    "glab api (pipeline jobs)",
    withQuery(`pipelines/${mr.head_pipeline.id}/jobs`, { per_page: JOB_LIMIT })
  );
  return { checks: jobs.map(jobCheck), more: jobs.length >= JOB_LIMIT };
}
var who2 = (mr) => mr.author?.username ? ` by @${mr.author.username}` : "";
function formatMr(gl, mr, rollup) {
  const flags = [mr.state, isDraft(mr) ? "draft" : ""].filter(Boolean).join(", ");
  const body = (mr.description ?? "").trim();
  const reviewers = (mr.reviewers ?? []).map((user) => user.username ?? user.name ?? "").filter(Boolean);
  const status = mr.has_conflicts ? "conflict" : mr.detailed_merge_status ?? mr.merge_status ?? "unknown";
  let checks = "checks: none (no pipeline)";
  if (rollup) {
    const failing = rollup.checks.filter((check) => check.bucket === "fail").map((check) => check.name);
    checks = `checks: ${describeCounts(count(rollup.checks))}${failing.length > 0 ? `; failing: ${failing.slice(0, 5).join(", ")}` : ""}${rollup.more ? ` (only the first ${JOB_LIMIT} jobs are read)` : ""}`;
  }
  const pipeline = mr.head_pipeline ? `; pipeline #${mr.head_pipeline.id} ${mr.head_pipeline.status}` : "";
  return [
    `MR !${mr.iid} ${mr.title} [${flags}]${who2(mr)} in ${gl.repo.name}`,
    `${mr.source_branch} -> ${mr.target_branch} at ${(mr.sha ?? "").slice(0, 7)}; merge status: ${status}${pipeline}`,
    checks,
    (mr.labels ?? []).length > 0 ? `labels: ${(mr.labels ?? []).join(", ")}` : "",
    reviewers.length > 0 ? `review requested from: ${reviewers.join(", ")}` : "",
    mr.merge_when_pipeline_succeeds ? "auto-merge on (when the pipeline succeeds)" : "",
    mr.web_url ?? "",
    body ? `
${clip(body, BODY_CHARS2)}${body.length > BODY_CHARS2 ? `
(${body.length - BODY_CHARS2} more characters)` : ""}` : ""
  ].filter((line) => line !== "").join("\n");
}
function planView2(params, call, home) {
  return readOnly(`pr view ${params.number ?? params.branch ?? "here"} in ${params.repo ?? "here"}`, async () => {
    const gl = { home, repo: await resolveRepo(params.repo, call.signal, call.cwd), call };
    const mr = await getMr(gl, await mrNumber(gl, params));
    return {
      text: formatMr(gl, mr, await checksOf(gl, mr)),
      facts: { pr: mr.iid },
      details: { number: mr.iid, head: mr.sha, state: mr.state }
    };
  });
}
var STATES = { open: "opened", closed: "closed", merged: "merged", all: "all" };
function planList2(params, call, home) {
  const state = params.state ?? "open";
  if (!Object.hasOwn(STATES, state)) throw new Error("pr list: state must be one of open, closed, merged, all");
  const author = params.author === void 0 ? void 0 : checkLine(params.author, "author").replace(/^@/, "");
  const mine = params.author === "@me";
  const source = params.branch === void 0 ? void 0 : checkBranch(params.branch);
  const limit = Math.max(1, Math.min(50, Math.trunc(params.limit ?? 20)));
  return readOnly(`pr list in ${params.repo ?? "here"}`, async () => {
    const gl = { home, repo: await resolveRepo(params.repo, call.signal, call.cwd), call };
    const rows = await get(
      gl,
      "glab api (merge requests)",
      withQuery("merge_requests", {
        state: STATES[state],
        per_page: limit,
        order_by: "updated_at",
        sort: "desc",
        ...mine ? { scope: "created_by_me" } : { author_username: author },
        source_branch: source
      })
    );
    if (rows.length === 0) return { text: `No merge requests match in ${gl.repo.name}.` };
    const lines2 = rows.map(
      (row) => `!${row.iid} ${row.state}${isDraft(row) ? " draft" : ""} ${row.source_branch} -> ${row.target_branch}  ${clip(plainTitle(row.title), 100)}${row.author?.username ? `  @${row.author.username}` : ""}`
    );
    return {
      text: `${gl.repo.name}: ${plural(rows.length, "merge request")}
${lines2.join("\n")}`,
      details: { numbers: rows.map((row) => row.iid) }
    };
  });
}
var threadId = (iid, discussion) => `${iid}:${discussion}`;
function parseThread(value) {
  const found = typeof value === "string" ? /^(\d{1,9}):([0-9a-f]{8,64})$/.exec(value) : null;
  return found ? { number: Number(found[1]), discussion: found[2] } : void 0;
}
var login2 = (note) => note.author?.username ?? "unknown";
var MAX_CHARS2 = 6e4;
function placeOf(note) {
  const position = note.position;
  if (!position) return "";
  const file = position.new_path ?? position.old_path ?? "";
  const line = position.new_line ?? position.old_line;
  return `${file}${line ? `:${line}` : ""}`;
}
var isOpen = (discussion) => discussion.notes.some((note) => note.resolvable === true && note.resolved !== true);
function planComments2(params, call, home) {
  const author = params.author === void 0 ? void 0 : checkLine(params.author, "author").replace(/^@/, "");
  return readOnly(`pr comments ${params.number ?? params.branch ?? "here"} in ${params.repo ?? "here"}`, async () => {
    const gl = { home, repo: await resolveRepo(params.repo, call.signal, call.cwd), call };
    const number = await mrNumber(gl, params);
    const { items: all, more } = await glabPages(
      home,
      "glab api (discussions)",
      `${projectBase(home)}/merge_requests/${number}/discussions?per_page=100`,
      DISCUSSION_PAGES,
      { cwd: gl.repo.root, signal: call.signal }
    );
    const by = (note) => author === void 0 || login2(note).toLowerCase() === author.toLowerCase();
    const items = [];
    for (const discussion of all) {
      const notes = discussion.notes.filter((note) => note.system !== true && (note.body ?? "").trim() !== "");
      if (notes.length === 0) continue;
      if (params.unresolved && !isOpen(discussion)) continue;
      if (author !== void 0 && !notes.some(by)) continue;
      const thread = threadId(number, discussion.id);
      const first = notes[0];
      if (discussion.individual_note === true) {
        items.push({
          at: first.created_at ?? "",
          text: entry(
            `${(first.created_at ?? "").slice(0, 16)} comment @${login2(first)} (thread ${thread})`,
            first.body ?? ""
          )
        });
        continue;
      }
      const where = placeOf(first);
      const state = discussion.notes.some((note) => note.resolvable === true) ? isOpen(discussion) ? "unresolved" : "resolved" : "not resolvable";
      const inner = notes.map(
        (note, index) => entry(
          `${index === 0 ? "" : "reply "}@${login2(note)} ${(note.created_at ?? "").slice(0, 16)}`,
          note.body ?? ""
        ).replace(/^/gm, "  ")
      ).join("\n");
      items.push({
        at: first.created_at ?? "",
        text: `thread ${thread}${where ? ` ${where}` : ""} [${state}]
${inner}`
      });
    }
    items.sort((a, b) => a.at.localeCompare(b.at));
    const shown = [];
    let size = 0;
    for (const item of items) {
      if (size + item.text.length > MAX_CHARS2 && shown.length > 0) break;
      shown.push(item.text);
      size += item.text.length;
    }
    const left = items.length - shown.length;
    if (items.length === 0)
      return {
        text: `merge request ${number}: nothing to show${params.unresolved ? " (no unresolved threads)" : ""}.`
      };
    return {
      text: [
        `merge request ${number}: ${plural(items.length, "item")}`,
        ...shown,
        left > 0 ? `... ${left} more items; filter by author or unresolved` : "",
        more ? `(GitLab holds more than ${DISCUSSION_PAGES * 100} threads; only the first ${DISCUSSION_PAGES * 100} are read)` : ""
      ].filter(Boolean).join("\n"),
      details: { threads: all.map((discussion) => threadId(number, discussion.id)) }
    };
  });
}

// plugins/jig-git/src/gitlab-pr-write.ts
var TEMPLATE_FILES2 = [
  ".gitlab/merge_request_templates/Default.md",
  ".gitlab/merge_request_templates/default.md",
  ".gitlab/merge_request_templates/DEFAULT.md"
];
async function glOf(params, call, home) {
  return { home, repo: await resolveRepo(params.repo, call.signal, call.cwd), call };
}
var run = (gl) => ({ cwd: gl.repo.root, signal: gl.call.signal });
var endpoint = (gl, rest) => `${projectBase(gl.home)}/${rest}`;
var asDraft = (title) => DRAFT_PREFIX.test(title) ? title : `Draft: ${title}`;
async function planCreate2(params, call, home) {
  const repo = await resolveRepo(params.repo, call.signal, call.cwd);
  const { signal, settings: settings2 } = call;
  const title = ruledTitle(params.title, settings2);
  if (params.body === void 0 || params.body.trim() === "") {
    const template = readTemplate(repo, settings2.prTemplate, TEMPLATE_FILES2);
    throw new Error(
      `pr create needs body: write the description.${template === void 0 ? "" : `
Fill in this template:
---
${template.trimEnd()}
---`}`
    );
  }
  const body = checkBody(params.body);
  const branch = params.branch === void 0 ? await currentBranch(repo.root, signal) : checkBranch(params.branch);
  if (!branch) throw new InputError(`HEAD is detached in ${repo.name}; pass branch`);
  const base = params.base === void 0 ? await baseBranch(repo, settings2, signal) : checkBranch(params.base, "base");
  if (base === branch)
    throw new InputError(`head and base are both ${branch}; open the merge request from another branch`);
  const local = await revParse(repo.root, `refs/heads/${branch}`, signal);
  const remote = await revParse(repo.root, `refs/remotes/origin/${branch}`, signal);
  if (!local) throw new InputError(`branch ${branch} does not exist locally`);
  if (remote !== local)
    throw new InputError(
      `${branch} is not pushed to origin at its local tip; run git push first (this tool does not push)`
    );
  const gl = { home, repo, call };
  const existing = await openMrFor(gl, branch);
  const draft = params.draft === true;
  const sentTitle = draft ? asDraft(title) : title;
  const summary = existing ? `merge request ${existing.iid} is already open for ${branch}; nothing will be created` : `create a merge request ${branch} -> ${base}${draft ? " (draft)" : ""} at ${local.slice(0, 7)} in ${repo.name}`;
  return {
    preview: reviewPreview(
      summary,
      `# ${sentTitle}

${body}`,
      digest("mr create", home.host, home.path, branch, base, local, sentTitle, body)
    ),
    run: async () => {
      if (existing) {
        return {
          text: `Merge request !${existing.iid} is already open for ${branch} (target ${existing.target_branch}): ${existing.web_url ?? mrUrl(home, existing.iid)}. No new one was created.`,
          details: { number: existing.iid, created: false }
        };
      }
      const sent = await glabWrite(
        "glab api (create merge request)",
        home,
        "POST",
        endpoint(gl, "merge_requests"),
        { source_branch: branch, target_branch: base, title: sentTitle, description: body },
        run(gl)
      );
      if (sent.kind === "sent") {
        const mr = answerOf(sent);
        if (typeof mr?.iid !== "number")
          throw new Error(
            `glab api (create merge request) gave no merge request; run pr list for ${branch} before trying again`
          );
        return finishCreate2(
          gl,
          mr.iid,
          branch,
          base,
          local,
          `Created merge request !${mr.iid} ${branch} -> ${base} in ${repo.name}: ${mr.web_url ?? mrUrl(home, mr.iid)}`
        );
      }
      let number = 0;
      const found = await afterLostReply(
        "glab api (create merge request)",
        sent.why,
        async () => {
          const row = await openMrFor({ ...gl, call: afterwards(call) }, branch);
          if (!row) return void 0;
          number = row.iid;
          return `Created merge request !${row.iid} ${branch} -> ${base} in ${repo.name}: ${row.web_url ?? mrUrl(home, row.iid)}`;
        },
        "GitLab"
      );
      return finishCreate2(gl, number, branch, base, local, found.text);
    }
  };
}
async function finishCreate2(gl, number, branch, base, sha, text) {
  const { call, repo, home } = gl;
  await announcePushed({ repo, settings: call.settings, branch, sha, pr: number, signal: call.signal });
  const watching = watchComments2(gl, number);
  return {
    text: watching === void 0 ? text : `${text}
${watching.text}`,
    facts: { pr: number },
    details: {
      number,
      created: true,
      base,
      ...watching?.id === void 0 ? {} : { watch: watching.id },
      project: home.path
    }
  };
}
function watchComments2(gl, number) {
  if (gl.call.settings.watchComments !== "after-create") return void 0;
  try {
    const spec = { slug: gl.home.path, number, forge: "gitlab", host: gl.home.host };
    const { id, already } = startCommentWatch(spec);
    return { id, text: watchingText(spec, id, already) };
  } catch (error) {
    return {
      text: `(The watch on its comments could not start: ${error.message}. pr watch starts it.)`
    };
  }
}
async function idsOf(gl, names) {
  const ids = [];
  for (const name of names) {
    const login3 = name.replace(/^@/, "");
    const rows = await getGlobal(gl, "glab api (users)", withQuery("users", { username: login3 }));
    const found = rows.find((user) => (user.username ?? "").toLowerCase() === login3.toLowerCase());
    if (found?.id === void 0) throw new Error(`GitLab has no user "${login3}" to request a review from`);
    ids.push(found.id);
  }
  return ids;
}
async function planEdit2(params, call, home) {
  const number = checkNumber(params.number);
  const edit = {
    title: params.title === void 0 ? void 0 : ruledTitle(params.title, call.settings),
    body: params.body === void 0 ? void 0 : checkBody(params.body),
    base: params.base === void 0 ? void 0 : checkBranch(params.base, "base"),
    labels: params.labels === void 0 ? void 0 : checkWords(params.labels, "labels"),
    reviewers: params.reviewers === void 0 ? void 0 : checkWords(params.reviewers, "reviewers")
  };
  if (Object.values(edit).every((value) => value === void 0))
    throw new Error(
      "pr edit needs title, body, base, labels or reviewers. Usage: pr edit {number, title?, body?, base?, labels?, reviewers?, repo?}"
    );
  const gl = await glOf(params, call, home);
  const mr = await getMr(gl, number);
  const title = edit.title !== void 0 && isDraft(mr) ? asDraft(edit.title) : edit.title;
  const added = edit.reviewers === void 0 ? void 0 : await idsOf(gl, edit.reviewers);
  const reviewerIds = added === void 0 ? void 0 : [.../* @__PURE__ */ new Set([...(mr.reviewers ?? []).flatMap((user) => user.id ?? []), ...added])];
  const shown = lines(
    title !== void 0 && `Title: ${title}`,
    edit.base !== void 0 && `Target branch: ${edit.base}`,
    edit.labels !== void 0 && `Add labels: ${edit.labels.join(", ")} (a label GitLab does not have yet is created)`,
    edit.reviewers !== void 0 && `Request review from: ${edit.reviewers.join(", ")}`,
    edit.body !== void 0 && `
New description (replaces the whole old one):

${edit.body}`
  );
  const changing = Object.entries(edit).filter(([, value]) => value !== void 0).map(([name]) => name);
  return {
    preview: reviewPreview(
      `edit the ${changing.join(", ")} of merge request ${number} in ${gl.repo.name}`,
      shown,
      digest("mr edit", home.host, home.path, number, { ...edit, title, reviewerIds })
    ),
    run: async () => {
      const body = {
        ...title === void 0 ? {} : { title },
        ...edit.body === void 0 ? {} : { description: edit.body },
        ...edit.base === void 0 ? {} : { target_branch: edit.base },
        ...edit.labels === void 0 ? {} : { add_labels: edit.labels.join(",") },
        ...reviewerIds === void 0 ? {} : { reviewer_ids: reviewerIds }
      };
      const done = `Edited the ${changing.join(", ")} of merge request !${number} in ${gl.repo.name}.`;
      const sent = await glabWrite(
        "glab api (edit merge request)",
        home,
        "PUT",
        endpoint(gl, `merge_requests/${number}`),
        body,
        run(gl)
      );
      if (sent.kind === "sent") return { text: done, details: { number, changed: changing } };
      return afterLostReply(
        "glab api (edit merge request)",
        sent.why,
        async () => {
          const now = await getMr({ ...gl, call: afterwards(call) }, number);
          const labels = now.labels ?? [];
          const asked = (now.reviewers ?? []).flatMap((user) => user.id ?? []);
          const same = (title === void 0 || now.title === title) && (edit.body === void 0 || (now.description ?? "").trim() === edit.body.trim()) && (edit.base === void 0 || now.target_branch === edit.base) && (edit.labels === void 0 || edit.labels.every((label) => labels.includes(label))) && (reviewerIds === void 0 || reviewerIds.every((id) => asked.includes(id)));
          return same ? done : void 0;
        },
        "GitLab"
      );
    }
  };
}
async function planReady2(params, call, home) {
  const number = checkNumber(params.number);
  const gl = await glOf(params, call, home);
  const mr = await getMr(gl, number);
  if (mr.state !== "opened") throw new Error(`merge request ${number} is ${mr.state}, not open`);
  const draft = isDraft(mr);
  const title = plainTitle(mr.title);
  if (draft && title.trim() === "")
    throw new Error(`merge request ${number} has no title besides Draft:; edit its title first`);
  const done = `Merge request !${number} in ${gl.repo.name} is ready for review.`;
  return {
    preview: {
      summary: draft ? `mark merge request ${number} in ${gl.repo.name} ready for review` : `merge request ${number} in ${gl.repo.name} is already ready for review; nothing will be changed`,
      fingerprint: digest("mr ready", home.host, home.path, number, mr.title)
    },
    run: async () => {
      if (!draft) return { text: `Merge request !${number} in ${gl.repo.name} was already ready for review.` };
      const sent = await glabWrite(
        "glab api (ready)",
        home,
        "PUT",
        endpoint(gl, `merge_requests/${number}`),
        { title },
        run(gl)
      );
      if (sent.kind === "sent") return { text: done };
      return afterLostReply(
        "glab api (ready)",
        sent.why,
        async () => isDraft(await getMr({ ...gl, call: afterwards(call) }, number)) ? void 0 : done,
        "GitLab"
      );
    }
  };
}
function recentNotes(gl, number) {
  return get(
    { ...gl, call: afterwards(gl.call) },
    "glab api (notes)",
    withQuery(`merge_requests/${number}/notes`, { sort: "desc", order_by: "created_at", per_page: 10 })
  );
}
function madeSince(note, body, started) {
  return note.system !== true && (note.body ?? "").trim() === body.trim() && (note.created_at ?? "") >= started;
}
var secondsBefore = () => new Date(Date.now() - 1e3).toISOString().slice(0, 19);
async function planComment2(params, call, home) {
  const number = checkNumber(params.number);
  const body = checkBody(params.body);
  const gl = await glOf(params, call, home);
  return {
    preview: reviewPreview(
      `comment on merge request ${number} in ${gl.repo.name}`,
      body,
      digest("mr comment", home.host, home.path, number, body)
    ),
    run: async () => {
      const started = secondsBefore();
      const sent = await glabWrite(
        "glab api (comment)",
        home,
        "POST",
        endpoint(gl, `merge_requests/${number}/notes`),
        { body },
        run(gl)
      );
      if (sent.kind === "sent") {
        const note = answerOf(sent);
        const url = note?.id === void 0 ? "" : `${mrUrl(home, number)}#note_${note.id}`;
        return {
          text: `Commented on merge request !${number} in ${gl.repo.name}${url ? `: ${url}` : "."}`,
          details: { number, url: url || void 0 }
        };
      }
      return afterLostReply(
        "glab api (comment)",
        sent.why,
        async () => {
          const found = (await recentNotes(gl, number)).find((note) => madeSince(note, body, started));
          return found ? `Commented on merge request !${number} in ${gl.repo.name}: ${mrUrl(home, number)}#note_${found.id}` : void 0;
        },
        "GitLab"
      );
    }
  };
}
function checkThread2(value) {
  const found = parseThread(value);
  if (!found)
    throw new Error(
      "thread must be a GitLab thread id such as 42:6a9c1750b37d513a43987b574953fceb50b03ce7 (the merge request number, a colon, the discussion); pr comments lists them"
    );
  return found;
}
async function planReply2(params, call, home) {
  const { number, discussion } = checkThread2(params.thread);
  const body = checkBody(params.body);
  const gl = await glOf(params, call, home);
  const thread = threadId(number, discussion);
  return {
    preview: reviewPreview(
      `reply in thread ${thread} of merge request ${number} in ${gl.repo.name}`,
      body,
      digest("mr reply", home.host, home.path, thread, body)
    ),
    run: async () => {
      const started = secondsBefore();
      const sent = await glabWrite(
        "glab api (reply)",
        home,
        "POST",
        endpoint(gl, `merge_requests/${number}/discussions/${discussion}/notes`),
        { body },
        run(gl)
      );
      if (sent.kind === "sent") {
        const note = answerOf(sent);
        return {
          text: `Replied in thread ${thread}${note?.id === void 0 ? "." : `: ${mrUrl(home, number)}#note_${note.id}`}`
        };
      }
      return afterLostReply(
        "glab api (reply)",
        sent.why,
        async () => {
          const now = await get(
            { ...gl, call: afterwards(call) },
            "glab api (discussion)",
            `merge_requests/${number}/discussions/${discussion}`
          );
          const found = now.notes.find((note) => madeSince(note, body, started));
          return found ? `Replied in thread ${thread}: ${mrUrl(home, number)}#note_${found.id}` : void 0;
        },
        "GitLab"
      );
    }
  };
}
var resolved = (discussion) => discussion.notes.filter((note) => note.resolvable === true).every((note) => note.resolved === true);
async function planResolve2(params, call, home) {
  const { number, discussion } = checkThread2(params.thread);
  const gl = await glOf(params, call, home);
  const thread = threadId(number, discussion);
  const now = await get(
    gl,
    "glab api (discussion)",
    `merge_requests/${number}/discussions/${discussion}`
  );
  if (!now.notes.some((note) => note.resolvable === true))
    throw new Error(`thread ${thread} is a plain comment, not a thread that can be resolved`);
  const already = resolved(now);
  return {
    preview: {
      summary: already ? `thread ${thread} is already resolved; nothing will be changed` : `resolve thread ${thread}`,
      fingerprint: digest("mr resolve", home.host, home.path, thread, already)
    },
    run: async () => {
      if (already) return { text: `Thread ${thread} was already resolved.` };
      const done = `Resolved thread ${thread}.`;
      const sent = await glabWrite(
        "glab api (resolve)",
        home,
        "PUT",
        endpoint(gl, `merge_requests/${number}/discussions/${discussion}`),
        { resolved: true },
        run(gl)
      );
      if (sent.kind === "sent") {
        const answer = answerOf(sent);
        if (answer?.notes && !resolved(answer))
          throw new Error(
            `glab api (resolve): GitLab did not resolve thread ${thread}; pr comments shows where it stands`
          );
        return { text: done };
      }
      return afterLostReply(
        "glab api (resolve)",
        sent.why,
        async () => resolved(
          await get(
            { ...gl, call: afterwards(call) },
            "glab api (discussion)",
            `merge_requests/${number}/discussions/${discussion}`
          )
        ) ? done : void 0,
        "GitLab"
      );
    }
  };
}
async function planReview2(params, call, home) {
  const number = checkNumber(params.number);
  if (params.event !== "comment" && params.event !== "request_changes")
    throw new Error(
      "pr review sends a comment or requests changes. It never approves: approval stays with a person."
    );
  const body = checkBody(params.body);
  const gl = await glOf(params, call, home);
  const drafts = await get(gl, "glab api (draft notes)", `merge_requests/${number}/draft_notes`);
  if (drafts.length > 0)
    throw new Error(
      `the signed-in GitLab user has ${drafts.length} pending draft comment${drafts.length === 1 ? "" : "s"} on merge request ${number}, and a review would publish them too; publish or delete them in GitLab first`
    );
  const verb = params.event === "comment" ? "a review comment" : "a request for changes";
  return {
    preview: reviewPreview(
      `send ${verb} on merge request ${number} in ${gl.repo.name}`,
      body,
      digest("mr review", home.host, home.path, number, params.event, body)
    ),
    run: async () => {
      const started = secondsBefore();
      const done = `Sent ${verb} on merge request !${number} in ${gl.repo.name}.`;
      const look = async () => (await recentNotes(gl, number)).some((note) => madeSince(note, body, started)) ? done : void 0;
      const sent = await glabWrite(
        "glab api (review)",
        home,
        "POST",
        endpoint(gl, `merge_requests/${number}/draft_notes/bulk_publish`),
        { note: body, reviewer_state: params.event === "comment" ? "reviewed" : "requested_changes" },
        run(gl)
      );
      if (sent.kind === "lost") return afterLostReply("glab api (review)", sent.why, look, "GitLab");
      if (await look() === void 0)
        throw new Error(
          `glab api (review): GitLab accepted the request, but one check does not show the review on merge request ${number}. Nothing was sent twice; look at the merge request before trying again.`
        );
      return { text: done };
    }
  };
}
var METHODS2 = ["merge", "squash", "rebase"];
var MERGE_HINTS = {
  405: "GitLab will not merge it now: a pipeline, an approval or an open thread is still required; pr view shows its merge status",
  409: "the head moved since you looked, so its sha no longer matches; run pr merge again to see the new preview",
  422: "GitLab could not merge the branch: a conflict, or the target moved"
};
async function planMerge2(params, call, home) {
  const number = checkNumber(params.number);
  if (!METHODS2.includes(params.method)) throw new Error("method is required: merge, squash or rebase");
  const method = params.method;
  if (method === "rebase")
    throw new Error(
      `pr merge: GitLab does not rebase as part of a merge; the project's merge method (fast-forward or semi-linear) decides. Run glab mr rebase ${number} yourself, then merge`
    );
  const auto = params.auto === true;
  const gl = await glOf(params, call, home);
  const mr = await getMr(gl, number);
  if (mr.state !== "opened") throw new Error(`merge request ${number} is ${mr.state}, not open`);
  if (isDraft(mr)) throw new Error(`merge request ${number} is a draft; mark it ready for review first`);
  if (mr.has_conflicts === true || mr.detailed_merge_status === "conflict")
    throw new Error(
      `merge request ${number} conflicts with ${mr.target_branch}; resolve the conflicts on ${mr.source_branch} first`
    );
  const head = mr.sha;
  if (!head)
    throw new Error(`GitLab did not say which commit merge request ${number} is at, so the merge cannot be pinned`);
  const rollup = await checksOf(gl, mr);
  const checks = rollup ? count(rollup.checks) : void 0;
  const what = auto ? `turn on auto-merge (${method}) for` : `${method}-merge`;
  return {
    preview: {
      summary: `${what} merge request ${number} into ${mr.target_branch} in ${gl.repo.name}: ${mr.title} (head ${head.slice(0, 7)})`,
      body: lines(
        `${mr.title}`,
        `From ${mr.source_branch} at ${head.slice(0, 7)} into ${mr.target_branch}, by ${method}.`,
        `Checks: ${checks ? describeCounts(checks) : "no pipeline"}. Merge status: ${mr.detailed_merge_status ?? mr.merge_status ?? "unknown"}.`,
        `It merges only while the head is still ${head.slice(0, 7)}.`
      ),
      format: "text",
      fingerprint: digest(
        "mr merge",
        home.host,
        home.path,
        number,
        mr.title,
        method,
        head,
        mr.target_branch,
        auto
      )
    },
    run: async () => {
      const done = auto ? `Auto-merge is on for merge request !${number} (${method}) in ${gl.repo.name}: it merges when its pipeline succeeds.` : `Merged merge request !${number} into ${mr.target_branch} (${method}) at ${head.slice(0, 7)} in ${gl.repo.name}.`;
      const sent = await glabWrite(
        "glab api (merge)",
        home,
        "PUT",
        endpoint(gl, `merge_requests/${number}/merge`),
        { sha: head, squash: method === "squash", ...auto ? { auto_merge: true } : {} },
        { ...run(gl), hints: MERGE_HINTS }
      );
      if (sent.kind === "sent") {
        const answer = answerOf(sent);
        if (!auto && answer?.state !== void 0 && answer.state !== "merged")
          return {
            text: `GitLab accepted the merge of !${number} in ${gl.repo.name}, but it shows ${answer.state}${answer.merge_when_pipeline_succeeds ? " and set to merge when its pipeline succeeds" : ""}; pr view shows where it stands.`,
            details: { number, head, method }
          };
        return { text: done, details: { number, head, method } };
      }
      return afterLostReply(
        "glab api (merge)",
        sent.why,
        async () => {
          const now = await getMr({ ...gl, call: afterwards(call) }, number);
          return (auto ? now.merge_when_pipeline_succeeds === true || now.state === "merged" : now.state === "merged") ? done : void 0;
        },
        "GitLab"
      );
    }
  };
}

// plugins/jig-git/src/gitlab-pr.ts
var looksLikeGitlabThread = (value) => parseThread(value) !== void 0;
async function homeOf(params, call) {
  const aThread = params.action === "reply" || params.action === "resolve";
  let repo;
  try {
    repo = await resolveRepo(params.repo, call.signal, call.cwd);
  } catch (error) {
    if (aThread && !looksLikeGitlabThread(params.thread)) return { forge: "github" };
    throw error;
  }
  return forgeOf(repo, call.settings, call.signal);
}
async function planWatch(params, call, home) {
  const gl = { home, repo: await resolveRepo(params.repo, call.signal, call.cwd), call };
  let number;
  if (params.number !== void 0) {
    number = checkNumber(params.number);
    const state = (await getMr(gl, number)).state;
    if (state !== "opened") {
      throw new Error(`merge request ${number} in ${home.path} is ${state}, so there is nothing to watch`);
    }
  } else {
    const branch = params.branch === void 0 ? await currentBranch(gl.repo.root, call.signal) : checkBranch(params.branch);
    if (!branch) throw new Error(`HEAD is detached in ${gl.repo.name}; pass number or branch`);
    const open = await openMrFor(gl, branch);
    if (open === void 0) {
      throw new Error(
        `no open merge request for ${branch} in ${gl.repo.name}: pass number, or open one with pr create`
      );
    }
    number = open.iid;
  }
  return {
    preview: { summary: `watch merge request ${number} in ${home.path} for new comments, in the background` },
    run: async () => {
      const spec = { slug: home.path, number, forge: "gitlab", host: home.host };
      const { id, already } = startCommentWatch(spec);
      return {
        text: watchingText(spec, id, already),
        facts: { pr: number, watch: already ? "existing" : "started" },
        details: { id, number, slug: home.path, already }
      };
    }
  };
}
function planGitlabPr(params, call, home) {
  const p = params;
  switch (params.action) {
    case "view":
      return planView2(p, call, home);
    case "list":
      return planList2(p, call, home);
    case "comments":
      return planComments2(p, call, home);
    case "create":
      return planCreate2(p, call, home);
    case "edit":
      return planEdit2(p, call, home);
    case "ready":
      return planReady2(p, call, home);
    case "comment":
      return planComment2(p, call, home);
    case "reply":
      return planReply2(p, call, home);
    case "resolve":
      return planResolve2(p, call, home);
    case "review":
      return planReview2(p, call, home);
    case "merge":
      return planMerge2(p, call, home);
    case "watch":
      return planWatch(p, call, home);
    default:
      throw new Error(
        unknownAction("pr", params.action, [
          "create",
          "edit",
          "ready",
          "comment",
          "reply",
          "resolve",
          "review",
          "merge"
        ])
      );
  }
}

// plugins/jig-git/src/pr-watch-tool.ts
async function planWatch2(params, call) {
  const repo = await resolveRepo(params.repo, call.signal, call.cwd);
  const remote = await requireRemote(repo, call.settings, call.signal);
  const { slug } = remote;
  let number;
  if (params.number !== void 0) {
    number = checkNumber(params.number);
    const state = (await viewPr(repo, String(number), call, "state")).state;
    if (state !== "OPEN") {
      throw new Error(
        `pull request ${number} in ${slug} is ${String(state).toLowerCase()}, so there is nothing to watch`
      );
    }
  } else {
    const branch = params.branch === void 0 ? await currentBranch(repo.root, call.signal) : checkBranch(params.branch);
    if (!branch) throw new Error(`HEAD is detached in ${repo.name}; pass number or branch`);
    const open = await openPrFor(repo, branch, call);
    if (open === void 0) {
      throw new Error(
        `no open pull request for ${branch} in ${repo.name}: pass number, or open one with pr create`
      );
    }
    number = open.number;
  }
  return {
    preview: { summary: `watch pull request ${number} in ${slug} for new comments, in the background` },
    run: async () => {
      const spec = {
        slug,
        number,
        ...remote.host === GITHUB_COM ? {} : { host: remote.host },
        ...remote.account === void 0 ? {} : { account: remote.account }
      };
      const { id, already } = startCommentWatch(spec);
      return {
        text: watchingText(spec, id, already),
        facts: { pr: number, watch: already ? "existing" : "started" },
        details: { id, number, slug, already }
      };
    }
  };
}

// plugins/jig-git/src/tool.ts
function buildEngineTool(spec) {
  return {
    tool: spec.name,
    plugin: "jig-git",
    label: spec.label,
    description: spec.description,
    promptSnippet: spec.promptSnippet,
    ...spec.promptGuidelines === void 0 ? {} : { promptGuidelines: spec.promptGuidelines },
    // A TypeBox schema is a JSON Schema object.
    input: spec.parameters,
    sequential: spec.sequential,
    usesFolder: spec.usesFolder,
    classify: spec.classify,
    async preview(input, signal, cwd) {
      checkParams(spec.name, spec.table, input);
      return (await spec.plan(input, { toolCallId: "", signal, settings: gitSettings(), cwd })).preview;
    },
    async execute(input, call) {
      const action = checkParams(spec.name, spec.table, input);
      const planned = await spec.plan(input, {
        toolCallId: call.callId,
        signal: call.signal,
        settings: gitSettings(),
        cwd: call.cwd
      });
      checkSeen(call.seen, planned, `${spec.name} ${action}`);
      const reply = await planned.run();
      return {
        text: reply.text,
        ...reply.details === void 0 ? {} : { data: reply.details },
        ...reply.facts === void 0 ? {} : { facts: reply.facts }
      };
    }
  };
}
function at(action, environment, effect, more = {}) {
  return { action, environment, effect, ...more };
}

// plugins/jig-git/src/pr.ts
var PR_ACTIONS = {
  view: { summary: "state, review, checks and body", optional: ["repo", "number", "branch"] },
  list: {
    summary: "pull requests by state, author or branch",
    optional: ["repo", "state", "author", "branch", "limit"]
  },
  comments: {
    summary: "conversation, reviews and line comments, with thread ids",
    optional: ["repo", "number", "branch", "author", "unresolved"]
  },
  create: {
    summary: "open one from a pushed branch; returns the open one if there is one",
    required: ["title"],
    optional: ["repo", "body", "branch", "base", "draft"]
  },
  edit: {
    summary: "title, body, base, labels, reviewers",
    required: ["number"],
    optional: ["repo", "title", "body", "base", "labels", "reviewers"]
  },
  ready: { summary: "draft to ready for review", required: ["number"], optional: ["repo"] },
  comment: { summary: "a comment on the conversation", required: ["number", "body"], optional: ["repo"] },
  reply: { summary: "a reply in a review thread", required: ["thread", "body"], optional: ["repo"] },
  resolve: { summary: "resolve a review thread", required: ["thread"], optional: ["repo"] },
  review: {
    summary: "comment or request changes; never approves",
    required: ["number", "event", "body"],
    optional: ["repo"]
  },
  merge: {
    summary: "merge, squash or rebase at the head you saw; or auto-merge",
    required: ["number", "method"],
    optional: ["repo", "auto"]
  },
  watch: {
    summary: "tell me about new comments on a pull request, in the background",
    optional: ["repo", "number", "branch"]
  }
};
var ACTION_NAMES = Object.keys(PR_ACTIONS);
var PrParams = typebox_exports.Object(
  {
    action: stringEnum(ACTION_NAMES, { description: describeActions(PR_ACTIONS) }),
    repo: typebox_exports.Optional(
      typebox_exports.String({
        minLength: 1,
        maxLength: 1e3,
        description: "Folder/path, not owner/name; default repo."
      })
    ),
    number: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, description: "Pull/merge request number." })),
    branch: typebox_exports.Optional(
      typebox_exports.String({
        minLength: 1,
        maxLength: 200,
        description: "Head branch; default current."
      })
    ),
    base: typebox_exports.Optional(
      typebox_exports.String({
        minLength: 1,
        maxLength: 200,
        description: "Base; default git.base or default branch."
      })
    ),
    title: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256, description: "One line." })),
    body: typebox_exports.Optional(
      typebox_exports.String({
        minLength: 1,
        maxLength: 6e4,
        description: "Markdown; create omit template; edit replaces."
      })
    ),
    draft: typebox_exports.Optional(typebox_exports.Boolean({ description: "create: open it as a draft." })),
    method: typebox_exports.Optional(stringEnum(["merge", "squash", "rebase"], { description: "How to merge." })),
    auto: typebox_exports.Optional(typebox_exports.Boolean({ description: "merge: turn on auto-merge instead of merging now." })),
    event: typebox_exports.Optional(
      stringEnum(["comment", "request_changes"], {
        description: "review: comment/request changes; a person approves."
      })
    ),
    thread: typebox_exports.Optional(
      typebox_exports.String({ minLength: 8, maxLength: 200, description: "Thread id from pr comments." })
    ),
    author: typebox_exports.Optional(
      typebox_exports.String({
        minLength: 1,
        maxLength: 100,
        description: "list/ comments: author or @me."
      })
    ),
    unresolved: typebox_exports.Optional(typebox_exports.Boolean({ description: "comments: unresolved only." })),
    state: typebox_exports.Optional(
      stringEnum(["open", "closed", "merged", "all"], {
        description: "list: state; default open."
      })
    ),
    limit: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 50, description: "list: count, default 20." })),
    labels: typebox_exports.Optional(
      typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 100 }), {
        maxItems: 30,
        description: "edit: labels to add."
      })
    ),
    reviewers: typebox_exports.Optional(
      typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 100 }), {
        maxItems: 30,
        description: "edit: reviewers. GitLab: usernames."
      })
    )
  },
  { additionalProperties: false }
);
function classifyPr(input) {
  const action = input.action;
  switch (action) {
    case "view":
    case "list":
    case "comments":
      return at(action, "external", "read");
    case "create":
    case "edit":
    case "comment":
    case "reply":
    case "review":
      return at(action, "external", "write", { approval: "review" });
    case "ready":
    case "resolve":
    case "merge":
      return at(action, "external", "write");
    // Starts a poll that only reads GitHub, as the ci tool's watch does: a local write, so it does not ask.
    case "watch":
      return at(action, "local", "write");
    default:
      return void 0;
  }
}
async function planPr(params, call) {
  const home = await homeOf(params, call);
  return home.forge === "gitlab" ? planGitlabPr(params, call, home) : planGithubPr(params, call);
}
function planGithubPr(params, call) {
  const p = params;
  switch (params.action) {
    case "view":
      return planView(p, call);
    case "list":
      return planList(p, call);
    case "comments":
      return planComments(p, call);
    case "create":
      return planCreate(p, call);
    case "edit":
      return planEdit(p, call);
    case "ready":
      return planReady(p, call);
    case "comment":
      return planComment(p, call);
    case "reply":
      return planReply(p, call);
    case "resolve":
      return planResolve(p, call);
    case "review":
      return planReview(p, call);
    case "merge":
      return planMerge(p, call);
    case "watch":
      return planWatch2(p, call);
    default:
      throw new Error(unknownAction("pr", params.action, Object.keys(PR_ACTIONS)));
  }
}
var prTool = buildEngineTool({
  name: "pr",
  label: "Pull request",
  description: "Pull and merge requests by the repository's origin: view, comments, create, review, merge. Every write needs the user's approval first. Read the git skill before your first pr call.",
  promptSnippet: "Pull and merge requests: view, comments, watch, create, review, merge",
  promptGuidelines: [
    "Use the pr tool for pull requests and merge requests, not bash: the shell has no GitHub or GitLab sign-in. Push the branch with the git tool first."
  ],
  parameters: PrParams,
  table: PR_ACTIONS,
  classify: classifyPr,
  plan: async (params, call) => planPr(params, call),
  // Calls run in order, so a push lands before the pull request that needs it, and they work on the folder of the call.
  sequential: true,
  usesFolder: true
});

// plugins/jig-git/src/gitlab-release.ts
var day = (release) => (release.released_at ?? release.created_at ?? "").slice(0, 10);
function planReleases(params, call, home) {
  const tag = params.tag === void 0 ? void 0 : checkTag(params.tag);
  const n = Math.max(1, Math.min(100, Math.trunc(params.n ?? 20)));
  return readOnly(`release releases in ${params.repo ?? "here"}`, async () => {
    const gl = { home, repo: await resolveRepo(params.repo, call.signal, call.cwd), call };
    if (tag !== void 0) {
      const r = await get(gl, "glab api (release)", `releases/${encodeURIComponent(tag)}`);
      const flags = r.upcoming_release ? "upcoming" : "";
      const links = (r.assets?.links ?? []).map((link) => link.name ?? "").filter(Boolean);
      return {
        text: [
          `Release ${r.tag_name}${r.name && r.name !== r.tag_name ? ` "${r.name}"` : ""}${flags ? ` [${flags}]` : ""}, published ${day(r) || "not yet"}, target ${(r.commit?.id ?? "").slice(0, 7) || "unknown"}`,
          r._links?.self ?? "",
          links.length > 0 ? `assets: ${links.join(", ")}` : "no assets",
          "",
          firstLines(r.description ?? "", 120).text
        ].join("\n")
      };
    }
    const rows = await get(
      gl,
      "glab api (releases)",
      withQuery("releases", { per_page: n, order_by: "released_at", sort: "desc" })
    );
    if (rows.length === 0) return { text: `No releases in ${gl.repo.name}.` };
    const lines2 = rows.map(
      (r) => `${r.tag_name}  ${day(r) || "unpublished"}${r.upcoming_release ? "  upcoming" : ""}${r.name && r.name !== r.tag_name ? `  ${r.name}` : ""}`
    );
    return { text: `${gl.repo.name}: ${plural(rows.length, "release")}
${lines2.join("\n")}` };
  });
}
async function planReleaseCreate(params, call, home) {
  const tag = checkTag(params.tag);
  const title = params.title === void 0 ? tag : checkTitle(params.title);
  const notes = params.notes === void 0 ? "" : checkBody(params.notes, "notes");
  const target = params.target === void 0 ? void 0 : checkRev(params.target, "target");
  if (params.draft === true)
    throw new Error(
      "release_create: GitLab has no draft releases; create the release when it is ready (a release dated in the future shows as upcoming)"
    );
  if (params.prerelease === true)
    throw new Error("release_create: GitLab has no pre-release flag; say it in the title or the notes");
  if (params.generate_notes === true)
    throw new Error(
      "release_create: GitLab does not write release notes; write them in notes, or use its changelog API to generate them"
    );
  const gl = { home, repo: await resolveRepo(params.repo, call.signal, call.cwd), call };
  const { signal, settings: settings2 } = call;
  const where = `${projectBase(home)}/releases/${encodeURIComponent(tag)}`;
  const exists = await glab(apiArgs(home, where), { cwd: gl.repo.root, signal });
  if (exists.code === 0) throw new Error(`a release for ${tag} already exists in ${home.path}`);
  if (statusOf(exists) !== 404) throw glabFailure("glab api (release)", exists, home.host);
  const there = (await gitOut(gl.repo.root, ["ls-remote", "origin", `refs/tags/${tag}`], {
    signal,
    network: true,
    timeoutMs: T_NETWORK
  })).trim().split("	")[0] ?? "";
  const base = await baseBranch(gl.repo, settings2, signal);
  const ref = target ?? base;
  const at2 = there !== "" ? `the existing tag ${tag} (${there.slice(0, 7)})` : `a new tag ${tag} at ${target ?? `the head of ${base}`}`;
  const baseSha = there !== "" ? "" : await revParse(gl.repo.root, `refs/remotes/origin/${ref}`, signal) ?? "";
  const text = `# ${title}

${notes}`.trimEnd();
  return {
    preview: reviewPreview(
      `create the release ${tag} on ${at2} in ${home.path}`,
      text,
      digest("release_create", home.host, home.path, tag, title, notes, target ?? "", there, baseSha)
    ),
    run: async () => {
      const done = (url) => `Created the release ${tag} in ${home.path}${url ? `: ${url}` : "."}`;
      const sent = await glabWrite(
        "glab api (create release)",
        home,
        "POST",
        `${projectBase(home)}/releases`,
        {
          tag_name: tag,
          name: title,
          ...notes === "" ? {} : { description: notes },
          // A tag that is not there yet is made from this ref; one that is there keeps the commit it has.
          ...there === "" ? { ref } : {}
        },
        { cwd: gl.repo.root, signal }
      );
      if (sent.kind === "sent")
        return { text: done(answerOf(sent)?._links?.self ?? ""), details: { tag } };
      return afterLostReply(
        "glab api (create release)",
        sent.why,
        async () => {
          const now = await glab(apiArgs(home, where), { cwd: gl.repo.root });
          if (now.code !== 0) return void 0;
          let url = "";
          try {
            url = JSON.parse(now.stdout)._links?.self ?? "";
          } catch {
          }
          return done(url);
        },
        "GitLab"
      );
    }
  };
}

// plugins/jig-git/src/release.ts
var RELEASE_ACTIONS = {
  tags: {
    summary: "tags: the latest matching a pattern, or those containing a commit",
    optional: ["repo", "pattern", "contains", "n"]
  },
  releases: { summary: "releases, listed; or one in full", optional: ["repo", "tag", "n"] },
  tag_create: { summary: "an annotated tag, locally", required: ["tag", "message"], optional: ["repo", "target"] },
  tag_push: { summary: "push a tag (asks)", required: ["tag"], optional: ["repo", "remote"] },
  release_create: {
    summary: "a GitHub or GitLab release (asks)",
    required: ["tag"],
    optional: ["repo", "title", "notes", "target", "draft", "prerelease", "generate_notes"]
  }
};
var ACTION_NAMES2 = Object.keys(RELEASE_ACTIONS);
var ReleaseParams = typebox_exports.Object(
  {
    action: stringEnum(ACTION_NAMES2, { description: describeActions(RELEASE_ACTIONS) }),
    repo: typebox_exports.Optional(
      typebox_exports.String({
        minLength: 1,
        maxLength: 1e3,
        description: "A folder in the workspace, or an absolute path inside a work tree. Omit it for the repo you work in."
      })
    ),
    tag: typebox_exports.Optional(
      typebox_exports.String({
        minLength: 1,
        maxLength: 200,
        description: "A tag name. releases: show this release in full."
      })
    ),
    message: typebox_exports.Optional(
      typebox_exports.String({ minLength: 1, maxLength: 1e4, description: "tag_create: the tag's message." })
    ),
    target: typebox_exports.Optional(
      typebox_exports.String({
        minLength: 1,
        maxLength: 200,
        description: "tag_create: the commit to tag. Default HEAD. release_create: the branch or commit a new tag points at. Default: the default branch."
      })
    ),
    remote: typebox_exports.Optional(
      typebox_exports.String({ minLength: 1, maxLength: 100, description: "tag_push: the remote. Default origin." })
    ),
    title: typebox_exports.Optional(
      typebox_exports.String({
        minLength: 1,
        maxLength: 256,
        description: "release_create: the release title. Default: the tag."
      })
    ),
    notes: typebox_exports.Optional(
      typebox_exports.String({
        minLength: 1,
        maxLength: 6e4,
        description: "release_create: the release notes, Markdown."
      })
    ),
    draft: typebox_exports.Optional(typebox_exports.Boolean({ description: "release_create: save it as a draft. GitHub only." })),
    prerelease: typebox_exports.Optional(
      typebox_exports.Boolean({ description: "release_create: mark it as a pre-release. GitHub only." })
    ),
    generate_notes: typebox_exports.Optional(
      typebox_exports.Boolean({ description: "release_create: let GitHub write the notes. GitHub only." })
    ),
    pattern: typebox_exports.Optional(
      typebox_exports.String({ minLength: 1, maxLength: 100, description: "tags: a glob such as v1.*." })
    ),
    contains: typebox_exports.Optional(
      typebox_exports.String({ minLength: 1, maxLength: 200, description: "tags: only tags that contain this commit." })
    ),
    n: typebox_exports.Optional(
      typebox_exports.Integer({ minimum: 1, maximum: 100, description: "tags, releases: how many. Default 20." })
    )
  },
  { additionalProperties: false }
);
function classifyRelease(input) {
  const action = input.action;
  switch (action) {
    case "tags":
      return at(action, "local", "read");
    case "releases":
      return at(action, "external", "read");
    case "tag_create":
      return at(action, "local", "write");
    case "tag_push":
    case "release_create":
      return at(action, "external", "write");
    default:
      return void 0;
  }
}
var TAG_FORMAT = "%(refname:short)%09%(if)%(*objectname)%(then)%(*objectname:short)%(else)%(objectname:short)%(end)%09%(creatordate:short)%09%(contents:subject)";
function planTags(params, call) {
  if (params.pattern !== void 0 && !/^[A-Za-z0-9._*?/[\]-]{1,100}$/.test(params.pattern))
    throw new Error("release tags: pattern must be a glob such as v1.*");
  const contains = params.contains === void 0 ? void 0 : checkRev(params.contains, "contains");
  const n = Math.max(1, Math.min(100, Math.trunc(params.n ?? 20)));
  return readOnly(`release tags in ${params.repo ?? "here"}`, async () => {
    const repo = await resolveRepo(params.repo, call.signal, call.cwd);
    const args = [
      "tag",
      "--list",
      ...params.pattern ? [params.pattern] : [],
      "--sort=-version:refname",
      "--sort=-creatordate",
      `--format=${TAG_FORMAT}`,
      ...contains ? ["--contains", contains] : []
    ];
    const rows = (await gitOut(repo.root, args, { signal: call.signal })).split("\n").filter(Boolean);
    if (rows.length === 0)
      return {
        text: `No tags${params.pattern ? ` match ${params.pattern}` : ""}${contains ? ` that contain ${contains}` : ""} in ${repo.name}.`
      };
    const shown = rows.slice(0, n).map((row) => row.split("	").join("  "));
    return {
      text: `${repo.name}: ${plural(rows.length, "tag")}, newest first
${shown.join("\n")}${rows.length > n ? `
... ${rows.length - n} more` : ""}`,
      details: { latest: rows[0]?.split("	")[0] }
    };
  });
}
function planReleases2(params, call) {
  const tag = params.tag === void 0 ? void 0 : checkTag(params.tag);
  const n = Math.max(1, Math.min(100, Math.trunc(params.n ?? 20)));
  return readOnly(`release releases in ${params.repo ?? "here"}`, async () => {
    const repo = await resolveRepo(params.repo, call.signal, call.cwd);
    const flags = await repoFlags(repo, call.settings, call.signal);
    if (tag !== void 0) {
      const r = ghJson(
        "gh release view",
        await gh(
          [
            "release",
            "view",
            tag,
            "--json",
            "name,tagName,isDraft,isPrerelease,publishedAt,url,targetCommitish,body,assets",
            ...flags
          ],
          { cwd: repo.root, signal: call.signal }
        )
      );
      const flagsText = [r.isDraft ? "draft" : "", r.isPrerelease ? "pre-release" : ""].filter(Boolean).join(", ");
      const assets = r.assets.length > 0 ? `assets: ${r.assets.map((asset) => asset.name).join(", ")}` : "no assets";
      return {
        text: [
          `Release ${r.tagName}${r.name && r.name !== r.tagName ? ` "${r.name}"` : ""}${flagsText ? ` [${flagsText}]` : ""}, published ${r.publishedAt?.slice(0, 10) ?? "not yet"}, target ${r.targetCommitish}`,
          r.url,
          assets,
          "",
          firstLines(r.body ?? "", 120).text
        ].join("\n")
      };
    }
    const rows = ghJson(
      "gh release list",
      await gh(
        [
          "release",
          "list",
          "--limit",
          String(n),
          "--json",
          "name,tagName,isDraft,isPrerelease,isLatest,publishedAt",
          ...flags
        ],
        { cwd: repo.root, signal: call.signal }
      )
    );
    if (rows.length === 0) return { text: `No releases in ${repo.name}.` };
    const lines2 = rows.map(
      (r) => `${r.tagName}  ${r.publishedAt?.slice(0, 10) ?? "unpublished"}${r.isLatest ? "  latest" : ""}${r.isDraft ? "  draft" : ""}${r.isPrerelease ? "  pre-release" : ""}${r.name && r.name !== r.tagName ? `  ${r.name}` : ""}`
    );
    return { text: `${repo.name}: ${plural(rows.length, "release")}
${lines2.join("\n")}` };
  });
}
async function planTagCreate(params, call) {
  const tag = checkTag(params.tag);
  const message = checkCommitMessage(params.message);
  const target = params.target === void 0 ? "HEAD" : checkRev(params.target, "target");
  const repo = await resolveRepo(params.repo, call.signal, call.cwd);
  const { signal } = call;
  if (await revParse(repo.root, `refs/tags/${tag}`, signal))
    throw new Error(`tag ${tag} already exists in ${repo.name}; a tag is never moved or deleted from here`);
  const sha = await revParse(repo.root, target, signal);
  if (!sha) throw new Error(`${target} is not a commit in ${repo.name}`);
  return {
    preview: {
      summary: `tag ${sha.slice(0, 7)} as ${tag} in ${repo.name}`,
      body: message,
      format: "text",
      fingerprint: digest("tag_create", repo.root, tag, sha, message)
    },
    run: async () => {
      await gitOut(repo.root, ["tag", "--annotate", "-m", message, tag, sha], { signal });
      return {
        text: `Created the annotated tag ${tag} at ${sha.slice(0, 7)} in ${repo.name}. It is local until tag_push sends it.`,
        details: { tag, sha }
      };
    }
  };
}
async function planTagPush(params, call) {
  const tag = checkTag(params.tag);
  const remote = params.remote === void 0 ? "origin" : checkRemote(params.remote);
  const repo = await resolveRepo(params.repo, call.signal, call.cwd);
  const { signal } = call;
  const object = (await gitTry(repo.root, ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], { signal }))?.trim();
  if (!object) throw new Error(`tag ${tag} does not exist in ${repo.name}; tag_create makes it`);
  const commit = await revParse(repo.root, `refs/tags/${tag}`, signal) ?? object;
  const there = (await gitOut(repo.root, ["ls-remote", remote, `refs/tags/${tag}`], {
    signal,
    network: true,
    timeoutMs: T_NETWORK
  })).trim();
  if (there !== "" && !there.startsWith(object))
    throw new Error(
      `${remote} already has a tag ${tag} that points elsewhere; a pushed tag is never forced or deleted from here`
    );
  const subject = (await gitOut(repo.root, ["log", "-1", "--format=%s", commit], { signal })).trim();
  const already = there !== "";
  return {
    preview: {
      summary: `push the tag ${tag} (${commit.slice(0, 7)}) to ${remote} from ${repo.name}${already ? "; it is already there" : ""}`,
      body: `Tag ${tag} points at ${commit.slice(0, 7)}: ${subject}`,
      format: "text",
      fingerprint: digest("tag_push", repo.root, remote, tag, object)
    },
    run: async () => {
      if (already) return { text: `${remote} already has ${tag} at ${commit.slice(0, 7)}; nothing to push.` };
      const result = await git(
        repo.root,
        ["push", "--no-progress", remote, `refs/tags/${tag}:refs/tags/${tag}`],
        { signal, network: true, timeoutMs: T_PUSH }
      );
      if (result.code !== 0 || result.timedOut) {
        if (!mayHaveLanded(result) && !signal?.aborted)
          throw new Error(
            `git push failed: ${summaryOf(result.stderr || result.stdout) || `exit ${result.code}`}`
          );
        const why = result.timedOut ? "timed out" : signal?.aborted ? "the call was cancelled" : summaryOf(result.stderr);
        const now = await gitTry(repo.root, ["ls-remote", remote, `refs/tags/${tag}`], {
          network: true,
          timeoutMs: T_NETWORK
        });
        if (now === void 0)
          throw new Error(
            `git push: the reply was lost (${why}) and the check failed too. Run git ls-remote ${remote} before pushing again. Nothing was sent twice.`
          );
        if (!now.startsWith(object))
          throw new Error(
            `git push: the reply was lost (${why}) and ${remote} does not have ${tag}. Nothing was sent twice; push again if you still want it.`
          );
        return {
          text: `Pushed the tag ${tag} (${commit.slice(0, 7)}) to ${remote}. (The reply was lost (${why}); one check shows ${remote} has it. Nothing was sent twice.)`
        };
      }
      return {
        text: `Pushed the tag ${tag} (${commit.slice(0, 7)}) to ${remote} from ${repo.name}.`,
        details: { tag, commit }
      };
    }
  };
}
async function planReleaseCreate2(params, call) {
  const tag = checkTag(params.tag);
  const title = params.title === void 0 ? tag : checkTitle(params.title);
  const notes = params.notes === void 0 ? "" : checkBody(params.notes, "notes");
  const target = params.target === void 0 ? void 0 : checkRev(params.target, "target");
  const generate = params.generate_notes === true;
  const repo = await resolveRepo(params.repo, call.signal, call.cwd);
  const { signal, settings: settings2 } = call;
  const remote = await requireRemote(repo, settings2, signal);
  const { slug } = remote;
  const flags = ["-R", repoArgument(remote)];
  const exists = await gh(["release", "view", tag, "--json", "url", ...flags], { cwd: repo.root, signal });
  if (exists.code === 0) throw new Error(`a release for ${tag} already exists in ${slug}`);
  if (!/not found/i.test(exists.stderr)) throw ghFailure("gh release view", exists);
  const there = (await gitOut(repo.root, ["ls-remote", "origin", `refs/tags/${tag}`], {
    signal,
    network: true,
    timeoutMs: T_NETWORK
  })).trim().split("	")[0] ?? "";
  const base = await baseBranch(repo, settings2, signal);
  const at2 = there !== "" ? `the existing tag ${tag} (${there.slice(0, 7)})` : `a new tag ${tag} at ${target ?? `the head of ${base}`}`;
  const baseSha = there !== "" ? "" : await revParse(repo.root, `refs/remotes/origin/${target ?? base}`, signal) ?? "";
  const flagsText = [params.draft ? "draft" : "", params.prerelease ? "pre-release" : ""].filter(Boolean).join(", ");
  const text = `# ${title}

${generate ? "(GitHub writes the notes.)\n\n" : ""}${notes}`.trimEnd();
  return {
    preview: reviewPreview(
      `create the release ${tag}${flagsText ? ` (${flagsText})` : ""} on ${at2} in ${slug}`,
      text,
      digest(
        "release_create",
        slug,
        tag,
        title,
        notes,
        target ?? "",
        generate,
        params.draft === true,
        params.prerelease === true,
        there,
        baseSha
      )
    ),
    run: async () => {
      const args = [
        "release",
        "create",
        tag,
        `--title=${title}`,
        "--notes-file",
        "-",
        ...generate ? ["--generate-notes"] : [],
        ...target && there === "" ? ["--target", target] : [],
        ...params.draft ? ["--draft"] : [],
        ...params.prerelease ? ["--prerelease"] : [],
        ...flags
      ];
      const done = (url) => `Created the release ${tag} in ${slug}${url ? `: ${url}` : "."}`;
      const sent = await ghWrite("gh release create", args, { cwd: repo.root, signal, input: notes });
      if (sent.kind === "sent")
        return { text: done(sent.result.stdout.trim().split("\n").at(-1) ?? ""), details: { tag } };
      return afterLostReply("gh release create", sent.why, async () => {
        const now = await gh(["release", "view", tag, "--json", "url", ...flags], { cwd: repo.root });
        return now.code === 0 ? done(JSON.parse(now.stdout).url ?? "") : void 0;
      });
    }
  };
}
async function planRelease(params, call) {
  const p = params;
  if (params.action === "releases" || params.action === "release_create") {
    const repo = await resolveRepo(params.repo, call.signal, call.cwd);
    const home = await forgeOf(repo, call.settings, call.signal);
    if (home.forge === "gitlab")
      return params.action === "releases" ? planReleases(p, call, home) : planReleaseCreate(p, call, home);
  }
  switch (params.action) {
    case "tags":
      return planTags(p, call);
    case "releases":
      return planReleases2(p, call);
    case "tag_create":
      return planTagCreate(p, call);
    case "tag_push":
      return planTagPush(p, call);
    case "release_create":
      return planReleaseCreate2(p, call);
    default:
      throw new Error(unknownAction("release", params.action, Object.keys(RELEASE_ACTIONS)));
  }
}
var releaseTool = buildEngineTool({
  name: "release",
  label: "Release",
  description: "Tags and releases: list, create, push. The user must approve before a tag or release is pushed or created. Read the git skill before your first release call.",
  promptSnippet: "Tags and releases: list, create, push",
  parameters: ReleaseParams,
  table: RELEASE_ACTIONS,
  classify: classifyRelease,
  plan: async (params, call) => planRelease(params, call),
  // Calls run in order, and they work on the folder of the call.
  sequential: true,
  usesFolder: true
});

// plugins/jig-git/src/connector.ts
var connector = {
  name: "jig-git",
  tools: [prTool, releaseTool],
  // Both are local writes, which the engine runs with no question, so a gateway that cannot ask keeps them out until it can: `release
  // tag_create` and `pr watch` (the comment watch needs an agent that can be told about a comment).
  notOffered: { pr: ["watch"], release: ["tag_create"] },
  register: registerGitSection
};
var connector_default = connector;
export {
  connector_default as default
};
