noflo-jekyll [![Build Status](https://travis-ci.org/the-grid/noflo-jekyll.png?branch=master)](https://travis-ci.org/the-grid/noflo-jekyll)
============

Flow-based implementation of static site generation.

![Main process flow](http://cdn.thegrid.io.s3.amazonaws.com/noflo/kickstarter/images/cards-v4-kickstarter-up.jpg)

## Installation

If you want to use this as a command-line executable, then the easiest option is to install it globally with:

    $ npm install -g noflo-jekyll

If you want to use it as a library inside a bigger application, then just install it as a dependency by:

    $ npm install noflo-jekyll --save

## Command-line usage

Since this project aims for feature parity with Jekyll, the command-line usage is similar. To generate a site, run:

    $ noflo-jekyll source_dir target_dir

## Usage in Node.js applications

The site generation graph can also be used as a library in Node.js applications.

``` javascript
var Jekyll, generator;
Jekyll = require('noflo-jekyll').Jekyll;

// Prepare the site generator
generator = new Jekyll('source_dir', 'target_dir');

// Event handling
generator.on('start', function () {
  console.log("Build started");
});

generator.on('error', console.error);

generator.on('end', function (end) {
  var seconds = end.uptime / 1000;
  console.log("Build finished in " + seconds);
});

// Start the process
generator.run();
```

## Usage in NoFlo graphs

The main site generation flow is exposed as the `jekyll/Jekyll` graph. Here is a simple example of using it in another graph:

``` fbp
# Directory setup
'/some/source/directory' -> SOURCE Generator(jekyll/Jekyll)
'/some/target/directory' -> DESTINATION Generator()

# Outputs
Generator() GENERATED -> IN Drop(Drop)
Generator() ERRORS -> IN Display(Output)
```

## Known issues and differences with Ruby Jekyll

### Template incompatibilities

The Liquid Templating library we use, [liquid-node](https://github.com/sirlantis/liquid-node) does not cover 100% of the Liquid spec, so some template parameters that work with Jekyll might not yet work.

We're working with the liquid-node developers to improve the coverage, and this is something you can also help with. Please [report an issue](https://github.com/sirlantis/liquid-node/issues) if you are using something that doesn't work!

### Newer Jekyll features

When this project was started, Jekyll was still in the pre-1.0 stage, and its development had stopped. Since then, its development resumed, and [1.0 added features](http://jekyllrb.com/docs/upgrading/) that we don't yet provide. These include:

* Draft posts
* Timezones
* Baseurl

Please report any [issues you encounter](https://github.com/the-grid/noflo-jekyll/issues) with these or other Jekyll features.

### No web server

The Ruby Jekyll includes a rudimentary web server for testing purposes. As that is outside of the scope of static site generation, this feature was not included into the NoFlo Jekyll implementation. You can serve the generated pages in many ways, including [grunt-contrib-connect](https://npmjs.org/package/grunt-contrib-connect), [simple-server](https://npmjs.org/package/simple-server), or [NoFlo webserver](http://noflojs.org/library/noflo-webserver/).
