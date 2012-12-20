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
    config

  processPost: (post) ->
    post.content = post.body
    @config.paginator.posts.unshift post

    return unless post.categories

    for category in post.categories
      unless @config.categories[category]
        @config.categories[category] = []
      @config.categories[category].unshift post

exports.getComponent = -> new PostCollector
