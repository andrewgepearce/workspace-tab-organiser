import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createRuleDraft, ruleFieldMessage } from "../extension/rule-draft.js";
import { createRuleStore } from "../extension/rule-store.js";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../extension/rule-draft.js"),
  "utf8",
);

function savedRule(overrides = {}) {
  return {
    id: "rule-1",
    label: "Example",
    hostname: "example.com",
    pathPrefix: null,
    ...overrides,
  };
}

function ids(draft) {
  return draft.rules().map((rule) => rule.id);
}

test("draft module does not touch the DOM or storage", () => {
  assert.match(source, /export function createRuleDraft/);
  assert.match(source, /export function ruleFieldMessage/);
  assert.doesNotMatch(source, /chrome\.|browser\.|document\.|localStorage|indexedDB|eval\(|fetch\(|drag/i);
  assert.doesNotMatch(source, /storage\.sync|storage\.managed/);
});

test("OTO-001 create, edit, delete and reorder keep stable identifiers", () => {
  const created = [];
  const draft = createRuleDraft([], {
    createId: () => {
      const id = `rule-${created.length + 1}`;
      created.push(id);
      return id;
    },
  });

  assert.equal(draft.addRule(), "rule-1");
  assert.equal(draft.addRule(), "rule-2");
  assert.equal(draft.addRule(), "rule-3");
  assert.deepEqual(created, ["rule-1", "rule-2", "rule-3"]);

  assert.equal(draft.updateRule("rule-2", {
    id: "replaced",
    label: "  Product documentation  ",
    hostname: "  Docs.Example.COM  ",
    pathPrefix: "/product",
  }), true);
  assert.equal(draft.rules()[1].id, "rule-2");
  assert.equal(draft.rules()[1].label, "  Product documentation  ");

  assert.equal(draft.moveRule("rule-3", "up"), true);
  assert.deepEqual(ids(draft), ["rule-1", "rule-3", "rule-2"]);
  assert.equal(draft.moveRule("rule-3", "up"), true);
  assert.deepEqual(ids(draft), ["rule-3", "rule-1", "rule-2"]);
  assert.equal(draft.moveRule("rule-3", "up"), false);
  assert.equal(draft.moveRule("rule-2", "down"), false);
  assert.equal(draft.moveRule("rule-2", "sideways"), false);
  assert.deepEqual(ids(draft), ["rule-3", "rule-1", "rule-2"]);

  assert.equal(draft.deleteRule("rule-1"), true);
  assert.equal(draft.deleteRule("missing"), false);
  assert.deepEqual(ids(draft), ["rule-3", "rule-2"]);
  assert.equal(draft.rules()[1].hostname, "  Docs.Example.COM  ");
  assert.deepEqual(created, ["rule-1", "rule-2", "rule-3"]);
});

test("moveRuleTo reaches an index by one-step swaps and keeps the other rules in order", () => {
  const draft = createRuleDraft([
    savedRule({ id: "a", label: "Alpha", hostname: "a.example" }),
    savedRule({ id: "b", label: "Beta", hostname: "b.example", pathPrefix: "/b" }),
    savedRule({ id: "c", label: "Gamma", hostname: "c.example" }),
    savedRule({ id: "d", label: "Delta", hostname: "d.example" }),
  ]);

  assert.equal(draft.moveRuleTo("a", 2), true);
  assert.deepEqual(ids(draft), ["b", "c", "a", "d"]);
  assert.equal(draft.rules()[2].label, "Alpha");
  assert.equal(draft.rules().find((rule) => rule.id === "b").pathPrefix, "/b");

  assert.equal(draft.moveRuleTo("d", 0), true);
  assert.deepEqual(ids(draft), ["d", "b", "c", "a"]);
  assert.equal(draft.moveRuleTo("b", 1), false);
  assert.equal(draft.moveRuleTo("b", -1), false);
  assert.equal(draft.moveRuleTo("b", 4), false);
  assert.equal(draft.moveRuleTo("b", 1.5), false);
  assert.equal(draft.moveRuleTo("missing", 0), false);
  assert.deepEqual(ids(draft), ["d", "b", "c", "a"]);
  assert.equal(draft.hasEdits(), true);
});

test("OTO-001 a saved reorder round-trips through the store in the new order", async () => {
  const storage = {
    data: {},
    async get(key) {
      return Object.hasOwn(this.data, key) ? { [key]: structuredClone(this.data[key]) } : {};
    },
    async set(items) {
      Object.assign(this.data, structuredClone(items));
    },
  };
  const store = createRuleStore(storage);
  const draft = createRuleDraft([
    savedRule({ id: "docs-product", label: "Product documentation", hostname: "docs.example.com", pathPrefix: "/product" }),
    savedRule({ id: "docs", label: "Other documentation", hostname: "docs.example.com" }),
  ]);

  assert.equal(draft.moveRule("docs", "up"), true);
  const validated = draft.validate();
  assert.equal(validated.ok, true);
  const saved = await store.save(validated.rules);
  assert.equal(saved.ok, true);

  const reopened = createRuleDraft((await createRuleStore(storage).load()).rules);
  assert.deepEqual(ids(reopened), ["docs", "docs-product"]);
  assert.equal(reopened.isDirty(), false);
  assert.equal(reopened.rules()[0].label, "Other documentation");
  assert.equal(reopened.rules()[1].pathPrefix, "/product");
});

test("OTO-002 empty label, invalid hostname and invalid path are named and not saved", async () => {
  const draft = createRuleDraft([
    savedRule({ id: "kept", label: "Kept", hostname: "kept.example" }),
  ], {
    createId: () => "bad",
  });
  draft.addRule();
  draft.updateRule("bad", {
    label: "   ",
    hostname: "https://user:secret@example.com/admin",
    pathPrefix: "product",
  });

  const validated = draft.validate();
  assert.equal(validated.ok, false);
  assert.deepEqual(
    validated.errors.map((error) => [error.index, error.id, error.field, error.code]),
    [
      [1, "bad", "label", "empty"],
      [1, "bad", "hostname", "invalid"],
      [1, "bad", "pathPrefix", "invalid"],
    ],
  );
  for (const error of validated.errors) {
    assert.equal(error.message, ruleFieldMessage(error.field, error.code));
    assert.equal(error.message.includes("secret"), false);
    assert.equal(error.message.includes("product"), false);
  }
  assert.match(validated.errors[0].message, /label/i);
  assert.match(validated.errors[1].message, /hostname/i);
  assert.match(validated.errors[2].message, /path prefix/i);

  let sets = 0;
  const storage = {
    async get() {
      return {};
    },
    async set() {
      sets += 1;
    },
  };
  const saved = await createRuleStore(storage).save(draft.validationInputs());
  assert.equal(saved.ok, false);
  assert.equal(saved.written, false);
  assert.equal(sets, 0);
});

test("a blank path prefix means any path and a spaced prefix is invalid", () => {
  const draft = createRuleDraft([], { createId: () => "host" });
  draft.addRule();
  draft.updateRule("host", { label: "Example", hostname: "example.com", pathPrefix: "   " });
  const omitted = draft.validate();
  assert.equal(omitted.ok, true);
  assert.equal(omitted.rules[0].pathPrefix, null);
  assert.equal(draft.validationInputs()[0].pathPrefix, null);

  draft.updateRule("host", { pathPrefix: " /product" });
  const spaced = draft.validate();
  assert.equal(spaced.ok, false);
  assert.equal(spaced.errors[0].field, "pathPrefix");
  assert.equal(spaced.errors[0].id, "host");
});

test("discard restores the saved rules and clears edits", () => {
  const draft = createRuleDraft([
    savedRule({ id: "a", label: "Alpha", hostname: "a.example" }),
    savedRule({ id: "b", label: "Beta", hostname: "b.example", pathPrefix: "/beta" }),
  ]);
  const before = draft.rules();

  draft.updateRule("a", { label: "Changed" });
  draft.moveRule("b", "up");
  draft.addRule();
  assert.equal(draft.hasEdits(), true);
  assert.equal(draft.isDirty(), true);

  draft.revert();
  assert.equal(draft.hasEdits(), false);
  assert.equal(draft.isDirty(), false);
  assert.deepEqual(draft.rules(), before);
  assert.equal(draft.rules()[1].pathPrefix, "/beta");
});

test("an unreadable load is not an edit until the caller replaces the saved list", () => {
  const draft = createRuleDraft([], { unreadable: true });
  assert.equal(draft.isUnreadable(), true);
  assert.equal(draft.hasEdits(), false);
  assert.equal(draft.isDirty(), true);

  draft.revert();
  assert.equal(draft.isUnreadable(), true);
  assert.deepEqual(draft.rules(), []);

  draft.replaceSaved([savedRule({ id: "a", label: "Alpha", hostname: "a.example" })]);
  assert.equal(draft.isUnreadable(), false);
  assert.equal(draft.isDirty(), false);
  assert.deepEqual(ids(draft), ["a"]);
});

test("replaceSaved adopts the canonical rules returned by validation", () => {
  const draft = createRuleDraft([], { createId: () => "docs" });
  draft.addRule();
  draft.updateRule("docs", {
    label: "  Product documentation  ",
    hostname: "  Docs.Example.COM  ",
    pathPrefix: "",
  });
  const validated = draft.validate();
  assert.equal(validated.ok, true);
  draft.replaceSaved(validated.rules);

  assert.equal(draft.isDirty(), false);
  assert.deepEqual(draft.rules(), [
    {
      id: "docs",
      label: "Product documentation",
      hostname: "docs.example.com",
      pathPrefix: "",
    },
  ]);
  assert.equal(draft.savedRules()[0].hostname, "docs.example.com");
});

test("callers cannot mutate the draft through a returned array", () => {
  const draft = createRuleDraft([savedRule()]);
  const rules = draft.rules();
  rules[0].label = "Mutated";
  rules.push(savedRule({ id: "extra" }));
  assert.equal(draft.rules()[0].label, "Example");
  assert.deepEqual(ids(draft), ["rule-1"]);
});

test("unknown rules and bad arguments do not change the draft", () => {
  const draft = createRuleDraft([savedRule()]);
  assert.equal(draft.updateRule("missing", { label: "No" }), false);
  assert.equal(draft.updateRule("rule-1", null), false);
  assert.equal(draft.rules()[0].label, "Example");
  assert.throws(() => createRuleDraft(null), TypeError);
  assert.throws(() => createRuleDraft([], { createId: "nope" }), TypeError);
});

test("the default identifier is a UUID and stays on the rule", () => {
  const draft = createRuleDraft([]);
  const id = draft.addRule();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  draft.updateRule(id, { label: "Mail", hostname: "mail.example", pathPrefix: "/inbox" });
  draft.addRule();
  draft.moveRule(id, "down");
  assert.equal(draft.rules()[1].id, id);
  draft.deleteRule(draft.rules()[0].id);
  assert.equal(draft.rules()[0].id, id);
});

test("duplicate identifiers are reported on the later rule", () => {
  const draft = createRuleDraft([
    savedRule({ id: "same", label: "First", hostname: "one.example" }),
    savedRule({ id: "same", label: "Second", hostname: "two.example" }),
  ]);
  const validated = draft.validate();
  assert.equal(validated.ok, false);
  assert.deepEqual(validated.errors, [
    {
      index: 1,
      id: "same",
      field: "id",
      code: "duplicate",
      message: "This identifier is already used by another rule.",
    },
  ]);
});
