noflo = require 'noflo'
chai = require 'chai'
path = require 'path'
baseDir = path.resolve __dirname, '../'

describe 'BuildPostPath component', ->
  c = null
  ins = null
  source = null
  config = null
  out = null
  before (done) ->
    @timeout 4000
    loader = new noflo.ComponentLoader baseDir
    loader.load 'jekyll/BuildPostPath', (err, instance) ->
      return done err if err
      c = instance
      ins = noflo.internalSocket.createSocket()
      c.inPorts.in.attach ins
      source = noflo.internalSocket.createSocket()
      c.inPorts.source.attach source
      config = noflo.internalSocket.createSocket()
      c.inPorts.config.attach config
      done()
  beforeEach ->
    out = noflo.internalSocket.createSocket()
    c.outPorts.out.attach out
  afterEach ->
    c.outPorts.out.detach out

  describe 'building path with categories', ->
    it 'should produce correct path', (done) ->
      out.on 'data', (data) ->
        chai.expect(data.path).to.equal '/some/source/blog/foo/bar/hello/index.md'
        done()

      source.send '/some/source'
      config.send
        permalink: '/blog/:categories/:title/'
      ins.send
        path: '/some/source/_posts/hello.html'
        name: 'hello.md'
        categories: ['foo', 'bar']
  describe 'building path without categories', ->
    it 'should produce correct path', (done) ->
      out.on 'data', (data) ->
        chai.expect(data.path).to.equal '/some/source/blog/hello/index.md'
        done()

      source.send '/some/source'
      config.send
        permalink: '/blog/:categories/:title/'
      ins.send
        path: '/some/source/_posts/hello.html'
        name: 'hello.md'
  describe 'building path with empty category', ->
    it 'should produce correct path', (done) ->
      out.on 'data', (data) ->
        chai.expect(data.path).to.equal '/some/source/blog/foo/bar/hello/index.md'
        done()

      source.send '/some/source'
      config.send
        permalink: '/blog/:categories/:title/'
      ins.send
        path: '/some/source/_posts/hello.html'
        name: 'hello.md'
        categories: ['foo', 'bar', '']
  describe 'building path with date', ->
    it 'should produce correct path', (done) ->
      out.on 'data', (data) ->
        chai.expect(data.path).to.equal '/some/source/blog/2012/12/hello/index.md'
        done()

      source.send '/some/source'
      config.send
        permalink: '/blog/:year/:month/:title/'
      ins.send
        path: '/some/source/_posts/hello.html'
        name: 'hello.md'
        date: new Date '2012-12-13'
  describe 'building path with January date', ->
    it 'should produce correct path', (done) ->
      out.on 'data', (data) ->
        chai.expect(data.path).to.equal '/some/source/blog/2012/1/hello/index.md'
        done()

      source.send '/some/source'
      config.send
        permalink: '/blog/:year/:month/:title/'
      ins.send
        path: '/some/source/_posts/hello.html'
        name: 'hello.md'
        date: new Date '2012-01-13'
