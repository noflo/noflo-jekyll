const noflo = require('noflo');
const path = require('path');

const pathMatcher = new RegExp('^(\\d{4})-0?(\\d+)-0?(\\d+)-([A-Za-z0-9-_.]*)');

function getDate(postName, data) {
  if (data.date) {
    // Parse the ISO date
    return new Date(data.date);
  }

  const match = pathMatcher.exec(postName);
  if (!match) {
    return new Date();
  }
  return new Date(`${match[1]}-${match[2]}-${match[3]}`);
}

function getName(postName) {
  const match = pathMatcher.exec(postName);
  // TODO: use Stringex for generating URL names
  // in cases where we can't parse one
  if (!match) { return ''; }
  return match[4];
}

function getCategories(data, source) {
  if (data.category) {
    return data.category;
  }
  if (data.categories) {
    return data.categories;
  }

  const postPath = data.path.replace(source, '');
  const dirName = path.dirname(postPath);
  const categories = [];
  const dirs = dirName.split('/');
  dirs.forEach((dir) => {
    if (!dir) { return; }
    if (dir === '_posts') { return; }
    categories.push(dir);
  });
  return categories;
}

exports.getComponent = () => {
  const c = new noflo.Component();
  c.inPorts.add('in', {
    datatype: 'object',
  });
  c.inPorts.add('source', {
    datatype: 'string',
    control: true,
  });
  c.outPorts.add('out', {
    datatype: 'object',
  });
  c.process((input, output) => {
    if (!input.hasData('in', 'source')) {
      return;
    }
    const source = input.getData('source');
    const post = input.getData('in');
    const postName = path.basename(post.path);
    post.date = getDate(postName, post);
    post.name = getName(postName);
    post.categories = getCategories(post, source);
    output.sendDone({
      out: post,
    });
  });
  return c;
};
