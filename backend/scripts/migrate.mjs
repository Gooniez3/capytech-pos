import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import {
  BASELINE, inspectSchema, readHistory, assertBaseline, schemaDifferences,
  classifyDatabase, planCommand,
} from './lib/schema-inspection.mjs';

export const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS = join(BACKEND, 'migrations');
export const IGNORE_PATTERN = '(?![0-9]{13}_[a-z0-9][a-z0-9_-]*\\.mjs$).*';
const LOCK_ID = '7241865325823964'; // Same session advisory lock as node-pg-migrate.

export function parseArguments(args) {
  const [command, ...rest] = args;
  if (!['check','status','up','down','baseline','create'].includes(command)) throw new Error('Use check, status, up, down, baseline, or create.');
  if (command === 'create') {
    if (rest.length !== 1 || !/^[a-z][a-z0-9_-]*$/.test(rest[0])) throw new Error('Provide one migration name using lowercase letters, digits, hyphens, or underscores.');
    return {command,name:rest[0]};
  }
  if (['check','status'].includes(command)) {
    if (rest.length) throw new Error('Read-only commands accept no runner flags.');
    return {command};
  }
  if (rest.length !== 2 || rest[0] !== '--database' || !rest[1] || rest[1].startsWith('-')) {
    throw new Error('Write commands require --database <exact DB_NAME> to identify the intended target.');
  }
  return {command,database:rest[1]};
}

export async function migrationNames() {
  const files = await readdir(MIGRATIONS, {withFileTypes:true});
  const migrations = [];
  for (const entry of files) {
    if (['README.md','baseline-schema.json'].includes(entry.name)) continue;
    if (!entry.isFile() || !/^[0-9]{13}_[a-z0-9][a-z0-9_-]*\.mjs$/.test(entry.name)) {
      throw new Error(`Unexpected migration directory entry: ${entry.name}`);
    }
    migrations.push(entry.name.slice(0,-4));
  }
  migrations.sort();
  if (migrations[0] !== BASELINE) throw new Error('Baseline migration missing or not first.');
  if (new Set(migrations.map(n=>n.slice(0,13))).size !== migrations.length) throw new Error('Duplicate migration timestamps.');
  return migrations;
}

export function connectionConfig(env, readOnly) {
  for (const key of ['DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD']) {
    if (!env[key]) throw new Error(`Missing ${key}; refusing connection defaults.`);
  }
  if (!/^\d+$/.test(env.DB_PORT) || +env.DB_PORT < 1 || +env.DB_PORT > 65535) throw new Error('Invalid DB_PORT.');
  return {
    host:env.DB_HOST,port:Number(env.DB_PORT),database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD,
    connectionTimeoutMillis:5000,
    options:`-c search_path=public -c statement_timeout=${readOnly ? 15000 : 60000} -c lock_timeout=5000 -c default_transaction_read_only=${readOnly ? 'on' : 'off'}`,
  };
}

async function databaseState(client, expected, migrations) {
  const {rows:[server]} = await client.query(`SELECT current_database() AS database,
    current_setting('server_version_num')::integer AS version,
    current_setting('transaction_read_only') AS read_only FROM pg_catalog.pg_database WHERE datname=current_database()`);
  if (server.version < 140000) throw new Error('PostgreSQL 14 or later is required.');
  const history = await readHistory(client);
  const snapshot = await inspectSchema(client);
  const state = classifyDatabase(snapshot,history,expected,migrations);
  return {server,history,snapshot,state};
}

// Dependency injection lets unit tests prove check/status never load or call the migration runner.
export async function executeDatabaseCommand(args, config, expected, migrations, dependencies = {}) {
  const makeClient = dependencies.makeClient ?? (options => new pg.Client(options));
  const getRunner = dependencies.getRunner ?? (async () => (await import('node-pg-migrate')).runner);
  const log = dependencies.log ?? console.log;
  const readOnly = ['check','status'].includes(args.command);
  if (!readOnly && args.database !== config.database) throw new Error('--database must exactly match configured DB_NAME.');
  const client = makeClient(config);
  let locked = false;
  try {
    await client.connect();
    if (!readOnly) {
      const {rows:[lock]} = await client.query(`SELECT pg_catalog.pg_try_advisory_lock(${LOCK_ID}) AS locked`);
      if (!lock.locked) throw new Error('Another migration is running.');
      locked = true;
    }
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const data = await databaseState(client,expected,migrations);
    if (data.server.read_only !== 'on') throw new Error('Schema inspection requires a read-only transaction.');
    const report = {
      database:data.server.database,state:data.state,readOnly,
      applied:data.history,pending:migrations.filter(n=>!data.history.includes(n)),
      baselineValidation:data.state === 'migrated' ? 'Not applicable after later migrations; validate those through their own reviewed checks.' : 'Compared with immutable baseline',
      differences:data.state === 'empty' || data.state === 'migrated' ? [] : schemaDifferences(expected,data.snapshot),
    };
    log(JSON.stringify(report,null,2));
    if (data.state === 'drifted-unbaselined' || data.state === 'baselined') assertBaseline(expected,data.snapshot);
    if (readOnly) {
      await client.query('COMMIT');
      return report;
    }
    const options = planCommand(args.command,data.state,data.history);
    await client.query('COMMIT');
    const runner = await getRunner();
    // Fake registration has no transaction of its own in v9. Wrap bookkeeping explicitly.
    if (options.fake) {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const current = await databaseState(client,expected,migrations);
      assertBaseline(expected,current.snapshot);
      planCommand('baseline',current.state,current.history);
    }
    await runner({
      dbClient:client,dir:MIGRATIONS,ignorePattern:IGNORE_PATTERN,
      schema:'public',migrationsSchema:'public',migrationsTable:'pgmigrations',
      createSchema:false,createMigrationsSchema:false,
      checkOrder:true,singleTransaction:true,noLock:false,verbose:false,
      ...options,
    });
    if (options.fake) await client.query('COMMIT');
    return report;
  } catch (error) {
    // ROLLBACK only ends our own transaction; it is not a down migration.
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {
    if (locked) await client.query(`SELECT pg_catalog.pg_advisory_unlock(${LOCK_ID})`).catch(()=>{});
    await client.end();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const migrations = await migrationNames();
  if (args.command === 'create') {
    const timestamp = Math.max(Date.now(),Number(migrations.at(-1).slice(0,13))+1);
    const file = join(MIGRATIONS,`${timestamp}_${args.name}.mjs`);
    await writeFile(file,`// Review SQL and rollback safety before applying. Never edit an applied migration.\nexport function up(pgm) {\n  throw new Error('Migration not implemented.');\n}\n\nexport function down() {\n  throw new Error('Rollback has not been reviewed.');\n}\n`,{flag:'wx'});
    console.log(file);
    return;
  }
  dotenv.config({path:join(BACKEND,'.env')});
  const config = connectionConfig(process.env,['check','status'].includes(args.command));
  const expected = JSON.parse(await readFile(join(MIGRATIONS,'baseline-schema.json'),'utf8'));
  return executeDatabaseCommand(args,config,expected,migrations);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
