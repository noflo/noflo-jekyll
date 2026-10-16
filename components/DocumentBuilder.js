import path from "node:path";
import { Component, fail } from "@noflo/assembly";

/**
 * Resolves template inheritance and pagination for document messages,
 * emitting one message per generated page with the resolved
 * `template` and inherited `variables` (work document #35: assembly
 * relay for the 1.x DocumentBuilder).
 *
 * No ordering is assumed between the wires: in an asynchronous network
 * documents, templates, and the site config arrive in any order (only
 * within a stream is there an ordering guarantee). A document whose
 * referenced parts have not arrived yet stays buffered on its inport —
 * the has-first rule: the head message is peeked at non-consumingly,
 * and consumed only when the current config and template store can
 * resolve it. Config and template arrivals re-fire the process, which
 * is what lets buffered documents resolve later. A message whose parts
 * never arrive stays buffered until network shutdown discards it; the
 * `fail` port is for unexpected processing errors, not missing parts.
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
    /** @type {Record<string, { path: string, body: string }>} */
    this.templates = {};
    /** @type {Record<string, any> | null} */
    this.config = null;
    /** Guards the drain loop against the concurrent activations that new arrivals fire while it is in flight */
    this.draining = false;
  }

  tearDown() {
    this.templates = {};
    this.config = null;
    this.draining = false;
    return Promise.resolve();
  }

  /**
   * @param {{ path: string, body: string }} template
   * @returns {void}
   */
  addTemplate(template) {
    const name = path.basename(template.path, path.extname(template.path));
    this.templates[name] = template;
  }

  /**
   * @param {string} templateName
   * @param {Error[]} errors
   * @returns {{ path: string, body: string } | undefined}
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
    if (msg.layout && !this.templates[msg.layout]) {
      return false;
    }
    if (this.hasPaginator(msg.body ?? "") && !this.config?.posts) {
      return false;
    }
    return true;
  }

  /**
   * Resolves the `{% layout %}`/`layout` chain: the parent template body
   * replaces `{{ content }}` with the child body.
   * @param {Record<string, any>} templateData
   * @param {Error[]} errors
   * @returns {string}
   */
  handleInheritance(templateData, errors) {
    let template = templateData.body;
    if (templateData.layout) {
      const parent = this.getTemplate(templateData.layout, errors);
      if (parent) {
        template = parent.body.replace("{{ content }}", template);
      }
    }
    return template;
  }

  /**
   * Merges the layout chain's variables into the document data, child
   * values winning.
   * @param {Record<string, any>} data
   * @param {Error[]} errors
   * @returns {Record<string, any>}
   */
  handleVariableInheritance(data, errors) {
    if (!data.layout) {
      return data;
    }
    const parent = this.getTemplate(data.layout, errors);
    if (!parent) {
      return data;
    }
    // The parent template file carries no front-matter variables in the
    // 1.x model beyond its body; the layout name is what propagates
    return data;
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
        page.paginator.previous_page_path =
          current === 2 ? "/index.html" : `/page${current - 1}`;
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
   * Build the output messages for one resolvable document.
   * @param {Record<string, any>} msg
   * @returns {Array<Record<string, any>>}
   */
  build(msg) {
    /** @type {Error[]} */
    const errors = Array.isArray(msg.errors) ? [...msg.errors] : [];
    const resolvedBody = this.handleInheritance(msg, errors);
    if (errors.length > 0) {
      throw errors[0];
    }
    if (this.hasPaginator(resolvedBody)) {
      return this.paginate({ ...msg }, resolvedBody);
    }
    return [
      {
        ...msg,
        template: resolvedBody,
        variables: { ...msg, ...this.handleVariableInheritance(msg, errors) },
      },
    ];
  }

  /**
   * Whether the head document in the msg buffer is resolvable. The
   * validator only accepts the first data IP in the buffer — `has` is
   * an any-match scan, and `get` consumes the head, so a match on a
   * later message would consume the wrong one.
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
   * Drain the msg buffer head-first: consume and emit every document
   * the current store can resolve, in arrival order, stopping at the
   * first one still missing parts. The sends respect edge
   * backpressure; new arrivals fired while a drain is in flight are
   * picked up by the drain loop itself or re-checked after it unwinds.
   * @param {{ has(...args: unknown[]): boolean, getData(port: string): any }} input
   * @param {{ send(map: Record<string, unknown>): Promise<void>, done(err?: Error): void }} output
   * @returns {Promise<void>}
   */
  async flush(input, output) {
    try {
      while (this.headResolvable(input)) {
        const msg = input.getData("msg");
        try {
          for (const page of this.build(msg)) {
            await output.send({ out: page });
          }
        } catch (err) {
          await output.send({
            fail: fail(
              msg,
              err instanceof Error ? err : new Error(String(err)),
            ),
          });
        }
      }
    } finally {
      this.draining = false;
    }
    // A message that arrived between the last buffer check and the
    // guard being lowered fired an activation that saw the guard up and
    // closed without draining — re-check here so it is not stranded
    if (this.headResolvable(input)) {
      await this.flush(input, output);
      return;
    }
    output.done();
  }

  /**
   * @param {{ has(...args: unknown[]): boolean, hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any }} input
   * @param {{ send(map: Record<string, unknown>): Promise<void>, done(err?: Error): void }} output
   */
  processMessage(input, output) {
    // Consume config and templates as they arrive: their arrivals are
    // the re-fire triggers that let buffered documents resolve
    if (input.hasData("config")) {
      this.config = { ...input.getData("config") };
    }
    if (input.hasData("templates")) {
      this.addTemplate(input.getData("templates"));
    }
    if (this.draining) {
      // A drain is in flight; it sees the updated store on its next
      // loop iteration or re-checks after unwinding
      output.done();
      return;
    }
    if (!input.hasData("msg")) {
      output.done();
      return;
    }
    this.draining = true;
    this.flush(input, output).catch((/** @type {Error} */ err) =>
      output.done(err),
    );
  }
}

export const getComponent = () => new DocumentBuilder();
