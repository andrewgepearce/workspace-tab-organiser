import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ORGANISER_RULES_KEY, ORGANISER_SETTINGS_KEY, createRuleStore } from "../extension/rule-store.js";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../extension/rule-store.js"),
  "utf8",
);

function rule(overrides = {}) {
  return {
    id: "rule-1",
    label: "Example",
    hostname: "example.com",
    pathPrefix: null,
    ...overrides,
  };
}

function memoryStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    gets: 0,
    sets: [],
    async get(key) {
      this.gets += 1;
      if (typeof key !== "string") {
        throw new TypeError("expected one storage key");
      }
      if (!Object.hasOwn(data, key)) {
        return {};
      }
      return { [key]: structuredClone(data[key]) };
    },
    async set(items) {
      this.sets.push(structuredClone(items));
      Object.assign(data, structuredClone(items));
    },
    snapshot() {
      return structuredClone(data);
    },
  };
}

test("store module stays on the injected adapter and local rules key", () => {
  assert.equal(ORGANISER_RULES_KEY, "organiserRules");
  assert.equal(ORGANISER_SETTINGS_KEY, "organiserSettings");
  assert.match(source, /export function createRuleStore/);
  assert.doesNotMatch(source, /chrome\.|browser\.|document\.|localStorage|indexedDB|eval\(|fetch\(/);
  assert.doesNotMatch(source, /storage\.sync|storage\.managed|\.sync\b|\.managed\b/);
});

test("a missing key loads as an empty list and does not write", async () => {
  const storage = memoryStorage();
  const store = createRuleStore(storage);
  const loaded = await store.load();

  assert.deepEqual(loaded, { ok: true, rules: [], reason: null, groupUnmatchedTabs: true });
  assert.equal(storage.gets, 2);
  assert.deepEqual(storage.sets, []);
  assert.deepEqual(storage.snapshot(), {});
});

test("null and omitted stored values load as an empty list", async () => {
  for (const value of [null, undefined]) {
    const storage = memoryStorage({ [ORGANISER_RULES_KEY]: value });
    const loaded = await createRuleStore(storage).load();
    assert.deepEqual(loaded, { ok: true, rules: [], reason: null, groupUnmatchedTabs: true });
    assert.deepEqual(storage.sets, []);
  }
});

test("corrupt storage is reported and left unchanged", async () => {
  const badValues = [
    "not-rules",
    4,
    { id: "rule-1" },
    [{ id: "rule-1", label: "", hostname: "example.com", pathPrefix: null }],
    [rule({ id: "same" }), rule({ id: "same", label: "Second" })],
  ];

  for (const value of badValues) {
    const storage = memoryStorage({ [ORGANISER_RULES_KEY]: value, other: 1 });
    const before = storage.snapshot();
    const loaded = await createRuleStore(storage).load();
    assert.equal(loaded.ok, false);
    assert.equal(loaded.reason, "unreadable");
    assert.deepEqual(loaded.rules, []);
    assert.ok(loaded.errors.length > 0);
    assert.equal(JSON.stringify(loaded).includes("not-rules"), false);
    assert.deepEqual(storage.sets, []);
    assert.deepEqual(storage.snapshot(), before);
  }

  const broken = memoryStorage({ other: 1 });
  for (const response of [null, ["nope"], "bad"]) {
    broken.get = async () => response;
    const loaded = await createRuleStore(broken).load();
    assert.equal(loaded.ok, false);
    assert.equal(loaded.reason, "unreadable");
  }
  assert.deepEqual(broken.sets, []);
  assert.deepEqual(broken.snapshot(), { other: 1 });
});

test("OTO-001 saved order survives a new store on the same adapter", async () => {
  const storage = memoryStorage();
  const store = createRuleStore(storage);
  const firstSave = await store.save([
    rule({ id: "docs-product", label: "Product documentation", hostname: "docs.example.com", pathPrefix: "/product" }),
    rule({ id: "docs", label: "Other documentation", hostname: "docs.example.com", pathPrefix: null }),
    rule({ id: "mail", label: "Mail", hostname: "mail.example.com", pathPrefix: null }),
  ]);

  assert.equal(firstSave.ok, true);
  assert.equal(firstSave.written, true);
  assert.deepEqual(
    firstSave.rules.map((item) => item.id),
    ["docs-product", "docs", "mail"],
  );
  assert.equal(storage.sets.length, 1);
  assert.deepEqual(Object.keys(storage.sets[0]).sort(), [ORGANISER_RULES_KEY, ORGANISER_SETTINGS_KEY].sort());
  assert.deepEqual(storage.sets[0][ORGANISER_SETTINGS_KEY], { groupUnmatchedTabs: true });

  const reordered = await store.save([
    firstSave.rules[2],
    firstSave.rules[0],
    firstSave.rules[1],
  ]);
  assert.equal(reordered.ok, true);
  assert.equal(storage.sets.length, 2);

  const reopened = await createRuleStore(storage).load();
  assert.equal(reopened.ok, true);
  assert.deepEqual(
    reopened.rules.map((item) => item.id),
    ["mail", "docs-product", "docs"],
  );
  assert.deepEqual(reopened.rules[1], {
    id: "docs-product",
    label: "Product documentation",
    hostname: "docs.example.com",
    pathPrefix: "/product",
  });
});

test("OTO-002 an invalid rule is not saved and the previous list remains", async () => {
  const storage = memoryStorage({
    [ORGANISER_RULES_KEY]: [rule({ id: "kept", label: "Kept", hostname: "kept.example" })],
    unrelated: { stay: true },
  });
  const store = createRuleStore(storage);
  const result = await store.save([
    rule({ id: "kept", label: "Kept", hostname: "kept.example" }),
    {
      id: "bad",
      label: "   ",
      hostname: "https://user:secret@example.com/path",
      pathPrefix: "product",
    },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.written, false);
  assert.deepEqual(result.errors, [
    { index: 1, field: "label", code: "empty" },
    { index: 1, field: "hostname", code: "invalid" },
    { index: 1, field: "pathPrefix", code: "invalid" },
  ]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.deepEqual(storage.sets, []);

  const loaded = await store.load();
  assert.deepEqual(loaded.rules, [rule({ id: "kept", label: "Kept", hostname: "kept.example" })]);
  assert.deepEqual(storage.snapshot().unrelated, { stay: true });
});

test("OTO-003 save writes the canonical list once and only to the local key", async () => {
  const storage = memoryStorage();
  const store = createRuleStore(storage);
  const saved = await store.save([
    {
      id: "docs",
      label: "  Product documentation  ",
      hostname: "  Docs.Example.COM  ",
      pathPrefix: "/product",
      secret: "do-not-store",
    },
  ]);

  assert.equal(saved.ok, true);
  assert.equal(storage.sets.length, 1);
  assert.deepEqual(storage.sets[0], {
    [ORGANISER_RULES_KEY]: [
      {
        id: "docs",
        label: "Product documentation",
        hostname: "docs.example.com",
        pathPrefix: "/product",
      },
    ],
    [ORGANISER_SETTINGS_KEY]: { groupUnmatchedTabs: true },
  });
  assert.equal(JSON.stringify(storage.snapshot()).includes("secret"), false);

  const loaded = await createRuleStore(storage).load();
  assert.deepEqual(loaded.rules, saved.rules);
});

test("deleting a rule persists the remaining order and identifiers", async () => {
  const storage = memoryStorage();
  const store = createRuleStore(storage);
  await store.save([
    rule({ id: "a", label: "A", hostname: "a.example" }),
    rule({ id: "b", label: "B", hostname: "b.example" }),
    rule({ id: "c", label: "C", hostname: "c.example" }),
  ]);
  const saved = await store.save([
    rule({ id: "a", label: "A renamed", hostname: "a.example" }),
    rule({ id: "c", label: "C", hostname: "c.example" }),
  ]);

  assert.equal(saved.ok, true);
  const loaded = await createRuleStore(storage).load();
  assert.deepEqual(
    loaded.rules.map((item) => [item.id, item.label]),
    [
      ["a", "A renamed"],
      ["c", "C"],
    ],
  );
});

test("an empty list is a valid save and clears stored rules", async () => {
  const storage = memoryStorage({
    [ORGANISER_RULES_KEY]: [rule()],
  });
  const store = createRuleStore(storage);
  const saved = await store.save([]);

  assert.equal(saved.ok, true);
  assert.deepEqual(saved.rules, []);
  assert.equal(storage.sets.length, 1);
  const loaded = await store.load();
  assert.deepEqual(loaded, { ok: true, rules: [], reason: null, groupUnmatchedTabs: true });
});

test("a non-array save is rejected without a write", async () => {
  const storage = memoryStorage({ [ORGANISER_RULES_KEY]: [rule()] });
  const result = await createRuleStore(storage).save({ id: "rule-1" });
  assert.deepEqual(result, {
    ok: false,
    written: false,
    errors: [{ index: null, field: "rules", code: "invalid" }],
  });
  assert.deepEqual(storage.sets, []);
  assert.equal((await createRuleStore(storage).load()).rules.length, 1);
});

test("D12 a missing setting stays on and an explicit false is kept", async () => {
  const savedRules = [rule({ id: "kept", label: "Kept", hostname: "kept.example" })];
  const missing = memoryStorage({ [ORGANISER_RULES_KEY]: savedRules });
  const missingLoaded = await createRuleStore(missing).load();
  assert.equal(missingLoaded.ok, true);
  assert.equal(missingLoaded.groupUnmatchedTabs, true);
  assert.deepEqual(missing.sets, []);

  const off = memoryStorage({
    [ORGANISER_RULES_KEY]: savedRules,
    [ORGANISER_SETTINGS_KEY]: { groupUnmatchedTabs: false },
  });
  const offLoaded = await createRuleStore(off).load();
  assert.equal(offLoaded.groupUnmatchedTabs, false);
  assert.deepEqual(offLoaded.rules, savedRules);

  for (const value of [null, { other: true }, { groupUnmatchedTabs: "false" }, "off", []]) {
    const storage = memoryStorage({
      [ORGANISER_RULES_KEY]: savedRules,
      [ORGANISER_SETTINGS_KEY]: value,
    });
    const loaded = await createRuleStore(storage).load();
    assert.equal(loaded.ok, true, JSON.stringify(value));
    assert.equal(loaded.groupUnmatchedTabs, true);
    assert.deepEqual(storage.sets, []);
  }
});

test("D12 save writes the checkbox with the rules and an invalid list writes neither", async () => {
  const storage = memoryStorage({
    [ORGANISER_RULES_KEY]: [rule({ id: "kept", label: "Kept", hostname: "kept.example" })],
    [ORGANISER_SETTINGS_KEY]: { groupUnmatchedTabs: true },
  });
  const store = createRuleStore(storage);
  const saved = await store.save(
    [rule({ id: "kept", label: "Kept", hostname: "kept.example" })],
    { groupUnmatchedTabs: false },
  );
  assert.equal(saved.ok, true);
  assert.equal(saved.groupUnmatchedTabs, false);
  assert.equal(storage.sets.length, 1);
  assert.deepEqual(storage.snapshot()[ORGANISER_SETTINGS_KEY], { groupUnmatchedTabs: false });

  const reopened = await createRuleStore(storage).load();
  assert.equal(reopened.groupUnmatchedTabs, false);

  const rejected = await store.save(
    [{ id: "bad", label: "", hostname: "kept.example", pathPrefix: null }],
    { groupUnmatchedTabs: true },
  );
  assert.equal(rejected.written, false);
  assert.equal(storage.sets.length, 1);
  assert.equal((await store.load()).groupUnmatchedTabs, false);
});

test("createRuleStore rejects an adapter without get and set", () => {
  assert.throws(() => createRuleStore(null), TypeError);
  assert.throws(() => createRuleStore({ get() {} }), TypeError);
  assert.throws(() => createRuleStore({ set() {} }), TypeError);
});
