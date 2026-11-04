// Runs every migration on PGlite (Postgres 17) and checks RLS and credit rules as real roles.
// node --test tests/db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = fileURLToPath(new URL("../../", import.meta.url));
const db = new PGlite();
const users = {};

/** Run `fn` as an authenticated user inside a transaction that is always rolled back. */
async function as(user, fn) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [users[user]]);
    await tx.exec("set local role authenticated");
    try {
      return await fn(tx);
    } finally {
      await tx.rollback();
    }
  });
}

/** Run `fn` as the given user and keep the changes. */
async function commitAs(user, fn) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [users[user]]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}

/** Run `fn` as the API server (service role). */
async function asService(fn) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return fn(tx);
  });
}

const one = async (tx, sql, params) => (await tx.query(sql, params)).rows[0];
const count = async (tx, sql, params) => (await tx.query(sql, params)).rows.length;

let project;
let otherProject;

before(async () => {
  await db.exec(readFileSync(join(root, "tests/db/supabase-shim.sql"), "utf8"));
  const dir = join(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  for (const name of ["owner", "manager", "editor", "viewer", "outsider"]) {
    users[name] = (await db.query("insert into auth.users (email) values ($1) returning id", [`${name}@test.local`])).rows[0].id;
  }
  project = (await commitAs("owner", (tx) => one(tx, "insert into projects (name) values ('Bridge') returning id"))).id;
  otherProject = (await commitAs("outsider", (tx) => one(tx, "insert into projects (name) values ('Other') returning id"))).id;
  await commitAs("owner", async (tx) => {
    await tx.query(
      "insert into project_members (project_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer'), ($1, $4, 'manager')",
      [project, users.editor, users.viewer, users.manager],
    );
  });
});

test("signing up creates a profile", async () => {
  const r = await as("owner", (tx) => one(tx, "select display_name from profiles where id = auth.uid()"));
  assert.equal(r.display_name, "owner");
});

test("project creator becomes owner and can read the project", async () => {
  const r = await as("owner", (tx) => one(tx, "select role from project_members where project_id = $1 and user_id = auth.uid()", [project]));
  assert.equal(r.role, "owner");
});

test("outsiders cannot see another project or its members", async () => {
  assert.equal(await as("outsider", (tx) => count(tx, "select 1 from projects where id = $1", [project])), 0);
  assert.equal(await as("outsider", (tx) => count(tx, "select 1 from project_members where project_id = $1", [project])), 0);
});

test("anon has no table access at all", async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await tx.query("select * from projects");
    }),
    /permission denied/,
  );
});

test("editors write content; viewers only read", async () => {
  await as("editor", async (tx) => {
    const s = await one(tx, "insert into scenes (project_id, position, heading) values ($1, 0, 'EXT. BRIDGE - DAY') returning id", [project]);
    assert.ok(s.id);
  });
  await assert.rejects(
    as("viewer", (tx) => tx.query("insert into scenes (project_id, position) values ($1, 0)", [project])),
    /row-level security/,
  );
});

test("an outsider cannot write into someone else's project", async () => {
  await assert.rejects(
    as("outsider", (tx) => tx.query("insert into characters (project_id, name) values ($1, 'Intruder')", [project])),
    /row-level security/,
  );
});

test("updates by viewers silently affect no rows", async () => {
  const n = await as("viewer", async (tx) => (await tx.query("update projects set name = 'Hacked' where id = $1", [project])).affectedRows);
  assert.equal(n, 0);
});

test("only managers/owners approve stages", async () => {
  await assert.rejects(
    as("editor", (tx) => tx.query("insert into stage_approvals (project_id, stage) values ($1, 'idea')", [project])),
    /row-level security/,
  );
  await as("owner", (tx) => tx.query("insert into stage_approvals (project_id, stage) values ($1, 'idea')", [project]));
});

test("managers add members but cannot grant owner; editors cannot add members", async () => {
  await as("manager", (tx) =>
    tx.query("insert into project_members (project_id, user_id, role) values ($1, $2, 'commenter')", [project, users.outsider]),
  );
  await assert.rejects(
    as("manager", (tx) =>
      tx.query("insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')", [project, users.outsider]),
    ),
    /row-level security/,
  );
  await assert.rejects(
    as("manager", (tx) => tx.query("update project_members set role = 'owner' where project_id = $1 and user_id = $2", [project, users.editor])),
    /row-level security/,
  );
  await assert.rejects(
    as("editor", (tx) => tx.query("insert into project_members (project_id, user_id, role) values ($1, $2, 'viewer')", [project, users.outsider])),
    /row-level security/,
  );
});

test("rows cannot link across projects (composite foreign keys)", async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      const scene = await one(tx, "insert into scenes (project_id, position) values ($1, 0) returning id", [project]);
      const shot = await one(tx, "insert into shots (project_id, scene_id, position) values ($1, $2, 0) returning id", [project, scene.id]);
      const foreign = await one(tx, "insert into characters (project_id, name) values ($1, 'Other cast') returning id", [otherProject]);
      await tx.query("insert into shot_cast (project_id, shot_id, character_id) values ($1, $2, $3)", [project, shot.id, foreign.id]);
    }),
    /foreign key/,
  );
});

