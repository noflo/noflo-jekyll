noflo = require 'noflo'

exports.getComponent = ->
  c = new noflo.Component
  c.inPorts.add 'from',
    datatype: 'string'
  c.inPorts.add 'to',
    datatype: 'string'
  c.outPorts.add 'out'
  c.forwardBrackets =
    to: ['out']
  c.process (input, output) ->
    return unless input.has 'from', 'to'
    values = input.getData 'from', 'to'
    output.sendDone
      out: values.join '='
