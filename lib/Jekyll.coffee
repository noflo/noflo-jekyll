noflo = require 'noflo'
events = require 'events'

class Jekyll extends events.EventEmitter
  constructor: (source, target) ->
    @graph = @prepareGraph source, target

  run: ->
    @createNetwork @graph, (network) =>
      @emit 'network', network

      network.on 'start', (start) =>
        @emit 'start', start

      network.on 'end', (start) =>
        @emit 'end', start

  createNetwork: (graph, callback) ->
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
