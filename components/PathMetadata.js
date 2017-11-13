const noflo = require('noflo');
const path = require('path');

class PathMetadata extends noflo.Component {
  static initClass() {
    this.prototype.pathMatcher = new RegExp(`\
^\
(\\d{4})\
-\
0?(\\d+)\
-\
0?(\\d+)\
-\
([A-Za-z0-9-_.]*)\
`);
  }

  constructor() {
    super();
    this.source = '';

    this.inPorts = {
      in: new noflo.Port(),
      source: new noflo.Port()
    };
    this.outPorts =
      {out: new noflo.Port()};

    this.inPorts.source.on('data', data => {
      return this.source = data;
    });

    this.inPorts.in.on('begingroup', group => {
      return this.outPorts.out.beginGroup(group);
    });

    this.inPorts.in.on('data', data => {
      return this.outPorts.out.send(this.metadata(data));
    });

    this.inPorts.in.on('endgroup', () => {
      return this.outPorts.out.endGroup(group);
    });

    this.inPorts.in.on('disconnect', () => {
      return this.outPorts.out.disconnect();
    });
  }

  getDate(postName, data) {
    if (data.date) {
      // Parse the ISO date
      return new Date(data.date);
    }

    const match = this.pathMatcher.exec(postName);
    if (!match) { return new Date; }
    return new Date(`${match[1]}-${match[2]}-${match[3]}`);
  }

  getName(postName, data) {
    const match = this.pathMatcher.exec(postName);
    // TODO: use Stringex for generating URL names
    // in cases where we can't parse one
    if (!match) { return ''; }
    return match[4];
  }

  getCategories(data) {
    if (data.category) {
      return data.category;
    }
    if (data.categories) {
      return data.categories;
    }

    const postPath = data.path.replace(this.source, '');
    const dirName = path.dirname(postPath);
    const categories = [];
    const dirs = dirName.split('/');
    for (let dir of Array.from(dirs)) {
      if (!dir) { continue; }
      if (dir === '_posts') { continue; }
      categories.push(dir);
    }
    return categories;
  }

  metadata(post) {
    const postName = path.basename(post.path);
    post.date = this.getDate(postName, post);
    post.name = this.getName(postName, post);
    post.categories = this.getCategories(post);
    return post;
  }
}
PathMetadata.initClass();

exports.getComponent = () => new PathMetadata;
