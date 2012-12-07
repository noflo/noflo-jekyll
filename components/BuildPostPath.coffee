noflo = require 'noflo'
path = require 'path'

class BuildPostPath extends noflo.Component
  constructor: ->
    @inPorts =
      in: new noflo.Port()
      source: new noflo.Port()
      config: new noflo.Port()
    @outPorts =
      out: new noflo.Port()

    @posts = []
    @groups = []
    @config = null
    @source = null

    @inPorts.in.on 'begingroup', (group) =>
      @groups.push group

    @inPorts.in.on 'data', (data) =>
      if @config and @source
        @buildPath data, @groups
        return
      @posts.push
        post: data
        groups: @groups.slice 0

    @inPorts.in.on 'endgroup', =>
      groups.pop()

    @inPorts.in.on 'disconnect', =>
      @outPorts.out.disconnect()

    @inPorts.source.on 'data', (data) =>
      @source = data
      do @buildPaths if @config

    @inPorts.config.on 'data', (data) =>
      @config = data
      do @buildPaths if @source

  buildPaths: ->
    while @posts.length
      data = @posts.shift()
      @buildPath data.post, data.groups

  handleCategories: (permalink, categories) ->
    return permalink unless categories
    permalink.replace ':categories', categories.join '/'

  handleTitle: (permalink, name) ->
    permaExt = path.extname permalink
    nameExt = path.extname name
    if permaExt isnt nameExt
      # Remove extension
      dirName = path.dirname permalink
      baseName = path.basename permalink, permaExt
      permalink = "#{dirName}/#{baseName}"
    permalink.replace ':title', name

  buildPath: (post, groups) ->
    newpath = "#{@source}#{@config.permalink}"
    newpath = @handleCategories newpath, post.categories
    newpath = @handleTitle newpath, post.name
    post.path = newpath
    for group in groups
      @outPorts.out.beginGroup group
    @outPorts.out.send post
    for group in groups
      @outPorts.out.endGroup()

exports.getComponent = -> new BuildPostPath
