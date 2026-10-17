import path from "node:path";
import { Component, fail } from "@noflo/assembly";
import { IP } from "@noflo/noflo";

/**
 * Resolves template inheritance and pagination for document messages,
 * emitting one message per generated page with the resolved
 * `template` and inherited `variables` (work document #35: assembly
 * relay for the 1.x DocumentBuilder).
 *
 * No ordering is assumed between the wires: in an asynchronous network
 * documents, templates, and the site config arrive in any order (only
 * within a stream is there an ordering guarantee). Arriving documents are
 * consumed immediately into a per-scope state store — waiting in the port
 * buffer would strand them behind their scope, because later config and
 * template arrivals are unscoped and a scopeless activation cannot see
 * scoped buffers (the noflo/noflo #1092 review). Every activation —
 * including the unscoped re-fires — drains every scope's queue head-first:
 * a document whose referenced parts have not arrived stays queued in the
 * store, and is consumed only when the current config and template store
 * can resolve it. A document whose parts never arrive stays queued until
 * network shutdown discards it; the `fail` port is for unexpected
 * processing errors, not missing parts.
 */
export class DocumentBuilder extends Component {
  constructor() {
    super({
      description: "Resolve template inheritance and pagination for documents",
      icon: "pencil-square",
      inPorts: {
        msg: {
          datatype: "object",
          description: "Document message with path and body",
          required: true,
        },
        templates: {
          datatype: "object",
          description:
            "Template file with path and body; stored by template name",
          required: false,
        },
        config: {
          datatype: "object",
          description:
            "Site config with posts; consumed on arrival and stored — it may arrive after the documents",
          required: false,
          // The documents carry per-message scopes; the edge-delivered
          // standing config is unscoped and must stay readable from
          // scoped activations. A firing port, not a control port: the
          // config arrival must itself trigger the drain, and the drain's
          // work lives in the component's per-scope state store, which
          // the gate machinery cannot see. When the builder returns to
          // buffer-waiting under the one-firing-rule pump (the port
          // buffer becoming the store again), this reverts to a control
          // port
          scoped: false,
        },
      },
      outPorts: {
        out: {
          datatype: "object",
          description: "Page message with path, template, and variables",
        },
        fail: {
          datatype: "object",
          description: "The message with unexpected processing errors",
        },
      },
    });
    /** @type {Record<string, { path: string, body: string, data: Record<string, any> }>} */
    this.templates = {};
    /** @type {Record<string, any> | null} */
    this.config = null;
    /**
     * Documents consumed on arrival, queued head-first per scope for the
     * drain. The port buffer cannot hold them: a scopeless re-fire (a
     * config or template arrival) cannot read scoped buffers, so a
     * document waiting there behind its scope is stranded forever
     *
     * @type {Map<string | null, Array<Record<string, any>>>}
     */
    this.pending = new Map();
    /** Guards the drain loop against the concurrent activations that new arrivals fire while it is in flight */
    this.draining = false;
  }

  tearDown() {
    this.templates = {};
    this.config = null;
    this.pending.clear();
    this.draining = false;
    return Promise.resolve();
  }

  /**
   * @param {Record<string, any>} template - A template message already
   *   run through `jekyll/FrontMatter`: the body is the template source
   *   and the front-matter fields (e.g. its own `layout`) sit at the
   *   top level
   * @returns {void}
   */
  addTemplate(template) {
    const name = path.basename(template.path, path.extname(template.path));
    const {
      body,
      path: _path,
      errors: _errors,
      source: _source,
      ...data
    } = template;
    this.templates[name] = { path: template.path, body, data };
  }

  /**
   * @param {string} templateName
   * @param {Error[]} errors
   * @returns {{ path: string, body: string, data: Record<string, any> } | undefined}
   */
  getTemplate(templateName, errors) {
    const template = this.templates[templateName];
    if (!template) {
      errors.push(new Error(`Template ${templateName} not found`));
      return undefined;
    }
    return template;
  }

