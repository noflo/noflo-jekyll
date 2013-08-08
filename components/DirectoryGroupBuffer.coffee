noflo = require 'noflo'
path = require 'path'

class DirectoryGroupBuffer extends noflo.Component
  constructor: ->
    @buffers = {}
    @released = []

    @inPorts =
      collect: new noflo.Port 'all'
      release: new noflo.Port 'string'
    @outPorts =
      out: new noflo.Port 'all'

    @groups = []
    @inPorts.collect.on 'begingroup', (group) =>
      @groups.push group
    @inPorts.collect.on 'data', (data) =>
      bufName = path.dirname @groups.join '/'
      unless @released.indexOf(bufName) is -1
        @release
          data: data
          groups: @groups.slice 0
        return

      @buffers[bufName] = [] unless @buffers[bufName]
      @buffers[bufName].push
        data: data
        groups: @groups.slice 0

    @inPorts.collect.on 'endgroup', =>
      @groups.pop()

    @inPorts.release.on 'data', (data) =>
      @released.push data
      return unless @buffers[data]

      while @buffers[data].length > 0
        @release @buffers[data].pop()

    @inPorts.collect.on 'disconnect', =>
      @outPorts.out.disconnect() unless @inPorts.release.isConnected()

    @inPorts.release.on 'disconnect', =>
      @outPorts.out.disconnect() unless @inPorts.collect.isConnected()

  release: (packet) ->
    for group in packet.groups
      @outPorts.out.beginGroup group

    @outPorts.out.send packet.data

    for group in packet.groups
      @outPorts.out.endGroup()

exports.getComponent = -> new DirectoryGroupBuffer
