import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MigrationBuilder } from 'node-pg-migrate';
import { loadMigrations } from 'node-pg-migrate/runner';
import {
  BASELINE, QUERIES, inspectSchema, isEmptySchema, schemaDifferences,
  assertBaseline, classifyDatabase, planCommand, readHistory,
} from './lib/schema-inspection.mjs';
import {
  MIGRATIONS, IGNORE_PATTERN, migrationNames, parseArguments,
  connectionConfig, executeDatabaseCommand,
} from './migrate.mjs';
import { up as baselineUp, down as baselineDown, BASELINE_SQL } from '../migrations/1788652800000_baseline.mjs';
import {
  up as p04Up, down as p04Down, UP_SQL as P04_UP_SQL, DOWN_SQL as P04_DOWN_SQL,
  CONSTRAINT_NAMES as P04_CONSTRAINT_NAMES,
} from '../migrations/1788652800001_p04-database-constraints.mjs';
import {
  up as p06Up, down as p06Down, UP_SQL as P06_UP_SQL, DOWN_SQL as P06_DOWN_SQL,
  CONSTRAINT_NAMES as P06_CONSTRAINT_NAMES,
} from '../migrations/1788652800002_p06-checkout-request-fingerprint.mjs';
import {
  up as p08Up, down as p08Down, UP_SQL as P08_UP_SQL, DOWN_SQL as P08_DOWN_SQL,
  CONSTRAINT_NAMES as P08_CONSTRAINT_NAMES,
} from '../migrations/1788652800003_p08-product-recycle-bin.mjs';
import {
  up as p10Up, down as p10Down, UP_SQL as P10_UP_SQL,
  CONSTRAINT_NAME as P10_CONSTRAINT_NAME,
} from '../migrations/1791676800000_p10-invoice-warranty.mjs';
import {
  up as p2bUp, down as p2bDown, UP_SQL as P2B_UP_SQL,
  MIGRATION_NAME as P2B_MIGRATION_NAME, NEW_TABLES as P2B_NEW_TABLES,
  NEW_SEQUENCES as P2B_NEW_SEQUENCES,
} from '../migrations/1791763200000_p2b-stock-unit-warranty-schema.mjs';
import {
  up as p3aUp, down as p3aDown, UP_SQL as P3A_UP_SQL,
  MIGRATION_NAME as P3A_MIGRATION_NAME, NEW_TABLES as P3A_NEW_TABLES,
  NEW_SEQUENCES as P3A_NEW_SEQUENCES,
} from '../migrations/1791849600000_p3a-inventory-movements.mjs';
import {
  up as p3dUp, down as p3dDown, UP_SQL as P3D_UP_SQL,
  MIGRATION_NAME as P3D_MIGRATION_NAME, NEW_TABLES as P3D_NEW_TABLES,
  NEW_SEQUENCES as P3D_NEW_SEQUENCES,
} from '../migrations/1791936000000_p3d-inventory-receipts.mjs';

const P04 = '1788652800001_p04-database-constraints';
const P06 = '1788652800002_p06-checkout-request-fingerprint';
const P08 = '1788652800003_p08-product-recycle-bin';
const P10 = '1791676800000_p10-invoice-warranty';
const P2B = '1791763200000_p2b-stock-unit-warranty-schema';
const P3A = '1791849600000_p3a-inventory-movements';
const P3D = '1791936000000_p3d-inventory-receipts';
const EXPECTED_MIGRATIONS = [BASELINE, P04, P06, P08, P10, P2B, P3A, P3D];

const expected = JSON.parse(await readFile(join(MIGRATIONS,'baseline-schema.json'),'utf8'));
const clone = () => structuredClone(expected);
const empty = () => Object.fromEntries(Object.entries(expected).map(([k,v])=>[k,['schemas','extensions'].includes(k)?structuredClone(v):[]]));
const config = connectionConfig({DB_HOST:'localhost',DB_PORT:'5432',DB_NAME:'unit_test_only',DB_USER:'test',DB_PASSWORD:'test'},true);

