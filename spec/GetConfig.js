const noflo = require('noflo');
const chai = require('chai');
const path = require('path');
const baseDir = path.resolve(__dirname, '../');

describe('GetConfig graph', function() {
  let c = null;
  let ins = null;
  let out = null;
  before(function(done) {
    this.timeout(10000);
    const loader = new noflo.ComponentLoader(baseDir);
    return loader.load('jekyll/GetConfig', function(err, instance) {
      if (err) { return done(err); }
      return instance.once('ready', function() {
        c = instance;
        ins = noflo.internalSocket.createSocket();
        c.inPorts.directory.attach(ins);
        return c.start(done);
      });
    });
  });
  beforeEach(function() {
    out = noflo.internalSocket.createSocket();
    return c.outPorts.config.attach(out);
  });
  afterEach(() => c.outPorts.config.detach(out));

  return describe('reading the config file', () =>
    it('should produce parsed output', function(done) {
      this.timeout(4000);
      out.on('data', function(data) {
        chai.expect(data).to.be.an('object');
        chai.expect(data.name).to.equal('noflo-jekyll test');
        return done();
      });
      const sourceDir = path.resolve(__dirname, 'fixtures/source');
      return ins.send(sourceDir);
    })
  );
});
