module.exports = ->
  # Project configuration
  @initConfig
    pkg: @file.readJSON 'package.json'

    # Updating the package manifest files
    noflo_manifest:
      update:
        files:
          'package.json': ['graphs/*', 'components/*']

    # Coding standards
    coffeelint:
      all:
        files:
          src: ['components/*.coffee', 'lib/*.coffee']

    # Unit tests
    nodeunit:
      all: ['test/*.coffee']
      options:
        reporter: 'default'

    # Run Ruby Jekyll against fixtures to provide the baseline to compare with
    jekyll:
      fixtures:
        options:
          src: 'test/fixtures/source'
          dest: 'test/fixtures/jekyll'
          config: 'test/fixtures/source/_config.yml'

  @loadNpmTasks 'grunt-noflo-manifest'
  @loadNpmTasks 'grunt-coffeelint'
  @loadNpmTasks 'grunt-contrib-nodeunit'
  @loadNpmTasks 'grunt-jekyll'

  @registerTask 'test', ['coffeelint', 'noflo_manifest', 'nodeunit']
