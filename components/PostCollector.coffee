noflo = require 'noflo'

class PostCollector extends noflo.Component
  constructor: ->
    @config = null

    @inPorts =
      config: new noflo.Port
      in: new noflo.Port
    @outPorts =
      out: new noflo.Port

    @inPorts.config.on 'data', (data) =>
      @normalizeConfig data

    @inPorts.in.on 'data', (data) =>
      @processPost data

    @inPorts.in.on 'disconnect', =>
      return unless @outPorts.out.isAttached()
      @outPorts.out.send @sortPosts @config
      @outPorts.out.disconnect()

  normalizeConfig: (config) ->
    @config = config
    @config.paginator =
      posts: []
    @config.categories = {}

  sortPosts: (config) ->
    config.paginator.posts = config.paginator.posts.reverse()
    for category, posts of config.categories
      config.categories[category] = posts.reverse()

  processPost: (post) ->
    post.content = post.body
    for category in post.categories
      unless @config.categories[category]
        @config.categories[category] = []
      @config.categories[category].push post
    @config.paginator.posts.push post

exports.getComponent = -> new PostCollector
