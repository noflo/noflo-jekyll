noflo = require 'noflo'

setupNetwork = ->
  graph = new noflo.Graph 'GetConfig'
  graph.addNode 'ConfigReader', 'jekyll/GetConfig'
  graph.addNode 'Callback', 'Callback'
  graph.addEdge 'ConfigReader', 'config', 'Callback', 'in'
  graph

exports['test reading config'] = (test) ->
  configFile = "#{__dirname}/fixtures/site_source"
  graph = setupNetwork()

  checkConfig = (config) ->
    test.ok config
    test.equal typeof config, 'object'
    test.equal config.name, 'noflo-jekyll test'
    test.done()

  network = noflo.createNetwork graph, ->
    # Connect our function to the Callback node
    graph.addInitial checkConfig, 'Callback', 'callback'
    # Send config file to the DIRECTORY port
    graph.addInitial configFile, 'ConfigReader', 'directory'