function catalogClient(snapshot) {
  const queries = [];
  return {
    queries,
    async connect() {}, async end() {},
    async query(sql) {
      queries.push(sql);
      const section = Object.keys(QUERIES).find(k=>QUERIES[k]===sql);
      if (section) return {rows:structuredClone(snapshot[section])};
      if (['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','COMMIT','ROLLBACK'].includes(sql)) return {rows:[]};
      if (sql.includes("current_setting('server_version_num')")) return {rows:[{database:'unit_test_only',version:170011,read_only:'on'}]};
      if (sql.includes("c.relname='pgmigrations'")) return {rows:[]};
      throw new Error(`Unexpected SQL in metadata-only test: ${sql}`);
    },
  };
}

test('metadata inspection uses only catalog SELECTs and never evaluates sequences', async()=>{
  const client = catalogClient(expected);
  assert.deepEqual(await inspectSchema(client),expected);
  for (const sql of client.queries) {
    assert.match(sql,/^SELECT /);
    assert.match(sql,/pg_catalog\./);
    assert.doesNotMatch(sql,/\b(nextval|setval|last_value)\s*\(/i);
    assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
  }
});

test('exact baseline matches independent of catalog row order',()=>{
  const actual = clone();
  for (const rows of Object.values(actual)) rows.reverse();
  assert.deepEqual(schemaDifferences(expected,actual),[]);
});

const driftCases = {
  'missing customer column':s=>{s.columns=s.columns.filter(c=>!(c.table_name==='sales' && c.name==='customer_id'));},
  'incompatible idempotency type':s=>{s.columns.find(c=>c.name==='idempotency_key').type='text';},
  'changed nullable setting':s=>{s.columns.find(c=>c.table_name==='sale_items' && c.name==='unit_cost').not_null=false;},
  'changed soft-delete default':s=>{s.columns.find(c=>c.table_name==='products' && c.name==='is_active').default_expression='false';},
  'missing partial unique index':s=>{s.indexes=s.indexes.filter(i=>i.name!=='idx_sales_idempotency_key');},
  'wrong index predicate':s=>{const i=s.indexes.find(i=>i.name==='idx_sales_idempotency_key');i.definition=i.definition.replace('IS NOT NULL','IS NULL');},
  'invalid index':s=>{s.indexes[0].valid=false;},
  'missing foreign key':s=>{s.constraints=s.constraints.filter(c=>c.name!=='sales_customer_id_fkey');},
  'changed foreign key action':s=>{s.constraints.find(c=>c.name==='sales_customer_id_fkey').definition+=' DEFERRABLE';},
  'unvalidated constraint':s=>{s.constraints[0].validated=false;},
  'missing invoice sequence':s=>{s.sequences=s.sequences.filter(s=>s.name!=='invoice_number_seq');},
  'changed sequence increment':s=>{s.sequences.find(s=>s.name==='invoice_number_seq').increment='2';},
  'changed sequence ownership':s=>{s.sequences[0].owner_column='user_id';},
  'unexpected column':s=>{s.columns.push({...s.columns[0],name:'unexpected'});},
  'unexpected table':s=>{s.tables.push({...s.tables[0],name:'unexpected'});},
  'unexpected trigger':s=>{s.triggers.push({name:'unexpected'});},
  'unexpected function':s=>{s.routines.push({name:'unexpected'});},
  'unexpected schema':s=>{s.schemas.push({name:'other'});},
  'unexpected policy':s=>{s.policies.push({name:'unexpected'});},
  'unexpected extension':s=>{s.extensions.push({name:'unexpected',schema:'public'});},
  'unexpected enum':s=>{s.types.push({name:'unexpected',kind:'e'});},
  'unexpected rule':s=>{s.rules.push({name:'unexpected'});},
  'unexpected inheritance':s=>{s.inheritance.push({parent:'sales',child:'archive'});},
  'unexpected event trigger':s=>{s.event_triggers.push({name:'unexpected'});},
  'changed collation':s=>{s.columns.find(c=>c.name==='name').collation='pg_catalog.C';},
  'enabled RLS':s=>{s.tables[0].rls=true;},
  'incomplete inspection':s=>{delete s.sequences;},
};
for (const [name, mutate] of Object.entries(driftCases)) {
  test(`fail closed: ${name}`,()=>{
    const actual=clone(); mutate(actual);
    assert.throws(()=>assertBaseline(expected,actual),/Schema drift detected/);
    assert.equal(classifyDatabase(actual,[],expected,[BASELINE]),'drifted-unbaselined');
  });
}

test('detect empty, matching, baselined and later-migrated databases',()=>{
  assert.equal(classifyDatabase(empty(),[],expected,[BASELINE]),'empty');
  assert.equal(classifyDatabase(expected,[],expected,[BASELINE]),'matching-unbaselined');
  assert.equal(classifyDatabase(expected,[BASELINE],expected,[BASELINE]),'baselined');
  const names=[BASELINE,'1788652800001_future'];
  assert.equal(classifyDatabase(expected,names,expected,names),'migrated');
  const partial=empty();partial.sequences=[expected.sequences[0]];
  assert.equal(isEmptySchema(partial),false);
  assert.equal(isEmptySchema({}),false);
});

test('reject unknown, duplicated, out-of-order history and missing baseline',()=>{
  for (const history of [['unknown'],[BASELINE,BASELINE],['1788652800001_future']]) {
    assert.throws(()=>classifyDatabase(expected,history,expected,[BASELINE,'1788652800001_future']),/migration history/);
  }
  assert.throws(()=>classifyDatabase(expected,[],expected,[]),/first migration/);
});

test('up never applies the fresh baseline to an unbaselined existing DB',()=>{
  for(const state of ['matching-unbaselined','drifted-unbaselined']) assert.throws(()=>planCommand('up',state,[]),/not baselined/);
  assert.deepEqual(planCommand('up','empty',[]),{direction:'up',fake:false});
});

test('registration plan can fake only the named baseline, never future migrations',()=>{
  assert.deepEqual(planCommand('baseline','matching-unbaselined',[]),{direction:'up',fake:true,file:BASELINE,count:1});
  for(const state of ['empty','drifted-unbaselined','baselined','migrated']) assert.throws(()=>planCommand('baseline',state,[]),/exact matching/);
});

test('baseline down is blocked and later rollback selects one migration',()=>{
  assert.throws(baselineDown,/intentionally blocked/);
  assert.throws(()=>planCommand('down','baselined',[BASELINE]),/intentionally blocked/);
  assert.deepEqual(planCommand('down','migrated',[BASELINE,'future']),{direction:'down',fake:false,count:1});
});

test('fresh baseline rejects populated schema before queuing SQL',async()=>{
  let queued=false;
  await assert.rejects(baselineUp({db:catalogClient(expected),sql(){queued=true;}}),/empty application schema/);
  assert.equal(queued,false);
});

test('installed node-pg-migrate loads all migrations deterministically without executing DDL',async()=>{
  const client=catalogClient(empty());
  const migrations=await loadMigrations(client,{dir:MIGRATIONS,ignorePattern:IGNORE_PATTERN},console);
  assert.deepEqual(migrations.map(m=>m.name),EXPECTED_MIGRATIONS);
  const buildBaseline=async()=>{
    const builder=new MigrationBuilder(client,{},false,console);
    await migrations[0].up(builder);
    return builder.getSql();
  };
  const buildP04=async()=>{
    const builder=new MigrationBuilder(client,{},false,console);
    await migrations[1].up(builder);
    return builder.getSql();
  };
  const buildP06=async()=>{
    const builder=new MigrationBuilder(client,{},false,console);
    await migrations[2].up(builder);
    return builder.getSql();
  };
  const buildP08=async()=>{
    const builder=new MigrationBuilder(client,{},false,console);
    await migrations[3].up(builder);
    return builder.getSql();
  };
  const buildP10=async()=>{
    const builder=new MigrationBuilder(client,{},false,console);
    await migrations[4].up(builder);
    return builder.getSql();
  };
  const buildP2B=async()=>{
    const builder=new MigrationBuilder(client,{},false,console);
    await migrations[5].up(builder);
    return builder.getSql();
  };
  const buildP3A=async()=>{
    const builder=new MigrationBuilder(client,{},false,console);
    await migrations[6].up(builder);
    return builder.getSql();
  };
  const buildP3D=async()=>{
    const builder=new MigrationBuilder(client,{},false,console);
    await migrations[7].up(builder);
    return builder.getSql();
  };
  assert.equal(await buildBaseline(),await buildBaseline());
  assert.equal(await buildP04(),await buildP04());
  assert.equal(await buildP06(),await buildP06());
  assert.equal(await buildP08(),await buildP08());
  assert.equal(await buildP10(),await buildP10());
  assert.equal(await buildP2B(),await buildP2B());
  assert.equal(await buildP3A(),await buildP3A());
  assert.equal(await buildP3D(),await buildP3D());
  assert.ok(client.queries.every(sql=>sql.startsWith('SELECT ')));
});

test('Phase 3D adds immutable idempotency receipts without changing inventory history',()=>{
  assert.equal(P3D_MIGRATION_NAME,P3D);
  assert.deepEqual(P3D_NEW_TABLES,['inventory_receipts']);
  assert.deepEqual(P3D_NEW_SEQUENCES,[]);
  assert.doesNotMatch(P3D_UP_SQL,/^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|SETVAL|RESTART)\b/im);
  assert.doesNotMatch(P3D_UP_SQL,/\binvoice_number_seq\b/i);
  assert.match(P3D_UP_SQL,/PRIMARY KEY \(idempotency_key\)/);
  assert.match(P3D_UP_SQL,/quantity_after = quantity_before \+ quantity_received/);
  assert.match(P3D_UP_SQL,/inventory_receipts_immutable_row_trg/);
  assert.throws(p3dDown,/intentionally blocked/);
  const client=catalogClient(empty());
  const builder=new MigrationBuilder(client,{},false,console);
  p3dUp(builder);
  assert.ok(builder.getSql().includes(P3D_UP_SQL));
  assert.deepEqual(client.queries,[]);
});

