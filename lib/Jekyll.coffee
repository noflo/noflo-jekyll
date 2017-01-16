noflo = require 'noflo'
events = require 'events'
path = require 'path'

class Jekyll extends events.EventEmitter
  constructor: (source, target) ->
    @graph = @prepareGraph source, target

  run: (callback) ->
    @createNetwork @graph, (err, network) =>
      return callback err if err
      @emit 'network', network

      network.on 'start', (start) =>
        @emit 'start', start

      network.on 'end', (start) =>
        @emit 'end', start
        callback null

  createNetwork: (graph, callback) ->
    graph.baseDir = path.resolve __dirname, '../'
    noflo.createNetwork graph, callback

  generated: (file) ->
    @emit 'generated', file

  error: (error) ->
    @emit 'error', error

  prepareGraph: (source, target) ->
    graph = new noflo.Graph 'Jekyll'

    graph.addNode 'Jekyll', 'jekyll/Jekyll'
    graph.addNode 'Generated', 'Callback'
    graph.addNode 'Errors', 'Callback'

    graph.addEdge 'Jekyll', 'generated', 'Generated', 'in'
    graph.addEdge 'Jekyll', 'errors', 'Errors', 'in'

    generated = (file) => @generated file
    errors = (error) => @error error

    graph.addInitial generated, 'Generated', 'callback'
    graph.addInitial errors, 'Errors', 'callback'
    graph.addInitial source, 'Jekyll', 'source'
    graph.addInitial target, 'Jekyll', 'destination'

    graph

exports.Jekyll = Jekyll
