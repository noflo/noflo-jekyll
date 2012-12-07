noflo = require 'noflo'
rimraf = require 'rimraf'
fs = require 'fs'

sourceDir = "#{__dirname}/fixtures/site_source"
jekyllDir = "#{__dirname}/fixtures/jekyll"
nofloDir = "#{__dirname}/fixtures/noflo"

getGraph = ->
  graph = new noflo.Graph 'Jekyll'
  graph.addNode 'Jekyll', 'jekyll/Jekyll'
  graph.addNode 'DropGenerated', 'Drop'
  graph.addNode 'DropErrors', 'Drop'
  graph.addEdge 'Jekyll', 'generated', 'DropGenerated', 'in'
  graph.addEdge 'Jekyll', 'errors', 'DropErrors', 'in'
  graph.addInitial sourceDir, 'Jekyll', 'source'
  graph.addInitial nofloDir, 'Jekyll', 'destination'
  graph

nofloTime = 0

exports.setUp = (callback) ->
  startTime = new Date

  finished = ->
    endTime = new Date
    nofloTime = endTime.getTime() - startTime.getTime()
    console.log "NoFlo run finished, took #{nofloTime/1000} seconds"

    do callback

  graph = getGraph()
  noflo.createNetwork graph, (network) ->
    # NoFlo doesn't currently have a "finished" event
    timeOut = null
    handleActivity = ->
      clearTimeout timeOut if timeOut
      timeOut = setTimeout finished, 10

    network.on 'connect', (data) ->
      do handleActivity
    network.on 'data', (data) ->
      do handleActivity
    network.on 'disconnect', (data) ->
      do handleActivity

    timeOut = setTimeout finished, 10

checkDirectory = (subPath, test) ->
  try
    dirStats = fs.statSync "#{nofloDir}/#{subPath}"
    test.equal dirStats.isDirectory(), true
  catch e
    test.fail null, subPath, "NoFlo didn't generate dir #{subPath}"
    return

  jekyllFiles = fs.readdirSync "#{jekyllDir}/#{subPath}"
  nofloFiles = fs.readdirSync "#{nofloDir}/#{subPath}"

  for file in jekyllFiles
    jekyllStats = fs.statSync "#{jekyllDir}/#{subPath}/#{file}"
    if jekyllStats.isDirectory()
      checkDirectory "#{subPath}/#{file}", test
      continue

exports['test file equivalence'] = (test) ->
  checkDirectory '', test
  test.done()

exports.tearDown = (callback) ->
  rimraf nofloDir, (err) ->
    console.log err if err
    do callback