test('Phase 3A adds an empty immutable quantity ledger without rewriting history',()=>{
  assert.equal(P3A_MIGRATION_NAME,P3A);
  assert.deepEqual(P3A_NEW_TABLES,['inventory_movements']);
  assert.deepEqual(P3A_NEW_SEQUENCES,['inventory_movements_id_seq']);
  assert.doesNotMatch(P3A_UP_SQL,/^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|SETVAL|RESTART)\b/im);
  assert.doesNotMatch(P3A_UP_SQL,/\binvoice_number_seq\b/i);
  assert.match(P3A_UP_SQL,/quantity_after = quantity_before \+ quantity_change/);
  assert.match(P3A_UP_SQL,/inventory_movements_direction_chk/);
  assert.match(P3A_UP_SQL,/FOREIGN KEY \(product_id, variant_id\)/);
  assert.match(P3A_UP_SQL,/inventory_movements_immutable_row_trg/);
  assert.match(P3A_UP_SQL,/inventory_movements_immutable_truncate_trg/);
  assert.throws(p3aDown,/intentionally blocked/);
  const client=catalogClient(empty());
  const builder=new MigrationBuilder(client,{},false,console);
  p3aUp(builder);
  assert.ok(builder.getSql().includes(P3A_UP_SQL));
  assert.deepEqual(client.queries,[]);
});

