import path from "node:path";
import { Component, fail } from "@noflo/assembly";

/**
 * Resolves template inheritance and pagination for document messages,
 * emitting one message per generated page with the resolved
 * `template` and inherited `variables` (work document #35: assembly
 * relay for the 1.x DocumentBuilder).
 *
 * The 1.x component queued documents and retried until every referenced
 * part arrived; the 2.x pipeline orders the wires instead — the site
 * config with posts and the template corpus arrive before the
 * documents — and a missing part fails the message with accumulated
 * errors instead of holding it.
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
          description: "Site config with posts; arrives before the documents",
          required: false,
          control: true,
        },
      },
      outPorts: {
        out: {
          datatype: "object",
          description: "Page message with path, template, and variables",
        },
        fail: {
          datatype: "object",
          description: "The message with errors accumulated",
        },
      },
    });
    /** @type {Record<string, { path: string, body: string }>} */
    this.templates = {};
    this.config = null;
  }

  tearDown() {
    this.templates = {};
    this.config = null;
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
   * @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any, hasStream(arg: unknown): boolean, attached(port: string): unknown }} input
   * @param {{ sendDone(map: Record<string, unknown>): void, send(map: Record<string, unknown>): void, done(err?: Error): void }} output
   */
  processMessage(input, output) {
    if (input.hasData("templates")) {
      this.addTemplate(input.getData("templates"));
      output.done();
      return;
    }
    if (!input.hasData("msg")) {
      return;
    }
    const msg = input.getData("msg");
    // The config is a control port: the read is non-consuming, so the
    // buffered IP is available on every activation
    this.config = input.hasData("config")
      ? { ...input.getData("config") }
      : this.config;
    /** @type {Error[]} */
    const errors = Array.isArray(msg.errors) ? [...msg.errors] : [];

    if (!this.config?.posts) {
      output.sendDone({
        fail: fail(
          msg,
          new Error(
            "DocumentBuilder requires the site config with posts before documents",
          ),
        ),
      });
      return;
    }
    if (!this.checkIncludes(msg.body ?? "", errors)) {
      output.sendDone({ fail: { ...msg, errors } });
      return;
    }
    if (!this.checkDataReferences(msg.body ?? "", errors)) {
      output.sendDone({ fail: { ...msg, errors } });
      return;
    }

    const resolvedBody = this.handleInheritance(msg, errors);
    if (errors.length > 0) {
      output.sendDone({ fail: { ...msg, errors } });
      return;
    }

    if (this.hasPaginator(resolvedBody)) {
      const pages = this.paginate({ ...msg }, resolvedBody);
      // Multiple sends per activation: one message per generated page
      for (const page of pages) {
        output.send({ out: page });
      }
      output.done();
      return;
    }
    output.sendDone({
      out: {
        ...msg,
        template: resolvedBody,
        variables: { ...msg, ...this.handleVariableInheritance(msg, errors) },
      },
    });
  }
}

export const getComponent = () => new DocumentBuilder();
