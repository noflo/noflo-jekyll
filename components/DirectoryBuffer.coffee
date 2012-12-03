noflo = require 'noflo'
path = require 'path'

class DirectoryBuffer extends noflo.Component
  constructor: ->
    @buffers = {}
    @released = []

    @inPorts =
      collect: new noflo.Port()
      release: new noflo.Port()
    @outPorts =
      out: new noflo.Port()

    @inPorts.collect.on 'data', (data) =>
      bufName = path.dirname data
      return @release data unless @released.indexOf(bufName) is -1

      @buffers[bufName] = [] unless @buffers[bufName]
      @buffers[bufName].push data

    @inPorts.release.on 'data', (data) =>
      @released.push data
      return unless @buffers[data]

      while @buffers[data].length > 0
        @release @buffers[data].pop()

    @inPorts.collect.on 'disconnect', =>
      @outPorts.out.disconnect() unless @inPorts.release.isConnected()

    @inPorts.release.on 'disconnect', =>
      @outPorts.out.disconnect() unless @inPorts.collect.isConnected()

  release: (packet, buffer) ->
    @outPorts.out.send packet

exports.getComponent = -> new DirectoryBuffer
