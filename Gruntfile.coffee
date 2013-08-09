module.exports = ->
  # Project configuration
  @initConfig
    pkg: @file.readJSON 'package.json'

    # Coding standards
    coffeelint:
      all:
        files:
          src: ['components/*.coffee', 'lib/*.coffee']

    # Unit tests
    nodeunit:
      all: ['test/*.coffee']

  @loadNpmTasks 'grunt-coffeelint'
  @loadNpmTasks 'grunt-contrib-nodeunit'

  @registerTask 'test', ['coffeelint', 'nodeunit']