test('Phase 2B is additive, forward-only, transactional, and preserves legacy storage',()=>{
  assert.equal(P2B_MIGRATION_NAME,P2B);
  assert.deepEqual(P2B_NEW_TABLES,[
    'stock_units','stock_unit_events','sale_item_stock_units',
  ]);
  assert.deepEqual(P2B_NEW_SEQUENCES,[
    'stock_units_id_seq','stock_unit_internal_sku_seq',
    'stock_unit_events_id_seq','sale_item_stock_units_id_seq',
  ]);
  assert.doesNotMatch(P2B_UP_SQL,/^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|SETVAL|RESTART)\b/im);
  assert.doesNotMatch(P2B_UP_SQL,/\binvoice_number_seq\b/i);
  assert.doesNotMatch(P2B_UP_SQL,/ALTER\s+COLUMN\s+(sku|price|stock_quantity)\b/i);
  assert.match(P2B_UP_SQL,/ADD COLUMN serial_tracking_enabled boolean NOT NULL DEFAULT FALSE/);
  assert.match(P2B_UP_SQL,/ADD COLUMN shop_warranty_enabled boolean NOT NULL DEFAULT FALSE/);
  assert.match(P2B_UP_SQL,/ADD COLUMN checkout_contract_version smallint/);
  assert.match(P2B_UP_SQL,/products_sku_reserved_namespace_chk/);
  assert.match(P2B_UP_SQL,/product_variants_sku_reserved_namespace_chk/);
  assert.throws(p2bDown,/intentionally blocked/);

  const client=catalogClient(empty());
  const builder=new MigrationBuilder(client,{},false,console);
  p2bUp(builder);
  assert.ok(builder.getSql().includes(P2B_UP_SQL));
  assert.deepEqual(client.queries,[]);
});

