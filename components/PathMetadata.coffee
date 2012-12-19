noflo = require 'noflo'
path = require 'path'

class PathMetadata extends noflo.Component
  pathMatcher: ///
    ^
    (\d{4})          # Year
    -
    0?(\d+)          # Month
    -
    0?(\d+)          # Day
    -
    ([A-Za-z0-9-_.]*) #Filename
  ///

  constructor: ->
    @source = ''

    @inPorts =
      in: new noflo.Port()
      source: new noflo.Port()
    @outPorts =
      out: new noflo.Port()

    @inPorts.source.on 'data', (data) =>
      @source = data

    @inPorts.in.on 'begingroup', (group) =>
      @outPorts.out.beginGroup group

    @inPorts.in.on 'data', (data) =>
      @outPorts.out.send @metadata data

    @inPorts.in.on 'endgroup', =>
      @outPorts.out.endGroup group

    @inPorts.in.on 'disconnect', =>
      @outPorts.out.disconnect()

  getDate: (postName, data) ->
    if data.date
      # Parse the ISO date
      return new Date data.date

    match = @pathMatcher.exec postName
    return new Date unless match
    return new Date "#{match[1]}-#{match[2]}-#{match[3]}"

  getName: (postName, data) ->
    match = @pathMatcher.exec postName
    # TODO: use Stringex for generating URL names
    # in cases where we can't parse one
    return '' unless match
    return match[4]

  getCategories: (data) ->
    if data.category
      return data.category
    if data.categories
      return data.categories

    postPath = data.path.replace @source, ''
    dirName = path.dirname postPath
    categories = []
    dirs = dirName.split '/'
    for dir in dirs
      continue unless dir
      continue if dir is '_posts'
      categories.push dir
    return categories

  metadata: (post) ->
    postName = path.basename post.path
    post.date = @getDate postName, post
    post.name = @getName postName, post
    post.categories = @getCategories post
    post

exports.getComponent = -> new PathMetadata
