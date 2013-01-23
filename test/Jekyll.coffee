noflo = require 'noflo'
rimraf = require 'rimraf'
fs = require 'fs'
mimetype = require 'mimetype'

# Extra MIME types config
mimetype.set '.markdown', 'text/x-markdown'
mimetype.set '.md', 'text/x-markdown'
mimetype.set '.xml', 'text/xml'

sourceDir = "#{__dirname}/fixtures/source"
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

exports.setUp = (callback) ->
  startTime = new Date

  graph = getGraph()
  noflo.createNetwork graph, (network) ->
    network.on 'end', (data) ->
      setTimeout ->
        do callback
      , 3000

checkBinaryFile = (subPath, test) ->
  # With binary files we could do content matching like MD5, but for
  # no size comparison should be enough
  nofloStats = fs.statSync "#{nofloDir}/#{subPath}"
  jekyllStats = fs.statSync "#{jekyllDir}/#{subPath}"
  test.equal nofloStats.size, jekyllStats.size, "#{subPath} size must match"

checkFile = (subPath, test) ->
  try
    fileStats = fs.statSync "#{nofloDir}/#{subPath}"
  catch e
    test.fail null, subPath, "NoFlo didn't generate file #{subPath}"
    return

  mime = mimetype.lookup subPath
  if not mime or mime.indexOf('text/') is -1
    checkBinaryFile subPath, test
    return

  # We should check contents without whitespace
  replacer = /[\n\s"']*/g
  nofloContents = fs.readFileSync "#{nofloDir}/#{subPath}", 'utf-8'
  jekyllContents = fs.readFileSync "#{jekyllDir}/#{subPath}", 'utf-8'
  nofloClean = nofloContents.replace replacer, ''
  jekyllClean = jekyllContents.replace replacer, ''
  test.equal nofloClean, jekyllClean, "Contents of #{subPath} must match"

checkDirectory = (subPath, test) ->
  try
    dirStats = fs.statSync "#{nofloDir}/#{subPath}"
    unless dirStats.isDirectory()
      test.fail null, subPath, "NoFlo generated file #{subPath}, not directory"
      return
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
    checkFile "#{subPath}/#{file}", test

exports['test that NoFlo generates same files as Jekyll'] = (test) ->
  checkDirectory '', test
  test.done()

checkDirectoryMatch = (subPath, test) ->
  try
    dirStats = fs.statSync "#{jekyllDir}/#{subPath}"
    test.equal dirStats.isDirectory(), true, "Jekyll-generated #{subPath} must be a directory"
  catch e
    test.fail null, subPath, "Jekyll didn't generate dir #{subPath} but NoFlo did"
    return

  jekyllFiles = fs.readdirSync "#{jekyllDir}/#{subPath}"
  nofloFiles = fs.readdirSync "#{nofloDir}/#{subPath}"

  for file in nofloFiles
    try
      nofloStats = fs.statSync "#{nofloDir}/#{subPath}/#{file}"
      if nofloStats.isDirectory()
        checkDirectoryMatch "#{subPath}/#{file}", test
        continue
      jekyllStats = fs.statSync "#{jekyllDir}/#{subPath}/#{file}"
      test.equal jekyllStats.isDirectory(), false, "NoFlo generated file #{subPath}, Jekyll a directory"
    catch e
      test.fail null, subPath, "Jekyll didn't generate #{subPath} but NoFlo did"


exports['test that NoFlo generates only the files Jekyll does'] = (test) ->
  checkDirectoryMatch '', test
  test.done()

exports.tearDown = (callback) ->

  rimraf nofloDir, (err) ->
    console.log err if err
    do callback
