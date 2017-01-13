noflo = require 'noflo'
path = require 'path'

exports.getComponent = ->
  c = new noflo.Component
  c.inPorts.add 'directory',
    datatype: 'string'
  c.inPorts.add 'path',
    datatype: 'string'
  c.outPorts.add 'out',
    datatype: 'string'

  c.process (input, output) ->
    return unless input.has 'directory', 'path', (ip) -> ip.type is 'data'
    [directoryString, pathString] = input.getData 'directory', 'path'
    output.sendDone path.join directoryString, pathString
