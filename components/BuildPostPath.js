const noflo = require('noflo');
const path = require('path');

// @runtime noflo-nodejs
function handleCategories(permalink, categories) {
  if (!categories) {
    return permalink.replace('/:categories', '');
  }

  const clean = categories.filter((cat) => {
    if (!cat) {
      return false;
    }
    return true;
  });

  return permalink.replace(':categories', clean.join('/'));
}

function handleDate(permalink, date) {
  if (!date) {
    return permalink;
  }
  let link = permalink.replace(':year', date.getFullYear());
  link = link.replace(':month', date.getMonth() + 1);
  return link.replace(':day', date.getDate());
}

function handleTitle(permalink, name) {
  const permaExt = path.extname(permalink);
  const nameExt = path.extname(name);

  let endSlash = false;
  if (permalink[permalink.length - 1] === '/') {
    endSlash = true;
  }

  let link = permalink;
  if (permaExt !== nameExt) {
    // Remove extension
    const dirName = path.dirname(permalink);
    const baseName = path.basename(permalink, permaExt);
    link = `${dirName}/${baseName}`;

    if (endSlash && (link[link.length - 1] !== '/')) {
      link = `${link}/`;
    }
  }

  return link.replace(':title', name);
}

function handleIndex(permalink) {
  if (permalink[permalink.length - 1] !== '/') {
    return permalink;
  }
  const filePath = permalink.slice(0, -1);
  const permaExt = path.extname(filePath);
  const dirName = path.dirname(filePath);
  const baseName = path.basename(filePath, permaExt);
  return `${dirName}/${baseName}/index${permaExt}`;
}

function buildUrl(post, source) {
  const url = post.path.replace(source, '');

  const fileExt = path.extname(url);
  const baseName = path.basename(url, fileExt);
  if (baseName === 'index') {
    return `${path.dirname(url)}/`;
  }

  return url;
}

function buildPath(post, source, config) {
  let newpath = `${source}${config.permalink}`;
  newpath = handleCategories(newpath, post.categories);
  newpath = handleDate(newpath, post.date);
  newpath = handleTitle(newpath, post.name);
  newpath = handleIndex(newpath);
  const withPath = post;
  withPath.path = newpath;
  withPath.url = buildUrl(post, source);
  return withPath;
}

module.exports = () => {
  const c = new noflo.Component();
  c.inPorts.add('in', {
    datatype: 'object',
  });
  c.inPorts.add('source', {
    datatype: 'string',
    control: true,
  });
  c.inPorts.add('config', {
    datatype: 'object',
    control: true,
  });
  c.outPorts.add('out', {
    datatype: 'object',
  });
  c.process((input, output) => {
    if (!input.hasData('source', 'config')) {
      return;
    }
    if (!input.hasStream('in')) {
      return;
    }
    const source = input.getData('source');
    const config = input.getData('config');
    const posts = input.getStream('in').filter(ip => ip.type === 'data').map(ip => ip.data);
    const withPath = posts.map(post => buildPath(post, source, config));
    withPath.forEach((post) => {
      output.send({
        out: post,
      });
    });
    output.done();
  });
  return c;
};
