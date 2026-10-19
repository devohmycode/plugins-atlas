import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import type { AgentContext } from '../adapters/index.js';
import { AGENTS } from '../agents.js';
import { auditEnabled, auditPlugin } from '../audit.js';
import { applyProposals, describe, propose, type OperateDeps, type Proposal } from '../operate.js';
import { componentLines, readPreview } from '../preview.js';
import { searchPlugins } from '../search.js';
import { AGENT_IDS, SCOPES, type AgentId, type Catalog, type Plugin } from '../types.js';
import { renderPage } from './page.js';

export interface UiOptions {
  catalog: Catalog;
  /** Agents ticked by default in the review. */
  agents: AgentId[];
  ctx: AgentContext;
  operate: OperateDeps;
  port?: number;
  /** Serves the fiches and has no review or install route. */
  demo?: boolean;
}

export const TOKEN_HEADER = 'x-atlas-token';
const MAX_LIMIT = 200;
const MAX_BODY = 100_000;
const MAX_REVIEWS = 20;

const ReviewBody = z.object({
  ids: z.array(z.string()).min(1).max(50),
  agents: z.array(z.enum(AGENT_IDS)).min(1).max(AGENT_IDS.length),
  scope: z.enum(SCOPES),
  /** Ticked "install despite a high risk": this review is planned with the audit off. */
  noAudit: z.boolean().default(false),
});
const InstallBody = z.object({ reviewId: z.string(), confirm: z.literal(true) });

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A fiche as the list shows it. The audit reads only the catalog record. */
export function slimPlugin(plugin: Plugin) {
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description ?? '',
    agents: plugin.agents,
    themes: plugin.themes,
    official: plugin.official,
    audit: auditPlugin(plugin).status,
  };
}

/** Everything about one fiche the page shows without reading the network. */
export function fullPlugin(plugin: Plugin) {
  return {
    ...slimPlugin(plugin),
    version: plugin.version,
    author: plugin.author?.name,
    repository: plugin.repository?.url,
    marketplace: plugin.marketplace.name,
    category: plugin.category,
    keywords: plugin.keywords,
    origins: plugin.origins,
    components: plugin.components ? componentLines(plugin.components) : undefined,
    risks: auditPlugin(plugin).risks,
  };
}

export function agentList() {
  return AGENT_IDS.map((id) => ({ id, label: AGENTS[id].label, scopes: SCOPES.filter((scope) => AGENTS[id].install[scope]) }));
}

const reviewRow = (p: Proposal) => ({
  plugin: p.plugin.id,
  agent: p.agent,
  agents: p.plan?.agents ?? [p.agent],
  scope: p.scope,
  mechanism: p.plan?.mechanism,
  actions: p.plan ? describe(p.plan) : undefined,
  risks: (p.plan?.audit ?? auditPlugin(p.plugin)).risks,
  error: p.error,
});

/**
 * Local page on 127.0.0.1. Every `/api/` call carries the per-run token in a header, a local Host and,
 * when the browser sends one, this server's Origin. `/api/install` runs only a review the server kept,
 * once: the client names it, it never sends a plan.
 */
