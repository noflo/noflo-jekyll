const jekyll = require('../index');
const rimraf = require('rimraf');
const chai = require('chai');
const fs = require('fs');
const mimetype = require('mimetype');
const path = require('path');
const baseDir = path.resolve(__dirname, '../');
const sourceDir = path.resolve(__dirname, './fixtures/source');
const jekyllDir = path.resolve(__dirname, './fixtures/jekyll');
const nofloDir = path.resolve(__dirname, './fixtures/noflo');

// Extra MIME types config
mimetype.set('.markdown', 'text/x-markdown');
mimetype.set('.md', 'text/x-markdown');
mimetype.set('.xml', 'text/xml');

const checkBinaryFile = function(subPath) {
  // With binary files we could do content matching like MD5, but for
  // no size comparison should be enough
  const nofloStats = fs.statSync(path.resolve(nofloDir, subPath));
  const jekyllStats = fs.statSync(path.resolve(jekyllDir, subPath));
  return chai.expect(nofloStats.size, `${subPath} size must match`).to.equal(jekyllStats.size);
};

const checkFile = function(subPath) {
  const nofloPath = path.resolve(nofloDir, subPath);
  const jekyllPath = path.resolve(jekyllDir, subPath);
  try {
    const fileStats = fs.statSync(nofloPath);
  } catch (e) {
    throw new Error(`NoFlo didn't generate file ${subPath}`);
    return;
  }

  const mime = mimetype.lookup(subPath);
  if (!mime || (mime.indexOf('text/') === -1)) {
    checkBinaryFile(subPath);
    return;
  }

  // We should check contents without whitespace
  const replacer = /[\n\s"']*/g;
  const nofloContents = fs.readFileSync(nofloPath, 'utf-8');
  const jekyllContents = fs.readFileSync(jekyllPath, 'utf-8');
  const nofloClean = nofloContents.replace(replacer, '');
  const jekyllClean = jekyllContents.replace(replacer, '');
  return chai.expect(nofloClean, `Contents of ${subPath} must match`).to.equal(jekyllClean);
};

var checkDirectory = function(subPath) {
  const nofloPath = path.join(nofloDir, subPath);
  const jekyllPath = path.join(jekyllDir, subPath);
  try {
    const dirStats = fs.statSync(nofloPath);
    if (!dirStats.isDirectory()) {
      throw new Error(`NoFlo generated file ${subPath}, not directory`);
      return;
    }
  } catch (e) {
    throw new Error(`NoFlo didn't generate dir ${subPath}`);
    return;
  }

  const jekyllFiles = fs.readdirSync(jekyllPath);
  const nofloFiles = fs.readdirSync(nofloPath);

  return (() => {
    const result = [];
    for (let file of Array.from(jekyllFiles)) {
      const jekyllStats = fs.statSync(path.join(jekyllPath, file));
      if (jekyllStats.isDirectory()) {
        checkDirectory(path.join(subPath, file));
        continue;
      }
      result.push(checkFile(path.join(subPath, file)));
    }
    return result;
  })();
};

describe('Jekyll program', function() {
  const c = null;
  const source = null;
  const destination = null;
  const generated = null;
  const errors = null;
  after(done => rimraf(nofloDir, done));

  return describe('generating a site', function() {
    it('should complete', function(done) {
      this.timeout(10000);
      const generator = new jekyll.Jekyll(sourceDir, nofloDir);
      generator.on('error', data => done(err));
      generator.on('end', data => done());
      return generator.run(function(err) {
        if (err) { return done(err); }
      });
    });
    return it('should have created the same files as Jekyll', done => checkDirectory(''));
  });
});
