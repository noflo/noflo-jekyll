const noflo = require('noflo');

const sortByDate = function(post1, post2) {
  if (post1.date === post2.date) {
    // Same post date, sort by title
    const title1 = post1.path.toLowerCase();
    const title2 = post2.path.toLowerCase();
    if (title1 === title2) {
      return 0;
    }
    if (title1 < title2) {
      return -1;
    }
    return 1;
  }
  if (post1.date < post2.date) {
    return 1;
  }
  return -1;
};

class PostCollector extends noflo.Component {
  constructor() {
    super();
    this.config = null;
    this.buffer = [];
    this.wasDone = false;

    this.inPorts = {
      config: new noflo.Port,
      in: new noflo.Port
    };
    this.outPorts =
      {out: new noflo.Port};

    this.inPorts.config.on('data', data => {
      return this.normalizeConfig(data);
    });

    this.inPorts.in.on('data', data => {
      if (!this.config) {
        this.buffer.push(data);
        return;
      }
      return this.processPost(data);
    });

    this.inPorts.in.on('disconnect', () => {
      if (!this.config) {
        this.wasDone === true;
        return;
      }
      if (!this.outPorts.out.isAttached()) { return; }
      this.outPorts.out.send(this.sortPosts(this.config));
      return this.outPorts.out.disconnect();
    });
  }

  normalizeConfig(config) {
    this.config = config;
    this.config.posts = [];
    this.config.categories = {};

    if (this.buffer.length) {
      for (let post of Array.from(this.buffer)) { this.processPost(post); }
      this.buffer = [];
      if (!this.wasDone) { return; }
      this.outPorts.out.send(this.sortPorts(this.config));
      return this.outPorts.out.disconnect();
    }
  }

  sortPosts(config) {
    config.posts.sort(sortByDate);
    for (let name in config.categories) {
      const category = config.categories[name];
      category.sort(sortByDate);
    }
    return config;
  }

  processPost(post) {
    post.content = post.body;
    this.config.posts.push(post);

    if (!post.categories) { return; }

    return (() => {
      const result = [];
      for (let category of Array.from(post.categories)) {
        if (!this.config.categories[category]) {
          this.config.categories[category] = [];
        }
        result.push(this.config.categories[category].push(post));
      }
      return result;
    })();
  }
}

exports.getComponent = () => new PostCollector;
