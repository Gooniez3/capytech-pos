// Metadata only: never query application records or evaluate sequence defaults.
export const BASELINE = '1788652800000_baseline';
export const HISTORY = 'pgmigrations';
const appSchema = "n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'";
const appTable = `${appSchema} AND c.relname <> '${HISTORY}'`;

export const QUERIES = Object.freeze({
  schemas: `SELECT n.nspname AS name FROM pg_catalog.pg_namespace n WHERE ${appSchema} ORDER BY 1`,
  tables: `SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
    c.relpersistence AS persistence, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
    c.relreplident AS replica_identity, c.reloptions AS options,
    am.amname AS access_method, ts.spcname AS tablespace
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_catalog.pg_am am ON am.oid=c.relam
    LEFT JOIN pg_catalog.pg_tablespace ts ON ts.oid=c.reltablespace
    WHERE ${appTable} AND c.relkind IN ('r','p','v','m','f') ORDER BY 1,2`,
  columns: `SELECT n.nspname AS schema, c.relname AS table_name, a.attname AS name,
    pg_catalog.format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null,
    pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression,
    a.attidentity AS identity, a.attgenerated AS generated,
    CASE WHEN a.attcollation=0 THEN NULL ELSE cn.nspname || '.' || co.collname END AS collation,
    a.attinhcount AS inheritance_count
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    LEFT JOIN pg_catalog.pg_collation co ON co.oid=a.attcollation
    LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=co.collnamespace
    WHERE ${appTable} AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY 1,2,a.attnum`,
  constraints: `SELECT n.nspname AS schema, c.relname AS table_name, con.conname AS name,
    con.contype AS type, pg_catalog.pg_get_constraintdef(con.oid) AS definition,
    con.convalidated AS validated, con.condeferrable AS deferrable, con.condeferred AS deferred,
    con.connoinherit AS no_inherit
    FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE ${appTable} ORDER BY 1,2,3`,
  indexes: `SELECT n.nspname AS schema, c.relname AS table_name, ic.relname AS name,
    pg_catalog.pg_get_indexdef(i.indexrelid) AS definition, i.indisvalid AS valid,
    i.indisready AS ready, i.indislive AS live, i.indisclustered AS clustered,
    i.indisreplident AS replica_identity, ic.reloptions AS options, ts.spcname AS tablespace,
    con.conname AS constraint_name
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid
    LEFT JOIN pg_catalog.pg_tablespace ts ON ts.oid=ic.reltablespace
    LEFT JOIN pg_catalog.pg_constraint con ON con.conindid=i.indexrelid AND con.contype IN ('p','u','x')
    WHERE ${appTable} ORDER BY 1,2,3`,
  sequences: `SELECT n.nspname AS schema, c.relname AS name,
    pg_catalog.format_type(s.seqtypid,NULL) AS type, s.seqstart::text AS start,
    s.seqincrement::text AS increment, s.seqmin::text AS min, s.seqmax::text AS max,
    s.seqcache::text AS cache, s.seqcycle AS cycle, c.relpersistence AS persistence,
    tn.nspname AS owner_schema, tc.relname AS owner_table, a.attname AS owner_column,
    dep.deptype AS dependency_type
    FROM pg_catalog.pg_sequence s JOIN pg_catalog.pg_class c ON c.oid=s.seqrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_catalog.pg_depend dep ON dep.classid='pg_catalog.pg_class'::regclass
      AND dep.objid=c.oid AND dep.refclassid='pg_catalog.pg_class'::regclass AND dep.deptype IN ('a','i')
    LEFT JOIN pg_catalog.pg_class tc ON tc.oid=dep.refobjid
    LEFT JOIN pg_catalog.pg_namespace tn ON tn.oid=tc.relnamespace
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=tc.oid AND a.attnum=dep.refobjsubid
    WHERE ${appSchema} AND NOT (COALESCE(tn.nspname='public' AND tc.relname='${HISTORY}',false))
    ORDER BY 1,2`,
  triggers: `SELECT n.nspname AS schema, c.relname AS table_name, t.tgname AS name,
    t.tgenabled AS enabled, pg_catalog.pg_get_triggerdef(t.oid) AS definition
    FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE ${appSchema} AND NOT t.tgisinternal ORDER BY 1,2,3`,
  routines: `SELECT n.nspname AS schema, p.proname AS name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments, p.prokind AS kind
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE ${appSchema} ORDER BY 1,2,3`,
  types: `SELECT n.nspname AS schema, t.typname AS name, t.typtype AS kind
    FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
    LEFT JOIN pg_catalog.pg_class c ON c.oid=t.typrelid
    WHERE ${appSchema} AND (t.typtype IN ('d','e','r','m') OR (t.typtype='c' AND c.relkind='c')
      OR (t.typtype='b' AND t.typelem=0)) ORDER BY 1,2`,
  policies: `SELECT schemaname AS schema, tablename AS table_name, policyname AS name,
    permissive, roles, cmd, qual, with_check FROM pg_catalog.pg_policies
    WHERE schemaname <> 'information_schema' AND schemaname !~ '^pg_' ORDER BY 1,2,3`,
  rules: `SELECT n.nspname AS schema, c.relname AS table_name, r.rulename AS name,
    pg_catalog.pg_get_ruledef(r.oid) AS definition FROM pg_catalog.pg_rewrite r
    JOIN pg_catalog.pg_class c ON c.oid=r.ev_class JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE ${appSchema} ORDER BY 1,2,3`,
  extensions: `SELECT e.extname AS name, n.nspname AS schema FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace ORDER BY 1`,
  inheritance: `SELECT pn.nspname AS parent_schema, p.relname AS parent,
    cn.nspname AS child_schema, c.relname AS child FROM pg_catalog.pg_inherits i
    JOIN pg_catalog.pg_class p ON p.oid=i.inhparent JOIN pg_catalog.pg_namespace pn ON pn.oid=p.relnamespace
    JOIN pg_catalog.pg_class c ON c.oid=i.inhrelid JOIN pg_catalog.pg_namespace cn ON cn.oid=c.relnamespace
    WHERE cn.nspname <> 'information_schema' AND cn.nspname !~ '^pg_' ORDER BY 1,2,3,4`,
  event_triggers: `SELECT evtname AS name, evtevent AS event, evtenabled AS enabled
    FROM pg_catalog.pg_event_trigger ORDER BY 1`,
});