  /**
   * Whether the template body references the paginated posts list.
   * @param {string} body
   * @returns {boolean}
   */
  hasPaginator(body) {
    return body.includes("paginator.posts");
  }

  /**
   * Whether every `{% include %}` referenced by the body is available.
   * @param {string} body
   * @param {Error[]} errors
   * @returns {boolean}
   */
  checkIncludes(body, errors) {
    const matcher = /\{%\s*include\s+(.*?)\s*%\}/g;
    for (const match of body.matchAll(matcher)) {
      const name = path.basename(match[1], path.extname(match[1]));
      if (!this.templates[name]) {
        errors.push(new Error(`Include ${match[1]} not found`));
        return false;
      }
    }
    return true;
  }

  /**
   * Whether the body's references to posts or categories can resolve
   * with the current config.
   * @param {string} body
   * @param {Error[]} errors
   * @returns {boolean}
   */
  checkDataReferences(body, errors) {
    if (
      !body.includes("site.posts") &&
      !body.includes("paginator.posts") &&
      !body.includes("site.categories")
    ) {
      return true;
    }
    if (!this.config?.posts) {
      errors.push(
        new Error("Body references posts but no posts are available yet"),
      );
      return false;
    }
    return true;
  }

  /**
   * Enriches the site context with a converted document: posts flowing
   * through the builder carry their rendered body, and the matching
   * `config.posts` entry gains it as `content` — the two-pass shape
   * (collection first, conversion second) without a second collect.
   * Runs at consumption time: every converted document enriches exactly
   * once, whether or not it resolves yet.
   * @param {Record<string, any>} msg
   * @returns {void}
   */
  enrichSite(msg) {
    if (!this.config?.posts || !msg.path) {
      return;
    }
    for (const post of this.config.posts) {
      if (post.path === msg.path) {
        post.content = msg.body;
      }
    }
  }

  /**
   * Whether the current config and template store can resolve this
   * document. Missing templates, includes, or posts are "not yet",
   * never "never": without an end-of-stream signal there is no point
   * at which a missing part could be declared definitively absent, so
   * an unresolvable document stays buffered for later arrivals.
   * @param {Record<string, any>} msg
   * @returns {boolean}
   */
  canResolve(msg) {
    /** @type {Error[]} */
    const errors = [];
    if (!this.checkIncludes(msg.body ?? "", errors)) {
      return false;
    }
    if (!this.checkDataReferences(msg.body ?? "", errors)) {
      return false;
    }
    if (msg.layout && !this.chainPresent(msg.layout)) {
      return false;
    }
    if (this.hasPaginator(msg.body ?? "") && !this.config?.posts) {
      return false;
    }
    // Pages listing posts or paginating need every collected post
    // converted first: the rendered content flows through this builder
    // and enriches the collection as it passes
    if (
      (this.hasPaginator(msg.body ?? "") ||
        (msg.body ?? "").includes("site.posts")) &&
      this.config?.posts &&
      !this.config.posts.every(
        (/** @type {Record<string, any>} */ p) => p.content,
      )
    ) {
      return false;
    }
    return true;
  }

  /**
   * Whether every layout in the inheritance chain starting at
   * `templateName` is available. A cycle counts as present — the
   * resolution reports it as a processing error instead of holding.
   * @param {string} templateName
   * @returns {boolean}
   */
  chainPresent(templateName) {
    let current = /** @type {string | undefined} */ (templateName);
    const seen = new Set();
    while (current) {
      if (seen.has(current)) {
        return true;
      }
      seen.add(current);
      const template = this.templates[current];
      if (!template) {
        return false;
      }
      current = template.data?.layout;
    }
    return true;
  }

