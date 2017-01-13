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

    # Run Ruby Jekyll against fixtures to provide the baseline to compare with
    jekyll:
      fixtures:
        options:
          src: 'spec/fixtures/source'
          dest: 'spec/fixtures/jekyll'
          config: 'spec/fixtures/source/_config.yml'
    # BDD tests on Node.js
    mochaTest:
      nodejs:
        src: ['spec/*.coffee']
        options:
          reporter: 'spec'
          require: 'coffee-script/register'
          grep: process.env.TESTS

  @loadNpmTasks 'grunt-noflo-manifest'
  @loadNpmTasks 'grunt-coffeelint'
  @loadNpmTasks 'grunt-mocha-test'
  @loadNpmTasks 'grunt-jekyll'

  @registerTask 'test', ['coffeelint', 'noflo_manifest', 'mochaTest']