export async function startUi(opts: UiOptions): Promise<{ url: string; close(): Promise<void> }> {
  const { catalog, ctx, operate } = opts;
  const demo = opts.demo === true;
  const byId = new Map(catalog.plugins.map((plugin) => [plugin.id, plugin]));
  const token = randomBytes(24).toString('hex');
  const reviews = new Map<string, Proposal[]>();
  let busy = false;

  function state() {
    return {
      demo,
      audit: auditEnabled(operate.config),
      themes: catalog.themes,
      agents: agentList(),
      defaults: { agents: opts.agents, scope: 'project' },
      total: catalog.plugins.length,
    };
  }

  function search(params: URLSearchParams) {
    const agent = AGENT_IDS.find((id) => id === params.get('agent'));
    const found = searchPlugins(catalog.plugins, {
      query: params.get('q') ?? '',
      ...(params.get('theme') ? { theme: params.get('theme')! } : {}),
      ...(agent ? { agent } : {}),
      official: params.get('official') === '1',
    });
    const offset = Math.max(0, Number(params.get('offset')) || 0);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get('limit')) || 50));
    return { total: found.length, offset, items: found.slice(offset, offset + limit).map(slimPlugin) };
  }

  const find = (id: string | null) => {
    const plugin = id ? byId.get(id) : undefined;
    if (!plugin) throw new HttpError(404, `${id ?? ''} is not in the catalog`);
    return plugin;
  };

  async function preview(id: string | null) {
    const plugin = find(id);
    try {
      const read = await readPreview(plugin, operate.repo ?? ctx.repo ?? { env: ctx.env });
      return { id: plugin.id, readme: read.readme, components: componentLines(read.components) };
    } catch (e) {
      return { id: plugin.id, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function review(raw: unknown) {
    const parsed = ReviewBody.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, 'Invalid review request');
    const body = parsed.data;
    const plugins = [...new Set(body.ids)].map(find);
    const proposals = await propose(plugins, body.agents, ctx, { scope: body.scope, explicit: true, ...(body.noAudit ? { audit: false } : {}) }, operate);
    const reviewId = randomUUID();
    reviews.set(reviewId, proposals);
    // shortcut: oldest reviews are forgotten past MAX_REVIEWS; enough for one person on one page.
    for (const old of reviews.keys()) if (reviews.size > MAX_REVIEWS) reviews.delete(old);
    return { reviewId, audit: !body.noAudit && auditEnabled(operate.config), proposals: proposals.map(reviewRow), installable: proposals.some((p) => p.plan) };
  }

  async function install(raw: unknown) {
    const parsed = InstallBody.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, 'An install needs a review id and an explicit confirmation');
    const proposals = reviews.get(parsed.data.reviewId);
    if (!proposals) throw new HttpError(409, 'This review is unknown or was already used: review again');
    if (busy) throw new HttpError(409, 'An install is already running');
    reviews.delete(parsed.data.reviewId);
    busy = true;
    try {
      const results = await applyProposals(proposals, ctx, operate);
      return { results: results.map((p) => ({ ...reviewRow(p), ok: Boolean(p.plan) && !p.error })) };
    } finally {
      busy = false;
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) return res.end();
      json(res, { error: err instanceof Error ? err.message : String(err) }, err instanceof HttpError ? err.status : 500);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const port = (server.address() as AddressInfo).port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    // DNS rebinding and cross-site calls: only this server's own name and origin.
    if (!hosts.includes(req.headers.host ?? '')) throw new HttpError(403, 'Forbidden host');
    const origin = req.headers.origin;
    if (origin !== undefined && !hosts.some((host) => origin === `http://${host}`)) throw new HttpError(403, 'Forbidden origin');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
      });
      return res.end(renderPage());
    }
    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
    if (!validToken(req.headers[TOKEN_HEADER])) throw new HttpError(401, 'Bad token');
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /api/state') return json(res, state());
    if (route === 'GET /api/search') return json(res, search(url.searchParams));
    if (route === 'GET /api/plugin') return json(res, fullPlugin(find(url.searchParams.get('id'))));
    if (route === 'GET /api/preview') return json(res, await preview(url.searchParams.get('id')));
    if (!demo && route === 'POST /api/review') return json(res, await review(await readJson(req)));
    if (!demo && route === 'POST /api/install') return json(res, await install(await readJson(req)));
    if (demo && req.method === 'POST') throw new HttpError(403, 'The demo installs nothing');
    throw new HttpError(404, 'Not found');
  }

  function validToken(value: string | string[] | undefined): boolean {
    if (typeof value !== 'string' || value.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(value), Buffer.from(token));
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    // The token rides in the fragment: it never reaches a server log or a Referer.
    url: `http://127.0.0.1:${port}/#${token}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Expected JSON');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Body is too large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'Body is not JSON');
  }
}
