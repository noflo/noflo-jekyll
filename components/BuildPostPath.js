const noflo = require('noflo');
const path = require('path');

// @runtime noflo-nodejs

class BuildPostPath extends noflo.Component {
  constructor() {
    super();
    this.inPorts = {
      in: new noflo.Port(),
      source: new noflo.Port(),
      config: new noflo.Port()
    };
    this.outPorts =
      {out: new noflo.Port()};

    this.posts = [];
    this.groups = [];
    this.config = null;
    this.source = null;

    this.inPorts.in.on('begingroup', group => {
      return this.groups.push(group);
    });

    this.inPorts.in.on('data', data => {
      if (this.config && this.source) {
        this.buildPath(data, this.groups);
        return;
      }
      return this.posts.push({
        post: data,
        groups: this.groups.slice(0)
      });
    });

    this.inPorts.in.on('endgroup', () => {
      return this.groups.pop();
    });

    this.inPorts.in.on('disconnect', () => {
      return this.outPorts.out.disconnect();
    });

    this.inPorts.source.on('data', data => {
      this.source = data;
      if (this.config) { return (this.buildPaths)(); }
    });

    this.inPorts.config.on('data', data => {
      this.config = data;
      if (this.source) { return (this.buildPaths)(); }
    });
  }

  buildPaths() {
    return (() => {
      const result = [];
      while (this.posts.length) {
        const data = this.posts.shift();
        result.push(this.buildPath(data.post, data.groups));
      }
      return result;
    })();
  }

  handleCategories(permalink, categories) {
    if (!categories) { return permalink.replace('/:categories', ''); }

    const clean = [];
    for (let category of Array.from(categories)) {
      if (category) { clean.push(category); }
    }

    return permalink.replace(':categories', clean.join('/'));
  }

  handleDate(permalink, date) {
    if (!date) { return permalink; }
    permalink = permalink.replace(':year', date.getFullYear());
    permalink = permalink.replace(':month', date.getMonth() + 1);
    return permalink = permalink.replace(':day', date.getDate());
  }

  handleTitle(permalink, name) {
    const permaExt = path.extname(permalink);
    const nameExt = path.extname(name);

    let endSlash = false;
    if (permalink[permalink.length - 1] === '/') {
      endSlash = true;
    }

    if (permaExt !== nameExt) {
      // Remove extension
      const dirName = path.dirname(permalink);
      const baseName = path.basename(permalink, permaExt);
      permalink = `${dirName}/${baseName}`;

      if (endSlash && (permalink[permalink.length - 1] !== '/')) {
        permalink = `${permalink}/`;
      }
    }

    return permalink.replace(':title', name);
  }

  handleIndex(permalink) {
    if (permalink[permalink.length - 1] !== '/') { return permalink; }
    const filePath = permalink.slice(0, -1);
    const permaExt = path.extname(filePath);
    const dirName = path.dirname(filePath);
    const baseName = path.basename(filePath, permaExt);
    return `${dirName}/${baseName}/index${permaExt}`;
  }

  buildPath(post, groups) {
    let newpath = `${this.source}${this.config.permalink}`;
    newpath = this.handleCategories(newpath, post.categories);
    newpath = this.handleDate(newpath, post.date);
    newpath = this.handleTitle(newpath, post.name);
    newpath = this.handleIndex(newpath);
    post.path = newpath;
    post.url = this.buildUrl(post);
    for (var group of Array.from(groups)) {
      this.outPorts.out.beginGroup(group);
    }
    this.outPorts.out.send(post);
    return (() => {
      const result = [];
      for (group of Array.from(groups)) {
        result.push(this.outPorts.out.endGroup());
      }
      return result;
    })();
  }

  buildUrl(post) {
    const url = post.path.replace(this.source, '');

    const fileExt = path.extname(url);
    const baseName = path.basename(url, fileExt);
    if (baseName === 'index') {
      return `${path.dirname(url)}/`;
    }

    return url;
  }
}

exports.getComponent = () => new BuildPostPath;