test("character relationships: one per pair, same project only, editors only", async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      const a = await one(tx, "insert into characters (project_id, name) values ($1, 'A') returning id", [project]);
      const b = await one(tx, "insert into characters (project_id, name) values ($1, 'B') returning id", [project]);
      await tx.query("insert into character_relationships (project_id, from_id, to_id) values ($1, $2, $3)", [project, a.id, b.id]);
      await tx.query("insert into character_relationships (project_id, from_id, to_id) values ($1, $3, $2)", [project, a.id, b.id]);
    }),
    /duplicate key/,
    "reverse direction counts as the same pair",
  );
  await assert.rejects(
    db.transaction(async (tx) => {
      const a = await one(tx, "insert into characters (project_id, name) values ($1, 'A') returning id", [project]);
      const x = await one(tx, "insert into characters (project_id, name) values ($1, 'X') returning id", [otherProject]);
      await tx.query("insert into character_relationships (project_id, from_id, to_id) values ($1, $2, $3)", [project, a.id, x.id]);
    }),
    /foreign key/,
  );
  await as("editor", async (tx) => {
    const a = await one(tx, "insert into characters (project_id, name) values ($1, 'A') returning id", [project]);
    const b = await one(tx, "insert into characters (project_id, name) values ($1, 'B') returning id", [project]);
    await tx.query("insert into character_relationships (project_id, from_id, to_id, label) values ($1, $2, $3, 'mentor of')", [project, a.id, b.id]);
  });
  await assert.rejects(
    as("viewer", (tx) => tx.query("insert into character_relationships (project_id, from_id, to_id) values ($1, gen_random_uuid(), gen_random_uuid())", [project])),
    /row-level security/,
  );
});

test("timelines: one per scene, shape-checked, revision bumps on save", async () => {
  await as("editor", async (tx) => {
    const scene = await one(tx, "insert into scenes (project_id, position) values ($1, 0) returning id", [project]);
    const t = await one(tx, "insert into timelines (project_id, scene_id) values ($1, $2) returning id, revision", [project, scene.id]);
    assert.equal(t.revision, 0);
    const u = await one(tx, "update timelines set duration_s = 12 where id = $1 returning revision", [t.id]);
    assert.equal(u.revision, 1);
    await assert.rejects(tx.query("insert into timelines (project_id, scene_id) values ($1, $2)", [project, scene.id]), /duplicate key/);
  });
  await assert.rejects(
    as("editor", async (tx) => {
      const scene = await one(tx, "insert into scenes (project_id, position) values ($1, 1) returning id", [project]);
      await tx.query("insert into timelines (project_id, scene_id, doc) values ($1, $2, '{\"tracks\": 1}')", [project, scene.id]);
    }),
    /timelines_doc_shape/,
  );
  await assert.rejects(
    as("editor", async (tx) => {
      const scene = await one(tx, "insert into scenes (project_id, position) values ($1, 2) returning id", [project]);
      await tx.query("insert into timelines (project_id, scene_id, doc) values ($1, $2, '{\"clips\": [], \"markers\": []}')", [project, scene.id]);
    }),
    /timelines_doc_shape/,
    "a missing key is rejected too",
  );
});

test("built-in library entries are shared; user entries are private", async () => {
  await commitAs("owner", (tx) =>
    tx.query(
      `insert into library_entries (kind, scope, owner_id, slug, name, data) values ('scene_preset', 'user', auth.uid(), 'my-glide', 'My glide', '{"camera": {}}')`,
    ),
  );
  assert.equal(await as("outsider", (tx) => count(tx, "select 1 from library_entries where slug = 'fact-short' and scope = 'builtin'")), 1);
  assert.equal(await as("outsider", (tx) => count(tx, "select 1 from library_entries where name = 'My glide'")), 0);
  await assert.rejects(
    as("outsider", (tx) => tx.query(`insert into library_entries (kind, scope, slug, name, data) values ('narrative', 'builtin', 'fake', 'Fake', '{"beats": []}')`)),
    /row-level security/,
  );
});

