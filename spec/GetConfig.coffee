noflo = require 'noflo'
chai = require 'chai'
path = require 'path'
baseDir = path.resolve __dirname, '../'

describe 'GetConfig graph', ->
  c = null
  ins = null
  out = null
  before (done) ->
    @timeout 10000
    loader = new noflo.ComponentLoader baseDir
    loader.load 'jekyll/GetConfig', (err, instance) ->
      return done err if err
      instance.once 'ready', ->
        c = instance
        ins = noflo.internalSocket.createSocket()
        c.inPorts.directory.attach ins
        c.start()
        done()
  beforeEach ->
    out = noflo.internalSocket.createSocket()
    c.outPorts.config.attach out
  afterEach ->
    c.outPorts.config.detach out

  describe 'reading the config file', ->
    it 'should produce parsed output', (done) ->
      @timeout 4000
      out.on 'data', (data) ->
        chai.expect(data).to.be.an 'object'
        chai.expect(data.name).to.equal 'noflo-jekyll test'
        done()
      sourceDir = path.resolve __dirname, 'fixtures/source'
      ins.send sourceDir
