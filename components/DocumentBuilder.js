const noflo = require('noflo');
const path = require('path');

// @runtime noflo-nodejs

class DocumentBuilder extends noflo.Component {
  constructor() {
    super();
    this.includes = {};
    this.documents = [];
    this.config = null;

    this.inPorts = {
      layouts: new noflo.Port(),
      includes: new noflo.Port(),
      in: new noflo.Port(),
      config: new noflo.Port()
    };
    this.outPorts = {
      template: new noflo.Port(),
      variables: new noflo.Port(),
      error: new noflo.Port()
    };

    this.inPorts.layouts.on('data', data => {
      return this.addInclude(data);
    });

    this.inPorts.layouts.on('disconnect', () => {
      return (this.checkPending)();
    });

    this.inPorts.includes.on('data', data => {
      return this.addInclude(data);
    });

    this.inPorts.includes.on('disconnect', () => {
      return (this.checkPending)();
    });

    this.inPorts.in.on('data', data => {
      this.documents.push(data);
      return (this.checkPending)();
    });

    this.inPorts.config.on('data', data => {
      this.config = data;
      return (this.checkPending)();
    });
  }

  checkPending() {
    const pending = [];
    while (this.documents.length) {
      const document = this.documents.shift();
      if (!this.checkReady(document)) {
        pending.push(document);
        continue;
      }

      // If the page does pagination we need to paginate it first
      if (this.hasPaginator(document)) {
        const pages = this.paginate(document);
        pages.forEach(page => {
          return process.nextTick(() => {
            return this.sendDocument(page);
          });
        });
        continue;
      }

      this.sendDocument(document);
    }
    return (() => {
      const result = [];
      for (let doc of Array.from(pending)) {
        if (this.documents.indexOf(doc) !== -1) { continue; }
        result.push(this.documents.push(doc));
      }
      return result;
    })();
  }

  sendDocument(data) {
    this.outPorts.template.beginGroup(data.path);
    this.outPorts.template.send(this.handleInheritance(data));
    this.outPorts.template.endGroup();
    this.outPorts.template.disconnect();
    this.outPorts.variables.beginGroup(data.path);
    this.outPorts.variables.send(this.handleVariableInheritance(data));
    this.outPorts.variables.endGroup();
    return this.outPorts.variables.disconnect();
  }

  templateName(templatePath) {
    return path.basename(templatePath, path.extname(templatePath));
  }

  addInclude(template) {
    const name = this.templateName(template.path);
    return this.includes[name] = template;
  }

  getTemplate(templateName) {
    if (!this.includes[templateName]) {
      this.error(new Error(`Template ${templateName} not found`));
      return;
    }
    return this.handleInheritance(this.includes[templateName]);
  }

  getTemplateData(templateName) {
    if (!this.includes[templateName]) {
      this.error(new Error(`Template ${templateName} not found`));
      return;
    }
    return this.handleVariableInheritance(this.includes[templateName]);
  }

  hasPaginator(document) {
    const body = this.handleInheritance(document);
    if (body.indexOf('paginator.posts') === -1) { return false; }
    return true;
  }

  // Create multiple instances of the document, each with separate pagination
  paginate(document) {
    const pagedDocs = [];
    let current = 1;
    let start = 0;
    const pages = Math.ceil(this.config.posts.length / this.config.paginate);
    while (current <= pages) {
      // Clone the page
      const page = {};
      for (let key in document) {
        page[key] = document[key];
      }

      // Create the paginator object
      const end = start + this.config.paginate;

      page.paginator = {
        page: current,
        per_page: this.config.paginate,
        posts: this.config.posts.slice(start, end),
        total_posts: this.config.posts.length,
        total_pages: pages,
        previous_page: current > 0 ? current - 1 : null,
        next_page: current === pages ? null : current + 1
      };

      if (current === 1) {
        page.paginator.previous_page = null;
        page.paginator.previous_page_path = null;
      } else {
        page.path = this.getPagePath(document, current);
        page.paginator.previous_page = current - 1;
        if (current === 2) {
          page.paginator.previous_page_path = '/index.html';
        } else {
          page.paginator.previous_page_path = `/page${current - 1}`;
        }
      }

      if (current === pages) {
        page.paginator.next_page = null;
        page.paginator.next_page_path = null;
      } else {
        page.paginator.next_page = current + 1;
        page.paginator.next_page_path = `/page${current + 1}`;
      }

      start = end;

      pagedDocs.push(page);
      current++;
    }

    return pagedDocs;
  }

  getPagePath(document, page) {
    const base = path.dirname(document.path);
    return `${base}/page${page}/index.html`;
  }

  checkIncludes(body) {
    const matcher = new RegExp('\{\% include (.*)\.html \%\}');
    const match = matcher.exec(body);
    if (!match) { return true; }
    if (this.includes[match[1]]) {
      const include = this.includes[match[1]];
      return this.checkCategories(include.body, include);
    }
    return false;
  }

  // If document contents refer to the posts list, we need to
  // wait until we have posts available
  checkPosts(body, document) {
    if ((body.indexOf('site.posts') === -1) &&
        (body.indexOf('paginator.posts') === -1)) {
      return true;
    }
    if (!this.config) { return false; }
    return true;
  }

  // If document contents refer to the categories list, we need to
  // wait until we have posts available
  checkCategories(body, document) {
    if (body.indexOf('site.categories') === -1) { return true; }
    if (!this.config) { return false; }
    return true;
  }

  // Check whether a document is ready to be created, of if it is
  // still waiting for some parts (includes, posts, layouts)
  checkReady(templateData) {
    if (!this.config) { return false; }
    if (templateData.body) {
      if (!this.checkIncludes(templateData.body)) { return false; }
      if (!this.checkPosts(templateData.body, templateData)) { return false; }
      if (!this.checkCategories(templateData.body, templateData)) { return false; }
    }
    if (!templateData.layout) { return true; }
    if (!this.includes[templateData.layout]) { return false; }
    return this.checkReady(this.includes[templateData.layout]);
  }

  handleInheritance(templateData) {
    let template = templateData.body;
    if (templateData.layout) {
      const parent = this.getTemplate(templateData.layout);
      if (parent) {
        template = parent.replace('{{ content }}', template);
      }
    }
    return template;
  }

  handleVariableInheritance(data) {
    if (data.layout) {
      const parent = this.getTemplateData(data.layout);
      if (parent) {
        for (let key in parent) {
          const val = parent[key];
          if (key === 'body') { continue; }
          if (data[key] !== undefined) { continue; }
          data[key] = val;
        }
      }
    }
    return data;
  }

  error(error) {
    if (!this.outPorts.error.isAttached()) { return; }
    this.outPorts.error.send(e);
    return this.outPorts.error.disconnect();
  }
}

exports.getComponent = () => new DocumentBuilder;
