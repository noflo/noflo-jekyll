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
    return permalink.replace '/:categories', ''  unless categories

    clean = []
    for category in categories
      clean.push category if category

    permalink.replace ':categories', clean.join '/'

  handleDate: (permalink, date) ->
    return permalink unless date
    permalink = permalink.replace ':year', date.getFullYear()
    permalink = permalink.replace ':month', date.getMonth() + 1
    permalink = permalink.replace ':day', date.getDate()

  handleTitle: (permalink, name) ->
    permaExt = path.extname permalink
    nameExt = path.extname name
    if permaExt isnt nameExt
      # Remove extension
      dirName = path.dirname permalink
      baseName = path.basename permalink, permaExt
      permalink = "#{dirName}/#{baseName}"
    permalink.replace ':title', name

  handleIndex: (permalink) ->
    return permalink unless permalink[permalink.length - 1] is '/'
    filePath = permalink.slice 0, -1
    permaExt = path.extname filePath
    dirName = path.dirname filePath
    baseName = path.basename filePath, permaExt
    "#{dirName}/#{baseName}/index#{permaExt}"

  buildPath: (post, groups) ->
    newpath = "#{@source}#{@config.permalink}"
    newpath = @handleCategories newpath, post.categories
    newpath = @handleDate newpath, post.date
    newpath = @handleTitle newpath, post.name
    newpath = @handleIndex newpath
    post.path = newpath
    for group in groups
      @outPorts.out.beginGroup group
    @outPorts.out.send post
    for group in groups
      @outPorts.out.endGroup()

exports.getComponent = -> new BuildPostPath
