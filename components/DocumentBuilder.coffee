noflo = require 'noflo'
path = require 'path'

class DocumentBuilder extends noflo.Component
  constructor: ->
    @includes = {}
    @documents = []

    @inPorts =
      layouts: new noflo.Port()
      includes: new noflo.Port()
      in: new noflo.Port()
    @outPorts =
      template: new noflo.Port()
      variables: new noflo.Port()
      error: new noflo.Port()

    @inPorts.layouts.on 'data', (data) =>
      @addInclude data

    @inPorts.layouts.on 'disconnect', =>
      do @checkPending

    @inPorts.includes.on 'data', (data) =>
      @addInclude data

    @inPorts.includes.on 'disconnect', =>
      do @checkPending

    @inPorts.in.on 'data', (data) =>
      @documents.push data
      do @checkPending

  checkPending: ->
    @documents.forEach (document) =>
      unless @checkReady document
        return
      @sendDocument document

  sendDocument: (data) ->
    @outPorts.template.beginGroup data.path
    @outPorts.template.send @handleInheritance data
    @outPorts.template.endGroup()
    @outPorts.variables.disconnect()
    @outPorts.variables.beginGroup data.path
    @outPorts.variables.send data
    @outPorts.variables.endGroup()
    @outPorts.variables.disconnect()

    @documents.splice @documents.indexOf(data), 1

  templateName: (templatePath) ->
    path.basename templatePath, path.extname templatePath

  addInclude: (template) ->
    name = @templateName template.path
    @includes[name] = template

  getTemplate: (templateName) ->
    unless @includes[templateName]
      @error new Error "Template #{templateName} not found"
      return
    @handleInheritance @includes[templateName]

  checkReady: (templateData) ->
    return true unless templateData.layout
    return false unless @includes[templateData.layout]
    @checkReady @getTemplate templateData.layout

  handleInheritance: (templateData) ->
    template = templateData.body
    if templateData.layout
      parent = @getTemplate templateData.layout
      if parent
        template = parent.replace '{{ content }}', template
    template

  error: (error) ->
    return unless @outPorts.error.isAttached()
    @outPorts.error.send e
    @outPorts.error.disconnect()

exports.getComponent = -> new DocumentBuilder
