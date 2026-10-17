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
 * within a stream is there an ordering guarantee). Documents wait in the
 * port buffer — one partition per message scope — and are consumed
 * head-first when the current config and template store can resolve
 * them: the has-first rule, with the head peeked at non-consumingly via
 * a validator pinned to the first data IP so an any-match scan can never
 * consume a later document out of order. The engine's firing rule makes
 * the wait complete: an arrival on any port — the standing config's
 * control gate, a template, a new document — re-fires the process once
 * per scope that holds pending documents, so a document whose referenced
 * parts have not arrived is re-offered on every subsequent arrival
 * instead of stranding behind its scope (the state store this relay
 * carried through the scopeless-re-fire era is obsolete under the
 * one-firing rule; work document #47). A document whose parts never
 * arrive stays buffered until network shutdown discards it; the `fail`
 * port is for unexpected processing errors, not missing parts.
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
            "Template file with path and body, as one bracket-framed corpus stream; stored by template name",
          required: false,
          // The corpus is standing site configuration and the only
          // per-scope re-fire trigger for buffered documents: as a
          // control gate its arrival re-fires every scope that holds
          // pending documents, so a document buffered behind the
          // corpus race resolves when the corpus completes. The stream
          // must arrive as one bracket frame (the envelope merges the
          // layouts and includes listings): the control buffer keeps
          // the latest stream, and two separate listing groups would
          // discard each other
          control: true,
          scoped: false,
        },
        config: {
          datatype: "object",
          description:
            "Site config with posts; standing configuration, read non-consumingly — it may arrive after the documents",
          required: false,
          // The gate model (work document #47): standing configuration
          // is a control port — read non-consumingly, its arrival
          // re-firing every scope that holds pending documents. The
          // edge-delivered standing config is unscoped and must stay
          // readable from scoped activations
          control: true,
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
     * The scopes with a drain in flight. Each scope's port buffer is its
     * own queue, and each activation drains only its own scope's
     * partition, so the guard is per scope: a same-scope activation that
     * fires while the drain is in flight declines at the has-level and
     * its packet is picked up by the drain's re-checks, while other
     * scopes drain independently
     *
     * @type {Set<string | null>}
     */
    this.drainingScopes = new Set();
  }

  tearDown() {
    this.templates = {};
    this.config = null;
    this.drainingScopes.clear();
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
   * Whether the head document of this activation's scope partition can
   * resolve with the current config and template store. The peek is
   * non-consuming, and the validator is pinned to the first data IP:
   * `has` is an any-match scan and `get` consumes the head, so a match
   * on a later document would consume the wrong one.
   * @param {{ has(...args: unknown[]): boolean }} input
   * @returns {boolean}
   */
  headResolvable(input) {
    let seen = false;
    let ok = false;
    input.has("msg", (/** @type {{ type: string, data: any }} */ ip) => {
      if (ip.type !== "data" || seen) {
        return false;
      }
      seen = true;
      ok = this.canResolve(ip.data);
      return ok;
    });
    return ok;
  }

  /**
   * Drain this activation's scope partition head-first: consume and emit
   * every document the current config and template store can resolve, in
   * arrival order, stopping at the first one still missing parts. The
   * sends respect edge backpressure; arrivals during the drain are
   * picked up by the loop itself or re-checked after the guard lowers.
   * @param {{ has(...args: unknown[]): boolean, getData(...args: unknown[]): any, scope: string | null }} input
   * @param {{ send(map: Record<string, unknown>): Promise<void>, done(err?: Error): void }} output
   * @returns {Promise<undefined>} Resolves undefined: the sends happened
   *   in-activation while the promise was pending, and the bridge
   *   completes the activation on resolution — flush must not call
   *   done() itself (a double-done re-activates a deactivated context)
   */
  async flush(input, output) {
    const scope = input.scope ?? null;
    try {
      while (this.headResolvable(input)) {
        const msg = input.getData("msg");
        this.enrichSite(msg);
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
              /** @type {import("@noflo/assembly").AssemblyMessage} */ (msg),
              err instanceof Error ? err : new Error(String(err)),
            ),
          });
        }
      }
    } finally {
      this.drainingScopes.delete(scope);
    }
    // An arrival that landed between the last buffer check and the guard
    // lowering fired an activation that saw the guard up and closed
    // without draining — re-check so nothing is stranded
    if (this.headResolvable(input)) {
      return this.flush(input, output);
    }
    return undefined;
  }

  /**
   * Consume the standing config and the template corpus as they arrive;
   * then drain this activation's scope partition. The config is a
   * control port: standing configuration read non-consumingly, whose
   * arrival re-fires every scope that holds pending documents (work
   * document #47's gate). The documents wait in the port buffer, one
   * partition per message scope, and are consumed head-first when
   * resolvable.
   * @param {{ has(...args: unknown[]): boolean, hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any, getStream(...args: unknown[]): import("@noflo/noflo").IP[], scope: string | null }} input
   * @param {{ send(map: Record<string, unknown>): Promise<void>, done(err?: Error): void }} output
   * @returns {Promise<undefined> | void}
   */
  processMessage(input, output) {
    // The standing config and the template corpus consume into the
    // stores; their arrivals are the re-fire triggers that let buffered
    // documents resolve
    if (input.hasData("config")) {
      this.config = { ...input.getData("config") };
    }
    if (input.hasData("templates")) {
      // The corpus is a bracketed control stream, read non-consumingly:
      // every re-fire re-registers the whole buffered corpus
      // idempotently, so the store is complete no matter which arrival
      // triggered this firing
      for (const ip of input.getStream("templates")) {
        if (ip.type === "data") {
          this.addTemplate(ip.data);
        }
      }
    }
    const scope = input.scope ?? null;
    if (this.drainingScopes.has(scope)) {
      // A drain is in flight for this scope; it re-checks the buffer
      // after every send and again after the guard lowers
      output.done();
      return;
    }
    if (!this.headResolvable(input)) {
      output.done();
      return;
    }
    this.drainingScopes.add(scope);
    // The activation contract: the drain is asynchronous, so the promise
    // is returned and the activation holds until the flush completes —
    // the drain's sends happen in-activation. The fire-and-forget form
    // closed the activation immediately and the flush's sends raced
    // drain-based closing, re-opening the ended network (the
    // noflo/noflo #1092 review)
    return this.flush(input, output);
  }
}

export const getComponent = () => new DocumentBuilder();
