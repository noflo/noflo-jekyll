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
    pending = []
    while @documents.length
      document = @documents.shift()
      unless @checkReady document
        pending.push document
        continue
      @sendDocument document
    for doc in pending
      continue unless @documents.indexOf(doc) is -1
      @documents.push doc

  sendDocument: (data) ->
    @documents.splice @documents.indexOf(data), 1

    @outPorts.template.beginGroup data.path
    @outPorts.template.send @handleInheritance data
    @outPorts.template.endGroup()
    @outPorts.template.disconnect()
    @outPorts.variables.beginGroup data.path
    @outPorts.variables.send data
    @outPorts.variables.endGroup()
    @outPorts.variables.disconnect()

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

  checkIncludes: (body) ->
    matcher = new RegExp '\{\% include (.*)\.html \%\}'
    match = matcher.exec body
    return true unless match
    return true if @includes[match[1]]
    false

  checkReady: (templateData) ->
    if templateData.body
      return false unless @checkIncludes templateData.body
    return true unless templateData.layout
    return false unless @includes[templateData.layout]
    @checkReady @includes[templateData.layout]

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
