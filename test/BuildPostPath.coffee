noflo = require 'noflo'
component = require '../components/BuildPostPath'

getComponent = ->
  c = component.getComponent()
  ins = noflo.internalSocket.createSocket()
  c.inPorts.in.attach ins
  source = noflo.internalSocket.createSocket()
  c.inPorts.source.attach source
  config = noflo.internalSocket.createSocket()
  c.inPorts.config.attach config
  out = noflo.internalSocket.createSocket()
  c.outPorts.out.attach out
  [ins, source, config, out]

exports['test path with categories'] = (test) ->
  [ins, source, config, out] = getComponent()

  out.on 'data', (data) ->
    test.equal data.path, '/some/source/blog/foo/bar/hello/index.md'
    test.done()

  source.send '/some/source'
  config.send
    permalink: '/blog/:categories/:title/'
  ins.send
    path: '/some/source/_posts/hello.html'
    name: 'hello.md'
    categories: ['foo', 'bar']

exports['test path without categories'] = (test) ->
  [ins, source, config, out] = getComponent()

  out.on 'data', (data) ->
    test.equal data.path, '/some/source/blog/hello/index.md'
    test.done()

  source.send '/some/source'
  config.send
    permalink: '/blog/:categories/:title/'
  ins.send
    path: '/some/source/_posts/hello.html'
    name: 'hello.md'

exports['test path with empty category'] = (test) ->
  [ins, source, config, out] = getComponent()

  out.on 'data', (data) ->
    test.equal data.path, '/some/source/blog/foo/bar/hello/index.md'
    test.done()

  source.send '/some/source'
  config.send
    permalink: '/blog/:categories/:title/'
  ins.send
    path: '/some/source/_posts/hello.html'
    name: 'hello.md'
    categories: ['foo', 'bar', '']

exports['test path with date'] = (test) ->
  [ins, source, config, out] = getComponent()

  out.on 'data', (data) ->
    test.equal data.path, '/some/source/blog/2012/12/hello/index.md'
    test.done()

  source.send '/some/source'
  config.send
    permalink: '/blog/:year/:month/:title/'
  ins.send
    path: '/some/source/_posts/hello.html'
    name: 'hello.md'
    date: new Date '2012-12-13'

exports['test path with December date'] = (test) ->
  [ins, source, config, out] = getComponent()

  out.on 'data', (data) ->
    test.equal data.path, '/some/source/blog/2007/12/hello/index.md'
    test.done()

  source.send '/some/source'
  config.send
    permalink: '/blog/:year/:month/:title/'
  ins.send
    path: '/some/source/_posts/hello.html'
    name: 'hello.md'
    date: new Date '2007-12-18'
