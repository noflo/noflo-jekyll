jekyll = require '../index'
rimraf = require 'rimraf'
chai = require 'chai'
fs = require 'fs'
mimetype = require 'mimetype'
path = require 'path'
baseDir = path.resolve __dirname, '../'
sourceDir = path.resolve __dirname, './fixtures/source'
jekyllDir = path.resolve __dirname, './fixtures/jekyll'
nofloDir = path.resolve __dirname, './fixtures/noflo'

# Extra MIME types config
mimetype.set '.markdown', 'text/x-markdown'
mimetype.set '.md', 'text/x-markdown'
mimetype.set '.xml', 'text/xml'

checkBinaryFile = (subPath) ->
  # With binary files we could do content matching like MD5, but for
  # no size comparison should be enough
  nofloStats = fs.statSync path.resolve nofloDir, subPath
  jekyllStats = fs.statSync path.resolve jekyllDir, subPath
  chai.expect(nofloStats.size, "#{subPath} size must match").to.equal jekyllStats.size

checkFile = (subPath) ->
  nofloPath = path.resolve nofloDir, subPath
  jekyllPath = path.resolve jekyllDir, subPath
  try
    fileStats = fs.statSync nofloPath
  catch e
    throw new Error "NoFlo didn't generate file #{subPath}"
    return

  mime = mimetype.lookup subPath
  if not mime or mime.indexOf('text/') is -1
    checkBinaryFile subPath
    return

  # We should check contents without whitespace
  replacer = /[\n\s"']*/g
  nofloContents = fs.readFileSync nofloPath, 'utf-8'
  jekyllContents = fs.readFileSync jekyllPath, 'utf-8'
  nofloClean = nofloContents.replace replacer, ''
  jekyllClean = jekyllContents.replace replacer, ''
  chai.expect(nofloClean, "Contents of #{subPath} must match").to.equal jekyllClean

checkDirectory = (subPath) ->
  nofloPath = path.join nofloDir, subPath
  jekyllPath = path.join jekyllDir, subPath
  try
    dirStats = fs.statSync nofloPath
    unless dirStats.isDirectory()
      throw new Error "NoFlo generated file #{subPath}, not directory"
      return
  catch e
    throw new Error "NoFlo didn't generate dir #{subPath}"
    return

  jekyllFiles = fs.readdirSync jekyllPath
  nofloFiles = fs.readdirSync nofloPath

  for file in jekyllFiles
    jekyllStats = fs.statSync path.join jekyllPath, file
    if jekyllStats.isDirectory()
      checkDirectory path.join subPath, file
      continue
    checkFile path.join subPath, file

describe 'Jekyll program', ->
  c = null
  source = null
  destination = null
  generated = null
  errors = null
  after (done) ->
    rimraf nofloDir, done

  describe 'generating a site', ->
    it 'should complete', (done) ->
      @timeout 10000
      generator = new jekyll.Jekyll sourceDir, nofloDir
      generator.on 'error', (data) ->
        done err
      generator.on 'end', (data) ->
        done()
      generator.run (err) ->
        return done err if err
    it 'should have created the same files as Jekyll', (done) ->
      checkDirectory ''
