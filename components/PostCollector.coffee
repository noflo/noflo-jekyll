noflo = require 'noflo'

sortByDate = (post1, post2) ->
  if post1.date == post2.date
    # Same post date, sort by title
    title1 = post1.path.toLowerCase()
    title2 = post2.path.toLowerCase()
    if title1 == title2
      return 0
    if title1 < title2
      return -1
    return 1
  if post1.date < post2.date
    return 1
  return -1

class PostCollector extends noflo.Component
  constructor: ->
    super()
    @config = null
    @buffer = []
    @wasDone = false

    @inPorts =
      config: new noflo.Port
      in: new noflo.Port
    @outPorts =
      out: new noflo.Port

    @inPorts.config.on 'data', (data) =>
      @normalizeConfig data

    @inPorts.in.on 'data', (data) =>
      unless @config
        @buffer.push data
        return
      @processPost data

    @inPorts.in.on 'disconnect', =>
      unless @config
        @wasDone is true
        return
      return unless @outPorts.out.isAttached()
      @outPorts.out.send @sortPosts @config
      @outPorts.out.disconnect()

  normalizeConfig: (config) ->
    @config = config
    @config.posts = []
    @config.categories = {}

    if @buffer.length
      @processPost post for post in @buffer
      @buffer = []
      return unless @wasDone
      @outPorts.out.send @sortPorts @config
      @outPorts.out.disconnect()

  sortPosts: (config) ->
    config.posts.sort sortByDate
    for name,category of config.categories
      category.sort sortByDate
    config

  processPost: (post) ->
    post.content = post.body
    @config.posts.push post

    return unless post.categories

    for category in post.categories
      unless @config.categories[category]
        @config.categories[category] = []
      @config.categories[category].push post

exports.getComponent = -> new PostCollector
