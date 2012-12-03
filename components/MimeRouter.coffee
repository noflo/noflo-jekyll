noflo = require 'noflo'
mimetype = require 'mimetype'

class MimeRouter extends noflo.Component
  constructor: ->
    @routes = []

    @inPorts =
      routes: new noflo.Port
      in: new noflo.ArrayPort
    @outPorts =
      out: new noflo.ArrayPort
      missed: new noflo.Port

    @inPorts.routes.on 'data', (data) =>
      if typeof data is 'string'
        data = data.split ','
      @routes = data

    @inPorts.in.on 'data', (data) =>
      mime = mimetype.lookup data
      return @missed data unless mime

      mimeParts = mime.split '/'
      selected = @routes.indexOf mimeParts[0]
      return @missed data if selected is -1

      @outPorts.out.send data, selected

    @inPorts.in.on 'disconnect', =>
      @outPorts.out.disconnect()
      @outPorts.missed.disconnect() if @outPorts.missed.isAttached()

  missed: (data) ->
    return unless @outPorts.missed.isAttached()
    @outPorts.missed.send data

exports.getComponent = -> new MimeRouter