export async function inspectSchema(client) {
  const snapshot = {};
  for (const [section, sql] of Object.entries(QUERIES)) {
    snapshot[section] = (await client.query(sql)).rows;
  }
  return snapshot;
}

// Compare definitions, not physical OIDs, owners, privileges, statistics, or live counters.
// Array ordering is canonicalized so physical column order is not treated as schema drift.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k,canonical(value[k])]));
  return value;
}

export function schemaDifferences(expected, actual) {
  const differences = [];
  for (const section of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const want = new Set((expected[section] ?? []).map(r => JSON.stringify(canonical(r))));
    const got = new Set((actual[section] ?? []).map(r => JSON.stringify(canonical(r))));
    for (const row of want) if (!got.has(row)) differences.push(`${section}: missing or changed ${row}`);
    for (const row of got) if (!want.has(row)) differences.push(`${section}: unexpected or changed ${row}`);
    if (!(section in actual)) differences.push(`${section}: inspection section missing`);
  }
  return differences;
}

export function assertBaseline(expected, actual) {
  const differences = schemaDifferences(expected, actual);
  if (differences.length) throw new Error(`Schema drift detected; no repair or registration performed.\n${differences.join('\n')}`);
}

export function isEmptySchema(snapshot) {
  return Object.entries(snapshot).every(([section, rows]) => {
    if (section === 'schemas') return rows.length === 1 && rows[0].name === 'public';
    if (section === 'extensions') return rows.length === 1 && rows[0].name === 'plpgsql' && rows[0].schema === 'pg_catalog';
    return rows.length === 0;
  }) && Object.keys(QUERIES).every(k => k in snapshot);
}