  /**
   * Resolves the `{% layout %}`/`layout` chain: each parent template
   * body replaces `{{ content }}` with the child body, walking until a
   * template without its own `layout`. The chain's front matter is the
   * layouts' own variables, not page variables — the Jekyll-generated
   * reference is the contract: a `class: index` on a layout does not
   * reach `page.class` (the nocontent page, which uses the layout but
   * carries no class of its own, renders a bare `<body>`), so the chain
   * contributes the content substitution only.
   * @param {Record<string, any>} templateData
   * @param {Error[]} errors
   * @returns {{ body: string, data: Record<string, any> }}
   */
  handleInheritance(templateData, errors) {
    let body = templateData.body ?? "";
    let layoutName = /** @type {string | undefined} */ (templateData.layout);
    const seen = new Set();
    while (layoutName) {
      if (seen.has(layoutName)) {
        errors.push(new Error(`Layout cycle at ${layoutName}`));
        return { body, data: {} };
      }
      seen.add(layoutName);
      const parent = this.getTemplate(layoutName, errors);
      if (!parent) {
        return { body, data: {} };
      }
      // A replacer function: string replacement would interpret `$`
      // patterns in the substituted body
      body = parent.body.replace("{{ content }}", () => body);
      layoutName = parent.data?.layout;
    }
    return { body, data: {} };
  }

  /**
   * The site URL of an output path, the Jekyll page URL convention: an
   * `index.html` maps to its directory (the site root's `index.html` to
   * `/`), other paths to their directory.
   * @param {string} docPath
   * @returns {string}
   */
  urlForPage(docPath) {
    const rel = path.relative(this.config?.target ?? "", docPath);
    const dir = path.dirname(rel);
    if (dir === ".") {
      return "/";
    }
    return `/${dir}/`;
  }

  /**
   * Expands a paginated document into one message per page.
   * @param {Record<string, any>} document
   * @param {string} resolvedBody
   * @returns {Array<Record<string, any>>}
   */
  paginate(document, resolvedBody) {
    if (!this.config) {
      throw new Error("Pagination requires the site config");
    }
    const posts = this.config.posts;
    const perPage = this.config.paginate;
    const pages = Math.ceil(posts.length / perPage);
    /** @type {Array<Record<string, any>>} */
    const pagedDocs = [];
    let start = 0;
    for (let current = 1; current <= pages; current += 1) {
      const end = start + perPage;
      const page = /** @type {Record<string, any>} */ ({
        ...document,
        template: resolvedBody,
      });
      page.paginator = {
        page: current,
        per_page: perPage,
        posts: posts.slice(start, end),
        total_posts: posts.length,
        total_pages: pages,
        previous_page: current > 1 ? current - 1 : null,
        next_page: current === pages ? null : current + 1,
      };
      if (current === 1) {
        page.paginator.previous_page_path = null;
      } else {
        const base = path.dirname(document.path);
        page.path = `${base}/page${current}/index.html`;
        page.paginator.previous_page = current - 1;
        // Page 1 of a paginated document is the document itself, at its
        // own URL — the Jekyll page URL convention (index.html maps to
        // its directory)
        page.paginator.previous_page_path =
          current === 2
            ? this.urlForPage(document.path)
            : `/page${current - 1}`;
      }
      if (current === pages) {
        page.paginator.next_page_path = null;
      } else {
        page.paginator.next_page_path = `/page${current + 1}`;
      }
      pagedDocs.push(page);
      start = end;
    }
    return pagedDocs;
  }

  /**
   * Build the output messages for one resolvable document. The liquid
   * context is the message itself: the document fields nest under
   * `page` and the site data under `site`, the way Jekyll scopes
   * template variables. The wrapped Template component receives the
   * whole message as its scope (whole-message mapping), so these nest
   * at the top level.
   * @param {Record<string, any>} msg
   * @returns {Array<Record<string, any>>}
   */
  build(msg) {
    /** @type {Error[]} */
    const errors = Array.isArray(msg.errors) ? [...msg.errors] : [];
    const resolved = this.handleInheritance(msg, errors);
    if (errors.length > 0) {
      throw errors[0];
    }
    const page = { ...resolved.data, ...msg };
    delete page.errors;
    const site = {
      name: this.config?.name,
      time: this.config?.time,
      posts: this.config?.posts ?? [],
      categories: this.config?.categories ?? {},
    };
    const scoped = { ...msg, page, site };
    if (this.hasPaginator(resolved.body)) {
      return this.paginate(scoped, resolved.body);
    }
    return [
      {
        ...scoped,
        template: resolved.body,
      },
    ];
  }

