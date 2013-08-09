noflo = require 'noflo'
path = require 'path'

class DocumentBuilder extends noflo.Component
  constructor: ->
    @includes = {}
    @documents = []
    @config = null

    @inPorts =
      layouts: new noflo.Port()
      includes: new noflo.Port()
      in: new noflo.Port()
      config: new noflo.Port()
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

    @inPorts.config.on 'data', (data) =>
      @config = data
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
    @outPorts.template.beginGroup data.path
    @outPorts.template.send @handleInheritance data
    @outPorts.template.endGroup()
    @outPorts.template.disconnect()
    @outPorts.variables.beginGroup data.path
    @outPorts.variables.send @handleVariableInheritance data
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

  getTemplateData: (templateName) ->
    unless @includes[templateName]
      @error new Error "Template #{templateName} not found"
      return
    @handleVariableInheritance @includes[templateName]


  checkIncludes: (body) ->
    matcher = new RegExp '\{\% include (.*)\.html \%\}'
    match = matcher.exec body
    return true unless match
    if @includes[match[1]]
      include = @includes[match[1]]
      return @checkCategories include.body, include
    false

  # If document contents refer to the posts list, we need to
  # wait until we have posts available
  checkPosts: (body, document) ->
    if body.indexOf('site.posts') is -1 and
        body.indexOf('paginator.posts') is -1
      return true
    return false unless @config
    true

  checkPaginator: (body, document) ->
    return true if body.indexOf('paginator.posts') is -1
    return false unless @config
    true

  # If document contents refer to the categories list, we need to
  # wait until we have posts available
  checkCategories: (body, document) ->
    return true if body.indexOf('site.categories') is -1
    return false unless @config
    true

  # Check whether a document is ready to be created, of if it is
  # still waiting for some parts (includes, posts, layouts)
  checkReady: (templateData) ->
    if templateData.body
      return false unless @checkIncludes templateData.body
      return false unless @checkPosts templateData.body, templateData
      return false unless @checkCategories templateData.body, templateData
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

  handleVariableInheritance: (data) ->
    if data.layout
      parent = @getTemplateData data.layout
      if parent
        for key, val of parent
          continue if key is 'body'
          continue if data[key] isnt undefined
          data[key] = val
    data

  error: (error) ->
    return unless @outPorts.error.isAttached()
    @outPorts.error.send e
    @outPorts.error.disconnect()

exports.getComponent = -> new DocumentBuilder