export function classifyDatabase(snapshot, history, expected, migrations) {
  if (migrations[0] !== BASELINE) throw new Error('Baseline must be the first migration.');
  if (new Set(history).size !== history.length || history.some((name,i) => migrations[i] !== name)) {
    throw new Error('Unknown, duplicate, or out-of-order migration history; stop for review.');
  }
  if (history.length) return history.length === 1 ? 'baselined' : 'migrated';
  if (isEmptySchema(snapshot)) return 'empty';
  return schemaDifferences(expected, snapshot).length ? 'drifted-unbaselined' : 'matching-unbaselined';
}

export function planCommand(command, state, history) {
  if (command === 'baseline') {
    if (state !== 'matching-unbaselined') throw new Error('Baseline registration requires an exact matching, unbaselined existing schema.');
    return { direction: 'up', fake: true, file: BASELINE, count: 1 };
  }
  if (command === 'up') {
    if (!['empty','baselined','migrated'].includes(state)) throw new Error('Existing database is not baselined. Run read-only migrate:check; do not apply the fresh baseline.');
    return { direction: 'up', fake: false };
  }
  if (command === 'down') {
    if (history.length <= 1) throw new Error('Baseline rollback is intentionally blocked; no migration will run.');
    return { direction: 'down', fake: false, count: 1 };
  }
  throw new Error(`Unsupported mutation command: ${command}`);
}

export async function readHistory(client) {
  const relation = (await client.query(`SELECT c.relkind, c.relpersistence, c.relrowsecurity,
    c.relforcerowsecurity FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='pgmigrations'`)).rows;
  if (!relation.length) return [];
  if (relation.length !== 1 || relation[0].relkind !== 'r' || relation[0].relpersistence !== 'p'
      || relation[0].relrowsecurity || relation[0].relforcerowsecurity) {
    throw new Error('Unexpected migration history relation; stop for review.');
  }
  const columns = (await client.query(`SELECT a.attname AS name,
    pg_catalog.format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null,
    pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.pgmigrations'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`)).rows;
  const expected = [
    {name:'id',type:'integer',not_null:true,default_expression:"nextval('pgmigrations_id_seq'::regclass)"},
    {name:'name',type:'character varying(255)',not_null:true,default_expression:null},
    {name:'run_on',type:'timestamp without time zone',not_null:true,default_expression:null},
  ];
  if (schemaDifferences({columns:expected},{columns}).length) throw new Error('Unexpected migration history columns; no repair attempted.');
  const constraints = (await client.query(`SELECT conname AS name, pg_catalog.pg_get_constraintdef(oid) AS definition
    FROM pg_catalog.pg_constraint
    WHERE conrelid='public.pgmigrations'::regclass
      AND contype <> 'n'
    ORDER BY conname`)).rows;
  if (constraints.length !== 1 || constraints[0].definition !== 'PRIMARY KEY (id)') {
    throw new Error('Unexpected migration history constraints; no repair attempted.');
  }
  const sequences = (await client.query(`SELECT c.relname AS name, n.nspname AS schema, a.attname AS column_name
    FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class c ON c.oid=d.objid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
    WHERE d.classid='pg_catalog.pg_class'::regclass AND d.refclassid='pg_catalog.pg_class'::regclass
      AND d.refobjid='public.pgmigrations'::regclass AND d.deptype IN ('a','i') AND c.relkind='S'`)).rows;
  if (sequences.length !== 1 || sequences[0].name !== 'pgmigrations_id_seq'
      || sequences[0].schema !== 'public' || sequences[0].column_name !== 'id') {
    throw new Error('Unexpected migration history sequence ownership; stop for review.');
  }
  // Bookkeeping rows only. Never read application/customer records.
  return (await client.query('SELECT name FROM public.pgmigrations ORDER BY run_on, id')).rows.map(r => r.name);
}