  /**
   * Drain the pending store: consume and emit every document the current
   * store can resolve, head-first within each scope's queue and skipping
   * ahead across scopes (one scope's missing parts must not block another
   * scope's resolvable document), repeating until no queue makes
   * progress. The sends respect edge backpressure; arrivals during the
   * drain queue in the store and are picked up by the loop itself or
   * re-checked after the guard lowers.
   * @param {{ send(map: Record<string, unknown>): Promise<void>, done(err?: Error): void }} output
   * @returns {Promise<undefined>} Resolves undefined: the sends happened
   *   in-activation while the promise was pending, and the bridge
   *   completes the activation on resolution — flush must not call
   *   done() itself (a double-done re-activates a deactivated context)
   */
  async flush(output) {
    try {
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const queue of this.pending.values()) {
          while (queue.length > 0 && this.canResolve(queue[0])) {
            const msg = /** @type {Record<string, any>} */ (queue.shift());
            progressed = true;
            try {
              for (const page of this.build(msg)) {
                // Unique scope per generated page: the wrapped adapters
                // downstream correlate per scope, so concurrent renders
                // cannot cross pairs inside an adapter
                await output.send({
                  out: new IP("data", page, { scope: page.path }),
                });
              }
            } catch (err) {
              await output.send({
                fail: fail(
                  /** @type {import("@noflo/assembly").AssemblyMessage} */ (
                    msg
                  ),
                  err instanceof Error ? err : new Error(String(err)),
                ),
              });
            }
          }
        }
      }
    } finally {
      this.draining = false;
    }
    // An arrival that landed between the last progress check and the
    // guard lowering fired an activation that saw the guard up and
    // closed without draining — re-check so nothing is stranded
    for (const queue of this.pending.values()) {
      if (queue.length > 0 && this.canResolve(queue[0])) {
        return this.flush(output);
      }
    }
    return undefined;
  }

  /**
   * Consume config, templates, and documents as they arrive; then drain
   * the pending store. The document consumption is the load-bearing part:
   * the activation fired by an arrival shares the arrival's scope, so the
   * port buffer is readable here — but a document left waiting in it is
   * stranded behind its scope, because the config and template arrivals
   * that re-fire the process are unscoped and a scopeless activation
   * cannot see scoped buffers (the noflo/noflo #1092 review).
   * @param {{ has(...args: unknown[]): boolean, hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any, scope: string | null }} input
   * @param {{ send(map: Record<string, unknown>): Promise<void>, done(err?: Error): void }} output
   * @returns {Promise<undefined> | void}
   */
  processMessage(input, output) {
    // Config and templates consume into the stores; their arrivals are
    // the re-fire triggers that let queued documents resolve
    if (input.hasData("config")) {
      this.config = { ...input.getData("config") };
    }
    if (input.hasData("templates")) {
      this.addTemplate(input.getData("templates"));
    }
    while (input.hasData("msg")) {
      const msg = input.getData("msg");
      this.enrichSite(msg);
      const scope = input.scope ?? null;
      let queue = this.pending.get(scope);
      if (!queue) {
        queue = [];
        this.pending.set(scope, queue);
      }
      queue.push(msg);
    }
    if (this.draining) {
      // A drain is in flight; it re-scans every queue and re-checks after
      // the guard lowers
      output.done();
      return;
    }
    const resolvable = [...this.pending.values()].some(
      (/** @type {Array<Record<string, any>>} */ q) =>
        q.length > 0 && this.canResolve(q[0]),
    );
    if (!resolvable) {
      output.done();
      return;
    }
    this.draining = true;
    // The activation contract: the drain is asynchronous, so the promise
    // is returned and the activation holds until the flush completes —
    // the drain's sends happen in-activation. The fire-and-forget form
    // closed the activation immediately and the flush's sends raced
    // drain-based closing, re-opening the ended network (the
    // noflo/noflo #1092 review)
    return this.flush(output);
  }
}

export const getComponent = () => new DocumentBuilder();
