// A stand-in for lib/supabase.ts in screen tests. Screens and their real hooks
// run against it unchanged; a test sets what each table holds, which calls
// fail, and what each rpc returns, then checks what was asked of the server.
//
//   jest.mock('@/lib/supabase', () => require('../../test-support/fakeSupabase'));
//   import { fake } from '../../test-support/fakeSupabase';
//
// Lives outside __tests__ so Jest doesn't run it as a test file.

type Err = { message: string } | null;

export interface RecordedQuery {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  payload?: unknown;
  // every other call in the chain, e.g. ['eq', 'circle_id', 'c1']
  calls: unknown[][];
}

export const fake = {
  // rows returned by a select on each table
  tables: {} as Record<string, unknown[]>,
  // errors by `${table}.${op}`, e.g. 'messages.insert'
  errors: {} as Record<string, Err>,
  rpcResults: {} as Record<string, { data?: unknown; error?: Err }>,
  // computed answers, for server state that changes during a test
  rpcHandlers: {} as Record<string, (args: any) => { data?: unknown; error?: Err }>,
  queries: [] as RecordedQuery[],
  rpcCalls: [] as [string, unknown][],
  channels: [] as { table: string; event: string; cb: (payload: unknown) => void }[],

  reset() {
    this.tables = {};
    this.errors = {};
    this.rpcResults = {};
    this.rpcHandlers = {};
    this.queries.length = 0;
    this.rpcCalls.length = 0;
    this.channels.length = 0;
  },

  // Deliver a realtime change to every subscriber of that table.
  emit(table: string, payload: unknown = {}) {
    for (const c of this.channels.filter((x) => x.table === table)) c.cb(payload);
  },

  queriesOf(table: string, op?: RecordedQuery['op']) {
    return this.queries.filter((q) => q.table === table && (!op || q.op === op));
  },

  rpcsOf(name: string) {
    return this.rpcCalls.filter(([n]) => n === name).map(([, args]) => args);
  },
};

function query(table: string) {
  const record: RecordedQuery = { table, op: 'select', calls: [] };
  let started = false;
  let single = false;
  const builder: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          const rows = fake.tables[table] ?? [];
          const error = fake.errors[`${table}.${record.op}`] ?? null;
          const data = error ? null : record.op === 'select' ? (single ? (rows[0] ?? null) : rows) : null;
          return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve({ data, error }).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          const name = String(prop);
          if (['select', 'insert', 'update', 'delete', 'upsert'].includes(name) && !started) {
            started = true;
            record.op = name as RecordedQuery['op'];
            if (name !== 'select' && name !== 'delete') record.payload = args[0];
            fake.queries.push(record);
          } else {
            if (!started) {
              started = true;
              fake.queries.push(record);
            }
            if (name === 'single' || name === 'maybeSingle') single = true;
            record.calls.push([name, ...args]);
          }
          return builder;
        };
      },
    },
  );
  return builder;
}

export const supabase = {
  from: (table: string) => query(table),
  rpc: async (name: string, args?: unknown) => {
    fake.rpcCalls.push([name, args]);
    const r = fake.rpcHandlers[name]?.(args) ?? fake.rpcResults[name] ?? {};
    return { data: r.data ?? null, error: r.error ?? null };
  },
  channel: () => {
    const ch: Record<string, unknown> = {};
    ch.on = (_type: string, filter: { table: string; event?: string }, cb: (payload: unknown) => void) => {
      fake.channels.push({ table: filter.table, event: filter.event ?? '*', cb });
      return ch;
    };
    ch.subscribe = () => ch;
    return ch;
  },
  removeChannel: async () => {},
  auth: {
    getSession: async () => ({ data: { session: null } }),
    signOut: async () => ({ error: null }),
    updateUser: async () => ({ data: {}, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  storage: {
    from: () => ({
      upload: async () => ({ data: {}, error: null }),
      remove: async () => ({ data: {}, error: null }),
      getPublicUrl: () => ({ data: { publicUrl: 'https://example.invalid/a.jpg' } }),
    }),
  },
};