test('Phase 2B defines serial uniqueness, variant ownership, lifecycle, and immutable history',()=>{
  assert.match(P2B_UP_SQL,/normalized_serial_number text GENERATED ALWAYS AS/);
  assert.match(P2B_UP_SQL,/UNIQUE \(normalized_serial_number\)/);
  assert.match(P2B_UP_SQL,/DEFAULT \('SU-' \|\| nextval\('public\.stock_unit_internal_sku_seq'/);
  assert.match(P2B_UP_SQL,/CHECK \(internal_sku ~ '\^SU-\[0-9\]\+\$'\)/);
  assert.match(P2B_UP_SQL,/FOREIGN KEY \(product_id, variant_id\)[\s\S]*REFERENCES public\.product_variants\(product_id, id\)/);
  assert.match(P2B_UP_SQL,/state IN \('available', 'sold', 'quarantined', 'retired'\)/);
  assert.match(P2B_UP_SQL,/sale_item_stock_units_one_active_unit_idx[\s\S]*WHERE released_at IS NULL/);
  assert.match(P2B_UP_SQL,/stock_unit_events_immutable_row_trg/);
  assert.match(P2B_UP_SQL,/stock_unit_events_immutable_truncate_trg/);
  assert.match(P2B_UP_SQL,/sale_item_stock_units_snapshot_immutable_trg/);
});

test('Phase 2B warranty policies and sale snapshots retain legacy NULL compatibility',()=>{
  assert.match(P2B_UP_SQL,/shop_warranty_months IN \(1, 3, 6, 12\)/);
  assert.match(P2B_UP_SQL,/shop_warranty_enabled IS NULL AND shop_warranty_months IS NULL/);
  assert.match(P2B_UP_SQL,/shop_warranty_eligible IS NULL[\s\S]*shop_warranty_months IS NULL/);
  assert.match(P2B_UP_SQL,/ADD COLUMN product_sku_snapshot character varying\(50\)/);
  assert.match(P2B_UP_SQL,/ADD COLUMN variant_sku_snapshot character varying\(80\)/);
  assert.doesNotMatch(P2B_UP_SQL,/ALTER TABLE public\.sales[\s\S]*ALTER COLUMN warranty_months/);
});

test('P1.0 adds only nullable warranty metadata and never rewrites history or sequences',()=>{
  assert.equal(P10_CONSTRAINT_NAME,'sales_warranty_months_valid_chk');
  assert.match(P10_UP_SQL,/ADD COLUMN warranty_months smallint/);
  assert.doesNotMatch(P10_UP_SQL,/warranty_months smallint NOT NULL/);
  assert.match(P10_UP_SQL,/warranty_months IN \(0, 1, 3, 6, 12\)/);
  assert.match(P10_UP_SQL,/NOT VALID/);
  assert.match(P10_UP_SQL,/VALIDATE CONSTRAINT sales_warranty_months_valid_chk/);
  assert.doesNotMatch(P10_UP_SQL,/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|SETVAL|NEXTVAL|RESTART)\b/i);
  assert.throws(p10Down,/intentionally blocked/);

  const client=catalogClient(empty());
  const builder=new MigrationBuilder(client,{},false,console);
  p10Up(builder);
  assert.ok(builder.getSql().includes(P10_UP_SQL));
  assert.deepEqual(client.queries,[]);
});

test('P0.6 adds only the nullable fingerprint column and its two named checks',()=>{
  assert.deepEqual(P06_CONSTRAINT_NAMES,[
    'sales_checkout_request_fingerprint_length_chk',
    'sales_checkout_request_fingerprint_requires_key_chk',
  ]);
  assert.match(P06_UP_SQL,/ADD COLUMN checkout_request_fingerprint bytea/);
  assert.match(P06_UP_SQL,/octet_length\(checkout_request_fingerprint\) = 32/);
  assert.match(P06_UP_SQL,/checkout_request_fingerprint IS NULL\s+OR idempotency_key IS NOT NULL/);
  assert.doesNotMatch(P06_UP_SQL,/checkout_request_fingerprint bytea NOT NULL/);
  assert.doesNotMatch(P06_UP_SQL,/\b(INSERT|UPDATE|DELETE|TRUNCATE|SETVAL|NEXTVAL|RESTART|CREATE INDEX)\b/i);
  assert.match(P06_DOWN_SQL,/DROP CONSTRAINT sales_checkout_request_fingerprint_requires_key_chk/);
  assert.match(P06_DOWN_SQL,/DROP CONSTRAINT sales_checkout_request_fingerprint_length_chk/);
  assert.match(P06_DOWN_SQL,/DROP COLUMN checkout_request_fingerprint/);
});

test('P0.6 queues deterministic up and down SQL without querying the test client',()=>{
  const client=catalogClient(empty());
  const build=(migration)=>{
    const builder=new MigrationBuilder(client,{},false,console);
    migration(builder);
    return builder.getSql();
  };
  assert.equal(build(p06Up),build(p06Up));
  assert.equal(build(p06Down),build(p06Down));
  assert.ok(build(p06Up).includes(P06_UP_SQL));
  assert.ok(build(p06Down).includes(P06_DOWN_SQL));
  assert.deepEqual(client.queries,[]);
});

test('P0.8 adds product recycle-bin metadata without backfilling legacy inactive products',()=>{
  assert.deepEqual(P08_CONSTRAINT_NAMES,[
    'products_deleted_by_requires_deleted_at_chk',
    'products_active_deletion_metadata_clear_chk',
  ]);
  assert.match(P08_UP_SQL,/ADD COLUMN deleted_at timestamptz/);
  assert.match(P08_UP_SQL,/ADD COLUMN deleted_by integer/);
  assert.match(P08_UP_SQL,/CONSTRAINT products_deleted_by_fkey\s+FOREIGN KEY \(deleted_by\) REFERENCES public\.users\(id\) ON DELETE SET NULL/);
  assert.match(P08_UP_SQL,/CHECK \(deleted_by IS NULL OR deleted_at IS NOT NULL\)/);
  assert.match(P08_UP_SQL,/CHECK \(NOT is_active OR \(deleted_at IS NULL AND deleted_by IS NULL\)\)/);
  assert.match(P08_UP_SQL,/CREATE INDEX idx_products_recycle_bin[\s\S]*WHERE is_active = FALSE/);
  assert.doesNotMatch(P08_UP_SQL,/\b(INSERT|UPDATE|TRUNCATE|SETVAL|NEXTVAL|RESTART)\b/i);
  assert.match(P08_DOWN_SQL,/DROP INDEX public\.idx_products_recycle_bin/);
  assert.match(P08_DOWN_SQL,/DROP CONSTRAINT products_active_deletion_metadata_clear_chk/);
  assert.match(P08_DOWN_SQL,/DROP CONSTRAINT products_deleted_by_requires_deleted_at_chk/);
  assert.match(P08_DOWN_SQL,/DROP CONSTRAINT products_deleted_by_fkey/);
  assert.match(P08_DOWN_SQL,/DROP COLUMN deleted_by/);
  assert.match(P08_DOWN_SQL,/DROP COLUMN deleted_at/);
});

test('P0.8 queues deterministic up and down SQL without querying the test client',()=>{
  const client=catalogClient(empty());
  const build=(migration)=>{
    const builder=new MigrationBuilder(client,{},false,console);
    migration(builder);
    return builder.getSql();
  };
  assert.equal(build(p08Up),build(p08Up));
  assert.equal(build(p08Down),build(p08Down));
  assert.ok(build(p08Up).includes(P08_UP_SQL));
  assert.ok(build(p08Down).includes(P08_DOWN_SQL));
  assert.deepEqual(client.queries,[]);
});

test('P0.4 adds only approved integrity constraints and reverses only its own changes',()=>{
  assert.equal(P04_CONSTRAINT_NAMES.length,19);
  assert.equal(new Set(P04_CONSTRAINT_NAMES).size,P04_CONSTRAINT_NAMES.length);
  for(const name of P04_CONSTRAINT_NAMES) {
    assert.match(P04_UP_SQL,new RegExp(`ADD CONSTRAINT ${name} CHECK`));
    assert.match(P04_DOWN_SQL,new RegExp(`DROP CONSTRAINT ${name}`));
  }
  for(const sql of [P04_UP_SQL,P04_DOWN_SQL]) {
    assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|CREATE|TRUNCATE|SETVAL|NEXTVAL|RESTART)\b/i);
    assert.doesNotMatch(sql,/\b(invoice_number|idempotency_key|refund_reason|refunded_by|product_id|variant_id|qr_code)\b/i);
  }
  assert.match(P04_UP_SQL,/ALTER COLUMN status SET NOT NULL/);
  assert.match(P04_UP_SQL,/ALTER COLUMN payment_method SET NOT NULL/);
  assert.match(P04_UP_SQL,/ALTER COLUMN tax SET NOT NULL/);
  assert.match(P04_UP_SQL,/ALTER COLUMN discount SET NOT NULL/);
  assert.doesNotMatch(P04_UP_SQL,/ALTER COLUMN (subtotal|total) SET NOT NULL/);
  assert.match(P04_DOWN_SQL,/ALTER COLUMN status DROP NOT NULL/);
  assert.match(P04_DOWN_SQL,/ALTER COLUMN sale_id DROP NOT NULL/);
  assert.doesNotMatch(P04_DOWN_SQL,/ALTER COLUMN (subtotal|total) DROP NOT NULL/);
});

