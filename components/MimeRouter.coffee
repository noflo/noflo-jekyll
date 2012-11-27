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
      return @outPorts.missed.send data unless mime

      mimeParts = mime.split '/'
      selected = @routes.indexOf mimeParts[0]
      return @outPorts.missed.send data if selected is -1

      @outPorts.out.send data, selected

exports.getComponent = -> new MimeRouter