test("library: built-ins seeded from code; slugs unique; data shape checked", async () => {
  const builtins = await as("outsider", async (tx) => (await tx.query("select kind, slug from library_entries where scope = 'builtin' order by kind, slug")).rows);
  assert.deepEqual(
    builtins.map((r) => `${r.kind}:${r.slug}`),
    [
      "narrative:fact-short",
      "narrative:heros-journey",
      "narrative:kishotenketsu",
      "narrative:save-the-cat",
      "narrative:three-act",
      "scene_preset:continuous-glide",
      "scene_preset:motion-graphics",
    ],
  );
  const glide = await as("outsider", (tx) => one(tx, "select data from library_entries where slug = 'continuous-glide'"));
  assert.deepEqual(glide.data.camera.glide_frames, [18, 40]);

  await assert.rejects(
    asService((tx) => tx.query(`insert into library_entries (kind, scope, slug, name, data) values ('narrative', 'builtin', 'fact-short', 'Dup', '{"beats": []}')`)),
    /duplicate key/,
  );
  await assert.rejects(
    commitAs("owner", (tx) =>
      tx.query(`insert into library_entries (kind, scope, owner_id, slug, name, data) values ('narrative', 'user', auth.uid(), 'bad', 'Bad', '{"no_beats": true}')`),
    ),
    /library_entries_data_shape/,
  );
  await assert.rejects(
    commitAs("owner", (tx) =>
      tx.query(`insert into library_entries (kind, scope, owner_id, slug, name, data) values ('narrative', 'user', auth.uid(), 'Bad Slug!', 'X', '{"beats": []}')`),
    ),
    /library_entries_slug_format/,
  );
  // Another user may reuse a slug; the same user may not.
  await commitAs("outsider", (tx) =>
    tx.query(`insert into library_entries (kind, scope, owner_id, slug, name, data) values ('scene_preset', 'user', auth.uid(), 'my-glide', 'Theirs', '{"camera": {}}')`),
  );
  await assert.rejects(
    commitAs("owner", (tx) =>
      tx.query(`insert into library_entries (kind, scope, owner_id, slug, name, data) values ('scene_preset', 'user', auth.uid(), 'my-glide', 'Again', '{"camera": {}}')`),
    ),
    /duplicate key/,
  );
});

test("clients cannot write credits or jobs", async () => {
  await assert.rejects(
    as("owner", (tx) => tx.query("insert into credit_ledger (user_id, delta, reason) values (auth.uid(), 1000, 'grant')")),
    /permission denied/,
  );
  await assert.rejects(
    as("owner", (tx) => tx.query("select private.grant_credits(auth.uid(), 1000)")),
    /permission denied/,
  );
});

test("credits: reserve, charge, refund and overspend protection", async () => {
  const balance = (u) => as(u, async (tx) => Number((await one(tx, "select credit_balance() as b")).b));

  await asService((tx) => tx.query("select private.grant_credits($1, 100, 'welcome')", [users.editor]));
  assert.equal(await balance("editor"), 100);

  const job = (await asService((tx) =>
    one(tx, "select private.reserve_job($1, $2, 'tripo_model', '{}', 30, 'key-0001') as id", [users.editor, project]),
  )).id;
  assert.equal(await balance("editor"), 70, "reservation holds credits");

  const retry = (await asService((tx) =>
    one(tx, "select private.reserve_job($1, $2, 'tripo_model', '{}', 30, 'key-0001') as id", [users.editor, project]),
  )).id;
  assert.equal(retry, job, "same idempotency key returns the same job");
  assert.equal(await balance("editor"), 70, "a retry does not reserve twice");

  await assert.rejects(
    asService((tx) => tx.query("select private.reserve_job($1, $2, 'unimate_motion', '{}', 80, 'key-0002')", [users.editor, project])),
    /insufficient credits/,
  );

  await asService((tx) => tx.query("select private.finish_job($1, true, 20, '{\"glb\":\"x\"}', null)", [job]));
  assert.equal(await balance("editor"), 80, "charged actual cost, rest released");

  await asService((tx) => tx.query("select private.finish_job($1, true, 20, null, null)", [job]));
  assert.equal(await balance("editor"), 80, "a duplicate callback changes nothing");

  const failed = (await asService((tx) =>
    one(tx, "select private.reserve_job($1, $2, 'image_google', '{}', 10, 'key-0003') as id", [users.editor, project]),
  )).id;
  await asService((tx) => tx.query("select private.finish_job($1, false, null, null, 'provider timeout')", [failed]));
  assert.equal(await balance("editor"), 80, "failed job refunded");

  assert.equal(await balance("owner"), 0, "credits are per user");
});

test("viewers cannot spend credits in a project", async () => {
  await asService((tx) => tx.query("select private.grant_credits($1, 50)", [users.viewer]));
  await assert.rejects(
    asService((tx) => tx.query("select private.reserve_job($1, $2, 'image_google', '{}', 5, 'key-0100')", [users.viewer, project])),
    /cannot run jobs/,
  );
});

test("the ledger is append-only", async () => {
  await assert.rejects(asService((tx) => tx.query("delete from credit_ledger")), /append-only/);
  await assert.rejects(asService((tx) => tx.query("update credit_ledger set delta = 999")), /append-only/);
});

test("team members can see each other's jobs in the project; outsiders cannot", async () => {
  assert.ok((await as("owner", (tx) => count(tx, "select 1 from jobs where project_id = $1", [project]))) >= 1);
  assert.equal(await as("outsider", (tx) => count(tx, "select 1 from jobs where project_id = $1", [project])), 0);
});

test("every public table has RLS enabled", async () => {
  const r = await db.query(
    "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity",
  );
  assert.deepEqual(r.rows, []);
});

test("every foreign key column is indexed", async () => {
  const r = await db.query(`
    select conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])`);
  assert.deepEqual(r.rows, []);
});