test('P0.4 queues deterministic up and down SQL without querying or mutating the test client',()=>{
  const client=catalogClient(empty());
  const build=(migration)=>{
    const builder=new MigrationBuilder(client,{},false,console);
    migration(builder);
    return builder.getSql();
  };
  const upSql=build(p04Up);
  const downSql=build(p04Down);
  assert.equal(upSql,build(p04Up));
  assert.equal(downSql,build(p04Down));
  assert.ok(upSql.includes(P04_UP_SQL));
  assert.ok(downSql.includes(P04_DOWN_SQL));
  assert.deepEqual(client.queries,[]);
});

test('static baseline contains all captured schema definitions without data writes or destructive SQL',()=>{
  assert.equal((BASELINE_SQL.match(/CREATE TABLE /g)||[]).length,12);
  assert.equal((BASELINE_SQL.match(/CREATE SEQUENCE /g)||[]).length,11);
  assert.equal((BASELINE_SQL.match(/ADD CONSTRAINT /g)||[]).length,30);
  for(const table of expected.tables) {
    const start=BASELINE_SQL.indexOf(`CREATE TABLE "${table.schema}"."${table.name}" (`);
    assert.ok(start>=0);
    const block=BASELINE_SQL.slice(start,BASELINE_SQL.indexOf('\n);',start));
    for(const c of expected.columns.filter(c=>c.table_name===table.name)) {
      assert.ok(block.includes(`"${c.name}" ${c.type}${c.default_expression===null?'':' DEFAULT '+c.default_expression}${c.not_null?' NOT NULL':''}`),`${table.name}.${c.name}`);
    }
  }
  for(const c of expected.constraints) assert.ok(BASELINE_SQL.includes(`ADD CONSTRAINT "${c.name}" ${c.definition};`),c.name);
  for(const i of expected.indexes.filter(i=>!i.constraint_name)) assert.ok(BASELINE_SQL.includes(i.definition+';'),i.name);
  for(const s of expected.sequences) {
    assert.ok(BASELINE_SQL.includes(`CREATE SEQUENCE "${s.schema}"."${s.name}" AS ${s.type} INCREMENT BY ${s.increment} MINVALUE ${s.min} MAXVALUE ${s.max} START WITH ${s.start} CACHE ${s.cache} ${s.cycle?'CYCLE':'NO CYCLE'};`));
    if(s.owner_table) assert.ok(BASELINE_SQL.includes(`ALTER SEQUENCE "${s.schema}"."${s.name}" OWNED BY "${s.owner_schema}"."${s.owner_table}"."${s.owner_column}";`));
  }
  assert.doesNotMatch(BASELINE_SQL,/\b(DROP|TRUNCATE|INSERT|UPDATE|SETVAL|RESTART)\b/i);
  assert.doesNotMatch(BASELINE_SQL,/IF NOT EXISTS/i);
  assert.doesNotMatch(BASELINE_SQL.replace(/DEFAULT nextval\('[^']+'::regclass\)/g,''),/\bnextval\s*\(/i);
  const firstFk=BASELINE_SQL.indexOf('FOREIGN KEY');
  assert.ok(firstFk>BASELINE_SQL.lastIndexOf('CREATE TABLE '));
});

for(const command of ['check','status']) {
  test(`${command} uses enforced read-only inspection and never loads the runner`,async()=>{
    const client=catalogClient(expected);
    const report=await executeDatabaseCommand({command},config,expected,[BASELINE],{
      makeClient:()=>client,getRunner:()=>assert.fail('Runner must never load'),log:()=>{},
    });
    assert.equal(report.state,'matching-unbaselined');
    assert.deepEqual(report.applied,[]);
    assert.ok(client.queries.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
    assert.ok(client.queries.every(sql=>sql.startsWith('SELECT ')||['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','COMMIT'].includes(sql)));
  });
  test(`${command} reports drift and fails without repairs`,async()=>{
    const actual=clone();actual.columns.pop();
    let report;
    await assert.rejects(executeDatabaseCommand({command},config,expected,[BASELINE],{
      makeClient:()=>catalogClient(actual),getRunner:()=>assert.fail('Runner must never load'),log:s=>{report=JSON.parse(s);},
    }),/Schema drift detected/);
    assert.ok(report.differences.length>0);
  });
}

test('absent migration history requires no bookkeeping SELECT or writes',async()=>{
  const client=catalogClient(expected);
  assert.deepEqual(await readHistory(client),[]);
  assert.equal(client.queries.length,1);
});

test('malformed migration history fails before runner could repair it',async()=>{
  await assert.rejects(readHistory({query:async()=>({rows:[{relkind:'v'}]})}),/Unexpected migration history relation/);
});

test('migration history inspection supports PostgreSQL 18 NOT NULL catalog constraints',async()=>{
  const queries=[];
  const replies=[
    [{relkind:'r',relpersistence:'p',relrowsecurity:false,relforcerowsecurity:false}],
    [
      {name:'id',type:'integer',not_null:true,default_expression:"nextval('pgmigrations_id_seq'::regclass)"},
      {name:'name',type:'character varying(255)',not_null:true,default_expression:null},
      {name:'run_on',type:'timestamp without time zone',not_null:true,default_expression:null},
    ],
    [{name:'pgmigrations_pkey',definition:'PRIMARY KEY (id)'}],
    [{name:'pgmigrations_id_seq',schema:'public',column_name:'id'}],
    [{name:BASELINE}],
  ];
  const client={query:async(sql)=>{queries.push(sql);return {rows:replies.shift()};}};
  assert.deepEqual(await readHistory(client),[BASELINE]);
  assert.match(queries[2],/contype <> 'n'/);
});

test('CLI rejects unsafe runner flags and requires an exact write target',async()=>{
  assert.deepEqual(parseArguments(['create','add-example']),{command:'create',name:'add-example'});
  assert.deepEqual(parseArguments(['up','--database','pos_store']),{command:'up',database:'pos_store'});
  for(const args of [['up'],['up','--fake'],['status','--fake'],['create','../escape'],['down','--database','pos_store','--count','2']]) {
    assert.throws(()=>parseArguments(args));
  }
  await assert.rejects(executeDatabaseCommand({command:'up',database:'wrong'},config,expected,[BASELINE],{
    makeClient:()=>assert.fail('Should not connect'),
  }),/exactly match/);
  assert.match(config.options,/default_transaction_read_only=on/);
  assert.throws(()=>connectionConfig({},true),/Missing DB_HOST/);
});

test('only expected migration files are discovered',async()=>{
  assert.deepEqual(await migrationNames(),EXPECTED_MIGRATIONS);
});
