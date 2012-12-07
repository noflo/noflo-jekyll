noflo = require 'noflo'
mimetype = require 'mimetype'

# Extra MIME types config
mimetype.set '.markdown', 'text/x-markdown'
mimetype.set '.md', 'text/x-markdown'
mimetype.set '.xml', 'text/xml'

class DocumentMimeRouter extends noflo.Component
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
      return @missed data unless data.path

      mime = mimetype.lookup data.path
      return @missed data unless mime

      selected = null
      for matcher, id in @routes
        selected = id unless mime.indexOf(matcher) is -1
      return @missed data if selected is null

      @outPorts.out.send data, selected

    @inPorts.in.on 'disconnect', =>
      @outPorts.out.disconnect()
      @outPorts.missed.disconnect() if @outPorts.missed.isAttached()

  missed: (data) ->
    return unless @outPorts.missed.isAttached()
    @outPorts.missed.send data

exports.getComponent = -> new DocumentMimeRouter
